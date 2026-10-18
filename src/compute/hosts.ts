/** hosts.json 只读解析（§4.4/B4 + 真机 P12）：home 候选 env(QILIN_HOME/DSH_HOME)
 * → ~/.kcoder → ~/.kcoder-dev → ~/.dsh；文件 = <home>/ssh-remote/hosts.json。
 * 纪律：只读、永不写回（宿主插件 reload 也只读）；不复制内容进项目目录；
 * auth:'key' 才可 ③ 直连，'password' 只能等 ① ControlMaster socket；
 * 对外视图只有 hostRef=sha256(hostId)[:8]+label，绝不落 id/host/user/port。 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ServiceError } from '../service.ts'
import { hostRefOf } from './types.ts'

/** hosts.json 单条目（hosts.js 字段面的本地最小子集，不 import 第三方内部模块）。 */
export interface HostEntry {
  readonly id: string
  readonly host: string
  readonly user: string
  readonly port?: number
  readonly identityFile?: string
  readonly auth: 'key' | 'password'
  readonly label?: string
}

/** 单 home 解析结果（home 只在内存，用于拼 cm socket 路径）。 */
export interface HomeHosts {
  readonly home: string
  readonly entries: readonly HostEntry[]
}

/** home 候选（env 优先，其后固定三候选；去重保序）。 */
export function homeCandidates(env: Record<string, string | undefined>): string[] {
  const home = homedir()
  const candidates: string[] = []
  for (const key of ['QILIN_HOME', 'DSH_HOME'] as const) {
    const value = env[key]
    if (typeof value === 'string' && value !== '') candidates.push(value)
  }
  candidates.push(join(home, '.kcoder'), join(home, '.kcoder-dev'), join(home, '.dsh'))
  return [...new Set(candidates)]
}

/** 解析 hosts.json 文本：容忍 {hosts:[…]} 与裸数组两种形态；非法条目静默过滤
 * （缺 id/host/user 的坏行不炸盘点）。auth 推导：显式 auth 优先；否则有
 * identityFile 即 'key'，否则 'password'。 */
export function parseHostsFile(text: string): HostEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    return []
  }
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>)['hosts'])
      ? (raw as Record<string, unknown>)['hosts'] as unknown[]
      : []
  const entries: HostEntry[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const id = row['id']
    const host = row['host']
    const user = row['user']
    if (typeof id !== 'string' || id === '' || typeof host !== 'string' || host === ''
      || typeof user !== 'string' || user === '') continue
    const port = typeof row['port'] === 'number' && Number.isSafeInteger(row['port']) && row['port'] > 0 ? row['port'] : undefined
    const identityFile = typeof row['identityFile'] === 'string' && row['identityFile'] !== '' ? row['identityFile'] : undefined
    const declared = row['auth']
    const auth: 'key' | 'password' = declared === 'key' || (declared !== 'password' && identityFile !== undefined) ? 'key' : 'password'
    const label = typeof row['label'] === 'string' && row['label'] !== '' ? row['label'] : undefined
    entries.push({ id, host, user, ...(port !== undefined ? { port } : {}), ...(identityFile !== undefined ? { identityFile } : {}), auth, ...(label !== undefined ? { label } : {}) })
  }
  return entries
}

/** 读单个 home 的 hosts.json：缺文件/坏 JSON → []（盘点不炸）。 */
export async function readHostsFromHome(home: string): Promise<HostEntry[]> {
  const file = join(home, 'ssh-remote', 'hosts.json')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return []
  }
  return parseHostsFile(text)
}

/** 全候选盘点：跨 home 按 hostRef 去重（先到先得，P12 双 home 场景取有活 socket 侧的
 * 优先级由候选顺序决定）；返回带 home 上下文的条目（home 不出本模块）。 */
export async function discoverHosts(env: Record<string, string | undefined>): Promise<HomeHosts[]> {
  const result: HomeHosts[] = []
  const seen = new Set<string>()
  for (const home of homeCandidates(env)) {
    const entries: HostEntry[] = []
    for (const entry of await readHostsFromHome(home)) {
      const ref = hostRefOf(entry.id)
      if (seen.has(ref)) continue
      seen.add(ref)
      entries.push(entry)
    }
    if (entries.length > 0) result.push({ home, entries })
  }
  return result
}

export interface ResolvedHost {
  readonly entry: HostEntry
  readonly home: string
  readonly ref: string
  /** 对外 label：显式 label 或 'host-<ref 后 6 位>'；绝不用 id（P1 实测 id 含 IP）。 */
  readonly label: string
}

export function resolveHostRef(homes: readonly HomeHosts[], ref: string): ResolvedHost | undefined {
  for (const { home, entries } of homes) {
    for (const entry of entries) {
      const entryRef = hostRefOf(entry.id)
      if (entryRef === ref) {
        return { entry, home, ref: entryRef, label: entry.label ?? 'host-' + entryRef.slice(2, 8) }
      }
    }
  }
  return undefined
}

/** ① ControlMaster socket 路径（存在即复用——真机 P9 实测零凭据可用）。 */
export function cmSockFor(home: string, entry: HostEntry): string {
  return join(home, 'ssh-remote', 'cm', entry.id + '.sock')
}

/** 通道判定：有活 socket → 'cm'；否则 auth:'key' 且私钥在 → 'direct'；
 * password 且无 socket → 不可用（NO_PROVIDER，绝不尝试密码回退/读凭据）。 */
export function pickTransport(resolved: ResolvedHost): { transport: 'cm' | 'direct'; cmSock?: string } {
  const sock = cmSockFor(resolved.home, resolved.entry)
  if (existsSync(sock)) return { transport: 'cm', cmSock: sock }
  if (resolved.entry.auth === 'key' && resolved.entry.identityFile !== undefined && existsSync(resolved.entry.identityFile)) {
    return { transport: 'direct' }
  }
  throw new ServiceError(
    'NO_PROVIDER',
    '主机 ' + resolved.label + '（' + resolved.ref + '）不可达通道：password 认证且无 ControlMaster socket（只能等宿主 ① 级连接），或 key 认证缺 identityFile',
  )
}
