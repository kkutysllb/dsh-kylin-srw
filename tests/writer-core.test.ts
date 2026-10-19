/** 论文线（0206 Task 5.2–5.6）：日志解析（79 列回接/括号栈/l.行号）、
 * 骨架渲染、引用审计、快照回滚（哈希比对）、大纲 G1 状态机。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refold, parseTeXLog } from '../src/writer/texlog.ts'
import { compilePaper, fallbackError } from '../src/writer/compile.ts'
import { renderScaffold, INPUT_BEGIN, INPUT_END, syncInputBlock } from '../src/writer/scaffold.ts'
import { compileCommand } from '../src/writer/engine.ts'
import { extractCiteKeys, auditCites } from '../src/writer/cite-audit.ts'
import { createHash } from 'node:crypto'
import { createSnapshot, listSnapshots, restoreSnapshot, tagSnapshot } from '../src/writer/snapshot.ts'
import { diffLines } from '../src/writer/diff.ts'
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
    cwd: '/tmp/srw-test-paper',
    run: async (command, args) => ({ stdout: `${command} ${args.join(' ')}\n${tectonicLog}`, stderr: '' }),
  })
  assert.equal(tectonic.ok, true)
  assert.equal(tectonic.reran, 0)
  assert.equal(tectonic.parsed.errors.length, 0)

  let latexmkCalls = 0
  const latexmk = await compilePaper({
    engine: 'latexmk',
    entry: 'main.tex',
    cwd: '/tmp/srw-test-paper',
    run: async () => {
      latexmkCalls += 1
      return { stdout: 'Latexmk: All targets () are up-to-date\nLaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.', stderr: '' }
    },
  })
  // 首轮日志含 Rerun → 重跑 2 次封顶
  assert.equal(latexmk.reran, 2)
  assert.equal(latexmkCalls, 3)
})

test('compile：xelatex + bibtex 串行；bbl 与最终 pass 的 undefined citation 统计', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'srw-bib-'))
  try {
    await mkdir(join(cwd, 'build'), { recursive: true })
    const commands: string[] = []
    let xelatexCalls = 0
    const outcome = await compilePaper({
      engine: 'xelatex',
      entry: 'main.tex',
      cwd,
      bibTool: 'bibtex',
      run: async (command) => {
        commands.push(command)
        if (command === 'bibtex') {
          await writeFile(join(cwd, 'build', 'main.bbl'), '\\begin{thebibliography}{1}\n')
          return { stdout: 'bibtex: wrote main.bbl', stderr: '' }
        }
        xelatexCalls += 1
        // 首轮有未解析引用（后续轮修好）：统计只看最终 pass，不能把历史噪声算进结果。
        return {
          stdout: xelatexCalls === 1
            ? "LaTeX Warning: Citation \`x' undefined on input line 1.\nOutput written on main.pdf (1 page)."
            : 'Output written on main.pdf (1 page).',
          stderr: '',
        }
      },
    })
    assert.deepEqual(commands, ['xelatex', 'bibtex', 'xelatex', 'xelatex'])
    assert.equal(outcome.ok, true)
    assert.equal(outcome.reran, 2)
    assert.deepEqual(outcome.bib, { tool: 'bibtex', bbl: true, undefinedCitations: 0 })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
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
    cwd: '/tmp/srw-test-paper',
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

test('scaffold：输入清单由大纲单源重写（标记块 + 旧项目 fallback），不静默丢节', () => {
  const venue = getVenue('ieee-journal')!
  const plan = renderScaffold({ venue, title: 'T' })
  assert.ok(plan.mainTex.includes(INPUT_BEGIN))
  assert.ok(plan.mainTex.includes(INPUT_END))
  const sections = [
    { title: 'Introduction', file: 'sections/01-introduction.tex' },
    { title: 'Method', file: 'sections/03-method.tex' },
  ]
  const synced = syncInputBlock(plan.mainTex, sections)
  assert.ok(synced.includes('\\input{sections/01-introduction} % Introduction'))
  assert.ok(synced.includes('\\input{sections/03-method} % Method'))
  assert.ok(!synced.includes('02-related-work'))
  assert.ok(synced.indexOf(INPUT_BEGIN) < synced.indexOf(INPUT_END))
  // 旧项目（无标记）也要能替换第一段连续 input
  const legacy = plan.mainTex.replace(INPUT_BEGIN, '').replace(INPUT_END, '')
  const legacySynced = syncInputBlock(legacy, sections)
  assert.ok(legacySynced.includes('\\input{sections/03-method}'))
  assert.ok(!legacySynced.includes('02-related-work'))
})

test('compileCommand：四种引擎都统一输出到 build/', () => {
  assert.deepEqual(compileCommand('tectonic', 'main.tex').args, ['--outdir', 'build', 'main.tex'])
  assert.ok(compileCommand('latexmk', 'main.tex').args.includes('-outdir=build'))
  assert.ok(compileCommand('xelatex', 'main.tex').args.includes('-output-directory=build'))
  assert.ok(compileCommand('pdflatex', 'main.tex').args.includes('-output-directory=build'))
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
    const result = await restoreSnapshot(paper, snap.id)
    assert.equal(await readFile(join(paper, 'sections', '01-introduction.tex'), 'utf8'), '\\section{Introduction}\n')
    assert.ok(result.restored.includes('-sections/99-leftover.tex'), '陈旧节文件被清除并报告')

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

test('diff：行 diff——同文空；改一行 1 hunk 行号正确；尾部纯增/头部纯删；两处改动两 hunk（8.2）', () => {
  assert.deepEqual(diffLines('a\nb\nc\n', 'a\nb\nc\n'), [], '同文零 hunk')
  const one = diffLines('a\nold\nc\n', 'a\nnew\nc\n')
  assert.equal(one.length, 1)
  assert.equal(one[0]?.aStart, 2)
  assert.equal(one[0]?.aCount, 1)
  assert.equal(one[0]?.bStart, 2)
  assert.equal(one[0]?.bCount, 1)
  assert.deepEqual(one[0]?.lines, [{ op: '-', text: 'old' }, { op: '+', text: 'new' }])

  const append = diffLines('a\n', 'a\nb\nc\n')
  assert.equal(append.length, 1)
  assert.equal(append[0]?.aStart, 2)
  assert.equal(append[0]?.aCount, 0, '纯增：a 侧不消费行')
  assert.equal(append[0]?.bStart, 2)
  assert.equal(append[0]?.bCount, 2)

  const delHead = diffLines('x\ny\n', 'y\n')
  assert.equal(delHead.length, 1)
  assert.equal(delHead[0]?.aStart, 1)
  assert.equal(delHead[0]?.aCount, 1)
  assert.equal(delHead[0]?.bStart, 1)
  assert.equal(delHead[0]?.bCount, 0, '纯删：b 侧不消费行')

  const two = diffLines('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\nE\n')
  assert.equal(two.length, 2, '被上下文隔开的两处改动 → 两个 hunk')
  assert.deepEqual(two[0]?.lines, [{ op: '-', text: 'a' }, { op: '+', text: 'A' }])
  assert.deepEqual(two[1]?.lines, [{ op: '-', text: 'e' }, { op: '+', text: 'E' }])
})

test('snapshot：materialsHash 留档 + 标签 + 回滚漂移检测 materialDrift（8.1）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-proj-'))
  const paper = join(root, 'paper')
  try {
    await mkdir(join(paper, 'sections'), { recursive: true })
    await mkdir(join(root, 'materials'), { recursive: true })
    await writeFile(join(paper, 'main.tex'), '\\documentclass{article}\n\\begin{document}hi\\end{document}\n')
    await writeFile(join(paper, 'sections', '01-introduction.tex'), '\\section{Introduction}\n')
    await writeFile(join(root, 'materials', 'manifest.json'), '{"schemaVersion":1,"artifacts":[]}\n')

    const snap = await createSnapshot(paper)
    const manifest = JSON.parse(await readFile(join(paper, 'snapshots', snap.id, 'manifest.json'), 'utf8')) as { kind?: string; materialsHash?: string }
    assert.equal(manifest.kind, 'compile', '默认 kind=compile')
    assert.ok(manifest.materialsHash !== undefined, '项目级 materials manifest 哈希入档')

    await tagSnapshot(paper, snap.id, { label: 'baseline', note: '首轮基线' })
    const listed = (await listSnapshots(paper)).find(item => item.id === snap.id)
    assert.equal(listed?.label, 'baseline', '标签入 manifest 并在 list 可见')
    assert.equal(listed?.note, '首轮基线')
    await assert.rejects(
      () => tagSnapshot(paper, snap.id, { label: '   ' }),
      (error: unknown) => error instanceof ServiceError && error.code === 'INVALID',
    )
    await assert.rejects(
      () => tagSnapshot(paper, 'no-such', { label: 'x' }),
      (error: unknown) => error instanceof ServiceError && error.code === 'NOT_FOUND',
    )

    const first = await restoreSnapshot(paper, snap.id)
    assert.equal(first.materialDrift, false, 'materials 未变 → 不报漂移')

    await writeFile(join(root, 'materials', 'manifest.json'), '{"schemaVersion":1,"artifacts":[{"tampered":true}]}\n')
    const drifted = await restoreSnapshot(paper, snap.id)
    assert.equal(drifted.materialDrift, true, 'materials 被改 → 报漂移（提示而非阻断）')

    await rm(join(root, 'materials'), { recursive: true, force: true })
    const lost = await restoreSnapshot(paper, snap.id)
    assert.equal(lost.materialDrift, true, 'materials manifest 丢失也算漂移')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('snapshot：旧格式 manifest（无新字段）list/restore 照常——向后兼容（8.1）', async () => {
  const paper = await mkdtemp(join(tmpdir(), 'srw-oldsnap-'))
  try {
    const id = '2026-01-01T00-00-00-000Z'
    await mkdir(join(paper, 'snapshots', id), { recursive: true })
    const main = Buffer.from('\\documentclass{article}\n\\begin{document}old\\end{document}\n')
    await writeFile(join(paper, 'main.tex'), main)
    await writeFile(join(paper, 'snapshots', id, 'main.tex'), main)
    await writeFile(join(paper, 'snapshots', id, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      files: { 'main.tex': createHash('sha256').update(main).digest('hex') },
    }))
    const listed = await listSnapshots(paper)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.label, undefined, '旧格式无标签字段')
    const result = await restoreSnapshot(paper, id)
    assert.ok(result.restored.includes('main.tex'))
    assert.equal(result.materialDrift, undefined, '旧格式无 materialsHash → 不判漂移')
  } finally {
    await rm(paper, { recursive: true, force: true })
  }
})

test('snapshot：伪造 manifest 的越界路径 → FORBIDDEN（不写 paper 外）', async () => {
  const paper = await mkdtemp(join(tmpdir(), 'srw-paper-'))
  try {
    await mkdir(join(paper, 'sections'), { recursive: true })
    await writeFile(join(paper, 'main.tex'), '\\documentclass{article}\n')
    await writeFile(join(paper, 'sections', '01-introduction.tex'), '\\section{Introduction}\n')
    await writeFile(join(paper, 'refs.bib'), '@article{a, title={A}}\n')
    const snap = await createSnapshot(paper)
    const manifestPath = join(paper, 'snapshots', snap.id, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { files: Record<string, string> }
    manifest.files['../escaped.txt'] = '0'.repeat(64)
    await writeFile(manifestPath, JSON.stringify(manifest))
    await assert.rejects(
      () => restoreSnapshot(paper, snap.id),
      (error: unknown) => error instanceof ServiceError && error.code === 'FORBIDDEN',
    )
    await assert.rejects(() => readFile(join(paper, '..', 'escaped.txt')))
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
