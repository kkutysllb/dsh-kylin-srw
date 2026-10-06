/** 大纲一级真相源（Task 5.4 / 0102 §6.2）：`outline.json` 是章节树的唯一
 * 权威——正文节文件按它对齐。**G1 确认门**：`draft→confirmed` 由用户显式
 * 确认（落 revision+时间戳）；未确认的大纲**禁止触发正文生成**（门在
 * 服务层硬编码，不是提示词请求）。
 *
 * LLM 生成部分（章节意图/正文）走 agent 车道——本模块只管状态机与文件。 */

import { ServiceError } from '../service.ts'
import type { DepthTier } from '../venue/types.ts'
import { DEPTH_PROFILES } from '../venue/depth.ts'

export type OutlineStatus = 'draft' | 'confirmed'

export interface OutlineSection {
  readonly id: string
  readonly title: string
  /** 一句话本节意图（写给起草者看）。 */
  readonly intent: string
  readonly targetWords: number
  readonly status: OutlineStatus
  /** 正文节文件（paper/ 内相对路径）——outline.save 按序分配，同名沿用。 */
  readonly file?: string
}

export interface Outline {
  readonly schemaVersion: 1
  readonly status: OutlineStatus
  readonly confirmedAt?: string
  /** 每次确认 +1——正文生成产物挂 revision，确认后改大纲必先落新 revision。 */
  readonly revision: number
  readonly sections: readonly OutlineSection[]
}

export function emptyOutline(sections: readonly { title: string; intent: string }[] = []): Outline {
  return {
    schemaVersion: 1,
    status: 'draft',
    revision: 0,
    sections: sections.map((section, index) => ({
      id: `s${index + 1}`,
      title: section.title,
      intent: section.intent,
      targetWords: 400,
      status: 'draft' as const,
    })),
  }
}

/** 解析项目内 outline.json（坏数据 → INVALID；文件级 I/O 在服务层）。 */
export function parseOutline(raw: string): Outline {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new ServiceError('INVALID', 'outline.json 不是合法 JSON')
  }
  const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
  if (record['schemaVersion'] !== 1) throw new ServiceError('INVALID', 'outline.json schemaVersion 非法')
  const status = record['status']
  if (status !== 'draft' && status !== 'confirmed') throw new ServiceError('INVALID', 'outline.json status 非法')
  const revision = record['revision']
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    throw new ServiceError('INVALID', 'outline.json revision 非法')
  }
  if (!Array.isArray(record['sections'])) throw new ServiceError('INVALID', 'outline.json sections 非法')
  const sections = (record['sections'] as unknown[]).map((item, index) => {
    const section = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    const title = typeof section['title'] === 'string' ? section['title'] : ''
    if (title === '') throw new ServiceError('INVALID', `outline sections[${index}].title 缺失`)
    return {
      id: typeof section['id'] === 'string' && section['id'] !== '' ? section['id'] : `s${index + 1}`,
      title,
      intent: typeof section['intent'] === 'string' ? section['intent'] : '',
      targetWords: typeof section['targetWords'] === 'number' ? section['targetWords'] : 400,
      status: section['status'] === 'confirmed' ? 'confirmed' as const : 'draft' as const,
      ...(typeof section['file'] === 'string' && section['file'] !== '' ? { file: section['file'] } : {}),
    }
  })
  const outline: Outline = {
    schemaVersion: 1,
    status,
    revision,
    sections,
    ...(typeof record['confirmedAt'] === 'string' ? { confirmedAt: record['confirmedAt'] } : {}),
  }
  return outline
}

export function serializeOutline(outline: Outline): string {
  return JSON.stringify(outline, null, 2) + '\n'
}

/** 确认（G1 通过动作）：draft → confirmed，revision+1。已确认再确认 →
 * 幂等返回原文（revision 不动）。 */
export function confirmOutline(outline: Outline): Outline {
  if (outline.status === 'confirmed' && outline.sections.every(section => section.status === 'confirmed')) {
    return outline
  }
  return {
    ...outline,
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
    revision: outline.revision + 1,
    sections: outline.sections.map(section => ({ ...section, status: 'confirmed' as const })),
  }
}

/** 确认后又改大纲 → 打回 draft（revision 保持——改后的内容还没被确认过）。 */
export function draftOutline(outline: Outline, sections: readonly OutlineSection[]): Outline {
  const { confirmedAt, ...rest } = outline
  void confirmedAt
  return {
    ...rest,
    status: 'draft',
    sections,
  }
}

/** G1 门检查：正文生成只认 confirmed。 */
export function assertConfirmed(outline: Outline): void {
  if (outline.status !== 'confirmed') {
    throw new ServiceError('GATE', '大纲未确认（G1）：先在面板确认大纲，再触发正文生成')
  }
}

/** 落点①：大纲生成的 agent 提示词包（分档给章节骨架与目标字数）。 */
export function outlinePrompt(input: { readonly tier: DepthTier; readonly topic: string; readonly venueName: string }): string {
  const profile = DEPTH_PROFILES[input.tier]
  const lines = [
    `请为论文《${input.topic}》拟大纲（目标刊物：${input.venueName}；深度档位 ${input.tier}）。`,
    `输出 JSON：{"sections":[{"title":"节名","intent":"一句话本节意图","targetWords":字数}]}。`,
    `要求：`,
    `- 章节数 ≥ ${profile.sections.min}${profile.sections.requireRelatedWork ? '，必须含 Related Work/相关工作' : ''}；`,
    `- 全文目标篇幅 ${profile.pages.min}–${profile.pages.max} 页；`,
    `- 每节 targetWords 按篇幅配比给出（合计对应 ${profile.pages.min}–${profile.pages.max} 页）；`,
    `- 节名用中文刊物体例（若刊物为中文）否则英文；intent 说清该节要论证什么，不是名词罗列。`,
  ]
  return lines.join('\n')
}
