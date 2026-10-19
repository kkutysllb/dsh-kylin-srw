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
