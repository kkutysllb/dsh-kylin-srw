/** 日志偏移续读（§3 子能力 9 + §4.5 断线续读）：tail -c +N 增量拉取 +
 * 本地镜像对账（mirrorSha256 + 远端尺寸回退检测）+ 总量上限显式失败
 * （LOG_CAP_EXCEEDED，绝不静默截断）。本地镜像落盘前过 redact()（§4.4：
 * 落盘只允许脱敏内容），offset.json 记录远端字节偏移。 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ServiceError } from '../service.ts'
import type { ComputeProvider, HostTarget } from './provider.ts'
import { redact, sha256Hex } from './types.ts'

export interface LogOffsetFile {
  stdoutBytes: number
  lastReadAt: string | null
  /** 本地镜像（脱敏后全文）的 sha256——下次读取先对账，被手改即整段重读。 */
  mirrorSha256: string | null
}

/** 宽松解析 offset.json（缺文件/坏 JSON → 归零重读，绝不带着坏偏移续读）。 */
export function parseOffsetFile(raw: unknown): LogOffsetFile {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bytes = row['stdoutBytes']
  return {
    stdoutBytes: typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0,
    lastReadAt: typeof row['lastReadAt'] === 'string' ? row['lastReadAt'] : null,
    mirrorSha256: typeof row['mirrorSha256'] === 'string' ? row['mirrorSha256'] : null,
  }
}

export interface PullRunLogInput {
  readonly provider: ComputeProvider
  readonly host: HostTarget
  readonly runDirAbs: string
  readonly localLogPath: string
  readonly localOffsetPath: string
  readonly prev: LogOffsetFile
  readonly maxLogBytes: number
  readonly now: string
  readonly chunkCap?: number
}

export interface PullRunLogOutcome {
  readonly appendedBytes: number
  readonly totalRemoteBytes: number
  readonly offset: LogOffsetFile
  /** true = 镜像对账失败/远端回退，已归零整段重读。 */
  readonly reconciled: boolean
  readonly tailText: string
}

const DEFAULT_CHUNK_CAP = 4 * 1024 * 1024
const TAIL_TEXT_CAP = 4000

async function readLocalMirror(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

export async function pullRunLog(input: PullRunLogInput): Promise<PullRunLogOutcome> {
  const logAbs = input.runDirAbs + '/run.log'
  const chunkCap = input.chunkCap ?? DEFAULT_CHUNK_CAP
  // ① 远端尺寸（文件未生成 = 0）
  let size = 0
  try {
    const stat = await input.provider.exec(input.host, ['stat', '-c', '%s', logAbs], { maxBytes: 1024, timeoutMs: 20_000 })
    if (stat.code === 0) size = Number.parseInt(new TextDecoder().decode(stat.stdout).trim(), 10) || 0
  } catch { /* 传输失败按 0 处理，下次再对账 */ }
  // ② 总量上限：显式失败，不静默截断（§8.1）
  if (size > input.maxLogBytes) {
    throw new ServiceError('GATE', 'LOG_CAP_EXCEEDED：远端日志 ' + String(size) + ' 字节超过上限 ' + String(input.maxLogBytes) + '——作业按 failed 处理，绝不静默截断')
  }
  // ③ 本地镜像对账：远端回退（轮转/清空）或镜像被手改 → 归零整段重读
  let from = input.prev.stdoutBytes
  let reconciled = false
  const mirror = await readLocalMirror(input.localLogPath)
  const mirrorIntact = input.prev.mirrorSha256 === null || sha256Hex(mirror) === input.prev.mirrorSha256
  if (size < from || !mirrorIntact) {
    from = 0
    reconciled = true
  }
  // ④ 增量 tail -c +N（1-based）
  let appendedBytes = 0
  let appendedText = ''
  if (size > from) {
    const tail = await input.provider.tailBytes(input.host, logAbs, from, chunkCap)
    const text = new TextDecoder().decode(tail.bytes)
    appendedBytes = tail.bytes.byteLength
    appendedText = redact(text)
  }
  // ⑤ 镜像落盘（先 redact 再写——§4.4）+ offset.json
  const merged = reconciled ? appendedText : mirror + appendedText
  const offset: LogOffsetFile = {
    stdoutBytes: reconciled ? appendedBytes : from + appendedBytes,
    lastReadAt: input.now,
    mirrorSha256: sha256Hex(merged),
  }
  if (appendedText !== '' || reconciled) {
    await mkdir(dirname(input.localLogPath), { recursive: true })
    if (reconciled) await writeFile(input.localLogPath, merged, 'utf8')
    else if (appendedText !== '') await appendFile(input.localLogPath, appendedText, 'utf8')
    await mkdir(dirname(input.localOffsetPath), { recursive: true })
    await writeFile(input.localOffsetPath, JSON.stringify(offset, null, 2) + '\n', 'utf8')
  }
  return {
    appendedBytes,
    totalRemoteBytes: size,
    offset,
    reconciled,
    tailText: appendedText.length > TAIL_TEXT_CAP ? appendedText.slice(-TAIL_TEXT_CAP) : appendedText,
  }
}
