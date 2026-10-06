/** 论文线（0206 Task 5.2–5.6）：日志解析（79 列回接/括号栈/l.行号）、
 * 骨架渲染、引用审计、快照回滚（哈希比对）、大纲 G1 状态机。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refold, parseTeXLog } from '../src/writer/texlog.ts'
import { compilePaper, fallbackError } from '../src/writer/compile.ts'
import { renderScaffold } from '../src/writer/scaffold.ts'
import { extractCiteKeys, auditCites } from '../src/writer/cite-audit.ts'
import { createSnapshot, listSnapshots, restoreSnapshot } from '../src/writer/snapshot.ts'
import { emptyOutline, parseOutline, serializeOutline, confirmOutline, assertConfirmed, outlinePrompt } from '../src/writer/outline.ts'
import { getVenue } from '../src/venue/registry.ts'
import { ServiceError } from '../src/service.ts'

test('texlog：79 列折行回接——恰好 79 列的行吞并下一行', () => {
  const long = 'A'.repeat(79)
  const folded = [long, 'B'.repeat(30), 'short line', '! LaTeX Error: boom']
  assert.deepEqual(refold(folded), [`${long}${'B'.repeat(30)}`, 'short line', '! LaTeX Error: boom'])
})

test('texlog：错误块 → {file, line, code, message}（括号栈 + l.行号）', () => {
  const log = [
    '(./sections/02-method.tex',
    'LaTeX2e <2026-01-01> patch level 3',
    '(./figs/pipeline.tikz)',
    '! Undefined control sequence.',
    'l.42 \\usemywidget',
    ')',
    '(./sections/03-experiments.tex',
    '! LaTeX Error: File `figs/missing.pdf\' not found.',
    'See the LaTeX manual or LaTeX Companion for explanation.',
    'l.88 \\includegraphics{figs/missing.pdf}',
  ].join('\n')
  const parsed = parseTeXLog(log)
  assert.equal(parsed.errors.length, 2)
  assert.equal(parsed.errors[0]?.code, 'Undefined control sequence')
  assert.equal(parsed.errors[0]?.line, 42)
  assert.equal(parsed.errors[0]?.file, './sections/02-method.tex', '错误落在当前打开的节文件')
  assert.equal(parsed.errors[1]?.file, './sections/03-experiments.tex')
  assert.equal(parsed.errors[1]?.line, 88)
  assert.ok(parsed.warnings.length === 0, '无 Warning 行不产告警')
})

test('texlog：file:line: 冒号形态（latexmk/tectonic 风格）优先', () => {
  const log = [
    '! Package pgfplots Error: Could not read table file "data.tsv".',
    './sections/05-results.tex:31: Package pgfplots Error: Could not read table file "data.tsv".',
    'Type H <return> for immediate help.',
  ].join('\n')
  const parsed = parseTeXLog(log)
  assert.equal(parsed.errors[0]?.file, './sections/05-results.tex')
  assert.equal(parsed.errors[0]?.line, 31)
})

test('texlog：Warning 归集 + 无错误日志零错误', () => {
  const log = [
    'LaTeX Warning: Citation `vaswani2017\' undefined on input line 12.',
    'Package hyperref Warning: Rerun to get outlines.',
  ].join('\n')
  const parsed = parseTeXLog(log)
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.warnings.length, 2)
})

test('compile：tectonic 单轮成功；latexmk Rerun 提示触发重跑（≤2）', async () => {
  const tectonicLog = ['Compiling main.tex', 'Writing build/main.pdf'].join('\n')
  const tectonic = await compilePaper({
    engine: 'tectonic',
    entry: 'main.tex',
    run: async (command, args) => ({ stdout: `${command} ${args.join(' ')}\n${tectonicLog}`, stderr: '' }),
  })
  assert.equal(tectonic.ok, true)
  assert.equal(tectonic.reran, 0)
  assert.equal(tectonic.parsed.errors.length, 0)

  let latexmkCalls = 0
  const latexmk = await compilePaper({
    engine: 'latexmk',
    entry: 'main.tex',
    run: async () => {
      latexmkCalls += 1
      return { stdout: 'Latexmk: All targets () are up-to-date\nLaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.', stderr: '' }
    },
  })
  // 首轮日志含 Rerun → 重跑 2 次封顶
  assert.equal(latexmk.reran, 2)
  assert.equal(latexmkCalls, 3)
})

test('compile：非零退出（nonstopmode 日志）→ 结构化错误，fallbackError 兜底', async () => {
  const failingLog = [
    '(./sections/02-method.tex',
    '! Undefined control sequence.',
    'l.7 \\brokenmacro',
  ].join('\n')
  const outcome = await compilePaper({
    engine: 'pdflatex',
    entry: 'main.tex',
    run: async () => {
      throw new Error(`exit code 1\n${failingLog}`)
    },
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.parsed.errors[0]?.line, 7)
  assert.equal(fallbackError(failingLog)?.code, 'Undefined control sequence')
  assert.equal(fallbackError(''), undefined, '空日志不编造错误')
})

test('scaffold：按 venue 渲染 main.tex + sections + refs.bib（结构体检素材）', () => {
  const venue = getVenue('ieee-journal')!
  const plan = renderScaffold({ venue, title: 'Attention & Transformers: 100% of NLP' })
  assert.ok(plan.mainTex.includes('\\documentclass[journal]{IEEEtran}'))
  assert.ok(plan.mainTex.includes('\\usepackage{algorithm}'))
  assert.ok(plan.mainTex.includes('\\usepackage{booktabs}'))
  assert.ok(plan.mainTex.includes('\\bibliographystyle{IEEEtran}'))
  assert.ok(plan.mainTex.includes('Attention \\& Transformers: 100\\% of NLP'), '特殊字符转义')
  assert.equal(plan.sections.length, venue.sectionOrder.length)
  assert.ok(Object.keys(plan.files).every(path => path.startsWith('sections/') || path === 'refs.bib'))
  const zh = renderScaffold({ venue: getVenue('cn-journal')!, title: '语义通信综述' })
  assert.ok(zh.mainTex.includes('\\documentclass[zihao=-4,a4paper]{ctexart}'))
  assert.ok(zh.mainTex.includes('引言'))
})

test('cite-audit：差集正确；\\cite 多 key/可选参数；\\nocite{*} 单独标记', () => {
  const tex = [
    '\\cite{vaswani2017,devlin2019}',
    '\\cite[p.~5]{brown2020}',
    '\\nocite{*}',
    '\\cite{ ghost2020 }',
  ].join('\n')
  const extracted = extractCiteKeys(tex)
  assert.deepEqual([...extracted.keys].sort(), ['brown2020', 'devlin2019', 'ghost2020', 'vaswani2017'])
  assert.equal(extracted.nociteAll, true)

  const bib = '@article{vaswani2017, title={A}, year={2017}}\n@inproceedings{devlin2019, title={B}}\n@misc{legacy2010, title={C}}'
  const audit = auditCites([{ name: 'sections/01-introduction.tex', text: tex }], bib)
  assert.deepEqual(audit.missing, ['brown2020', 'ghost2020'])
  assert.deepEqual(audit.unused, ['legacy2010'])
  assert.equal(audit.nociteAll, true)
})

test('snapshot：创建留档带哈希；回滚哈希一致恢复；篡改留档报 CORRUPT', async () => {
  const paper = await mkdtemp(join(tmpdir(), 'srw-paper-'))
  try {
    await mkdir(join(paper, 'sections'), { recursive: true })
    await mkdir(join(paper, 'build'), { recursive: true })
    await writeFile(join(paper, 'main.tex'), '\\documentclass{article}\n\\begin{document}hi\\end{document}\n')
    await writeFile(join(paper, 'sections', '01-introduction.tex'), '\\section{Introduction}\n')
    await writeFile(join(paper, 'refs.bib'), '@article{a, title={A}}\n')
    await writeFile(join(paper, 'build', 'main.pdf'), Buffer.from('%PDF-1.4 fake'))

    const snap = await createSnapshot(paper, { engine: 'tectonic', compileMs: 1200 })
    assert.equal(snap.files, 4)
    assert.equal((await listSnapshots(paper)).length, 1)

    // 修改现场 → 回滚 → 内容回到快照态
    await writeFile(join(paper, 'sections', '01-introduction.tex'), '\\section{Changed}\n')
    await writeFile(join(paper, 'sections', '99-leftover.tex'), '\\section{Junk}\n')
    const restored = await restoreSnapshot(paper, snap.id)
    assert.equal(await readFile(join(paper, 'sections', '01-introduction.tex'), 'utf8'), '\\section{Introduction}\n')
    assert.ok(restored.includes('-sections/99-leftover.tex'), '陈旧节文件被清除并报告')

    // 篡改快照内容 → CORRUPT（不静默恢复）
    const badSnap = await createSnapshot(paper, { engine: 'tectonic' })
    await writeFile(join(paper, 'snapshots', badSnap.id, 'main.tex'), '\\documentclass{tampered}')
    await assert.rejects(
      () => restoreSnapshot(paper, badSnap.id),
      (error: unknown) => error instanceof ServiceError && error.code === 'CORRUPT',
    )
    assert.equal((await listSnapshots(paper)).find(item => item.id === snap.id)?.engine, 'tectonic')
  } finally {
    await rm(paper, { recursive: true, force: true })
  }
})

test('outline：G1 状态机——未确认禁止正文生成；确认落 revision；改大纲回 draft', () => {
  const outline = emptyOutline([
    { title: 'Introduction', intent: '问题与贡献' },
    { title: 'Method', intent: '方法框架' },
  ])
  assert.throws(() => assertConfirmed(outline), (error: unknown) => error instanceof ServiceError && error.code === 'GATE')

  const confirmed = confirmOutline(outline)
  assert.equal(confirmed.status, 'confirmed')
  assert.equal(confirmed.revision, 1)
  assert.ok(confirmed.confirmedAt !== undefined)
  assertConfirmed(confirmed) // 不抛

  // 幂等确认
  assert.equal(confirmOutline(confirmed).revision, 1)

  // 解析往返
  const roundtrip = parseOutline(serializeOutline(confirmed))
  assert.equal(roundtrip.revision, 1)
  assert.equal(roundtrip.sections[1]?.title, 'Method')

  // 坏数据拒收
  assert.throws(() => parseOutline('{broken'), /INVALID|JSON/)
  assert.throws(() => parseOutline(JSON.stringify({ schemaVersion: 2 })), /schemaVersion/)

  // 确认后改大纲 → draft（revision 不动）
  const edited = confirmOutline(confirmed)
  const redraft = { ...edited, sections: edited.sections.map(section => ({ ...section, status: 'draft' as const })) }
  assert.equal(confirmOutline(redraft).revision, 2, '重新确认 revision+1')
})

test('outline：分档提示词——D1 无 Related Work 要求、D3 有', () => {
  const d1 = outlinePrompt({ tier: 'D1', topic: '语义通信', venueName: 'Workshop' })
  assert.ok(!d1.includes('必须含 Related Work'))
  const d3 = outlinePrompt({ tier: 'D3', topic: '语义通信', venueName: 'IEEE Transactions' })
  assert.ok(d3.includes('必须含 Related Work'))
  assert.ok(d3.includes('12–20 页'))
})
