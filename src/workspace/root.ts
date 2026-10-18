/** 科研总根配置（`.srw/root.json`，B 路线）：settings.register 后置到 V15
 * （宿主 schemastery 运行时不可达，见 0202 Task 1.1 决策），用户级根内设置
 * 以文件为真相源。读失败一律回落默认值（缺文件与坏文件同权），写走
 * tmp→rename 原子替换（与 writeBinary 同纪律）。
 *
 * P0-4/P0-5 追加（全部可选，缺省空；无迁移纪律）：
 * - openalexMailto?    OpenAlex 礼貌池邮箱；
 * - unpaywallEmail?    Unpaywall 必填真实邮箱（缺 → fulltext 报 INVALID 提示配置）；
 * - fulltext.confirmedHosts[]  用户确认过的出版商/仓储 PDF 域（白名单只可加）。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FulltextConfig {
  /** 用户显式确认过的全文 PDF 主机（小写、无端口）。 */
  readonly confirmedHosts?: readonly string[]
}

export interface RootConfig {
  readonly schemaVersion: 1
  readonly defaultLangPair: 'en-zh' | 'zh-en'
  readonly allowIllustrative: boolean
  readonly offlineMode: boolean
  /** Crossref 礼貌池邮箱（可选，加字段不加版本——0102 §6.3 无迁移纪律）。 */
  readonly politeMailto?: string
  /** OpenAlex 礼貌池邮箱（可选；P0-5 起可配）。 */
  readonly openalexMailto?: string
  /** Unpaywall 必填邮箱（可选；P0-4 全文获取用）。 */
  readonly unpaywallEmail?: string
  /** 全文获取域确认（可选；缺省无额外主机）。 */
  readonly fulltext?: FulltextConfig
}

export const DEFAULT_ROOT: RootConfig = {
  schemaVersion: 1,
  defaultLangPair: 'en-zh',
  allowIllustrative: false,
  offlineMode: false,
}

export function rootConfigPath(rootAbs: string): string {
  return join(rootAbs, '.srw', 'root.json')
}

function readMail(value: unknown): string | undefined {
  return typeof value === 'string' && value.includes('@') ? value : undefined
}

function normalizeHost(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '' || trimmed.length > 253) return undefined
  // 主机名（不含 scheme/端口/路径）；IPv4 允许（仅测试/自建仓储场景，
  // 真正能否连接受 SSRF 公网校验约束）。
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(trimmed)) return undefined
  return trimmed
}

/** 读根配置；缺文件/坏文件/字段非法逐项钳回默认（无迁移：version 恒 1）。 */
export async function readRootConfig(rootAbs: string): Promise<RootConfig> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(rootConfigPath(rootAbs), 'utf8'))
  } catch {
    return DEFAULT_ROOT
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_ROOT
  const m = raw as Record<string, unknown>
  const politeMailto = readMail(m['politeMailto'])
  const openalexMailto = readMail(m['openalexMailto'])
  const unpaywallEmail = readMail(m['unpaywallEmail'])
  const fulltextRaw = (typeof m['fulltext'] === 'object' && m['fulltext'] !== null)
    ? m['fulltext'] as Record<string, unknown>
    : undefined
  const confirmedHosts = Array.isArray(fulltextRaw?.['confirmedHosts'])
    ? [...new Set((fulltextRaw['confirmedHosts'] as unknown[])
        .filter((item): item is string => typeof item === 'string')
        .map(item => normalizeHost(item))
        .filter((item): item is string => item !== undefined))]
    : []
  const fulltext: FulltextConfig | undefined = confirmedHosts.length > 0 ? { confirmedHosts } : undefined
  return {
    schemaVersion: 1,
    defaultLangPair: m['defaultLangPair'] === 'zh-en' ? 'zh-en' : 'en-zh',
    allowIllustrative: m['allowIllustrative'] === true,
    offlineMode: m['offlineMode'] === true,
    ...(politeMailto === undefined ? {} : { politeMailto }),
    ...(openalexMailto === undefined ? {} : { openalexMailto }),
    ...(unpaywallEmail === undefined ? {} : { unpaywallEmail }),
    ...(fulltext === undefined ? {} : { fulltext }),
  }
}

/** 合并写入根配置（补 `.srw` 目录），返回合并后的完整配置。 */
export async function writeRootConfig(rootAbs: string, patch: Partial<Omit<RootConfig, 'schemaVersion'>>): Promise<RootConfig> {
  const merged: RootConfig = { ...(await readRootConfig(rootAbs)), ...patch, schemaVersion: 1 }
  const dir = join(rootAbs, '.srw')
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `root.json.srw-tmp-${process.pid}-${Date.now().toString(36)}`)
  try {
    await writeFile(tmp, JSON.stringify(merged, null, 2) + '\n')
    await rename(tmp, rootConfigPath(rootAbs))
  } catch (error: unknown) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  return merged
}

/** P0-4 域确认写回：把用户显式允许的主机并入 fulltext.confirmedHosts。
 * 非法主机名抛 INVALID（用 Error 而非 ServiceError 避免 root↔service 循环）。 */
export async function addConfirmedHost(rootAbs: string, host: string): Promise<readonly string[]> {
  const normalized = normalizeHost(host)
  if (normalized === undefined) throw new Error(`主机名非法：${JSON.stringify(host)}`)
  const config = await readRootConfig(rootAbs)
  const current = config.fulltext?.confirmedHosts ?? []
  if (current.includes(normalized)) return current
  const next = [...current, normalized].sort()
  await writeRootConfig(rootAbs, { fulltext: { ...config.fulltext, confirmedHosts: next } })
  return next
}
