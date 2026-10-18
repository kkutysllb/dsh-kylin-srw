/** 专利域 schema（M9-lite 第一批）：patent.json / disclosure.json /
 * events.jsonl 行的手写校验器（照 src/core/schema.ts 的 validateProjectMeta
 * 风格：零依赖、返回中文错误清单而非抛错——RPC INVALID 聚合与 list 的
 * 「坏文件跳过」共用同一判定）。全部 schemaVersion:1；ISO 时间用
 * Date.parse 判定（与 validateProjectMeta 同口径）。
 *
 * 法务口径（analysis/goals/03-写专利.md §2，设计输入、不构成法律意见）：
 * MVP 只做中国发明专利（kind/jurisdiction 恒 invention/CN）；宽限期仅
 * 四种法定情形且窗口为申请日前 6 个月。 */

import { SLUG_RE } from '../core/schema.ts'

export const PATENT_SCHEMA_VERSION = 1

/** 专利状态机（03 报告 §4）：idea → disclosure → … → granted|rejected|abandoned。 */
export const PATENT_STATUSES = [
  'idea', 'disclosure', 'searching', 'drafted', 'checked', 'filing-ready',
  'filed', 'published', 'oa', 'granted', 'rejected', 'abandoned',
] as const

export type PatentStatus = (typeof PATENT_STATUSES)[number]

/** 申请登记（手工回填；MVP 只支持中国发明专利）。 */
export interface PatentFiling {
  readonly applicationNo: string
  readonly filedAt: string
  readonly jurisdiction: 'CN'
}

export interface PatentMeta {
  readonly schemaVersion: typeof PATENT_SCHEMA_VERSION
  readonly patentId: string
  readonly title: string
  readonly kind: 'invention'
  readonly status: PatentStatus
  readonly inventors: readonly string[]
  readonly applicants: readonly string[]
  readonly filing?: PatentFiling
  readonly createdAt: string
  readonly updatedAt: string
}

/** ISO 时间判定（与 validateProjectMeta 的 createdAt/updatedAt 同口径）。 */
export function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item !== '')
}

/** 校验 patent.json 形状；返回中文错误清单（空数组 = 合法）。 */
export function validatePatentMeta(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['patent.json 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  if (m['schemaVersion'] !== 1) errors.push('schemaVersion 必须为 1')
  if (typeof m['patentId'] !== 'string' || !SLUG_RE.test(m['patentId'])) {
    errors.push('patentId 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$')
  }
  if (typeof m['title'] !== 'string' || m['title'] === '' || m['title'].length > 200) {
    errors.push('title 必填（≤200 字）')
  }
  if (m['kind'] !== 'invention') errors.push('kind 目前只支持 invention（MVP 仅中国发明专利）')
  if (typeof m['status'] !== 'string' || !(PATENT_STATUSES as readonly string[]).includes(m['status'])) {
    errors.push(`status 必须是 ${PATENT_STATUSES.join('|')}`)
  }
  if (!isStringArray(m['inventors'])) errors.push('inventors 必须是非空字符串数组')
  if (!isStringArray(m['applicants'])) errors.push('applicants 必须是非空字符串数组')
  const filing = m['filing']
  if (filing !== undefined) {
    if (typeof filing !== 'object' || filing === null || Array.isArray(filing)) {
      errors.push('filing 必须是对象（申请号/申请日/管辖区）')
    } else {
      const f = filing as Record<string, unknown>
      if (typeof f['applicationNo'] !== 'string' || f['applicationNo'] === '') {
        errors.push('filing.applicationNo 必填（申请号）')
      }
      if (!isIsoTime(f['filedAt'])) errors.push('filing.filedAt 必须是 ISO 时间（申请日）')
      if (f['jurisdiction'] !== 'CN') errors.push('filing.jurisdiction 目前只支持 CN')
    }
  }
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (!isIsoTime(m[key])) errors.push(`${key} 必须是 ISO 时间`)
  }
  return errors
}

/** 有益效果：evidence 是证据指针（产物/文件路径）或字面 'TODO'（待补）。 */
export interface BeneficialEffect {
  readonly text: string
  readonly evidence: string
}

export interface DisclosureAttachment {
  readonly path: string
  readonly note?: string
}

/** 技术交底书（disclosure.json；问题-方案-效果-实施例 skeleton）。 */
export interface Disclosure {
  readonly schemaVersion: typeof PATENT_SCHEMA_VERSION
  readonly technicalField: string
  readonly backgroundArt: string
  readonly problem: string
  readonly solution: string
  readonly embodiments: readonly string[]
  readonly beneficialEffects: readonly BeneficialEffect[]
  readonly attachments: readonly DisclosureAttachment[]
}

/** 宽容归一：把任意输入拉成 Disclosure 形状（缺省填空/TODO），交
 * validateDisclosure 报错。整体替换保存前的唯一入口。 */
export function normalizeDisclosure(value: unknown): Disclosure {
  const m = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const str = (key: string): string => (typeof m[key] === 'string' ? m[key] as string : '')
  return {
    schemaVersion: 1,
    technicalField: str('technicalField'),
    backgroundArt: str('backgroundArt'),
    problem: str('problem'),
    solution: str('solution'),
    embodiments: Array.isArray(m['embodiments'])
      ? m['embodiments'].filter((item): item is string => typeof item === 'string')
      : [],
    beneficialEffects: (Array.isArray(m['beneficialEffects']) ? m['beneficialEffects'] : []).map(row => {
      const r = typeof row === 'object' && row !== null && !Array.isArray(row)
        ? row as Record<string, unknown>
        : {}
      return {
        text: typeof r['text'] === 'string' ? r['text'] : '',
        evidence: typeof r['evidence'] === 'string' ? r['evidence'] : 'TODO',
      }
    }),
    attachments: (Array.isArray(m['attachments']) ? m['attachments'] : []).map(row => {
      const r = typeof row === 'object' && row !== null && !Array.isArray(row)
        ? row as Record<string, unknown>
        : {}
      return {
        path: typeof r['path'] === 'string' ? r['path'] : '',
        ...(typeof r['note'] === 'string' ? { note: r['note'] } : {}),
      }
    }),
  }
}

