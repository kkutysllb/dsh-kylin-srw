/** 科研总根配置（`.srw/root.json`，B 路线）：settings.register 后置到 V15
 * （宿主 schemastery 运行时不可达，见 0202 Task 1.1 决策），用户级根内设置
 * 以文件为真相源。读失败一律回落默认值（缺文件与坏文件同权），写走
 * tmp→rename 原子替换（与 writeBinary 同纪律）。 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface RootConfig {
  readonly schemaVersion: 1
  readonly defaultLangPair: 'en-zh' | 'zh-en'
  readonly allowIllustrative: boolean
  readonly offlineMode: boolean
  /** Crossref 礼貌池邮箱（可选，加字段不加版本——0102 §6.3 无迁移纪律）。 */
  readonly politeMailto?: string
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
  return {
    schemaVersion: 1,
    defaultLangPair: m['defaultLangPair'] === 'zh-en' ? 'zh-en' : 'en-zh',
    allowIllustrative: m['allowIllustrative'] === true,
    offlineMode: m['offlineMode'] === true,
    ...(typeof m['politeMailto'] === 'string' && m['politeMailto'].includes('@')
      ? { politeMailto: m['politeMailto'] }
      : {}),
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
