/** LiteratureService（0203 Task 2.10）：三源检索 / 入库（去重+撤稿标红）/
 * 取 PDF / 库管理 / BibTeX 导出。全部动作显式带 project（无隐式 active
 * 兜底）；offlineMode 网络动作直接 OFFLINE 拒绝。账本与库都挂在当前总根下
 * （root.set 后自然跟根）。 */

import { join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import type { SrwFsLike } from '../host.ts'
import { readRootConfig } from '../workspace/root.ts'
import { ServiceError, type SrwService } from '../service.ts'
import { RateGate } from './rate-gate.ts'
import { gatedFetchJson } from './http.ts'
import { searchArxiv, fetchArxivByIds } from './arxiv.ts'
import { searchOpenAlex } from './openalex.ts'
import { searchCrossref, resolveDoi, parseCrossrefWork } from './crossref.ts'
import { identityKey } from './identity.ts'
import { LibraryStore, type LitEntry } from './library.ts'
import { fetchPdfFor } from './pdf.ts'
import { appendToRefs, citekeyOf, entryOrThrow } from './bibtex.ts'
import { checkRetraction } from '../verify/retraction.ts'
import type { LitCandidate, LitSource } from './types.ts'

const SOURCES: readonly LitSource[] = ['arxiv', 'openalex', 'crossref']

export interface LiteratureDeps {
  /** 宿主 fs（护栏；注入缺失护栏 fail-closed）。 */
  readonly fs: SrwFsLike | undefined
  /** offlineMode（true 时一切网络动作拒绝）。 */
  readonly offlineMode: () => boolean
  /** 当前总根（动态；未设置时库/账本动作 NO_ROOT）。 */
  readonly rootDir: () => string | undefined
  /** 元数据自愈：按 arXiv id 批量取权威元数据（缺省真网 id_list；测试注入 stub）。 */
  readonly enrichByIds?: (ids: readonly string[]) => Promise<readonly LitCandidate[]>
}

function assertSource(source: string): LitSource {
  if (!(SOURCES as readonly string[]).includes(source)) {
    throw new ServiceError('INVALID', `source 必须是 ${SOURCES.join('|')}，收到 ${JSON.stringify(source)}`)
  }
  return source as LitSource
}

function assertProject(project: string): string {
  if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
  return project
}

/** RPC/工具传入的候选归一校验（宽松形状 → LitCandidate）。 */
export function candidateFromInput(raw: unknown): LitCandidate {
  if (typeof raw !== 'object' || raw === null) throw new ServiceError('INVALID', 'item 必须是对象')
  const m = raw as Record<string, unknown>
  const source = assertSource(typeof m['source'] === 'string' ? m['source'] : '')
  const identityRaw = (typeof m['identity'] === 'object' && m['identity'] !== null)
    ? m['identity'] as Record<string, unknown>
    : null
  if (identityRaw === null || typeof identityRaw['title'] !== 'string' || identityRaw['title'] === '') {
    throw new ServiceError('INVALID', 'item.identity.title 必填')
  }
  const identity: LitCandidate['identity'] = {
    ...(typeof identityRaw['doi'] === 'string' && identityRaw['doi'] !== '' ? { doi: identityRaw['doi'].toLowerCase() } : {}),
    ...(typeof identityRaw['arxivId'] === 'string' && identityRaw['arxivId'] !== '' ? { arxivId: identityRaw['arxivId'] } : {}),
    title: identityRaw['title'],
    year: typeof identityRaw['year'] === 'number' ? identityRaw['year'] : 0,
  }
  const authors = Array.isArray(m['authors'])
    ? m['authors'].filter((a): a is string => typeof a === 'string' && a !== '')
    : []
  const pickUrl = (key: string): string | undefined => {
    const value = m[key]
    return typeof value === 'string' && value.startsWith('http') ? value : undefined
  }
  const pdfUrl = pickUrl('pdfUrl')
  const oaUrl = pickUrl('oaUrl')
  return {
    source,
    identity,
    authors,
    venue: typeof m['venue'] === 'string' ? m['venue'] : '',
    abstract: typeof m['abstract'] === 'string' ? m['abstract'] : '',
    ...(typeof m['publishedAt'] === 'string' ? { publishedAt: m['publishedAt'] } : {}),
    ...(pdfUrl === undefined ? {} : { pdfUrl }),
    ...(oaUrl === undefined ? {} : { oaUrl }),
    ...(typeof m['citedByCount'] === 'number' ? { citedByCount: m['citedByCount'] } : {}),
  }
}

export class LiteratureService {
  private readonly fs: SrwFsLike | undefined
  private readonly offline: () => boolean
  private readonly root: () => string | undefined
  private readonly enrichByIds: (ids: readonly string[]) => Promise<readonly LitCandidate[]>
  readonly gate: RateGate

  constructor(deps: LiteratureDeps) {
    this.fs = deps.fs
    this.offline = deps.offlineMode
    this.root = deps.rootDir
    this.enrichByIds = deps.enrichByIds ?? (async ids => await fetchArxivByIds({ gate: this.gate }, ids))
    this.gate = new RateGate({
      ledgerPath: () => {
        const root = this.root()
        if (root === undefined) throw new ServiceError('NO_ROOT', '科研总根未设置（先在面板选择）')
        return join(root, '.srw', 'rate-ledger.json')
      },
    })
  }

  private requireRoot(): string {
    const root = this.root()
    if (root === undefined || root === '') throw new ServiceError('NO_ROOT', '科研总根未设置（先在面板选择）')
    return root
  }

  /** 离线断言（公开：tools/RPC 前置调用）。 */
  assertOnline(): void {
    if (this.offline()) throw new ServiceError('OFFLINE', '离线模式开启：网络动作停用（可在面板关闭离线模式）')
  }

  private store(project: string): LibraryStore {
    return new LibraryStore(this.requireRoot(), this.fs)
  }

  /** 三源检索（不入库）。 */
  async search(source: string, query: string, limit = 20): Promise<readonly LitCandidate[]> {
    this.assertOnline()
    const kind = assertSource(source)
    const capped = Math.min(50, Math.max(1, Math.floor(limit)))
    switch (kind) {
      case 'arxiv': return await searchArxiv({ gate: this.gate }, query, capped)
      case 'openalex': return await searchOpenAlex({ gate: this.gate }, query, capped)
      case 'crossref': const mailto = await this.mailto()
      return await searchCrossref({ gate: this.gate, ...(mailto === undefined ? {} : { mailto }) }, query, capped)
    }
  }

  /** 元数据自愈：调用方（agent 组参/用户手输）常剪掉 authors/year——带 arxivId
   * 但 year=0 或 authors 空的候选，入库前批量拉 arXiv 权威元数据**只补空缺**
   * （不覆盖调用方已给字段）。自愈失败/离线不阻断入库（退化原样入库）。
   * 返回补全世界（汇报用，键为去版本 arXiv id）。 */
  private async enrichThin(candidates: readonly LitCandidate[]): Promise<{
    candidates: LitCandidate[]
    enriched: string[]
  }> {
    const need = candidates.filter(item => item.identity.arxivId !== undefined
      && (item.identity.year === 0 || item.authors.length === 0))
    if (need.length === 0) return { candidates: [...candidates], enriched: [] }
    const ids = [...new Set(need.map(item => item.identity.arxivId?.replace(/v\d+$/, '') ?? ''))].filter(id => id !== '')
    let authoritative: readonly LitCandidate[]
    try {
      authoritative = await this.enrichByIds(ids)
    } catch { return { candidates: [...candidates], enriched: [] } }
    const byId = new Map<string, LitCandidate>()
    for (const full of authoritative) {
      const raw = full.identity.arxivId
      if (raw !== undefined) byId.set(raw.replace(/v\d+$/, '').toLowerCase(), full)
    }
    const out: LitCandidate[] = []
    const enriched: string[] = []
    for (const candidate of candidates) {
      const id = candidate.identity.arxivId
      const full = id === undefined ? undefined : byId.get(id.replace(/v\d+$/, '').toLowerCase())
      const thin = candidate.identity.year === 0 || candidate.authors.length === 0
      if (full === undefined || !thin) {
        out.push(candidate)
        continue
      }
      const merged: LitCandidate = {
        ...candidate,
        identity: {
          ...candidate.identity,
          ...(candidate.identity.year === 0 && full.identity.year > 0 ? { year: full.identity.year } : {}),
        },
        authors: candidate.authors.length > 0 ? candidate.authors : full.authors,
        abstract: candidate.abstract !== '' ? candidate.abstract : full.abstract,
        ...(candidate.pdfUrl === undefined && full.pdfUrl !== undefined ? { pdfUrl: full.pdfUrl } : {}),
        ...(candidate.oaUrl === undefined && full.oaUrl !== undefined ? { oaUrl: full.oaUrl } : {}),
        ...(candidate.publishedAt === undefined && full.publishedAt !== undefined ? { publishedAt: full.publishedAt } : {}),
      }
      out.push(merged)
      if (merged.identity.year !== candidate.identity.year || merged.authors.length !== candidate.authors.length) {
        if (id !== undefined) enriched.push(id.replace(/v\d+$/, ''))
      }
    }
    return { candidates: out, enriched }
  }

  /** 入库：元数据自愈 → 批内+库内去重 → 新条目 DOI 撤稿核查（失败不阻断）→ 标红。 */
  async importEntries(project: string, candidatesInput: readonly unknown[]): Promise<{
    added: number
    duplicates: number
    retracted: string[]
    enriched: string[]
  }> {
    const slug = assertProject(project)
    const parsed = candidatesInput.map(candidateFromInput)
    const { candidates, enriched } = this.offline()
      ? { candidates: parsed, enriched: [] }
      : await this.enrichThin(parsed)
    const store = this.store(slug)
    const result = await store.upsert(slug, candidates)
    const retracted: string[] = []
    if (candidates.length > 0 && !this.offline()) {
      for (const item of Object.values(result.doc.entries)) {
        const doi = item.identity.doi
        if (doi === undefined || item.status === 'retracted') continue
        if (Date.parse(item.addedAt) < Date.now() - 60_000) continue // 老条目不重复核查
        try {
          const mailto = await this.mailto()
          const state = await checkRetraction({ gate: this.gate, ...(mailto === undefined ? {} : { mailto }) }, doi)
          if (state === 'retracted') {
            await store.updateEntry(slug, item.key, entry => ({ ...entry, status: 'retracted' }))
            retracted.push(item.key)
          }
        } catch { /* 撤稿核查失败不阻断入库 */ }
      }
    }
    return { added: result.added, duplicates: result.duplicates, retracted, enriched }
  }

  /** 按 DOI 直取元数据（校验真伪）。 */
  async resolveDoi(doi: string): Promise<LitCandidate> {
    this.assertOnline()
    const mailto = await this.mailto()
    return await resolveDoi({ gate: this.gate, ...(mailto === undefined ? {} : { mailto }) }, doi)
  }

  /** 取 PDF：pdfUrl→oaUrl 顺序尝试；落 `literature/pdf/<citekey>-<hash6>.pdf`；
   * 成功回填 entry.pdf。 */
  async fetchPdf(project: string, key: string): Promise<{ path: string; sha256: string; bytes: number }> {
    this.assertOnline()
    const slug = assertProject(project)
    const root = this.requireRoot()
    const store = this.store(slug)
    const doc = await store.load(slug)
    const entry = entryOrThrow(doc.entries, key)
    const dest = join(root, slug, 'literature', 'pdf', this.pdfFilename(entry))
    const result = await fetchPdfFor(this.gate, [entry.pdfUrl, entry.oaUrl], dest, this.fs, root)
    await store.updateEntry(slug, key, current => ({
      ...current,
      status: current.status === 'retracted' ? 'retracted' : 'has-pdf',
      pdf: { file: join(slug, 'literature', 'pdf', this.pdfFilename(current)), sha256: result.sha256, bytes: result.bytes },
    }))
    return { path: result.path, sha256: result.sha256, bytes: result.bytes }
  }

  private pdfFilename(entry: LitEntry): string {
    const digest = identityKey(entry.identity).replace(/[^a-z0-9]/gi, '').slice(-8)
    return `${citekeyOf(entry)}-${digest}.pdf`
  }

  /** 库列表（loading 按加入序）。 */
  async lib(project: string): Promise<readonly LitEntry[]> {
    const slug = assertProject(project)
    const doc = await this.store(slug).load(slug)
    return Object.values(doc.entries).sort((a, b) => a.addedAt.localeCompare(b.addedAt))
  }

  /** 导出 BibTeX 到 `<root>/<project>/paper/refs.bib`；retracted 条目跳过并报告。 */
  async bibtex(project: string, keys?: readonly string[]): Promise<{ added: readonly string[]; skippedRetracted: string[] }> {
    const slug = assertProject(project)
    const root = this.requireRoot()
    const store = this.store(slug)
    const doc = await store.load(slug)
    const selected = keys !== undefined && keys.length > 0
      ? keys.map(key => entryOrThrow(doc.entries, key))
      : Object.values(doc.entries)
    const exportable: LitEntry[] = []
    const skippedRetracted: string[] = []
    for (const entry of selected) {
      if (entry.status === 'retracted') {
        skippedRetracted.push(entry.key)
        continue
      }
      exportable.push(entry)
    }
    const refsPath = join(root, slug, 'paper', 'refs.bib')
    const result = await appendToRefs(refsPath, exportable)
    return { added: result.added, skippedRetracted }
  }

  private async mailto(): Promise<string | undefined> {
    const root = this.root()
    if (root === undefined) return undefined
    const config = await readRootConfig(root)
    return config.politeMailto
  }
}

/** 装配：从 SrwService 取动态参数。 */
export function attachLiterature(service: SrwService): LiteratureService {
  return new LiteratureService({
    fs: (service.ctx as { fs?: SrwFsLike }).fs,
    offlineMode: () => service.config.offlineMode === true,
    rootDir: () => service.currentRoot(),
  })
}

/** arXiv id 批量取（agent 面用；放这里避免 tools 直依赖适配器）。 */
export async function literatureByIds(service: LiteratureService, ids: readonly string[]): Promise<LitCandidate[]> {
  service.assertOnline()
  return await fetchArxivByIds({ gate: service.gate }, ids)
}

/** OpenAlex 页直取（供未来 watch 用；M2 暂留内部）。 */
export async function rawJson(service: LiteratureService, url: URL): Promise<unknown> {
  service.assertOnline()
  return await gatedFetchJson(service.gate, url)
}
