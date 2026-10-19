/** 投稿材料草稿（8.4）：submissions/draft.json 为状态真相源，每次 draft
 * 全量重渲染三件套 cover-letter.md / highlights.txt / declarations.tex。
 * 诚实性：刊物事实带 confidence（unverified → cover letter 显式「未核定」）；
 * 数据可得性从 experiments、data/registry.json 取证（authored 优先），取不到
 * 写「需作者确认」并进 warnings——D2/D3 pack 阻断在 8.6 消费。声明 label 按
 * venue.lang 取中/英（goals/02 R5）。纯函数 + 类型，IO 在 service 层。 */

import { ServiceError } from '../service.ts'
import { DEPTH_PROFILES } from '../venue/depth.ts'
import type { DepthTier, StatementKind, VenueSchema } from '../venue/types.ts'

export type StatementStatus = 'authored' | 'evidenced' | 'needs-author'

export interface StatementDraft {
  readonly id: StatementKind
  readonly label: string
  readonly text: string
  readonly status: StatementStatus
  /** status=evidenced 时的取证路径（experiments/<id>、data/registry.json）。 */
  readonly evidence?: readonly string[]
}

export interface SubmissionDraft {
  readonly schemaVersion: 1
  readonly venueId: string
  readonly venueConfidence: 'verified' | 'unverified'
  readonly tier: DepthTier
  readonly lang: 'en' | 'zh'
  readonly round: number
  readonly title: string
  readonly coverLetterBody: string
  readonly highlights: readonly string[]
  readonly statements: readonly StatementDraft[]
  readonly updatedAt: string
}

export const STATEMENT_LABELS: Readonly<Record<StatementKind, { readonly en: string; readonly zh: string }>> = {
  dataAvailability: { en: 'Data Availability', zh: '数据可得性' },
  codeAvailability: { en: 'Code Availability', zh: '代码可得性' },
  limitations: { en: 'Limitations', zh: '局限性' },
  conflictOfInterest: { en: 'Conflict of Interest', zh: '利益冲突' },
  ethics: { en: 'Ethics', zh: '伦理声明' },
  authorContributions: { en: 'Author Contributions', zh: '作者贡献' },
}

const NEEDS_AUTHOR = '（需作者确认）'

function labelFor(lang: 'en' | 'zh', id: StatementKind): string {
  return lang === 'zh' ? STATEMENT_LABELS[id]!.zh : STATEMENT_LABELS[id]!.en
}

/** 声明集：venue.mandatoryStatements 优先，空则按已应用档位的 profile。 */
export function statementKindsFor(venue: VenueSchema, tier: DepthTier): readonly StatementKind[] {
  return venue.mandatoryStatements.length > 0 ? venue.mandatoryStatements : DEPTH_PROFILES[tier]!.statements
}

export function newSubmissionDraft(venue: VenueSchema, tier: DepthTier, title: string): SubmissionDraft {
  return {
    schemaVersion: 1,
    venueId: venue.id,
    venueConfidence: venue.confidence,
    tier,
    lang: venue.lang,
    round: 1,
    title,
    coverLetterBody: '',
    highlights: [],
    statements: statementKindsFor(venue, tier).map(id => ({
      id,
      label: labelFor(venue.lang, id),
      text: NEEDS_AUTHOR,
      status: 'needs-author',
    })),
    updatedAt: new Date().toISOString(),
  }
}

const KINDS = new Set<string>(Object.keys(STATEMENT_LABELS))

/** 落一笔草稿（返回新 draft；不改盘）。字段：coverLetter / highlights /
 * statement.<kind> / title / round。 */
export function applyDraftField(draft: SubmissionDraft, field: string, text: string): SubmissionDraft {
  const touch = (next: Partial<SubmissionDraft>): SubmissionDraft => ({ ...draft, ...next, updatedAt: new Date().toISOString() })
  if (field === 'coverLetter') {
    const body = text.trim()
    if (body === '' || body.length > 8000) throw new ServiceError('INVALID', 'coverLetter 正文必填且 ≤8000 字符')
    return touch({ coverLetterBody: body })
  }
  if (field === 'highlights') {
    const items = text.split('\n').map(line => line.trim()).filter(line => line !== '')
    if (items.length < 3 || items.length > 5) {
      throw new ServiceError('INVALID', `highlights 必须 3–5 条（当前 ${items.length}）`)
    }
    const long = items.findIndex(item => item.length > 100)
    if (long >= 0) {
      throw new ServiceError('INVALID', `highlights 第 ${long + 1} 条超 100 字符（${items[long]!.length}）`)
    }
    return touch({ highlights: items })
  }
  if (field.startsWith('statement.')) {
    const kind = field.slice('statement.'.length)
    if (!KINDS.has(kind)) throw new ServiceError('INVALID', `未知声明类型：${JSON.stringify(field)}`)
    const body = text.trim()
    if (body === '' || body.length > 2000) throw new ServiceError('INVALID', '声明正文必填且 ≤2000 字符')
    const statements = draft.statements.map((statement): StatementDraft => {
      if (statement.id !== kind) return statement
      const { evidence: _dropped, ...rest } = statement
      return { ...rest, text: body, status: 'authored' }
    })
    return touch({ statements })
  }
  if (field === 'title') {
    const title = text.trim()
    if (title === '' || title.length > 200) throw new ServiceError('INVALID', 'title 必填且 ≤200 字符')
    return touch({ title })
  }
  if (field === 'round') {
    const round = Number(text)
    if (!Number.isInteger(round) || round < 1 || round > 99) {
      throw new ServiceError('INVALID', `round 必须是 1–99 的整数：${JSON.stringify(text)}`)
    }
    return touch({ round })
  }
  throw new ServiceError('INVALID', `未知 draft 字段：${JSON.stringify(field)}（coverLetter | highlights | statement.<kind> | title | round）`)
}

