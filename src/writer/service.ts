/** WriterService（M5 论文线编排，0206）：骨架 → 大纲（G1 确认门）→ 正文
 * → 编译（日志解析）→ 快照与回滚 → 引用审计 → 合规检查。磁盘域
 * `<root>/<project>/paper/` 与 `<root>/<project>/.srw/{venue,outline}.json`；
 * 全部显式带 project（不依赖隐式 active）。进程执行经 RunPort 注入
 * （测试假引擎）；文件操作过 assertInsideRoot 护栏。
 *
 * LLM 生成（大纲内容/正文章节）**不经本服务**——走 agent 车道：agent 就是
 * 模型，工具只提供 IO + 门（0206 执行约定）。 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { probeEngines, type RunPort, type TeXEngine } from './engine.ts'
import { renderScaffold, type ScaffoldPlan } from './scaffold.ts'
import { compilePaper, type CompileOutcome } from './compile.ts'
import { auditCites, type CiteAudit } from './cite-audit.ts'
import { createSnapshot, listSnapshots, restoreSnapshot, type SnapshotInfo } from './snapshot.ts'
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
  readonly outline?: { readonly status: string; readonly revision: number; readonly sections: number } | undefined
  readonly engine: { readonly engine?: TeXEngine | undefined; readonly probes: readonly { readonly engine: string; readonly available: boolean }[] }
  readonly files: { readonly mainTex: boolean; readonly refsBib: boolean; readonly sections: readonly string[]; readonly buildPdf: boolean }
  readonly snapshots: readonly SnapshotInfo[]
}

export interface WriterDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
  /** 进程执行端口（默认真实 execFile；测试注入假引擎）。 */
  readonly run?: RunPort
  /** 文献库取条目（refsAppend 生成 BibTeX 用）。 */
  readonly libraryEntry?: (project: string, key: string) => Promise<unknown>
}

export class WriterService {
  private engineCache: Awaited<ReturnType<typeof probeEngines>> | undefined

  constructor(private readonly deps: WriterDeps) {}

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
    // 骨架同时落大纲草稿（节 = venue.sectionOrder，一级真相源就位）
    const outline = emptyOutline(venue.sectionOrder.map(title => ({ title, intent: `${title}（骨架占位——生成大纲后替换意图）` })))
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
    return next
  }

  async outlineConfirm(project: string): Promise<Outline> {
    const outline = await this.outlineGet(project)
    if (outline === undefined) throw new ServiceError('NOT_FOUND', '大纲不存在（先 scaffold 或让 agent 起草后 outline.save）')
    const confirmed = confirmOutline(outline)
    await this.writeText(this.outlinePath(project), serializeOutline(confirmed))
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
    const outline = await this.outlineGet(project)
    if (outline === undefined) throw new ServiceError('NOT_FOUND', '大纲不存在')
    assertConfirmed(outline)
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
      this.engineCache = await probeEngines(this.deps.run ?? throwNoRunner)
    }
    return this.engineCache
  }

  async compile(project: string): Promise<CompileOutcome & { readonly snapshot?: { readonly id: string; readonly files: number }; readonly pdfWritten: boolean }> {
    const probed = await this.engineOf()
    if (probed.engine === undefined) {
      throw new ServiceError('ENGINE_MISSING', '本机没有可用 TeX 引擎（tectonic/latexmk/xelatex/pdflatex 全缺）——brew install tectonic 后重试')
    }
    const dir = this.paperDir(project)
    if (await this.readText(join(dir, 'main.tex')) === undefined) {
      throw new ServiceError('NOT_FOUND', 'paper/main.tex 不存在——先骨架生成')
    }
    const outcome = await compilePaper({ engine: probed.engine, entry: 'main.tex', run: this.deps.run ?? throwNoRunner, cwd: dir })
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

  async snapshotRestore(project: string, id: string): Promise<readonly string[]> {
    return await restoreSnapshot(this.paperDir(project), id)
  }

  /* ── 引用审计 ── */

  private async texFiles(project: string): Promise<readonly { readonly name: string; readonly text: string }[]> {
    const dir = this.paperDir(project)
    const files: { name: string; text: string }[] = []
    const main = await this.readText(join(dir, 'main.tex'))
    if (main !== undefined) files.push({ name: 'main.tex', text: main })
    const sectionsDir = join(dir, 'sections')
    await this.guard(sectionsDir)
    for (const name of await readdir(sectionsDir).catch(() => [])) {
      if (!name.endsWith('.tex')) continue
      const text = await this.readText(join(sectionsDir, name))
      if (text !== undefined) files.push({ name: `sections/${name}`, text })
    }
    return files
  }

  async citeAudit(project: string): Promise<CiteAudit> {
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
        ? { outline: { status: outline.status, revision: outline.revision, sections: outline.sections.length } }
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

function throwNoRunner(): never {
  throw new ServiceError('NO_PROVIDER', '进程执行端口未装配')
}

function slugFile(title: string, index: number): string {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${String(index + 1).padStart(2, '0')}-${ascii !== '' ? ascii : `sec-${index + 1}`}`
}
