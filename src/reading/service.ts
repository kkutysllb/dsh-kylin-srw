/** ReadingService（0205 Task 4.7 / R6）：精读域编排——extract（PDF→块表）
 * → translate（缓存命中优先，miss 走翻译链）→ render（paper.md）→ verify。
 * 磁盘域 `<root>/<project>/reading/<paperKey>/`；LLM 经 reflect 通道可选
 * （缺席 → 翻译降级 INVALID 提示，抽取/校验不受影响）。 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { Limiter, limitedMap } from '../util/limiter.ts'
import { ServiceError } from '../service.ts'
import { extractPdfBlocks, UNTRANSLATED_KINDS } from './extract.ts'
import { assembleReading, splitSections, type AssembledReading } from './paragraphs.ts'
import { emptyNotesFile, generateGuide, generateSectionNote, type NotesFile } from './notes.ts'
import { renderReadingPdf } from './pdfdoc.ts'
import { cacheKeyOf, emptyCache, lookup, store, type TranslationCache } from './cache.ts'
import { enforceGlossary, type Glossary } from './glossary.ts'
import { renderPaperWithSources, parsePaper } from './render.ts'
import { buildSourceMap, migrateBlocks, SOURCE_MAP_VERSION, type SourceMap, type SourceMapBlock } from './source-map.ts'
import { translateBlocks, type LlmPort } from './translator.ts'
export type { LlmPort }
import { verifyPaper, type VerifyReport } from './verify.ts'

const PAPER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface ReadingDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
  /** LLM 窄面（真实装配：ctx.reflect.get('llm')；缺席 = 翻译不可用）。 */
  readonly llm: () => LlmPort | undefined
  readonly llmConfig: () => { provider: string; model: string }
}

export interface ReadingStatus {
  readonly paperKey: string
  readonly extracted: boolean
  readonly pages: number
  readonly blocks: number
  /** 参与翻译的块数（排除 furniture/figlabel/reference）。 */
  readonly translatable: number
  readonly translated: number
  readonly verified: number
  readonly mismatch: number
  readonly orphan: number
  readonly missing: number
  readonly llmAvailable: boolean
}

function assertPaperKey(paperKey: string): string {
  if (!PAPER_KEY_RE.test(paperKey)) throw new ServiceError('INVALID', `paperKey 非法：${JSON.stringify(paperKey)}`)
  return paperKey
}

