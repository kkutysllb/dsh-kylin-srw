/** 文献库存储（0203 Task 2.6 / P0-3）：`<root>/<project>/literature/library.json`
 * 是**唯一真相源**（0102 §6.2）。revision 比对 + STALE 拒写（0102 §6.3
 * 冲突策略）；原子落盘（tmp→rename）。路径全部过 assertInsideRoot 护栏。
 *
 * P0-3 追加：
 * - entry.identity.canonicalDoi 保留 arXiv 自赋 DOI 的原值；
 * - upsert 与库内既有条目匹配时用**重算后的 identityKey**（不是 entry.key），
 *   因此迁移前的旧 `title:<sha1>:<year>` 键不会产生新重复；
 * - `migrate()` 把旧键重算为新键：dry-run 默认、apply 才写盘、写前备份
 *   `library.json.bak`，并报告将合并/冲突条数；可重复执行。
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { disambiguatedTitleKey, identityKey, sameWork } from './identity.ts'
import type { LitCandidate, LitIdentity } from './types.ts'

const LIBRARY_VERSION = 1

/** 条目状态：`unread` 新入库 / `has-pdf` 已取原文 / `retracted` 撤稿 / `archived` 归档。 */
export type LitStatus = 'unread' | 'has-pdf' | 'retracted' | 'archived'

/** DOI 校验结果（P0-6）：不改变 status，只在 entry 上留证据。
 * import 时对含 DOI 的候选跑一次 resolveDoi；失败标 unresolved 但**不阻断入库**。 */
export interface EntryVerification {
  readonly status: 'verified' | 'unresolved'
  readonly checkedAt: string
  /** resolveDoi 命中的撤稿信号（true=Crossref 已标撤稿）。 */
  readonly retracted?: boolean
  /** unresolved 的错误码/消息（有界）。 */
  readonly error?: string
}

/** library.json 里的一条（合并后的最终形状）。 */
export interface LitEntry {
  /** citekey 或 identityKey（key 冲突时 citekey 带后缀；本存储层直接用 identityKey） */
  readonly key: string
  readonly identity: LitIdentity
  readonly source: LitCandidate['source']
  /** 命中的源列表（跨源合并累积） */
  readonly seenIn: readonly string[]
  readonly authors: readonly string[]
  readonly venue: string
  readonly abstract: string
  readonly status: LitStatus
  readonly addedAt: string
  readonly updatedAt: string
  readonly pdfUrl?: string
  readonly oaUrl?: string
  /** PDF 证据（P0-4：全文获取把 URL/时间/contentType 一并落在这里）。 */
  readonly pdf?: {
    readonly file: string
    readonly sha256: string
    readonly bytes: number
    readonly url?: string
    readonly finalUrl?: string
    readonly retrievedAt?: string
    readonly contentType?: string
  }
  readonly citedByCount?: number
  /** OpenAlex Work id（`W...`；溯源/跨源补全用，旧文档无此字段照读）。 */
  readonly openalexId?: string
  /** 源标记的撤稿状态（OpenAlex `is_retracted`）；true 时 status 置 `retracted`。 */
  readonly retracted?: boolean
  /** 勘误/更新通知（0204 3.6：Crossref is-update-of / corrigendum——
   * 不是撤稿不标红；旧文档无此字段照读）。 */
  readonly notice?: 'corrigendum'
  /** DOI 校验证据（P0-6）；旧文档/无 DOI 条目无此字段。 */
  readonly verification?: EntryVerification
}

export interface LibraryDoc {
  readonly schemaVersion: typeof LIBRARY_VERSION
  revision: number
  entries: Record<string, LitEntry>
}

export function emptyLibrary(): LibraryDoc {
  return { schemaVersion: LIBRARY_VERSION, revision: 0, entries: {} }
}

export function libraryPath(rootDir: string, project: string): string {
  if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
  return join(rootDir, project, 'literature', 'library.json')
}

