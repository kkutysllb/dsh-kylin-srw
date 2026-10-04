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
import { resolve } from 'node:path'

/** 宿主 fs 的最小结构面（运行时由注入的 `fs` 服务提供）。
 * 语义对照 QiLin FileSystem 源码（Task 1.0 定稿）：`resolve` 产出稳定目标
 * 对象（可能做 I/O），`contains` 收两个目标、同步返回 boolean——护栏必须
 * resolve→contains 两步，不能拿字符串路径自判；`processPath` 把目标换回
 * 宿主执行世界可打开的绝对路径。 */
export interface SrwFsLike {
  resolve?(rel: string, opts?: { readonly cwd?: string }): unknown
  contains?(parent: unknown, child: unknown): unknown
  processPath?(target: unknown): string
  writeBytes?(path: string, data: Uint8Array): unknown
}

/** 宿主 home 口径（仅诊断显示用；数据目录一律经 storageDomain，不经此函数）。
 *
 * 已知限制（E2 实测，2026-10-04）：麒麟启动器恒把 `DSH_HOME` pin 到 QiLin home
 * （app-boot/src/index.ts:263 的 dsh-compat 层）且不设 `QILIN_HOME` →
 * env 判定结构性不可靠：麒麟进程会被判成 'dsh'，DSH 桌面端（两个 env 都不设）
 * 落 'unknown'。收敛前不猜：unknown 时 home 返回空串，M1 换正向信号
 * （候选：loader 服务身份 / argv 指纹）后此注释作废。
 */
export function hostHome(env: Record<string, string | undefined> = process.env): {
  channel: 'qilin' | 'dsh' | 'unknown'
  home: string
} {
  if (env['QILIN_HOME'] !== undefined) return { channel: 'qilin', home: env['QILIN_HOME'] }
  if (env['DSH_HOME'] !== undefined) return { channel: 'dsh', home: env['DSH_HOME'] }
  return { channel: 'unknown', home: '' }
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

/** 路径护栏（ADR-15）：resolve root 与目标 → `ctx.fs.contains(rootTarget,
 * targetTarget)` canonical containment 校验（目标对象语义，Task 1.0 对照
 * 源码定稿；字符串自判是 resolveWorkspacePath 式的假护栏）。fail-closed：
 * - `resolve`/`contains` 能力缺失 → 抛错（不允许「无护栏也放行」）；
 * - 目标逃出 root（`../`、符号链接落地在外、绝对路径注入）→ 抛错。
 * @returns 宿主执行世界可打开的绝对路径（`processPath`，缺失时退化为
 * node 语义的 resolve 拼接——仅作显示/落点参考，安全判定已由 contains 给出）。
 */
export async function assertInsideRoot(
  fs: SrwFsLike | undefined,
  rootAbs: string,
  targetRel: string,
): Promise<string> {
  if (fs?.resolve === undefined || fs.contains === undefined) {
    throw new PathSafetyError('路径护栏不可用：宿主 fs.resolve/contains 缺席（fail-closed）')
  }
  const rootTarget = await awaited(fs.resolve(rootAbs))
  const target = await awaited(fs.resolve(targetRel, { cwd: rootAbs }))
  if (fs.contains(rootTarget, target) !== true) {
    throw new PathSafetyError(`路径越界：${JSON.stringify(targetRel)} 不在科研总根内`)
  }
  if (fs.processPath !== undefined) return fs.processPath(target)
  return resolve(rootAbs, targetRel)
}
