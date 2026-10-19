/** WriterService（M5 论文线编排，0206）：骨架 → 大纲（G1 确认门）→ 正文
 * → 编译（日志解析）→ 快照与回滚 → 引用审计 → 合规检查。磁盘域
 * `<root>/<project>/paper/` 与 `<root>/<project>/.srw/{venue,outline}.json`；
 * 全部显式带 project（不依赖隐式 active）。进程执行经 RunPort 注入
 * （测试假引擎）；文件操作过 assertInsideRoot 护栏。
 *
 * LLM 生成（大纲内容/正文章节）**不经本服务**——走 agent 车道：agent 就是
 * 模型，工具只提供 IO + 门（0206 执行约定）。 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { probeEngines, type RunPort, type TeXEngine } from './engine.ts'
import { renderScaffold, isSafeSectionFile, normalizeInputPath, sectionInputPaths, syncInputBlock, type ScaffoldPlan } from './scaffold.ts'
import { compilePaper, type CompileOutcome } from './compile.ts'
import { auditCites, type CiteAudit } from './cite-audit.ts'
import { createSnapshot, listSnapshots, restoreSnapshot, tagSnapshot, type SnapshotInfo, type SnapshotManifest } from './snapshot.ts'
import { diffLines, type PaperDiff, type PaperDiffFile } from './diff.ts'
import { emptyOutline, parseOutline, serializeOutline, confirmOutline, assertConfirmed, outlinePrompt, type Outline, type OutlineSection } from './outline.ts'
import { extractCitekeys, toBibtex } from '../literature/bibtex.ts'
import { getVenue, listVenues } from '../venue/registry.ts'
import { runCompliance, STATEMENT_LABELS, type ComplianceCheck, type ComplianceFacts } from '../venue/compliance.ts'
import type { DepthTier } from '../venue/types.ts'

const VENUE_INSTANCE_VERSION = 1

export interface VenueInstance {
  readonly schemaVersion: typeof VENUE_INSTANCE_VERSION
  readonly venueId: string
  readonly tier: DepthTier
  readonly appliedAt: string
}

export interface PaperState {
  readonly project: string
  readonly venue: VenueInstance | undefined
  readonly outline?: { readonly status: string; readonly revision: number; readonly sections: number; readonly files: number } | undefined
  readonly engine: { readonly engine?: TeXEngine | undefined; readonly probes: readonly { readonly engine: string; readonly available: boolean }[] }
  readonly files: { readonly mainTex: boolean; readonly refsBib: boolean; readonly sections: readonly string[]; readonly buildPdf: boolean }
  readonly snapshots: readonly SnapshotInfo[]
}

export interface WriterDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
  /** 进程执行端口：生产装配 nodeRun，测试注入假引擎。**必填**——缺失必须在
   * 构造期报 NO_PROVIDER，而不是被 probeEngines 的 catch 吞成「引擎不可用」。 */
  readonly run: RunPort
  /** 文献库取条目（refsAppend 生成 BibTeX 用）。 */
  readonly libraryEntry?: (project: string, key: string) => Promise<unknown>
}

export class WriterService {
  private engineCache: Awaited<ReturnType<typeof probeEngines>> | undefined