export class LibraryStore {
  constructor(
    /** 科研总根绝对路径。 */
    private readonly rootDir: string,
    /** 宿主 fs（护栏用；注入缺失时护栏 fail-closed）。 */
    private readonly fs: SrwFsLike | undefined,
  ) {}

  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.fs, this.rootDir, absPath)
  }

  /** 读库；缺文件返回空库。坏 JSON 抛 INVALID（不静默清空用户数据）。 */
  async load(project: string): Promise<LibraryDoc> {
    const path = libraryPath(this.rootDir, project)
    await this.guard(path)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return emptyLibrary()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ServiceError('INVALID', `library.json 不是合法 JSON：${path}`)
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ServiceError('INVALID', `library.json 形状损坏：${path}`)
    }
    const doc = parsed as Partial<LibraryDoc>
    if (doc.schemaVersion !== LIBRARY_VERSION || typeof doc.revision !== 'number'
      || typeof doc.entries !== 'object' || doc.entries === null) {
      throw new ServiceError('INVALID', `library.json 版本/字段损坏：${path}`)
    }
    return { schemaVersion: LIBRARY_VERSION, revision: doc.revision, entries: doc.entries }
  }

  /** 保存（乐观并发）：expectedRevision 不匹配当前文件 → STALE 拒写。
   * 内存 doc 直接给出（调用方从 load 改来），这里补 revision+1 并落盘。
   * 首写例外：文件不存在且 expectedRevision===0（load 刚给过空库）。 */
  async save(project: string, doc: LibraryDoc, expectedRevision: number): Promise<LibraryDoc> {
    const path = libraryPath(this.rootDir, project)
    await this.guard(path)
    try {
      const disk = JSON.parse(await readFile(path, 'utf8')) as Partial<LibraryDoc>
      const diskRevision = typeof disk.revision === 'number' ? disk.revision : -1
      if (expectedRevision !== diskRevision) {
        throw new ServiceError('STALE', `库已被他人修改（磁盘 revision=${diskRevision}，期望=${expectedRevision}）；请重读后重试`)
      }
    } catch (error: unknown) {
      if (error instanceof ServiceError) throw error
      const code = (error as { code?: string }).code
      if (code !== 'ENOENT') throw error
      if (expectedRevision > 0) {
        throw new ServiceError('STALE', '库文件已被删除而内存持有旧副本（expectedRevision>0）')
      }
    }
    const next: LibraryDoc = { ...doc, revision: doc.revision + 1, schemaVersion: LIBRARY_VERSION }
    await mkdir(join(path, '..'), { recursive: true })
    const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
    try {
      await writeFile(tmp, JSON.stringify(next, null, 2) + '\n')
      await rename(tmp, path)
    } catch (writeError: unknown) {
      await rm(tmp, { force: true }).catch(() => {})
      throw writeError
    }
    return next
  }

  /** 入库：批内去重（mergeInto）+ 与库内去重 → 返回 {added, duplicates}。
   * P0-3：写新条目/回填既有条目都用 mergeInto 给出的 `key`；库内匹配本身
   * 按重算后的 identityKey 进行（迁移前旧键也能命中，不产生新重复）。 */
  async upsert(project: string, candidates: readonly LitCandidate[]): Promise<{ added: number; duplicates: number; doc: LibraryDoc }> {
    const doc = await this.load(project)
    const existing = Object.values(doc.entries)
    const { mergeInto } = await import('./identity.ts')
    const { fresh, verdicts } = mergeInto(candidates, existing)
    const now = new Date().toISOString()
    for (const item of fresh) {
      const key = item.key
      const prev = doc.entries[key]
      doc.entries[key] = {
        key,
        identity: item.identity,
        source: item.source,
        seenIn: [...item.seenIn],
        authors: [...item.authors],
        venue: item.venue,
        abstract: item.abstract,
        // 撤稿优先：新条目被任一源标 is_retracted 即直接落 retracted（覆盖 unread）。
        status: item.retracted === true ? 'retracted' : (prev?.status ?? 'unread'),
        addedAt: prev?.addedAt ?? now,
        updatedAt: now,
        ...(item.openalexId !== undefined ? { openalexId: item.openalexId } : {}),
        ...(item.retracted !== undefined ? { retracted: item.retracted } : {}),
        ...(item.pdfUrl !== undefined ? { pdfUrl: item.pdfUrl } : {}),
        ...(item.oaUrl !== undefined ? { oaUrl: item.oaUrl } : {}),
        ...(item.citedByCount !== undefined ? { citedByCount: item.citedByCount } : {}),
        ...(prev?.pdf !== undefined ? { pdf: prev.pdf } : {}),
        ...(prev?.verification !== undefined ? { verification: prev.verification } : {}),
      }
    }
    // 已存在条目做信息补全：重复≠丢弃——新候选可能带来库缺的字段
    // （首次入库时 arXiv 尚无 PDF 链接、后来 OA 版本出现；或首次入库元数据
    // 不全——agent 剪掉了 authors/year——补全候选带来权威值时一并治愈）。
    // 注意：这里用 verdict.key（实际库内键），不是重算 identityKey——旧键条目
    // 也能被补全，且不会另写一条。
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!
      const key = verdicts[index]?.key ?? identityKey(candidate.identity)
      const prev = doc.entries[key]
      if (prev === undefined) continue
      const yearHealed = prev.identity.year === 0 && candidate.identity.year > 0
      const authorsHealed = prev.authors.length === 0 && candidate.authors.length > 0
      // 撤稿信号只升级不降级（源可能滞后/缺字段）：任一候选 retracted=true →
      // 条目 retracted=true 且 status='retracted'（覆盖 unread/has-pdf/archived，
      // 与 fetchPdf 的「撤稿优先」一致）；false 不会把已撤稿条目改回。
      const retractedNext = prev.retracted === true || candidate.retracted === true
        ? true
        : candidate.retracted ?? prev.retracted
      const canonicalDoi = prev.identity.canonicalDoi ?? candidate.identity.canonicalDoi
      const patched: LitEntry = {
        ...prev,
        ...(retractedNext === undefined ? {} : { retracted: retractedNext }),
        ...(retractedNext === true ? { status: 'retracted' as const } : {}),
        ...(yearHealed ? { identity: { ...prev.identity, year: candidate.identity.year } } : {}),
        ...(canonicalDoi !== undefined && prev.identity.canonicalDoi === undefined
          ? { identity: { ...prev.identity, year: yearHealed ? candidate.identity.year : prev.identity.year, canonicalDoi } }
          : {}),
        ...(authorsHealed ? { authors: [...candidate.authors] } : {}),
        ...(prev.openalexId === undefined && candidate.openalexId !== undefined ? { openalexId: candidate.openalexId } : {}),
        ...(prev.pdfUrl === undefined && candidate.pdfUrl !== undefined ? { pdfUrl: candidate.pdfUrl } : {}),
        ...(prev.oaUrl === undefined && candidate.oaUrl !== undefined ? { oaUrl: candidate.oaUrl } : {}),
        ...(prev.citedByCount === undefined && candidate.citedByCount !== undefined ? { citedByCount: candidate.citedByCount } : {}),
        seenIn: [...new Set([...prev.seenIn, candidate.source])],
      }
      const changed = JSON.stringify(patched) !== JSON.stringify(prev)
      doc.entries[key] = changed ? { ...patched, updatedAt: now } : prev
    }
    const saved = await this.save(project, doc, doc.revision)
    const duplicates = verdicts.filter(v => v.verdict.startsWith('duplicate')).length
    return { added: fresh.length, duplicates, doc: saved }
  }

  /** 更新单条（PDF 落盘回填 / 撤稿标红 / 状态迁移）。 */
  async updateEntry(project: string, key: string, patch: (entry: LitEntry) => LitEntry): Promise<LibraryDoc> {
    const doc = await this.load(project)
    const current = doc.entries[key]
    if (current === undefined) throw new ServiceError('NOT_FOUND', `条目不存在：${key}`)
    doc.entries[key] = patch(current)
    return await this.save(project, doc, doc.revision)
  }

  /** P0-3 身份迁移：把旧键（`title:<sha1>:<year>` 等）重算为新键。
   * - dryRun 默认：只报告，不写盘；
   * - apply=true：先备份 `library.json.bak` 再原子写；
   * - 同题不同文（守卫失败）保留两条，第二条使用稳定判别键并计入 conflicts；
   * - 无变化时 apply 也不写盘（可重复执行）。 */
  async migrate(project: string, options: { apply?: boolean } = {}): Promise<LibraryMigrationReport> {
    if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
    const path = libraryPath(this.rootDir, project)
    await this.guard(path)
    const doc = await this.load(project)
    const entries = Object.values(doc.entries)
    const dryRun = options.apply !== true
    const before = entries.length
    if (before === 0) {
      return {
        schemaVersion: 1, project, dryRun, applied: false,
        entriesBefore: 0, entriesAfter: 0, renamed: 0, merged: 0, conflicts: 0,
        changes: [], changesTruncated: false,
      }
    }

    const groups = new Map<string, LitEntry[]>()
    for (const entry of entries) {
      const base = identityKey(entry.identity)
      const group = groups.get(base) ?? []
      group.push(entry)
      groups.set(base, group)
    }

    const finalEntries: Record<string, LitEntry> = {}
    const used = new Set<string>()
    const changes: LibraryMigrationChange[] = []
    let merged = 0
    let conflicts = 0
    let renamed = 0
    let changesTruncated = false
    const noteChange = (change: LibraryMigrationChange): void => {
      if (changes.length < MIGRATION_CHANGE_CAP) changes.push(change)
      else changesTruncated = true
    }

    for (const base of [...groups.keys()].sort()) {
      const group = (groups.get(base) ?? []).slice().sort((a, b) => {
        const byAdded = a.addedAt.localeCompare(b.addedAt)
        return byAdded !== 0 ? byAdded : a.key.localeCompare(b.key)
      })
      const clusters: LitEntry[][] = []
      if (base.startsWith('title:')) {
        for (const entry of group) {
          const cluster = clusters.find(items => sameWork(entry, items[0]!))
          if (cluster === undefined) clusters.push([entry])
          else cluster.push(entry)
        }
      } else {
        clusters.push(group)
      }
      if (clusters.length > 1) conflicts += clusters.length - 1

      for (const cluster of clusters) {
        const first = cluster[0]!
        const finalKey = base.startsWith('title:')
          ? disambiguatedTitleKey(first.identity, first.venue, used)
          : base
        used.add(finalKey)
        if (cluster.length === 1 && first.key === finalKey) {
          finalEntries[finalKey] = first
          continue
        }
        merged += cluster.length - 1
        for (const item of cluster) {
          if (item.key !== finalKey) renamed += 1
          noteChange({ from: item.key, to: finalKey, action: cluster.length > 1 ? 'merge' : 'rename' })
        }
        finalEntries[finalKey] = mergeEntries(cluster, finalKey)
      }
    }

    const changed = renamed > 0 || merged > 0
    if (!changed || dryRun) {
      return {
        schemaVersion: 1, project, dryRun, applied: false,
        entriesBefore: before, entriesAfter: Object.keys(finalEntries).length,
        renamed, merged, conflicts, changes, changesTruncated,
      }
    }

    const backupPath = join(this.rootDir, project, 'literature', 'library.json.bak')
    await this.guard(backupPath)
    const raw = await readFile(path, 'utf8')
    await mkdir(join(backupPath, '..'), { recursive: true })
    await writeFile(backupPath, raw, 'utf8')
    await this.save(project, { schemaVersion: LIBRARY_VERSION, revision: doc.revision, entries: finalEntries }, doc.revision)
    return {
      schemaVersion: 1, project, dryRun, applied: true,
      entriesBefore: before, entriesAfter: Object.keys(finalEntries).length,
      renamed, merged, conflicts, changes, changesTruncated, backup: backupPath,
    }
  }
}