export class ReadingService {
  constructor(private readonly deps: ReadingDeps) {}

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_ROOT', '科研总根未设置（先在面板选择）')
    return root
  }

  private dir(project: string, paperKey: string): string {
    if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
    assertPaperKey(paperKey)
    return join(this.requireRoot(), project, 'reading', paperKey)
  }

  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.deps.fs, this.requireRoot(), absPath)
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    await this.guard(path)
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch {
      return undefined
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await this.guard(path)
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
    try {
      await writeFile(tmp, JSON.stringify(value, null, 2) + '\n')
      await rename(tmp, path)
    } catch (error: unknown) {
      await rm(tmp, { force: true }).catch(() => {})
      throw error
    }
  }

  private async writeText(path: string, text: string): Promise<void> {
    await this.guard(path)
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    await writeFile(path, text, 'utf8')
  }

  private mapPath(project: string, paperKey: string): string {
    return join(this.dir(project, paperKey), 'source_map.json')
  }

  private paperPath(project: string, paperKey: string): string {
    return join(this.dir(project, paperKey), 'paper.md')
  }

  private cachePath(project: string, paperKey: string): string {
    return join(this.dir(project, paperKey), 'cache.json')
  }

  private glossaryPath(project: string, paperKey: string): string {
    return join(this.dir(project, paperKey), 'glossary.json')
  }

  private notesPath(project: string, paperKey: string): string {
    return join(this.dir(project, paperKey), 'notes.json')
  }

  async loadNotes(project: string, paperKey: string): Promise<NotesFile | undefined> {
    return await this.readJson<NotesFile>(this.notesPath(project, paperKey))
  }

  /** 装配（exportPdf 与 notes 共用）：paper.md → 段落流 + 参考文献 + 图内标注。 */
  private async assemble(project: string, paperKey: string): Promise<{
    map: SourceMap
    assembled: AssembledReading
    verify: VerifyReport
    markdown: string
  }> {
    const map = await this.loadMap(project, paperKey)
    if (map === undefined) throw new ServiceError('NOT_FOUND', `未抽取：${paperKey}`)
    const markdown = await readFile(this.paperPath(project, paperKey), 'utf8')
      .catch(() => {
        throw new ServiceError('NOT_FOUND', `paper.md 未生成（先翻译）：${paperKey}`)
      })
    const parsed = parsePaper(markdown)
    const verify = verifyPaper(markdown, map)
    return { map, assembled: assembleReading(parsed, verify.states), verify, markdown }
  }

  /** 译注版分析层（0205 附记四）：全文导读 + 每节【本节速览】/◆精读备注。
   * 可恢复：已有的节跳过，失败重跑只补缺失；`limit` 限单次生成的节数
   * （agent 逐批调用 → 每批完成都能向用户报进度）。 */
  async generateNotes(project: string, paperKey: string, options: { limit?: number } = {}): Promise<{
    guideReady: boolean
    total: number
    done: number
    pending: number
    model: string
  }> {
    const llm = this.deps.llm()
    if (llm === undefined) throw new ServiceError('INVALID', '宿主 LLM 不可用：导读/备注无法生成')
    const { provider, model } = this.deps.llmConfig()
    const { assembled } = await this.assemble(project, paperKey)
    const sections = splitSections(assembled.flow)
    const previous = await this.loadNotes(project, paperKey) ?? emptyNotesFile(model)
    let guide = previous.guide
    const sectionsRecord: Record<string, { summary: string; note: string }> = { ...previous.sections }
    const deps = { llm, provider, model }
    if (guide === undefined) {
      const titleParagraph = assembled.flow.find(p => p.kind === 'title')
      const title = titleParagraph?.translation ?? titleParagraph?.sourceText ?? paperKey
      const abstract = assembled.flow.find(p => p.kind === 'abstract')?.translation
      try {
        guide = await generateGuide(deps, {
          title,
          ...(abstract !== undefined ? { abstract } : {}),
          headings: sections
            .filter(section => section.headingId !== undefined)
            .map(section => section.headingTranslation !== undefined ? `${section.headingSource}（${section.headingTranslation}）` : section.headingSource),
        })
      } catch { /* 导读失败不阻断节备注；重跑 notes 只补缺失 */ }
    }
    const candidates = sections
      .filter((section): section is typeof section & { headingId: string } =>
        section.headingId !== undefined && section.paragraphs.some(p => p.translation !== undefined))
    const missing = candidates.filter(section => sectionsRecord[section.headingId] === undefined)
    const limit = Math.max(1, Math.min(12, options.limit ?? 6))
    const limiter = new Limiter(2)
    await limitedMap(limiter, missing.slice(0, limit), async (section) => {
      try {
        sectionsRecord[section.headingId] = await generateSectionNote(deps, section)
      } catch { /* 单节失败可重跑补 */ }
    })
    const notesFile: NotesFile = {
      version: 1,
      model,
      at: new Date().toISOString(),
      ...(guide !== undefined ? { guide } : {}),
      sections: sectionsRecord,
    }
    await this.writeJson(this.notesPath(project, paperKey), notesFile)
    const done = candidates.filter(section => sectionsRecord[section.headingId] !== undefined).length
    return { guideReady: guide !== undefined, total: candidates.length, done, pending: candidates.length - done, model }
  }

  async loadMap(project: string, paperKey: string): Promise<SourceMap | undefined> {
    return await this.readJson<SourceMap>(this.mapPath(project, paperKey))
  }

  async loadGlossary(project: string, paperKey: string): Promise<Glossary> {
    return await this.readJson<Glossary>(this.glossaryPath(project, paperKey)) ?? { entries: {} }
  }

  /** 术语表写入 + 定向失效：srcText 含变更术语的块的缓存条目剔除。 */
  async setGlossary(project: string, paperKey: string, entries: Record<string, string>): Promise<Glossary> {
    const normalized: Record<string, string> = {}
    for (const [term, translation] of Object.entries(entries)) {
      const key = term.trim()
      if (key !== '' && translation.trim() !== '') normalized[key] = translation.trim()
    }
    const glossary: Glossary = { entries: normalized }
    await this.writeJson(this.glossaryPath(project, paperKey), glossary)
    // 定向失效：旧缓存的 key 无法反查术语哈希——直接清空（cacheKey 含
    // glossaryHash，改表后旧键永不再命中；留着无害但占空间。取舍：清空）。
    await this.writeJson(this.cachePath(project, paperKey), emptyCache())
    return glossary
  }

  /** 抽取：读 PDF → 块表 →（已有 map 则迁移）→ 落 source_map.json。
   * pdfPath 是库内相对路径（如 literature/pdf/xxx.pdf）。 */
  async extract(project: string, paperKey: string, pdfPath: string): Promise<{ pages: number; blocks: number; migrated: number; orphan: number }> {
    // 入参先于 I/O 校验（paperKey/slug 非法不该等到读文件才炸）
    const root = this.requireRoot()
    assertPaperKey(paperKey)
    if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
    const absPdf = join(root, project, pdfPath)
    await this.guard(absPdf)
    let data: Buffer
    try {
      data = await readFile(absPdf)
    } catch {
      throw new ServiceError('NOT_FOUND', `PDF 不存在：${pdfPath}（先取 PDF 再精读）`)
    }
    const extracted = await extractPdfBlocks(new Uint8Array(data))
    const sources: Record<string, string> = {}
    for (const block of extracted.blocks) sources[block.id] = block.text
    const pdfSha256 = createHash('sha256').update(data).digest('hex')
    const freshMap = buildSourceMap({ paperKey, pdfPath, pdfSha256, blocks: extracted.blocks })
    const previous = await this.loadMap(project, paperKey)
    let finalMap: SourceMap = freshMap
    let migrated = 0
    let orphan = 0
    if (previous !== undefined && previous.schemaVersion === SOURCE_MAP_VERSION) {
      const report = migrateBlocks(previous, extracted.blocks)
      finalMap = { ...freshMap, blocks: report.blocks }
      migrated = report.migrated
      orphan = report.orphans.length
    }
    await this.writeJson(this.mapPath(project, paperKey), finalMap)
    // 源文文本落独立文件（map 只存哈希；paper.md 未生成前 render 需要）
    await this.writeJson(join(this.dir(project, paperKey), 'sources.json'), sources)
    return { pages: extracted.pages, blocks: extracted.blocks.length, migrated, orphan }
  }

  /** 翻译：缓存命中跳过；miss 走 llm（缺席报 INVALID）→ 术语强校验 →
   * 写缓存/更新 map 元数据 → 重渲染 paper.md → verify。 */
  async translate(project: string, paperKey: string, options: { keys?: readonly string[]; force?: boolean } = {}): Promise<ReadingStatus> {
    const map = await this.loadMap(project, paperKey)
    if (map === undefined) throw new ServiceError('NOT_FOUND', `未抽取：先对 ${paperKey} 跑 reading.extract`)
    const llm = this.deps.llm()
    if (llm === undefined) throw new ServiceError('INVALID', '宿主 LLM 不可用：翻译无法进行（抽取/校验不受影响）')
    const { provider, model } = this.deps.llmConfig()
    const glossary = await this.loadGlossary(project, paperKey)
    const sources = await this.readJson<Record<string, string>>(join(this.dir(project, paperKey), 'sources.json')) ?? {}
    let cache = await this.readJson<TranslationCache>(this.cachePath(project, paperKey)) ?? emptyCache()
    const wanted = (options.keys !== undefined && options.keys.length > 0
      ? map.blocks.filter(block => options.keys?.includes(block.id))
      : map.blocks
    ).filter(block => !UNTRANSLATED_KINDS.has(block.kind))
    const pending = wanted.filter(block => {
      if (options.force === true) return true
      const key = this.keyOf(block, model, glossary)
      return lookup(cache, key) === undefined
    })
    if (pending.length > 0) {
      const report = await translateBlocks({
        llm, provider, model,
      }, pending.map(block => ({ id: block.id, text: sources[block.id] ?? '' })), {
        glossary: glossary.entries,
      })
      if (report.failures.length > 0) {
        throw new ServiceError('UPSTREAM', `翻译失败 ${report.failures.length} 块（首错：${report.failures[0]?.error ?? ''}）`)
      }
      for (const result of report.results) {
        const check = enforceGlossary(result.text, glossary)
        cache = store(cache, this.keyOfById(result.srcHash, model, glossary), { text: check.repaired, model, at: result.at })
      }
      await this.writeJson(this.cachePath(project, paperKey), cache)
    }
    await this.rewriteMapTranslations(project, paperKey, map, cache, model, glossary)
    await this.renderPaper(project, paperKey)
    return await this.status(project, paperKey)
  }

  private keyOf(block: SourceMapBlock, model: string, glossary: Glossary): string {
    return this.keyOfById(block.srcHash, model, glossary)
  }

  private keyOfById(srcHash: string, model: string, glossary: Glossary): string {
    // target 固定 zh（schema 留字段，当前只做 en→zh）
    return cacheKeyOf({ target: 'zh', model, srcHash, glossary })
  }

  private async rewriteMapTranslations(
    project: string,
    paperKey: string,
    map: SourceMap,
    cache: TranslationCache,
    model: string,
    glossary: Glossary,
  ): Promise<void> {
    const blocks: SourceMapBlock[] = []
    for (const block of map.blocks) {
      const hit = lookup(cache, this.keyOf(block, model, glossary))
      blocks.push(hit === undefined
        ? block
        : {
            ...block,
            translation: {
              target: 'zh',
              model,
              at: hit.at,
              cacheKey: this.keyOf(block, model, glossary),
            },
          })
    }
    await this.writeJson(this.mapPath(project, paperKey), { ...map, blocks })
  }

  /** 渲染 paper.md（以 map+sources+缓存现值为准），渲染后 verify 状态写进锚。 */
  private async renderPaper(project: string, paperKey: string): Promise<VerifyReport> {
    const map = await this.loadMap(project, paperKey)
    if (map === undefined) throw new ServiceError('NOT_FOUND', '未抽取')
    const sources = await this.readJson<Record<string, string>>(join(this.dir(project, paperKey), 'sources.json')) ?? {}
    const cache = await this.readJson<TranslationCache>(this.cachePath(project, paperKey)) ?? emptyCache()
    const glossary = await this.loadGlossary(project, paperKey)
    const { model } = this.deps.llmConfig()
    const translations: Record<string, string> = {}
    for (const block of map.blocks) {
      const hit = lookup(cache, this.keyOf(block, model, glossary))
      if (hit !== undefined) translations[block.id] = hit.text
    }
    const markdown = renderPaperWithSources(map, sources, translations)
    await this.writeText(this.paperPath(project, paperKey), markdown)
    return verifyPaper(markdown, map)
  }

  /** paper.md 原文（视图渲染用）。 */
  async content(project: string, paperKey: string): Promise<{ markdown: string; verify: VerifyReport }> {
    const map = await this.loadMap(project, paperKey)
    if (map === undefined) throw new ServiceError('NOT_FOUND', `未抽取：${paperKey}`)
    let markdown: string
    try {
      markdown = await readFile(this.paperPath(project, paperKey), 'utf8')
    } catch {
      throw new ServiceError('NOT_FOUND', `paper.md 未生成：${paperKey}`)
    }
    return { markdown, verify: verifyPaper(markdown, map) }
  }

  async verify(project: string, paperKey: string): Promise<VerifyReport> {
    const map = await this.loadMap(project, paperKey)
    if (map === undefined) throw new ServiceError('NOT_FOUND', `未抽取：${paperKey}`)
    let markdown: string
    try {
      markdown = await readFile(this.paperPath(project, paperKey), 'utf8')
    } catch {
      throw new ServiceError('NOT_FOUND', `paper.md 未生成：${paperKey}`)
    }
    return verifyPaper(markdown, map)
  }

  /** 译注版 PDF 归档（readings/<YYYY-MM-DD>/<paperKey>.pdf）：封面信息表 +
   * 阅读指南 + 全文导读 + 正文逐段双语（速览/备注盒 + 图内标注）+ 附录
   * （图表清单/术语对照表/参考文献英文原样/免责说明）。同日重导覆盖。 */
  async exportPdf(project: string, paperKey: string): Promise<{
    path: string
    bytes: number
    summary: { pages: number; blocks: number; translated: number; verified: number; mismatch: number; orphan: number; missing: number }
  }> {
    const { map, assembled, verify } = await this.assemble(project, paperKey)
    const { flow, references, figureNotes } = assembled
    const titleParagraph = flow.find(p => p.kind === 'title')
    const titleEn = (titleParagraph?.sourceText ?? paperKey).slice(0, 300)
    const titleZh = (titleParagraph?.translation ?? titleEn).slice(0, 300)
    // 作者行启发式：title 之后、首个标题行之前的第一段短正文
    let authors: string | undefined
    if (titleParagraph !== undefined) {
      const titleIndex = flow.indexOf(titleParagraph)
      for (let index = titleIndex + 1; index < flow.length; index += 1) {
        const paragraph = flow[index]!
        if (paragraph.kind === 'heading') break
        if (paragraph.kind === 'para' && paragraph.sourceText.length <= 420) {
          authors = paragraph.sourceText.slice(0, 300)
          break
        }
      }
    }
    const notes = await this.loadNotes(project, paperKey)
    const glossary = await this.loadGlossary(project, paperKey)
    const model = map.blocks.find(block => block.translation !== undefined)?.translation?.model
    const translatableIds = new Set(map.blocks.filter(block => !UNTRANSLATED_KINDS.has(block.kind)).map(block => block.id))
    const translated = map.blocks
      .filter(block => translatableIds.has(block.id) && block.translation !== undefined).length
    const verified = verify.verified.filter(id => translatableIds.has(id)).length
    const mismatch = verify.mismatch.filter(id => translatableIds.has(id)).length
    const orphan = verify.orphan.filter(id => translatableIds.has(id)).length
    const missing = Math.max(0, translatableIds.size - verified - mismatch - orphan)
    const figureList = flow
      .filter(p => p.kind === 'caption')
      .map(p => ({ text: p.sourceText, page: map.blocks.find(block => block.id === p.id)?.page ?? 0 }))
    const buffer = await renderReadingPdf({
      paperKey,
      titleZh,
      titleEn,
      ...(authors !== undefined ? { authors } : {}),
      pdfPath: map.source.pdf,
      exportedAt: new Date().toISOString(),
      ...(model !== undefined ? { model } : {}),
      ...(Object.keys(glossary.entries).length > 0 ? { glossary: glossary.entries } : {}),
      ...(notes?.guide !== undefined ? { guide: notes.guide } : {}),
      ...(notes !== undefined ? { sectionNotes: notes.sections } : {}),
      summary: {
        pages: map.source.pages,
        blocks: map.blocks.length,
        translated,
        verified,
        mismatch,
        orphan,
        missing,
      },
      flow: flow.map(p => ({
        id: p.id,
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        state: p.state,
        sourceText: p.sourceText,
        ...(p.translation !== undefined ? { translation: p.translation } : {}),
      })),
      references: references.map(p => ({
        id: p.id,
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        state: p.state,
        sourceText: p.sourceText,
      })),
      figureNotes,
      figureList,
    })
    const now = new Date()
    const day = [
      String(now.getFullYear()).padStart(4, '0'),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    const relPath = join(project, 'readings', day, `${paperKey}.pdf`)
    const absPath = join(this.requireRoot(), relPath)
    await this.guard(absPath)
    await mkdir(absPath.slice(0, absPath.lastIndexOf('/')), { recursive: true })
    await writeFile(absPath, buffer)
    return {
      path: relPath,
      bytes: buffer.length,
      summary: {
        pages: map.source.pages,
        blocks: map.blocks.length,
        translated,
        verified,
        mismatch,
        orphan,
        missing,
      },
    }
  }

  async status(project: string, paperKey: string): Promise<ReadingStatus> {
    const map = await this.loadMap(project, paperKey)
    if (map === undefined) {
      return { paperKey, extracted: false, pages: 0, blocks: 0, translatable: 0, translated: 0, verified: 0, mismatch: 0, orphan: 0, missing: 0, llmAvailable: this.deps.llm() !== undefined }
    }
    let verified = 0
    let mismatch = 0
    let orphan = 0
    try {
      const report = await this.verify(project, paperKey)
      verified = report.verified.length
      mismatch = report.mismatch.length
      orphan = report.orphan.length
    } catch { /* paper.md 未生成 */ }
    const translated = map.blocks.filter(block => block.translation !== undefined).length
    const translatable = map.blocks.filter(block => !UNTRANSLATED_KINDS.has(block.kind)).length
    const missing = Math.max(0, translatable - verified - mismatch - orphan)
    return {
      paperKey,
      extracted: true,
      pages: map.source.pages,
      blocks: map.blocks.length,
      translatable,
      translated,
      verified,
      mismatch,
      orphan,
      missing,
      llmAvailable: this.deps.llm() !== undefined,
    }
  }
}

/** 延迟取 cache.cacheKeyOf（避免模块级循环依赖）。 */
function require0(): { cacheKeyOf: typeof import('./cache.ts')['cacheKeyOf'] } {
  return { cacheKeyOf: cacheKeyOfRef }
}
import { cacheKeyOf as cacheKeyOfRef } from './cache.ts'