  constructor(private readonly deps: WriterDeps) {
    // 运行时兜底（JS 调用方/旧装配）：进程端口缺失是装配错误，不是引擎缺失。
    if ((deps as { run?: RunPort }).run === undefined) {
      throw new ServiceError('NO_PROVIDER', 'WriterService 进程执行端口未装配（run 缺失）——检查 SrwService.writer 装配')
    }
  }

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_ROOT', '科研总根未设置（先在面板选择）')
    return root
  }

  private projectDir(project: string): string {
    if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
    return join(this.requireRoot(), project)
  }

  private paperDir(project: string): string {
    return join(this.projectDir(project), 'paper')
  }

  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.deps.fs, this.requireRoot(), absPath)
  }

  private async readText(absPath: string): Promise<string | undefined> {
    await this.guard(absPath)
    try {
      return await readFile(absPath, 'utf8')
    } catch {
      return undefined
    }
  }

  private async writeText(absPath: string, text: string): Promise<void> {
    await this.guard(absPath)
    await mkdir(absPath.slice(0, absPath.lastIndexOf('/')), { recursive: true })
    await writeFile(absPath, text, 'utf8')
  }

  private venueInstancePath(project: string): string {
    return join(this.projectDir(project), '.srw', 'venue.json')
  }

  private outlinePath(project: string): string {
    return join(this.projectDir(project), '.srw', 'outline.json')
  }

  private mainTexPath(project: string): string {
    return join(this.paperDir(project), 'main.tex')
  }

  /** 大纲每节都必须绑定合法章节文件（G1 门与编译输入门的共同前提）。 */
  private assertOutlineBound(outline: Outline): void {
    for (const section of outline.sections) {
      if (section.file === undefined) {
        throw new ServiceError('INVALID', `大纲节「${section.title}」未绑定文件：先 outline.save 或重新 scaffold`)
      }
      if (!isSafeSectionFile(section.file)) {
        throw new ServiceError('INVALID', `大纲节「${section.title}」的文件路径非法：${section.file}`)
      }
    }
  }

  /** 把 outline 的章节顺序写回 main.tex 的 \input 清单；main.tex 不存在时跳过。 */
  private async syncInputs(project: string, outline: Outline): Promise<void> {
    const main = await this.readText(this.mainTexPath(project))
    if (main === undefined) return
    this.assertOutlineBound(outline)
    const sections = outline.sections.map(section => ({ title: section.title, file: section.file as string }))
    const next = syncInputBlock(main, sections)
    if (next !== main) await this.writeText(this.mainTexPath(project), next)
  }

  /** 旧项目迁移：scaffold 早期版本的大纲节没有 file，直接确认/编译会 INVALID。
   * 这里按标题/index 绑定骨架命名（与 scaffold 的 slugFile 一致）并补占位，
   * 已绑定的节不动；迁移结果写回 outline.json，避免「可确认但不可写」的死路。 */
  private async ensureOutlineFiles(project: string, outline: Outline): Promise<Outline> {
    if (outline.sections.every(section => section.file !== undefined && isSafeSectionFile(section.file))) {
      return outline
    }
    const used = new Set<string>()
    const nextSections: OutlineSection[] = []
    for (const [index, section] of outline.sections.entries()) {
      let file = section.file
      if (file === undefined || !isSafeSectionFile(file) || used.has(file)) {
        file = `sections/${slugFile(section.title, index)}.tex`
        let suffix = 2
        while (used.has(file)) {
          file = `sections/${slugFile(section.title, index)}-${suffix}.tex`
          suffix += 1
        }
      }
      used.add(file)
      nextSections.push({ ...section, file })
    }
    const next: Outline = { ...outline, sections: nextSections }
    await this.writeText(this.outlinePath(project), serializeOutline(next))
    for (const section of nextSections) {
      const file = section.file as string
      const path = join(this.paperDir(project), file)
      if (await this.readText(path) === undefined) {
        await this.writeText(path, `\\section{${section.title}}\n% 从旧大纲迁移：若已有正文请替换本节\n\n`)
      }
    }
    return next
  }

  /** 大纲改名/删节后，把不再被引用的旧节文件移入 sections/_orphaned/，
   * 既保留写作现场，又不让孤儿文件参与 compliance/引用审计。 */
  private async moveOrphanedSections(project: string, previous: Outline | undefined, next: Outline): Promise<void> {
    const keep = new Set(next.sections.map(section => section.file).filter((file): file is string => file !== undefined))
    const seen = new Set<string>()
    const orphanDir = join(this.paperDir(project), 'sections', '_orphaned')
    for (const section of previous?.sections ?? []) {
      const file = section.file
      if (file === undefined || keep.has(file) || seen.has(file) || !isSafeSectionFile(file)) continue
      seen.add(file)
      const source = join(this.paperDir(project), file)
      await this.guard(source)
      try {
        await mkdir(orphanDir, { recursive: true })
        await rename(source, join(orphanDir, basename(file)))
      } catch { /* 文件不存在：没什么可移的 */ }
    }
  }

  /** 编译前的输入一致性门：outline.file 序列必须与 main.tex 的 \input 序列逐项相等。
   * 这不是提示词纪律，而是编译动作的硬前提（静默丢节曾真实发生）。 */
  private async assertInputsMatchOutline(project: string, outline: Outline): Promise<void> {
    this.assertOutlineBound(outline)
    const main = await this.readText(this.mainTexPath(project))
    if (main === undefined) return
    const expected = outline.sections.map(section => normalizeInputPath(section.file as string))
    const actual = sectionInputPaths(main)
    const same = expected.length === actual.length && expected.every((path, index) => path === actual[index])
    if (!same) {
      throw new ServiceError('GATE', `编译输入与大纲不一致：大纲 [${expected.join(', ')}]，main.tex [${actual.join(', ')}]`)
    }
  }

  /* ── venue ── */

  venueList(): readonly unknown[] {
    return listVenues()
  }

  async venueApply(project: string, venueId: string, tier?: DepthTier): Promise<VenueInstance> {
    const venue = getVenue(venueId)
    if (venue === undefined) {
      throw new ServiceError('NOT_FOUND', `未知刊物：${venueId}（venue.list 查看注册表）`)
    }
    const instance: VenueInstance = {
      schemaVersion: VENUE_INSTANCE_VERSION,
      venueId,
      tier: tier ?? venue.depthTier,
      appliedAt: new Date().toISOString(),
    }
    await this.writeText(this.venueInstancePath(project), JSON.stringify(instance, null, 2) + '\n')
    return instance
  }

  private async venueOf(project: string): Promise<VenueInstance | undefined> {
    const raw = await this.readText(this.venueInstancePath(project))
    if (raw === undefined) return undefined
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed['venueId'] === 'string'
        && (parsed['tier'] === 'D1' || parsed['tier'] === 'D2' || parsed['tier'] === 'D3')) {
        return {
          schemaVersion: VENUE_INSTANCE_VERSION,
          venueId: parsed['venueId'],
          tier: parsed['tier'],
          appliedAt: typeof parsed['appliedAt'] === 'string' ? parsed['appliedAt'] : new Date().toISOString(),
        }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /* ── 骨架 ── */

  /** 骨架生成：venue 必须已应用（venueApply 先行——刊物决定模板）。已有
   * main.tex 时不覆盖（防止抹掉写作现场），提示先快照。 */
  async scaffold(project: string, input: { readonly title: string; readonly authors?: string; readonly abstract?: string }): Promise<ScaffoldPlan & { readonly written: readonly string[] }> {
    const instance = await this.venueOf(project)
    if (instance === undefined) throw new ServiceError('INVALID', `先应用刊物（venue.apply）再生成骨架`)
    const venue = getVenue(instance.venueId)
    if (venue === undefined) throw new ServiceError('NOT_FOUND', `刊物实例指向未注册刊物：${instance.venueId}`)
    const existing = await this.readText(join(this.paperDir(project), 'main.tex'))
    if (existing !== undefined) {
      throw new ServiceError('INVALID', 'paper/main.tex 已存在（骨架生成拒绝覆盖写作现场；确需重生成请先快照再删除）')
    }
    const plan = renderScaffold({ venue, title: input.title, ...(input.authors !== undefined ? { authors: input.authors } : {}), ...(input.abstract !== undefined ? { abstract: input.abstract } : {}) })
    const written: string[] = ['main.tex']
    await this.writeText(join(this.paperDir(project), 'main.tex'), plan.mainTex)
    for (const [path, content] of Object.entries(plan.files)) {
      await this.writeText(join(this.paperDir(project), path), content)
      written.push(path)
    }
    // 骨架同时落大纲草稿（节 = venue.sectionOrder，一级真相源就位）；
    // 每节直接绑定骨架已写出的 sections/*.tex，G1 确认后 section.write 即可用。
    const outline = emptyOutline(venue.sectionOrder.map((title, index) => ({
      title,
      intent: `${title}（骨架占位——生成大纲后替换意图）`,
      ...(plan.sections[index] !== undefined ? { file: plan.sections[index] } : {}),
    })))
    await this.writeText(this.outlinePath(project), serializeOutline(outline))
    return { ...plan, written }
  }

  /* ── 大纲（G1 门） ── */

  async outlineGet(project: string): Promise<Outline | undefined> {
    const raw = await this.readText(this.outlinePath(project))
    return raw === undefined ? undefined : parseOutline(raw)
  }

  /** 保存大纲（agent 起草后落盘）：整体置回 draft（改了就作废旧确认）；
   * revision 保持——改后的内容还没被确认过。节文件按序分配
   * sections/<nn>-<slug>.tex，同名标题沿用旧文件（内容不丢）。 */
  async outlineSave(project: string, sections: readonly { readonly title: string; readonly intent: string; readonly targetWords?: number }[]): Promise<Outline> {
    if (sections.length === 0) throw new ServiceError('INVALID', '大纲至少要有一节')
    const previous = await this.outlineGet(project)
    const byTitle = new Map<string, OutlineSection>()
    for (const section of previous?.sections ?? []) byTitle.set(section.title, section)
    const nextSections: OutlineSection[] = sections.map((section, index) => {
      const reused = byTitle.get(section.title)
      return {
        id: `s${index + 1}`,
        title: section.title,
        intent: section.intent,
        targetWords: section.targetWords ?? 400,
        status: 'draft' as const,
        ...(reused?.file !== undefined ? { file: reused.file } : { file: `sections/${slugFile(section.title, index)}.tex` }),
      }
    })
    const next: Outline = {
      schemaVersion: 1,
      status: 'draft',
      revision: previous?.revision ?? 0,
      sections: nextSections,
    }
    await this.writeText(this.outlinePath(project), serializeOutline(next))
    // 为新分配的节文件补 \section 占位（已有文件不动）
    for (const section of nextSections) {
      if (section.file === undefined) continue
      const path = join(this.paperDir(project), section.file)
      if (await this.readText(path) === undefined) {
        await this.writeText(path, `\\section{${section.title}}\n% intent: ${section.intent}\n\n`)
      }
    }
    // 大纲是编译输入的单一真相源：保存即重写 main.tex，旧节文件移入 _orphaned。
    await this.syncInputs(project, next)
    await this.moveOrphanedSections(project, previous, next)
    return next
  }

  async outlineConfirm(project: string): Promise<Outline> {
    const raw = await this.outlineGet(project)
    if (raw === undefined) throw new ServiceError('NOT_FOUND', '大纲不存在（先 scaffold 或让 agent 起草后 outline.save）')
    // 旧项目自动迁移：scaffold 早期版本不绑 file；不迁移会「可确认但不可写」。
    const outline = await this.ensureOutlineFiles(project, raw)
    this.assertOutlineBound(outline)
    const confirmed = confirmOutline(outline)
    await this.writeText(this.outlinePath(project), serializeOutline(confirmed))
    await this.syncInputs(project, confirmed)
    return confirmed
  }

  /** 大纲起草提示词（agent 车道入口：返回提示词，agent 自己拟好再
   * outline.save）。 */
  async outlinePromptFor(project: string): Promise<{ prompt: string; tier: DepthTier }> {
    const instance = await this.venueOf(project)
    if (instance === undefined) throw new ServiceError('INVALID', '先应用刊物再生成大纲')
    const projectJson = await this.readText(join(this.projectDir(project), '.srw', 'project.json'))
    let topic = project
    if (projectJson !== undefined) {
      try {
        const meta = JSON.parse(projectJson) as { title?: unknown }
        if (typeof meta['title'] === 'string' && meta['title'] !== '') topic = meta['title']
      } catch { /* 元数据坏 → 回落 slug */ }
    }
    const venue = getVenue(instance.venueId)
    return {
      prompt: outlinePrompt({ tier: instance.tier, topic, venueName: venue?.name ?? instance.venueId }),
      tier: instance.tier,
    }
  }

  /** 正文节写入（G1 门硬编码在此）：大纲确认后 agent 才能把起草的节落盘。 */
  async sectionWrite(project: string, sectionId: string, tex: string): Promise<{ file: string; bytes: number }> {
    const raw = await this.outlineGet(project)
    if (raw === undefined) throw new ServiceError('NOT_FOUND', '大纲不存在')
    assertConfirmed(raw)
    const outline = await this.ensureOutlineFiles(project, raw)
    const section = outline.sections.find(item => item.id === sectionId)
    if (section === undefined) throw new ServiceError('NOT_FOUND', `大纲没有节 ${sectionId}`)
    if (section.file === undefined) throw new ServiceError('INVALID', `节 ${sectionId} 未绑定文件（重新 outline.save）`)
    const path = join(this.paperDir(project), section.file)
    await this.writeText(path, tex)
    return { file: section.file, bytes: Buffer.byteLength(tex, 'utf8') }
  }

  /* ── 编译与快照 ── */

  private async engineOf(): Promise<Awaited<ReturnType<typeof probeEngines>>> {
    if (this.engineCache === undefined) {
      this.engineCache = await probeEngines(this.deps.run)
    }
    return this.engineCache
  }

  async compile(project: string): Promise<CompileOutcome & { readonly snapshot?: { readonly id: string; readonly files: number }; readonly pdfWritten: boolean }> {
    const dir = this.paperDir(project)
    if (await this.readText(join(dir, 'main.tex')) === undefined) {
      throw new ServiceError('NOT_FOUND', 'paper/main.tex 不存在——先骨架生成')
    }
    // 大纲是编译输入的单一真相源：先重写 \input，再逐项核对；不一致就拒绝编译，
    // 绝不「编译成功但静默丢节/编进已删节」。
    const rawOutline = await this.outlineGet(project)
    if (rawOutline !== undefined) {
      const outline = await this.ensureOutlineFiles(project, rawOutline)
      await this.syncInputs(project, outline)
      await this.assertInputsMatchOutline(project, outline)
    }
    const probed = await this.engineOf()
    if (probed.engine === undefined) {
      throw new ServiceError('ENGINE_MISSING', '本机没有可用 TeX 引擎（tectonic/latexmk/xelatex/pdflatex 全缺）——brew install tectonic 后重试')
    }
    const instance = await this.venueOf(project)
    const venue = instance === undefined ? undefined : getVenue(instance.venueId)
    await mkdir(join(dir, 'build'), { recursive: true })
    const outcome = await compilePaper({
      engine: probed.engine,
      entry: 'main.tex',
      run: this.deps.run,
      cwd: dir,
      ...(venue !== undefined ? { bibTool: venue.bibTool } : {}),
    })
    await this.writeText(join(dir, 'build', 'main.log'), outcome.log)
    const pdfWritten = await this.existsSafe(join(dir, 'build', 'main.pdf'))
    let snapshot: { id: string; files: number } | undefined
    if (outcome.ok) {
      const created = await createSnapshot(dir, { engine: outcome.engine, compileMs: outcome.durationMs })
      snapshot = { id: created.id, files: created.files }
    }
    return { ...outcome, ...(snapshot !== undefined ? { snapshot } : {}), pdfWritten }
  }

  private async existsSafe(path: string): Promise<boolean> {
    await this.guard(path)
    return await readFile(path).then(() => true).catch(() => false)
  }

  async snapshotList(project: string): Promise<readonly SnapshotInfo[]> {
    return await listSnapshots(this.paperDir(project))
  }

  /** 快照打标签（8.1）：manifest 记 label/note，snapshot.list 可见。 */
  async snapshotTag(project: string, id: string, tag: { readonly label: string; readonly note?: string }): Promise<SnapshotInfo> {
    return await tagSnapshot(this.paperDir(project), id, tag)
  }

  /** 8.2：两快照结构化 diff——文本走 LCS 行 diff（diff.ts），二进制只比哈希；
   * 结果持久化 paper/diffs/<from>__<to>.json，重复请求幂等返回。响应信证据门
   * （review.respond）以 hunk 定位为准——本方法是其唯一事实源。 */
  async paperDiff(project: string, fromId: string, toId: string): Promise<PaperDiff> {
    const dir = this.paperDir(project)
    for (const id of [fromId, toId]) {
      if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
        throw new ServiceError('INVALID', `快照 id 非法：${JSON.stringify(id)}`)
      }
    }
    if (fromId === toId) throw new ServiceError('INVALID', 'from/to 不能是同一快照')
    const load = async (id: string): Promise<SnapshotManifest> => {
      const raw = await this.readText(join(dir, 'snapshots', id, 'manifest.json'))
      if (raw === undefined) throw new ServiceError('NOT_FOUND', `快照不存在：${id}`)
      return JSON.parse(raw) as SnapshotManifest
    }
    const from = await load(fromId)
    const to = await load(toId)
    const outPath = join(dir, 'diffs', `${fromId}__${toId}.json`)
    const cached = await this.readText(outPath)
    if (cached !== undefined) return JSON.parse(cached) as PaperDiff
    const paths = [...new Set([...Object.keys(from.files), ...Object.keys(to.files)])].sort()
    const files: PaperDiffFile[] = []
    let added = 0
    let removed = 0
    let modified = 0
    let binary = 0
    for (const path of paths) {
      const inFrom = from.files[path] !== undefined
      const inTo = to.files[path] !== undefined
      if (inFrom && inTo && from.files[path] === to.files[path]) continue
      if (inFrom !== inTo) {
        files.push({ path, status: inTo ? 'added' : 'removed', hunks: [] })
        if (inTo) added += 1
        else removed += 1
        continue
      }
      if (path.endsWith('.pdf')) {
        files.push({ path, status: 'binary', hunks: [] })
        binary += 1
        continue
      }
      const aText = await this.readText(join(dir, 'snapshots', fromId, path)) ?? ''
      const bText = await this.readText(join(dir, 'snapshots', toId, path)) ?? ''
      files.push({ path, status: 'modified', hunks: diffLines(aText, bText) })
      modified += 1
    }
    const diff: PaperDiff = {
      schemaVersion: 1,
      from: fromId,
      to: toId,
      createdAt: new Date().toISOString(),
      files,
      stats: { added, removed, modified, binary },
    }
    await this.writeText(outPath, JSON.stringify(diff, null, 2) + '\n')
    return diff
  }

  async snapshotRestore(project: string, id: string): Promise<{ restored: readonly string[]; materialDrift?: boolean }> {
    return await restoreSnapshot(this.paperDir(project), id, {
      guard: async (rel: string) => {
        const abs = rel.startsWith('state/')
          ? join(this.projectDir(project), '.srw', rel.slice('state/'.length))
          : join(this.paperDir(project), rel)
        await this.guard(abs)
      },
    })
  }

  /* ── 引用审计 ── */

  private async texFiles(project: string): Promise<readonly { readonly name: string; readonly text: string }[]> {
    const dir = this.paperDir(project)
    const files: { name: string; text: string }[] = []
    const main = await this.readText(join(dir, 'main.tex'))
    if (main !== undefined) files.push({ name: 'main.tex', text: main })
    // 只用「已进入编译输入」的节做引用审计/合规事实：孤儿节与 _orphaned 不算。
    const outline = await this.outlineGet(project)
    const names = outline !== undefined
      ? outline.sections.map(section => section.file).filter((file): file is string => file !== undefined)
      : await readdir(join(dir, 'sections')).catch(() => []).then(entries => entries.filter(name => name.endsWith('.tex')).map(name => `sections/${name}`))
    for (const name of new Set(names)) {
      if (!isSafeSectionFile(name)) continue
      const text = await this.readText(join(dir, name))
      if (text !== undefined) files.push({ name, text })
    }
    return files
  }

  async citeAudit(project: string): Promise<CiteAudit> {
    // 旧大纲先迁移绑定，否则审计只读 main.tex、漏掉全部节引用（低估）。
    const rawOutline = await this.outlineGet(project)
    if (rawOutline !== undefined) await this.ensureOutlineFiles(project, rawOutline)
    const texFiles = await this.texFiles(project)
    if (texFiles.length === 0) throw new ServiceError('NOT_FOUND', 'paper/ 里没有 .tex（先骨架生成）')
    const bib = await this.readText(join(this.paperDir(project), 'refs.bib')) ?? ''
    return auditCites(texFiles, bib)
  }

  /** 一键追加：从项目文献库取条目渲染 BibTeX 追加进 refs.bib（按 key 去重）。 */
  async refsAppend(project: string, keys: readonly string[]): Promise<{ added: readonly string[]; skippedExisting: readonly string[]; missing: readonly string[] }> {
    if (this.deps.libraryEntry === undefined) throw new ServiceError('NO_PROVIDER', '文献库未接入')
    const bibPath = join(this.paperDir(project), 'refs.bib')
    const bib = await this.readText(bibPath)
    if (bib === undefined) throw new ServiceError('NOT_FOUND', 'refs.bib 不存在——先骨架生成')
    const existing = extractCitekeys(bib)
    const added: string[] = []
    const skippedExisting: string[] = []
    const missing: string[] = []
    const blocks: string[] = []
    for (const key of keys) {
      if (existing.has(key)) {
        skippedExisting.push(key)
        continue
      }
      const entry = await this.deps.libraryEntry(project, key).catch(() => undefined)
      if (entry === undefined) {
        missing.push(key)
        continue
      }
      blocks.push(toBibtex(entry as Parameters<typeof toBibtex>[0], key))
      added.push(key)
    }
    if (blocks.length > 0) {
      const current = await this.readText(bibPath) ?? bib
      await this.writeText(bibPath, `${current.trimEnd()}\n\n${blocks.join('\n\n')}\n`)
    }
    return { added, skippedExisting, missing }
  }

  /* ── 合规（R5 机读出口） ── */

  async compliance(project: string): Promise<{ readonly venue: VenueInstance; readonly checks: readonly ComplianceCheck[] }> {
    const rawOutline = await this.outlineGet(project)
    if (rawOutline !== undefined) await this.ensureOutlineFiles(project, rawOutline)
    const instance = await this.venueOf(project)
    if (instance === undefined) throw new ServiceError('INVALID', '先应用刊物再做合规检查')
    const venue = getVenue(instance.venueId)
    if (venue === undefined) throw new ServiceError('NOT_FOUND', `刊物实例指向未注册刊物：${instance.venueId}`)
    const texFiles = await this.texFiles(project)
    const allTex = texFiles.map(file => file.text).join('\n')
    const bib = await this.readText(join(this.paperDir(project), 'refs.bib')) ?? ''
    const log = await this.readText(join(this.paperDir(project), 'build', 'main.log')) ?? ''
    const pagesMatch = log.match(/Output written on [^(]*\((\d+) pages?/)
    const facts: ComplianceFacts = {
      ...(pagesMatch !== null && pagesMatch[1] !== undefined ? { pages: Number(pagesMatch[1]) } : {}),
      sections: [...allTex.matchAll(/\\section\*?\{([^}]*)\}/g)].map(match => match[1] ?? ''),
      figures: (allTex.match(/\\begin\{figure\*?\}/g) ?? []).length,
      tables: (allTex.match(/\\begin\{table\*?\}/g) ?? []).length,
      referenceCount: extractCitekeys(bib).size,
      statementsPresent: Object.values(STATEMENT_LABELS).filter(label => allTex.includes(label)),
      hasAppendix: /\\appendix/.test(allTex),
    }
    return { venue: instance, checks: runCompliance({ venue, tier: instance.tier, facts }) }
  }

  /* ── 状态（面板轮询面） ── */

  async state(project: string): Promise<PaperState> {
    const dir = this.paperDir(project)
    const sectionNames: string[] = []
    const sectionsDir = join(dir, 'sections')
    await this.guard(sectionsDir)
    for (const name of await readdir(sectionsDir).catch(() => [])) {
      if (name.endsWith('.tex')) sectionNames.push(`sections/${name}`)
    }
    sectionNames.sort()
    const outline = await this.outlineGet(project)
    return {
      project,
      venue: await this.venueOf(project),
      ...(outline !== undefined
        ? { outline: { status: outline.status, revision: outline.revision, sections: outline.sections.length, files: outline.sections.filter(section => section.file !== undefined).length } }
        : {}),
      engine: await this.engineOf(),
      files: {
        mainTex: await this.existsSafe(join(dir, 'main.tex')),
        refsBib: await this.existsSafe(join(dir, 'refs.bib')),
        sections: sectionNames,
        buildPdf: await this.existsSafe(join(dir, 'build', 'main.pdf')),
      },
      snapshots: await this.snapshotList(project),
    }
  }

  /** 测试钩子：清引擎探测缓存（装完引擎后立即可见）。 */
  resetEngineCache(): void {
    this.engineCache = undefined
  }
}


function slugFile(title: string, index: number): string {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${String(index + 1).padStart(2, '0')}-${ascii !== '' ? ascii : `sec-${index + 1}`}`
}
