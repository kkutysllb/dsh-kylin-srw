/** 订阅存储（0204 §2）：`<root>/.srw/watch.json` 是订阅本体的唯一真相源。
 * 原子落盘（tmp→rename）+ revision STALE 拒写 + assertInsideRoot 护栏——
 * 与 library.json 同款纪律；坏 JSON 抛 INVALID 不静默清空用户数据。
 * 时钟任务本体在宿主 schedule 存储，这里只存绑定 id。 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { emptyWatchDoc, WATCH_SCHEMA_VERSION, watchDocPath, type WatchDoc, type WatchSub } from './model.ts'

export class WatchStore {
  constructor(
    private readonly rootDir: string,
    private readonly fs: SrwFsLike | undefined,
  ) {}

  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.fs, this.rootDir, absPath)
  }

  /** 读订阅表；缺文件返回空表。坏 JSON 抛 INVALID。 */
  async load(): Promise<WatchDoc> {
    const path = watchDocPath(this.rootDir)
    await this.guard(path)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return emptyWatchDoc()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ServiceError('INVALID', `watch.json 不是合法 JSON：${path}`)
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ServiceError('INVALID', `watch.json 形状损坏：${path}`)
    }
    const doc = parsed as Partial<WatchDoc>
    if (doc.schemaVersion !== WATCH_SCHEMA_VERSION || typeof doc.revision !== 'number' || !Array.isArray(doc.subs)) {
      throw new ServiceError('INVALID', `watch.json 版本/字段损坏：${path}`)
    }
    return { schemaVersion: WATCH_SCHEMA_VERSION, revision: doc.revision, subs: doc.subs }
  }

  /** 保存（乐观并发，同 library 口径）；原子落盘。 */
  async save(doc: WatchDoc, expectedRevision: number): Promise<WatchDoc> {
    const path = watchDocPath(this.rootDir)
    await this.guard(path)
    try {
      const disk = JSON.parse(await readFile(path, 'utf8')) as Partial<WatchDoc>
      const diskRevision = typeof disk.revision === 'number' ? disk.revision : -1
      if (expectedRevision !== diskRevision) {
        throw new ServiceError('STALE', `watch.json 已被他人修改（磁盘 revision=${diskRevision}，期望=${expectedRevision}）；请重读后重试`)
      }
    } catch (error: unknown) {
      if (error instanceof ServiceError) throw error
      const code = (error as { code?: string }).code
      if (code !== 'ENOENT') throw error
      if (expectedRevision > 0) {
        throw new ServiceError('STALE', 'watch.json 已被删除而内存持有旧副本（expectedRevision>0）')
      }
    }
    const next: WatchDoc = { ...doc, revision: doc.revision + 1, schemaVersion: WATCH_SCHEMA_VERSION }
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
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

  /** 原子更新单条订阅（load→patch→save 一次持有，调用方给纯 patch 函数）。 */
  async update(patch: (subs: readonly WatchSub[]) => readonly WatchSub[]): Promise<WatchDoc> {
    const doc = await this.load()
    const nextSubs = [...patch(doc.subs)]
    return await this.save({ ...doc, subs: nextSubs }, doc.revision)
  }

  async upsertSub(sub: WatchSub): Promise<WatchDoc> {
    return await this.update(subs => [...subs.filter(item => item.id !== sub.id), sub])
  }

  async removeSub(id: string): Promise<WatchDoc> {
    return await this.update(subs => subs.filter(item => item.id !== id))
  }
}
