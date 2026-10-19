/** WriterService 全链（0206 Task 5.2–5.8 集成面）：假引擎注入——骨架 →
 * 大纲（G1 门拒正文）→ 确认 → section.write → 编译成功留快照 → 改坏再
 * 编译失败（错误带行）→ 回滚恢复。真引擎不在单测范围（本机四缺）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { WriterService, type VenueInstance, type WriterDeps } from '../src/writer/service.ts'
import type { RunPort } from '../src/writer/engine.ts'
import { ServiceError } from '../src/service.ts'
import { emptyOutline, serializeOutline } from '../src/writer/outline.ts'

function fakeFs() {
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = pathResolve(parent.key)
      const c = pathResolve(child.key)
      return c === p || c.startsWith(`${p}/`)
    },
  }
}

/** 假 tectonic：产出固定 PDF；任一 .tex（main + sections/）含 \brokenmacro
 * 时按真实 nonstopmode 日志形态失败（错误消息被 79 列折行——顺带验证解析链）。 */
function fakeEngine(): RunPort {
  return async (command, args, options) => {
    if (command !== 'tectonic') throw new Error(`spawn ${command} ENOENT`)
    // 探测阶段只回版本号：不读写 cwd，避免单测把假 PDF 写进仓库根（历史脏产物来源）。
    if (args.includes('--version')) return { stdout: 'tectonic 0.15.0-fake', stderr: '' }
    const { readdir } = await import('node:fs/promises')
    const texFiles: string[] = []
    const main = await readFile(join(options.cwd, 'main.tex'), 'utf8').catch(() => '')
    texFiles.push(main)
    for (const name of await readdir(join(options.cwd, 'sections')).catch(() => [])) {
      if (name.endsWith('.tex')) texFiles.push(await readFile(join(options.cwd, 'sections', name), 'utf8'))
    }
    const all = texFiles.join('\n')
    // 行号按所在文件算（真实引擎语义）
    let brokenLine = 0
    for (const text of texFiles) {
      const index = text.split('\n').findIndex(line => line.includes('\\brokenmacro'))
      if (index >= 0) {
        brokenLine = index + 1
        break
      }
    }
    if (brokenLine > 0) {
      // 79 列折行形态：解释行被引擎折成 79 列 + 余行（refold 应回接）
      const explain = 'the argument x was used somewhere in the document body and it is undef'.padEnd(79, 'i')
      const long = `! Undefined control sequence.\n${explain}\n ned indeed\nl.${brokenLine} \\brokenmacro`
      throw new Error(`exit 1\n${long}`)
    }
    // 真实引擎按命令行 outdir 落产物（tectonic --outdir / latexmk -outdir= /
    // xelatex -output-directory=）；假引擎也照这个语义写，才能钉住 P1-1 回归。
    const outIndex = args.indexOf('--outdir')
    const eqArg = args.find(arg => arg.startsWith('-outdir=') || arg.startsWith('-output-directory='))
    const outDir = outIndex >= 0 ? (args[outIndex + 1] ?? 'build') : (eqArg?.split('=')[1] ?? 'build')
    const outputDir = join(options.cwd, outDir)
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, 'main.pdf'), Buffer.from('%PDF-1.4 fake output'))
    await writeFile(join(outputDir, 'main.log'), 'Output written on main.pdf (6 pages, 12345 bytes).')
    return { stdout: `Compiling main.tex → ${outDir}/main.pdf`, stderr: '' }
  }
}

async function makeService(): Promise<{ service: WriterService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'srw-writer-'))
  const service = new WriterService({
    fs: fakeFs(),
    rootDir: () => root,
    run: fakeEngine(),
  })
  await mkdir(join(root, 'demo', '.srw'), { recursive: true })
  return { service, root }
}

