/** 文献库存储（0203 Task 2.6）：`<root>/<project>/literature/library.json`
 * 是**唯一真相源**（0102 §6.2）。revision 比对 + STALE 拒写（0102 §6.3
 * 冲突策略）；原子落盘（tmp→rename）。路径全部过 assertInsideRoot 护栏。
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { identityKey } from './identity.ts'
import type { LitCandidate } from './types.ts'

const LIBRARY_VERSION = 1

/** 条目状态：`unread` 新入库 / `has-pdf` 已取原文 / `retracted` 撤稿 / `archived` 归档。 */
export type LitStatus = 'unread' | 'has-pdf' | 'retracted' | 'archived'

/** library.json 里的一条（合并后的最终形状）。 */
export interface LitEntry {
  /** citekey 或 identityKey（key 冲突时 citekey 带后缀；本存储层直接用 identityKey） */
  readonly key: string
  readonly identity: LitCandidate['identity']
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
  readonly pdf?: { readonly file: string; readonly sha256: string; readonly bytes: number }
  readonly citedByCount?: number
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

  /** 入库：批内去重（mergeInto）+ 与库内去重 → 返回 {added, duplicates}。 */
  async upsert(project: string, candidates: readonly LitCandidate[]): Promise<{ added: number; duplicates: number; doc: LibraryDoc }> {
    const doc = await this.load(project)
    const existing = Object.values(doc.entries)
    const { mergeInto } = await import('./identity.ts')
    const { fresh, verdicts } = mergeInto(candidates, existing)
    const now = new Date().toISOString()
    for (const item of fresh) {
      const key = identityKey(item.identity)
      const prev = doc.entries[key]
      doc.entries[key] = {
        key,
        identity: item.identity,
        source: item.source,
        seenIn: [...item.seenIn],
        authors: [...item.authors],
        venue: item.venue,
        abstract: item.abstract,
        status: prev?.status ?? 'unread',
        addedAt: prev?.addedAt ?? now,
        updatedAt: now,
        ...(item.pdfUrl !== undefined ? { pdfUrl: item.pdfUrl } : {}),
        ...(item.oaUrl !== undefined ? { oaUrl: item.oaUrl } : {}),
        ...(item.citedByCount !== undefined ? { citedByCount: item.citedByCount } : {}),
        ...(prev?.pdf !== undefined ? { pdf: prev.pdf } : {}),
      }
    }
    // 已存在条目做信息补全：重复≠丢弃——新候选可能带来库缺的字段
    // （首次入库时 arXiv 尚无 PDF 链接、后来 OA 版本出现等）。
    for (const candidate of candidates) {
      const key = identityKey(candidate.identity)
      const prev = doc.entries[key]
      if (prev === undefined) continue
      const patched: LitEntry = {
        ...prev,
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
