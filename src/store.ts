/** storage 域 `srw_index` v1（0102 §6.3 / 0202 Task 1.4）：SRW 的持久索引。
 *
 * - spec 本体是纯数据 + zod schema（宿主 DomainFacility 只鸭子调 `.parse`，
 *   与宿主 zod ^4.4 同代同源，跨实例无兼容问题）。
 * - version 恒 1（storage 域无迁移机制）：只加可选字段 + `.default()`。
 * - `global`：`{rootDir, activeProject}` —— root.set / project.open 的
 *   持久落点（root.json 是根内配置，这里是「哪个根」的权威记忆）。
 * - `projectCache` 表：项目列表投影缓存（list 实扫的加速面，可丢弃——
 *   真相源始终是目录里的 project.json）。
 * - spec 的早期校验（name/table 合法、version 非负整数、global 不收 null）
 *   本地复刻宿主 defineDomain 的检查——模块加载即 fail loud，不等宿主。
 */

import { z } from 'zod'

/** 域/表名共用宿主 UNIT_NAME_RE（storage/src/backend.ts:10）。 */
const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

export interface SrwIndexGlobal {
  rootDir: string
  activeProject: string
}

export const ProjectCacheEntry = z.object({
  slug: z.string(),
  title: z.string(),
  stage: z.string(),
  updatedAt: z.string(),
})

export type ProjectCacheEntry = z.output<typeof ProjectCacheEntry>

export const SrwIndexGlobalSchema = z.object({
  rootDir: z.string().default(''),
  activeProject: z.string().default(''),
})

export const SrwIndexSpec = {
  name: 'srw_index',
  version: 1,
  layout: 'single' as const,
  global: {
    schema: SrwIndexGlobalSchema,
    initial: { rootDir: '', activeProject: '' },
  },
  tables: {
    // 表名受宿主 UNIT_NAME_RE 约束（^[a-z][a-z0-9_]*$）：不得驼峰。
    project_cache: { valueSchema: ProjectCacheEntry },
  },
} as const

/** 宿主 defineDomain 的早期校验复刻（模块加载即执行）。 */
export function assertValidDomainSpec(spec: typeof SrwIndexSpec): void {
  if (!UNIT_NAME_RE.test(spec.name)) {
    throw new Error(`domain name '${spec.name}' must match ${UNIT_NAME_RE.source}`)
  }
  if (!Number.isInteger(spec.version) || spec.version < 0) {
    throw new Error(`domain '${spec.name}' version must be a non-negative integer`)
  }
  for (const table of Object.keys(spec.tables)) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new Error(`domain '${spec.name}' table name '${table}' must match ${UNIT_NAME_RE.source}`)
    }
  }
  if (spec.global.schema.safeParse(null).success) {
    throw new Error(`domain '${spec.name}' global schema must not accept null（null 是介质「从未写入」哨兵）`)
  }
}
assertValidDomainSpec(SrwIndexSpec)

/** 宿主 Domain handle 的最小结构面（本插件用到的成员）。 */
export interface SrwIndexDomain {
  readonly global: {
    get(): SrwIndexGlobal
    set(value: SrwIndexGlobal): Promise<void>
  }
  table(name: string): {
    get(key: string): unknown
    entries(): IterableIterator<[string, unknown]>
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
  }
  close(): Promise<void> | void
}

/** 从注入的 storageDomain 打开 srw_index；失败抛错由调用方决定降级姿态。 */
export async function openSrwIndex(storageDomain: unknown): Promise<SrwIndexDomain> {
  const facility = storageDomain as { open(spec: unknown): Promise<SrwIndexDomain> }
  if (facility?.open === undefined) {
    throw new Error('storageDomain.open 缺席（宿主能力与 inject 矩阵不符）')
  }
  return await facility.open(SrwIndexSpec)
}
