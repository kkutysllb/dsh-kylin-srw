/** 跨进程文件锁（RateGate 账本用）：`O_CREAT|O_EXCL` 独占创建 + 轮询，
 * 陈旧锁（mtime 超龄）强破。不引第三方依赖；只保证「同一台机器同一文件系统」
 * 的互斥——账本场景（域级限速时间戳）恰好只需要这个粒度。
 *
 * 用法：`await withFileLock(path, async () => { …读改写… })`——锁的获取与
 * 释放都在本进程内成对；回调抛错也释放（finally）。
 */

import { open, stat, unlink, writeFile } from 'node:fs/promises'

/** 陈旧锁阈值：持有超过该时长的锁视为遗骸（持有者崩溃/断电），强破。 */
const STALE_MS = 30_000
/** 轮询间隔与总预算：预算内拿不到锁抛错（账本操作应当毫秒级）。 */
const POLL_MS = 25
const BUDGET_MS = 5_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** 独占创建锁文件；成功返回 true，已存在返回 false。 */
async function tryAcquire(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx')
    await handle.writeFile(String(process.pid))
    await handle.close()
    return true
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'EEXIST') return false
    throw error
  }
}

/** 强破陈旧锁：mtime 超龄才 unlink（竞态下误删他人新锁的概率窗口由
 * 「unlink 后 tryAcquire 失败即重试」兜底）。 */
async function breakIfStale(path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (Date.now() - info.mtimeMs > STALE_MS) {
      await unlink(path).catch(() => {})
    }
  } catch { /* 锁已消失 */ }
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T> | T): Promise<T> {
  const deadline = Date.now() + BUDGET_MS
  for (;;) {
    if (await tryAcquire(lockPath)) break
    await breakIfStale(lockPath)
    if (Date.now() > deadline) {
      throw new Error(`file-lock: 获取锁超时：${lockPath}`)
    }
    await sleep(POLL_MS)
  }
  try {
    return await fn()
  } finally {
    await unlink(lockPath).catch(() => {})
  }
}

/** 测试与降速注入用：把账本目录下的锁文件路径规约出来。 */
export function lockPathFor(targetPath: string): string {
  return `${targetPath}.lock`
}

/** 原子写兜底（账本以外的调用方不常用；与 writeRootConfig 同纪律）。 */
export async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(tmp, data)
  const { rename } = await import('node:fs/promises')
  await rename(tmp, path)
}
