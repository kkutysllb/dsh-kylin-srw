/** 宿主差异单点适配（ADR-20）：home 解析、二进制落盘、路径 containment。
 *
 * 双通道已核实的事实（0102 §5.3 / §12）：
 * - home 不同：`~/.qilin` vs `~/.dsh`（env 可覆盖）。
 * - DSH 侧 `ctx.fs` 缺 `writeBytes`/`createDirectory`/`remove`/`move` →
 *   二进制统一走「能力可用则用 ctx.fs，否则 node:fs + tmp→rename 原子替换」。
 * - `resolveWorkspacePath` 是纯拼接、不是护栏；真正的护栏是
 *   `ctx.fs.contains`（canonical containment）。本模块的所有安全检查
 *   fail-closed：能力缺失就拒绝，绝不静默放行。
 */

import { rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** 宿主 fs 的最小结构面（运行时由注入的 `fs` 服务提供；M0 只用到这三件）。 */
export interface SrwFsLike {
  resolve?(rel: string, opts?: { readonly cwd?: string }): unknown
  contains?(parent: string, child: string): unknown
  writeBytes?(path: string, data: Uint8Array): unknown
}

/** 宿主 home 口径：QILIN_HOME → DSH_HOME → ~/.qilin 兜底。 */
export function hostHome(env: Record<string, string | undefined> = process.env): {
  channel: 'qilin' | 'dsh' | 'unknown'
  home: string
} {
  const home = homedir()
  if (env['QILIN_HOME'] !== undefined) return { channel: 'qilin', home: env['QILIN_HOME'] }
  if (env['DSH_HOME'] !== undefined) return { channel: 'dsh', home: env['DSH_HOME'] }
  return { channel: 'unknown', home: join(home, '.qilin') }
}

async function awaited<T>(value: T | Promise<T>): Promise<T> {
  return await value
}

/** 二进制落盘：ctx.fs.writeBytes 可用则用；否则 node:fs 写临时文件后
 * 原子 rename（同目录保证同文件系统，rename 原子性成立）。 */
export async function writeBinary(
  fs: SrwFsLike | undefined,
  absPath: string,
  bytes: Uint8Array,
): Promise<{ via: 'ctx.fs' | 'node:fs' }> {
  if (fs?.writeBytes !== undefined) {
    await awaited(fs.writeBytes(absPath, bytes))
    return { via: 'ctx.fs' }
  }
  const target = resolve(absPath)
  const tmp = `${target}.srw-tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, target)
  } catch (error: unknown) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  return { via: 'node:fs' }
}

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathSafetyError'
  }
}

/** 路径护栏（ADR-15）：resolve 目标 → `ctx.fs.contains(root, target)`
 * canonical containment 校验。fail-closed：
 * - `contains` 能力缺失 → 抛错（不允许「无护栏也放行」）；
 * - 目标逃出 root（`../`、符号链接落地在外、绝对路径注入）→ 抛错。
 */
export async function assertInsideRoot(
  fs: SrwFsLike | undefined,
  rootAbs: string,
  targetRel: string,
): Promise<string> {
  if (fs?.contains === undefined) {
    throw new PathSafetyError('路径护栏不可用：宿主 fs.contains 缺席（fail-closed）')
  }
  const root = resolve(rootAbs)
  let target: string
  if (fs.resolve !== undefined) {
    target = await awaited(fs.resolve(targetRel, { cwd: root })) as string
  } else if (isAbsolute(targetRel)) {
    target = resolve(targetRel)
  } else {
    target = resolve(join(root, targetRel))
  }
  const contained = await awaited(fs.contains(root, target))
  if (contained !== true) {
    throw new PathSafetyError(`路径越界：${JSON.stringify(targetRel)} 不在科研总根内`)
  }
  return target
}
