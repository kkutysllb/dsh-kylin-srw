/** 零依赖手写校验器（ADR：M1 不引 zod 进 schema 面）：返回错误清单而非抛错，
 * RPC INVALID 聚合与 WorkspaceStore 的「坏文件跳过」共用同一判定。
 * storage 域无迁移机制（0102 §6.3）：version 恒 1，只加可选字段。 */

export interface ProjectMeta {
  readonly schemaVersion: 1
  readonly slug: string
  readonly title: string
  readonly field?: string
  readonly stage: 'idea' | 'literature' | 'reading' | 'writing' | 'experiments' | 'submission'
  readonly createdAt: string
  readonly updatedAt: string
  readonly targetVenue?: string
  readonly depthTier?: 'D1' | 'D2' | 'D3'
}

export const STAGES = ['idea', 'literature', 'reading', 'writing', 'experiments', 'submission'] as const

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** 校验 project.json 形状；返回中文错误清单（空数组 = 合法）。 */
export function validateProjectMeta(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['project.json 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  if (m['schemaVersion'] !== 1) errors.push('schemaVersion 必须为 1')
  if (typeof m['slug'] !== 'string' || !SLUG_RE.test(m['slug'])) {
    errors.push('slug 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$')
  }
  if (typeof m['title'] !== 'string' || m['title'] === '' || m['title'].length > 200) {
    errors.push('title 必填（≤200）')
  }
  if (typeof m['stage'] !== 'string' || !(STAGES as readonly string[]).includes(m['stage'])) {
    errors.push(`stage 必须是 ${STAGES.join('|')}`)
  }
  for (const key of ['createdAt', 'updatedAt'] as const) {
    const v = m[key]
    if (typeof v !== 'string' || v === '' || Number.isNaN(Date.parse(v))) {
      errors.push(`${key} 必须是 ISO 时间`)
    }
  }
  return errors
}