test('writer 全链：venue 应用 → 骨架 → 大纲 G1 → 确认 → 节写入 → 编译快照 → 失败定位 → 回滚', async () => {
  const { service, root } = await makeService()
  try {
    // 骨架前置：未应用刊物拒绝
    await assert.rejects(
      () => service.scaffold('demo', { title: 'T' }),
      (error: unknown) => error instanceof ServiceError && error.code === 'INVALID',
    )
    const instance = await service.venueApply('demo', 'ieee-journal', 'D1')
    assert.equal(instance.tier, 'D1')

    const plan = await service.scaffold('demo', { title: 'Attention Revisited' })
    assert.ok(plan.written.includes('main.tex'))
    assert.ok(plan.written.includes('refs.bib'))
    // 已有 main.tex 拒绝重生成
    await assert.rejects(
      () => service.scaffold('demo', { title: 'Again' }),
      (error: unknown) => error instanceof ServiceError && error.code === 'INVALID',
    )

    // 大纲：骨架落了草稿；G1 门拒正文
    const draft = await service.outlineGet('demo')
    assert.equal(draft?.status, 'draft')
    await assert.rejects(
      () => service.sectionWrite('demo', 's1', '\\section{X}'),
      (error: unknown) => error instanceof ServiceError && error.code === 'GATE',
    )

    // agent 起草新大纲（draft→save→confirm）
    const saved = await service.outlineSave('demo', [
      { title: 'Introduction', intent: '问题与贡献', targetWords: 500 },
      { title: 'Method', intent: '方法框架', targetWords: 900 },
    ])
    assert.equal(saved.status, 'draft')
    assert.equal(saved.revision, 0)
    assert.ok(saved.sections.every(section => section.file !== undefined))
    // 同名节沿用旧文件
    assert.equal(saved.sections[0]?.file, 'sections/01-introduction.tex')
    // 大纲改名后 main.tex 的 \input 必须同步；旧节文件进 _orphaned（不再编译）
    const mainAfterSave = await readFile(join(root, 'demo', 'paper', 'main.tex'), 'utf8')
    assert.ok(mainAfterSave.includes('\\input{sections/01-introduction} % Introduction'))
    assert.ok(mainAfterSave.includes('\\input{sections/03-method} % Method'))
    assert.ok(!mainAfterSave.includes('02-related-work'), '旧节不再出现在输入清单')
    const orphaned = await readdir(join(root, 'demo', 'paper', 'sections', '_orphaned'))
    assert.ok(orphaned.includes('02-related-work.tex'), '旧节文件移入 _orphaned')

    const confirmed = await service.outlineConfirm('demo')
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.revision, 1)

    // 节写入：坏节先写一个 \brokenmacro → 编译失败定位行号
    const badTex = '\\section{Introduction}\nWe use \\brokenmacro here.\n'
    await service.sectionWrite('demo', 's1', badTex)
    const failed = await service.compile('demo')
    assert.equal(failed.ok, false)
    assert.equal(failed.parsed.errors.length, 1)
    assert.equal(failed.parsed.errors[0]?.line, 2, '折行回接后行号指向 brokenmacro 行')
    assert.equal(failed.snapshot, undefined, '编译失败不留快照')

    // 修复 → 编译成功 → 快照 + PDF
    await service.sectionWrite('demo', 's1', '\\section{Introduction}\nAll good now.\n')
    const okRun = await service.compile('demo')
    assert.equal(okRun.ok, true)
    assert.equal(okRun.pdfWritten, true)
    assert.ok(okRun.snapshot !== undefined)

    // 快照必须带上「真实落点 PDF + 大纲/venue 状态」：只回滚 tex 会造成状态撕裂。
    const manifest = JSON.parse(await readFile(join(root, 'demo', 'paper', 'snapshots', okRun.snapshot!.id, 'manifest.json'), 'utf8')) as { files: Record<string, string> }
    assert.ok(manifest.files['build/main.pdf'] !== undefined, '快照含 build/main.pdf')
    assert.ok(manifest.files['state/outline.json'] !== undefined, '快照含 outline 状态')
    assert.ok(manifest.files['state/venue.json'] !== undefined, '快照含 venue 状态')

    // 改坏现场（改节 + 改大纲）→ 回滚 → tex 与 .srw 状态都复原
    await service.sectionWrite('demo', 's1', '\\section{Wrecked}\n')
    await service.outlineSave('demo', [{ title: 'Wrecked Section', intent: '回滚测试', targetWords: 100 }])
    await service.snapshotRestore('demo', okRun.snapshot!.id)
    assert.equal(await readFile(join(root, 'demo', 'paper', 'sections', '01-introduction.tex'), 'utf8'), '\\section{Introduction}\nAll good now.\n')
    const restoredOutline = JSON.parse(await readFile(join(root, 'demo', '.srw', 'outline.json'), 'utf8')) as { status: string; sections: Array<{ title: string; file?: string }> }
    assert.equal(restoredOutline.status, 'confirmed', '回滚恢复 outline 状态')
    assert.equal(restoredOutline.sections[0]?.title, 'Introduction')
    assert.equal(restoredOutline.sections[0]?.file, 'sections/01-introduction.tex')

    const state = await service.state('demo')
    assert.equal(state.venue?.venueId, 'ieee-journal')
    assert.equal(state.outline?.status, 'confirmed')
    assert.equal(state.engine.engine, 'tectonic')
    assert.equal(state.files.buildPdf, true)
    assert.ok(state.snapshots.length >= 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：snapshotTag 打标签 + restore 返回 materialDrift（服务层，8.1）', async () => {
  const { service, root } = await makeService()
  try {
    await service.venueApply('demo', 'ieee-journal', 'D1')
    await service.scaffold('demo', { title: 'Tagged' })
    await service.outlineSave('demo', [{ title: 'Intro', intent: '引言', targetWords: 100 }])
    await service.outlineConfirm('demo')
    await service.sectionWrite('demo', 's1', '\\section{Intro}\nbody\n')
    const run = await service.compile('demo')
    assert.ok(run.snapshot !== undefined)

    await service.snapshotTag('demo', run.snapshot!.id, { label: 'baseline', note: '首轮' })
    const listed = (await service.snapshotList('demo')).find(item => item.id === run.snapshot!.id)
    assert.equal(listed?.label, 'baseline', '服务层标签可见')
    assert.equal(listed?.note, '首轮')

    const result = await service.snapshotRestore('demo', run.snapshot!.id)
    assert.ok(result.restored.length > 0)
    assert.equal(result.materialDrift, undefined, '无 materialsHash 记录 → 不判漂移')

    await mkdir(join(root, 'demo', 'materials'), { recursive: true })
    await writeFile(join(root, 'demo', 'materials', 'manifest.json'), '{"schemaVersion":1,"artifacts":[]}\n')
    await service.sectionWrite('demo', 's1', '\\section{Intro}\nbody v2\n')
    const run2 = await service.compile('demo')
    assert.ok(run2.snapshot !== undefined)
    await writeFile(join(root, 'demo', 'materials', 'manifest.json'), '{"schemaVersion":1,"artifacts":[{"x":1}]}\n')
    const drifted = await service.snapshotRestore('demo', run2.snapshot!.id)
    assert.equal(drifted.materialDrift, true, 'materials 变更 → restore 报漂移提示')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：review 响应信——真实 hunk 可回、伪造 hunk 报 RESPONSE_UNBACKED、导出四段齐备（8.3）', async () => {
  const { service, root } = await makeService()
  try {
    await service.venueApply('demo', 'ieee-journal', 'D1')
    await service.scaffold('demo', { title: 'Reviewed' })
    await service.outlineSave('demo', [{ title: 'Intro', intent: '引言', targetWords: 100 }])
    await service.outlineConfirm('demo')
    await service.sectionWrite('demo', 's1', '\\section{Intro}\nbody\n')
    const run1 = await service.compile('demo')
    const base = run1.snapshot!.id
    await service.sectionWrite('demo', 's1', '\\section{Intro}\nbody revised for reviewers.\n')
    const run2 = await service.compile('demo')
    const revision = run2.snapshot!.id

    // 开轮：baseSnapshotId 锚定证据基线
    await service.reviewOpen('demo', 1, {
      venueId: 'ieee-journal',
      baseSnapshotId: base,
      reviews: [{ reviewer: 'R1', comments: [{ id: 'C1', text: '请改写第 2 行。', area: 'writing' }] }],
    })

    // 伪造证据：未知文件 / 越界 hunkIndex → RESPONSE_UNBACKED（防「编造已修改」）
    await assert.rejects(
      () => service.reviewRespond('demo', 1, 'C1', '已改。', [{ snapshotId: revision, file: 'sections/99-nope.tex', hunkIndex: 0 }]),
      (error: unknown) => error instanceof ServiceError && error.code === 'RESPONSE_UNBACKED',
    )
    await assert.rejects(
      () => service.reviewRespond('demo', 1, 'C1', '已改。', [{ snapshotId: revision, file: 'sections/01-intro.tex', hunkIndex: 7 }]),
      (error: unknown) => error instanceof ServiceError && error.code === 'RESPONSE_UNBACKED',
    )
    // 未知意见
    await assert.rejects(
      () => service.reviewRespond('demo', 1, 'C999', 'x', []),
      (error: unknown) => error instanceof ServiceError && error.code === 'NOT_FOUND',
    )
    // 未开轮
    await assert.rejects(
      () => service.reviewRespond('demo', 2, 'C1', 'x', []),
      (error: unknown) => error instanceof ServiceError && error.code === 'NOT_FOUND',
    )

    // 真实 hunk → 通过并落盘
    const saved = await service.reviewRespond('demo', 1, 'C1', '已按意见改写。', [
      { snapshotId: revision, file: 'sections/01-intro.tex', hunkIndex: 0, note: '整节改写' },
    ])
    assert.equal(saved.items.length, 1)

    // 导出 md：审稿意见/回复/修改位置+diff 摘要/快照 id 四段齐备
    const md = await service.reviewExport('demo', 1, 'md')
    assert.ok(md.content.includes('C1'), '意见 id')
    assert.ok(md.content.includes('请改写第 2 行。'), '审稿意见原文')
    assert.ok(md.content.includes('已按意见改写。'), '回复')
    assert.ok(md.content.includes('sections/01-intro.tex'), '修改位置')
    assert.ok(md.content.includes(revision), '快照 id')
    assert.ok(md.content.includes('- body') && md.content.includes('+ body revised'), 'diff 摘要')
    assert.equal(md.unanswered.length, 0)
    const tex = await service.reviewExport('demo', 1, 'tex')
    assert.ok(tex.content.includes('C1') && tex.content.includes('已按意见改写。'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：submission.draft 三件套——自动头部/声明证据/高亮校验（8.4）', async () => {
  const { service, root } = await makeService()
  try {
    await service.venueApply('demo', 'ieee-journal', 'D2')
    await service.scaffold('demo', { title: 'Evidence Paper' })
    // 取证现场：受管实验 run + 数据登记
    await mkdir(join(root, 'demo', 'experiments', 'exp-01', 'runs', 'r1'), { recursive: true })
    await writeFile(join(root, 'demo', 'experiments', 'exp-01', 'runs', 'r1', 'run.json'), '{}\n')
    await mkdir(join(root, 'demo', 'data'), { recursive: true })
    await writeFile(join(root, 'demo', 'data', 'registry.json'), '{"datasets":[]}\n')

    // 首笔草稿（写 limitations）→ 声明集按 D2 档位生成；data 可自动取证
    const state = await service.submissionDraft('demo', 'statement.limitations', 'Small sample size.')
    assert.equal(state.draft.venueId, 'ieee-journal')
    assert.equal(state.draft.tier, 'D2')
    assert.equal(state.draft.venueConfidence, 'unverified')
    assert.equal(state.draft.title, 'Evidence Paper', '标题从 main.tex 自动识别')
    assert.deepEqual(state.draft.statements.map(s => s.id).sort(), ['codeAvailability', 'dataAvailability', 'limitations'], 'D2 档位声明集')
    const data = state.draft.statements.find(s => s.id === 'dataAvailability')!
    assert.equal(data.status, 'evidenced', '有 experiments run + data registry → 自动取证')
    assert.ok(data.evidence?.includes('experiments/exp-01'))
    assert.ok(data.evidence?.includes('data/registry.json'))
    const code = state.draft.statements.find(s => s.id === 'codeAvailability')!
    assert.equal(code.status, 'needs-author')
    assert.ok(code.text.includes('需作者确认'))
    assert.equal(state.draft.statements.find(s => s.id === 'limitations')?.status, 'authored')
    assert.ok(state.warnings.some(w => w.includes('需作者确认')), 'needs-author 进 warnings（D2/D3 pack 将阻断）')

    // 渲染产物：cover letter 自动头部（标题/刊物/未核定标注）+ declarations
    const cover = await readFile(join(root, 'demo', 'submissions', 'cover-letter.md'), 'utf8')
    assert.ok(cover.includes('Evidence Paper'), '标题自动填充')
    assert.ok(cover.includes('ieee-journal'), '刊物自动填充')
    assert.ok(cover.includes('未核定'), 'unverified 刊物事实显式标注')
    const decl = await readFile(join(root, 'demo', 'submissions', 'declarations.tex'), 'utf8')
    assert.ok(decl.includes('Data Availability'), '声明 label（venue.lang=en → 英文）')
    assert.ok(decl.includes('Small sample size.'))
    assert.ok(decl.includes('experiments/exp-01'), '取证路径回指')

    // highlights：少于 3 / 多于 5 / 超 100 字符 → INVALID；3 条过并落盘
    await assert.rejects(() => service.submissionDraft('demo', 'highlights', 'a\nb'),
      (error: unknown) => error instanceof ServiceError && error.code === 'INVALID')
    await assert.rejects(() => service.submissionDraft('demo', 'highlights', Array.from({ length: 6 }, (_u, i) => `h${i}`).join('\n')),
      (error: unknown) => error instanceof ServiceError && error.code === 'INVALID')
    await assert.rejects(() => service.submissionDraft('demo', 'highlights', 'x'.repeat(101)),
      (error: unknown) => error instanceof ServiceError && error.code === 'INVALID')
    await service.submissionDraft('demo', 'highlights', 'First finding\nSecond finding\nThird finding')
    const hi = await readFile(join(root, 'demo', 'submissions', 'highlights.txt'), 'utf8')
    assert.ok(hi.includes('Third finding'))

    // coverLetter 正文 + round 字段
    await service.submissionDraft('demo', 'coverLetter', 'We believe this fits the scope because ...')
    const cover2 = await readFile(join(root, 'demo', 'submissions', 'cover-letter.md'), 'utf8')
    assert.ok(cover2.includes('We believe this fits'), '正文经 draft 落盘')
    const r2 = await service.submissionDraft('demo', 'round', '2')
    assert.equal(r2.draft.round, 2)

    // 未应用刊物 → NOT_FOUND
    await assert.rejects(
      () => service.submissionDraft('demo3', 'coverLetter', 'x'),
      (error: unknown) => error instanceof ServiceError && error.code === 'NOT_FOUND',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：format.check 激活 venue 死字段——十项检查同 compliance 形状（8.5）', async () => {
  const { service, root } = await makeService()
  try {
    await service.venueApply('demo', 'ieee-journal', 'D2')
    await service.scaffold('demo', { title: 'Format Target' })
    await service.outlineSave('demo', [{ title: 'Intro', intent: '引言', targetWords: 100 }])
    await service.outlineConfirm('demo')
    await service.sectionWrite('demo', 's1', '\\section{Intro}\nWe cite \\cite{refA} and \\citep{refB}.\n\\begin{table}x\\end{table}\n\\includegraphics{figs/plot.png}\n')

    const report = await service.formatCheck('demo')
    assert.equal(report.venueId, 'ieee-journal')
    assert.equal(report.tier, 'D2')
    const byId = new Map(report.checks.map(c => [c.id, c]))
    for (const id of ['template.class', 'template.options', 'pages', 'abstract.words', 'figures', 'tables', 'references', 'refstyle', 'figure.dpi', 'columns']) {
      assert.ok(byId.get(id) !== undefined, `检查项齐全：${id}`)
    }
    assert.equal(byId.get('template.class')?.pass, true, 'scaffold 按 venue 渲染 → class 过')
    assert.equal(byId.get('template.options')?.pass, true, 'classOptions ⊆ venue')
    assert.equal(byId.get('columns')?.pass, true, 'IEEEtran → 双栏推断 === venue.columns')
    assert.equal(byId.get('refstyle')?.pass, false, 'ieee 数字族出现 \\citep → 不过')
    assert.equal(byId.get('figures')?.pass, false, '1 幅 < D2 min 5（档位启发式）')
    assert.equal(byId.get('figures')?.level, 'warn', '档位区间是启发式 → warn 级')
    assert.equal(byId.get('tables')?.pass, false, '1 张 < D2 min 3')
    assert.equal(byId.get('abstract.words')?.pass, true, 'scaffold 占位注释不计词 → 0 ≤ 250')
    assert.equal(byId.get('pages')?.pass, undefined, '无 build PDF → 诚实降级不伪造')
    assert.equal(byId.get('figure.dpi')?.pass, undefined, '栅格图文件缺失 → 无法核 DPI 降级')

    // 篡改 documentclass → template.class error 级不过
    const main = await readFile(join(root, 'demo', 'paper', 'main.tex'), 'utf8')
    await writeFile(join(root, 'demo', 'paper', 'main.tex'), main.replace('IEEEtran', 'article'))
    const tampered = await service.formatCheck('demo')
    const tc = tampered.checks.find(c => c.id === 'template.class')!
    assert.equal(tc.pass, false)
    assert.equal(tc.level, 'error')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：无引擎 → ENGINE_MISSING（引导安装，不是崩）；outline.prompt 分档', async () => {
  const { service, root } = await makeService()
  try {
    await service.venueApply('demo', 'ieee-journal', 'D1')
    await service.scaffold('demo', { title: 'Diffed' })
    await service.outlineSave('demo', [{ title: 'Intro', intent: '引言', targetWords: 100 }])
    await service.outlineConfirm('demo')
    await service.sectionWrite('demo', 's1', '\\section{Intro}\nbody\n')
    const run1 = await service.compile('demo')
    assert.ok(run1.snapshot !== undefined)

    await service.sectionWrite('demo', 's1', '\\section{Intro}\nbody with one changed sentence.\n')
    const run2 = await service.compile('demo')
    assert.ok(run2.snapshot !== undefined)

    const diff = await service.paperDiff('demo', run1.snapshot!.id, run2.snapshot!.id)
    assert.equal(diff.files.length, 1, '只改了一节 → 只有一个变更文件（PDF 哈希相同不算）')
    assert.equal(diff.files[0]?.path, 'sections/01-intro.tex')
    assert.equal(diff.files[0]?.status, 'modified')
    const hunk = diff.files[0]?.hunks[0]
    assert.equal(hunk?.aStart, 2, 'A8：改一句话 → 1 hunk 行号正确')
    assert.equal(hunk?.lines.filter(line => line.op === '-').length, 1)
    assert.equal(hunk?.lines.filter(line => line.op === '+').length, 1)
    assert.equal(diff.stats.modified, 1)

    // 幂等：重复请求返回持久化结果（createdAt 也不变）
    const again = await service.paperDiff('demo', run1.snapshot!.id, run2.snapshot!.id)
    assert.deepEqual(again, diff)
    await assert.rejects(
      () => service.paperDiff('demo', 'no-such', run2.snapshot!.id),
      (error: unknown) => error instanceof ServiceError && error.code === 'NOT_FOUND',
    )
    assert.ok(root.length > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：无引擎 → ENGINE_MISSING（引导安装，不是崩）；outline.prompt 分档', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-writer-'))
  try {
    const service = new WriterService({
      fs: fakeFs(),
      rootDir: () => root,
      run: async () => {
        throw new Error('spawn ENOENT')
      },
    })
    await service.venueApply('demo', 'ieee-journal')
    await service.scaffold('demo', { title: 'T' })
    await assert.rejects(
      () => service.compile('demo'),
      (error: unknown) => error instanceof ServiceError && error.code === 'ENGINE_MISSING',
    )
    const { prompt, tier } = await service.outlinePromptFor('demo')
    assert.equal(tier, 'D3')
    assert.ok(prompt.includes('D3'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：合规检查从盘上事实计算（sections/figures/tables/refs/pages）', async () => {
  const { service, root } = await makeService()
  try {
    await service.venueApply('demo', 'ieee-journal', 'D1')
    await service.scaffold('demo', { title: 'T' })
    await service.outlineConfirm('demo')
    // 骨架空节：0 图 0 表 0 引用 → 合规必然不过（但 unverified 全 warn）
    const result = await service.compliance('demo')
    assert.equal((result.venue as VenueInstance).venueId, 'ieee-journal')
    assert.ok(result.checks.length >= 5)
    assert.ok(result.checks.every(check => check.level === 'warn'), '未核定刊物全 warn')
    const refs = result.checks.find(check => check.id === 'references')
    assert.equal(refs?.actual, '0 条')
    assert.ok(result.checks.some(check => check.id.startsWith('section.')))
    void root
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writer：run 缺失在构造期抛 NO_PROVIDER（不伪装成引擎缺失）', () => {
  assert.throws(
    () => new WriterService({ fs: fakeFs(), rootDir: () => '/tmp' } as unknown as WriterDeps),
    (error: unknown) => error instanceof ServiceError && error.code === 'NO_PROVIDER',
  )
})

test('writer：旧大纲缺 file 自动迁移绑定（confirm 不再可确认但不可写）', async () => {
  const { service, root } = await makeService()
  try {
    await service.venueApply('demo', 'ieee-journal')
    await mkdir(join(root, 'demo', '.srw'), { recursive: true })
    await writeFile(join(root, 'demo', '.srw', 'outline.json'), serializeOutline(emptyOutline([
      { title: 'Introduction', intent: '旧项目没有绑定文件' },
    ])))
    const confirmed = await service.outlineConfirm('demo')
    assert.equal(confirmed.status, 'confirmed')
    assert.ok(confirmed.sections.every(section => section.file !== undefined))
    // 迁移后正文写入不再是死路
    const written = await service.sectionWrite('demo', 's1', '\\section{Introduction}\nMigrated.\n')
    assert.equal(written.file, 'sections/01-introduction.tex')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