const MIGRATION_CHANGE_CAP = 200

export interface LibraryMigrationChange {
  readonly from: string
  readonly to: string
  readonly action: 'rename' | 'merge'
}

export interface LibraryMigrationReport {
  readonly schemaVersion: 1
  readonly project: string
  readonly dryRun: boolean
  readonly applied: boolean
  readonly entriesBefore: number
  readonly entriesAfter: number
  /** 实际改了键的条目数（含被合并掉的旧条目）。 */
  readonly renamed: number
  /** 因同文合并而减少的条目数。 */
  readonly merged: number
  /** 同题但守卫失败、保留两条的冲突数。 */
  readonly conflicts: number
  readonly changes: readonly LibraryMigrationChange[]
  readonly changesTruncated: boolean
  readonly backup?: string
}

/** 合并同文条目：author/venue/abstract 择优，seenIn/作者取并集，撤稿优先，
 * addedAt 取最早、updatedAt 取最晚。 */
function mergeEntries(cluster: readonly LitEntry[], key: string): LitEntry {
  const sorted = [...cluster].sort((a, b) => {
    const byAdded = a.addedAt.localeCompare(b.addedAt)
    return byAdded !== 0 ? byAdded : a.key.localeCompare(b.key)
  })
  const first = sorted[0]!
  let identity: LitIdentity = { ...first.identity }
  if (identity.year === 0) {
    const year = Math.max(0, ...sorted.map(item => item.identity.year))
    if (year > 0) identity = { ...identity, year }
  }
  if (identity.canonicalDoi === undefined) {
    const canonicalDoi = sorted.map(item => item.identity.canonicalDoi).find(value => value !== undefined)
    if (canonicalDoi !== undefined) identity = { ...identity, canonicalDoi }
  }
  const authors: string[] = []
  for (const item of sorted) {
    for (const author of item.authors) {
      if (!authors.includes(author)) authors.push(author)
    }
  }
  const seenIn = [...new Set(sorted.flatMap(item => item.seenIn))]
  const retracted = sorted.some(item => item.retracted === true) || sorted.some(item => item.status === 'retracted')
    ? true
    : sorted.some(item => item.retracted === false) ? false : undefined
  const status: LitStatus = retracted === true
    ? 'retracted'
    : sorted.some(item => item.status === 'has-pdf')
      ? 'has-pdf'
      : first.status
  const pdf = sorted.find(item => item.pdf !== undefined)?.pdf
  const openalexId = sorted.map(item => item.openalexId).find(value => value !== undefined)
  const citedByCount = sorted.map(item => item.citedByCount).filter((value): value is number => value !== undefined)
  const verification = sorted.map(item => item.verification).find(value => value?.status === 'verified')
    ?? sorted.map(item => item.verification).find(value => value !== undefined)
  const venue = sorted.map(item => item.venue).find(value => value !== '') ?? first.venue
  const abstract = sorted.map(item => item.abstract).sort((a, b) => b.length - a.length)[0] ?? first.abstract
  const pdfUrl = sorted.map(item => item.pdfUrl).find(value => value !== undefined)
  const oaUrl = sorted.map(item => item.oaUrl).find(value => value !== undefined)
  const notice = sorted.some(item => item.notice === 'corrigendum') ? 'corrigendum' as const : first.notice
  const updatedAt = sorted.map(item => item.updatedAt).sort().at(-1) ?? first.updatedAt
  return {
    key,
    identity,
    source: first.source,
    seenIn,
    authors,
    venue,
    abstract,
    status,
    addedAt: first.addedAt,
    updatedAt,
    ...(pdf === undefined ? {} : { pdf }),
    ...(pdfUrl === undefined ? {} : { pdfUrl }),
    ...(oaUrl === undefined ? {} : { oaUrl }),
    ...(citedByCount.length === 0 ? {} : { citedByCount: Math.max(...citedByCount) }),
    ...(openalexId === undefined ? {} : { openalexId }),
    ...(retracted === undefined ? {} : { retracted }),
    ...(notice === undefined ? {} : { notice }),
    ...(verification === undefined ? {} : { verification }),
  }
}

/** 探测文件是否存在（视图层显示用）。 */
export async function libraryExists(rootDir: string, project: string): Promise<boolean> {
  try {
    await stat(libraryPath(rootDir, project))
    return true
  } catch {
    return false
  }
}