/** 校验 disclosure.json 形状；返回中文错误清单（空数组 = 合法）。 */
export function validateDisclosure(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['disclosure.json 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  if (m['schemaVersion'] !== 1) errors.push('schemaVersion 必须为 1')
  for (const key of ['technicalField', 'backgroundArt', 'problem', 'solution'] as const) {
    const v = m[key]
    if (typeof v !== 'string' || v === '') errors.push(`${key} 必填`)
  }
  if (!Array.isArray(m['embodiments']) || !m['embodiments'].every(item => typeof item === 'string' && item !== '')) {
    errors.push('embodiments 必须是非空字符串数组（至少一个具体实施例）')
  }
  const effects = m['beneficialEffects']
  if (!Array.isArray(effects)) {
    errors.push('beneficialEffects 必须是数组')
  } else {
    effects.forEach((row, index) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        errors.push(`beneficialEffects[${index}] 必须是对象`)
        return
      }
      const r = row as Record<string, unknown>
      if (typeof r['text'] !== 'string' || r['text'] === '') errors.push(`beneficialEffects[${index}].text 必填`)
      if (typeof r['evidence'] !== 'string' || r['evidence'] === '') {
        errors.push(`beneficialEffects[${index}].evidence 必填（证据指针或字面 'TODO'）`)
      }
    })
  }
  const attachments = m['attachments']
  if (!Array.isArray(attachments)) {
    errors.push('attachments 必须是数组')
  } else {
    attachments.forEach((row, index) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        errors.push(`attachments[${index}] 必须是对象`)
        return
      }
      const r = row as Record<string, unknown>
      if (typeof r['path'] !== 'string' || r['path'] === '') errors.push(`attachments[${index}].path 必填`)
      if (r['note'] !== undefined && (typeof r['note'] !== 'string' || r['note'] === '')) {
        errors.push(`attachments[${index}].note 必须是非空字符串`)
      }
    })
  }
  return errors
}

/** 公开事件类别（03 报告 §6）：paper/预印本/会议/学位论文/代码/其他公开 +
 * 申请登记（filed）与宽限声明（grace-declared）。 */
export const PUBLIC_EVENT_KINDS = [
  'paper-submitted', 'preprint-published', 'conference-talk', 'thesis',
  'code-release', 'other-public', 'filed', 'grace-declared',
] as const

export type PublicEventKind = (typeof PUBLIC_EVENT_KINDS)[number]

/** 宽限期四种法定情形 + none（专利法第 24 条；「规定的学术会议」极窄）。 */
export const GRACE_CASES = [
  'none', 'government-emergency', 'international-exhibition',
  'prescribed-academic-conference', 'unconsented-disclosure',
] as const

export type GraceCase = (typeof GRACE_CASES)[number]

/** events.jsonl 一行（append-only，每行一个 JSON）。 */
export interface PublicEvent {
  readonly at: string
  readonly kind: PublicEventKind
  readonly description: string
  readonly publicAt: string
  readonly graceCase: GraceCase
  readonly source?: string
}

/** 宽容归一：at 缺省取 nowIso、graceCase 缺省 none；其余交 validatePublicEvent。 */
export function normalizePublicEvent(value: unknown, nowIso: string): PublicEvent {
  const m = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    at: typeof m['at'] === 'string' ? m['at'] : nowIso,
    kind: (typeof m['kind'] === 'string' ? m['kind'] : '') as PublicEventKind,
    description: typeof m['description'] === 'string' ? m['description'] : '',
    publicAt: typeof m['publicAt'] === 'string' ? m['publicAt'] : '',
    graceCase: (typeof m['graceCase'] === 'string' ? m['graceCase'] : 'none') as GraceCase,
    ...(typeof m['source'] === 'string' ? { source: m['source'] } : {}),
  }
}

/** 校验 events.jsonl 行；返回中文错误清单（空数组 = 合法）。 */
export function validatePublicEvent(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['公开事件必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  if (!isIsoTime(m['at'])) errors.push('at 必须是 ISO 时间（登记时刻）')
  if (typeof m['kind'] !== 'string' || !(PUBLIC_EVENT_KINDS as readonly string[]).includes(m['kind'])) {
    errors.push(`kind 必须是 ${PUBLIC_EVENT_KINDS.join('|')}`)
  }
  if (typeof m['description'] !== 'string' || m['description'] === '') errors.push('description 必填（公开了什么）')
  if (!isIsoTime(m['publicAt'])) errors.push('publicAt 必须是 ISO 时间（该公开实际发生的时点）')
  if (typeof m['graceCase'] !== 'string' || !(GRACE_CASES as readonly string[]).includes(m['graceCase'])) {
    errors.push(`graceCase 必须是 ${GRACE_CASES.join('|')}`)
  }
  if (m['source'] !== undefined && (typeof m['source'] !== 'string' || m['source'] === '')) {
    errors.push('source 必须是非空字符串（URL/证明指针）')
  }
  return errors
}