/** 重估自动状态：authored 永不被覆盖；dataAvailability 有取证则 evidenced；
 * 其余缺稿 → needs-author。同时产出 warnings（needs-author 与未起草项）。 */
export function refreshStatements(draft: SubmissionDraft, evidence: readonly string[]): { draft: SubmissionDraft; warnings: readonly string[] } {
  const warnings: string[] = []
  const statements = draft.statements.map((statement): StatementDraft => {
    if (statement.status === 'authored') return statement
    if (statement.id === 'dataAvailability' && evidence.length > 0) {
      return {
        ...statement,
        status: 'evidenced',
        text: `Data: produced under managed experiments and dataset registry (${evidence.join('; ')}).`,
        evidence,
      }
    }
    const { evidence: _dropped, ...rest } = statement
    return { ...rest, status: 'needs-author', text: NEEDS_AUTHOR }
  })
  const pending = statements.filter(statement => statement.status === 'needs-author').map(statement => statement.label)
  if (pending.length > 0) {
    warnings.push(`声明需作者确认：${pending.join('、')}——D2/D3 投稿包将阻断`)
  }
  if (draft.highlights.length === 0) warnings.push('highlights 未起草（3–5 条，每条 ≤100 字符）')
  if (draft.coverLetterBody === '') warnings.push('cover letter 正文未起草')
  const next: SubmissionDraft = { ...draft, statements, updatedAt: new Date().toISOString() }
  return { draft: next, warnings }
}

export interface RenderedSubmission {
  readonly coverLetter: string
  readonly highlights: string
  readonly declarations: string
}

export function renderSubmission(draft: SubmissionDraft): RenderedSubmission {
  const confidenceNote = draft.venueConfidence === 'unverified' ? '（⚠ 刊物事实未核定——提交前人工核对作者指南）' : ''
  const coverLetter = [
    '# Cover Letter',
    '',
    `- Venue: ${draft.venueId}${confidenceNote}`,
    `- Depth tier: ${draft.tier}　Round: ${draft.round}`,
    `- Manuscript: ${draft.title === '' ? '（标题未识别）' : draft.title}`,
    '',
    draft.coverLetterBody === '' ? '（正文待起草——submission.draft field=coverLetter）' : draft.coverLetterBody,
    '',
  ].join('\n')
  const highlights = draft.highlights.length > 0 ? draft.highlights.join('\n') + '\n' : '（未起草——3–5 条，每条 ≤100 字符）\n'
  const declarations = [
    '\\section*{Declarations}',
    '',
    ...draft.statements.flatMap(statement => [
      `\\subsection*{${statement.label}}`,
      statement.text,
      '',
    ]),
  ].join('\n')
  return { coverLetter, highlights, declarations }
}

/* ── 8.5 format.check 纯函数面：解析与判定，IO 在 service 层 ── */

export interface DocumentClassInfo {
  readonly cls: string
  readonly options: readonly string[]
}

export function parseDocumentClass(mainTex: string): DocumentClassInfo | undefined {
  const match = mainTex.match(/\\documentclass\s*(?:\[([^\]]*)\])?\{([^}]*)\}/)
  if (match === null) return undefined
  return {
    cls: match[2]!.trim(),
    options: (match[1] ?? '').split(',').map(option => option.trim()).filter(option => option !== ''),
  }
}

/** abstract 环境词数；占位注释行（% 开头）不计；无环境 → undefined。 */
export function abstractWordCount(mainTex: string): number | undefined {
  const match = mainTex.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)
  if (match === null) return undefined
  const body = match[1]!.split('\n').filter(line => !line.trim().startsWith('%')).join('\n')
  return body.split(/\s+/).filter(word => word !== '').length
}

/** 由 documentclass 推断栏数（设计表：IEEEtran journal / acmart sigconf = 2，
 * llncs / ctexart / article = 1；PDF 实测列数超出本程）。 */
export function inferredColumns(cls: string, options: readonly string[]): 1 | 2 {
  if (cls === 'IEEEtran') return 2
  if (cls === 'acmart') return options.includes('sigconf') ? 2 : 1
  return 1
}

export type RefStyleFamily = 'numeric' | 'authoryear'

export function refStyleFamily(style: string): RefStyleFamily {
  return style === 'apa' || style === 'authoryear' ? 'authoryear' : 'numeric'
}

/** PNG pHYs chunk → DPI（pixels-per-meter × 0.0254；unit 非 meter → undefined）。 */
export function pngDpi(bytes: Buffer): number | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < signature.length + 8 || !bytes.subarray(0, 8).equals(signature)) return undefined
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'pHYs') {
      if (length < 9) return undefined
      const xPpm = bytes.readUInt32BE(offset + 8)
      const unit = bytes.readUInt8(offset + 16)
      return unit === 1 ? Math.round(xPpm * 0.0254) : undefined
    }
    if (type === 'IDAT') break
    offset += 12 + length
  }
  return undefined
}

/** JPEG JFIF APP0 → DPI（units 1=dpi；2=dots/cm ×2.54；其余 undefined）。 */
export function jpegDpi(bytes: Buffer): number | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === undefined || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    if (marker === 0xda) break
    const length = bytes.readUInt16BE(offset + 2)
    if (marker === 0xe0 && bytes.length >= offset + 15) {
      const units = bytes[offset + 11]
      const xDensity = bytes.readUInt16BE(offset + 12)
      if (units === 1) return xDensity
      if (units === 2) return Math.round(xDensity * 2.54)
      return undefined
    }
    offset += 2 + length
  }
  return undefined
}
