/** 审稿意见 → 响应信（8.3）：reviews/round-<n>/{reviews,responses}.json +
 * response.<md|tex>。证据门：responses 的每条 change 必须能在
 * paperDiff(baseSnapshotId, snapshotId) 中定位到 file+hunkIndex，否则
 * RESPONSE_UNBACKED——防「编造已修改」。门只证「引用存在」，不证「改得对」
 * （goals/02 R6）：结论须作者本人复核。 */

import { ServiceError } from '../service.ts'
import type { PaperDiff, PaperDiffFile } from './diff.ts'

export interface ReviewComment {
  readonly id: string
  readonly text: string
  readonly area?: string
}

export interface ReviewEntry {
  readonly reviewer: string
  readonly comments: readonly ReviewComment[]
}

export interface ReviewsFile {
  readonly schemaVersion: 1
  readonly round: number
  readonly venueId: string
  /** 证据基线：首轮基线快照或上一轮投稿快照（respond 的 diff 以此为 from）。 */
  readonly baseSnapshotId: string
  readonly reviews: readonly ReviewEntry[]
}

export interface ResponseChange {
  readonly snapshotId: string
  readonly file: string
  readonly hunkIndex: number
  readonly note?: string
}

export interface ResponseItem {
  readonly commentId: string
  readonly response: string
  readonly changes: readonly ResponseChange[]
}

export interface ResponsesFile {
  readonly schemaVersion: 1
  readonly round: number
  readonly baseSnapshotId: string
  readonly items: readonly ResponseItem[]
}

export interface ReviewInput {
  readonly venueId: string
  readonly baseSnapshotId: string
  readonly reviews: readonly ReviewEntry[]
}

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const SNAP_RE = /^[A-Za-z0-9._-]+$/

/** 开轮入参校验（服务层调用；错误码 INVALID）。 */
export function parseReviewInput(round: number, input: ReviewInput): ReviewsFile {
  if (!Number.isInteger(round) || round < 1 || round > 99) {
    throw new ServiceError('INVALID', 'round 必须是 1–99 的整数')
  }
  const venueId = typeof input.venueId === 'string' ? input.venueId.trim() : ''
  if (venueId === '' || venueId.length > 80) throw new ServiceError('INVALID', 'venueId 必填且 ≤80 字符')
  if (!SNAP_RE.test(input.baseSnapshotId) || input.baseSnapshotId === '.' || input.baseSnapshotId === '..') {
    throw new ServiceError('INVALID', `baseSnapshotId 非法：${JSON.stringify(input.baseSnapshotId)}`)
  }
  if (!Array.isArray(input.reviews) || input.reviews.length === 0) {
    throw new ServiceError('INVALID', 'reviews 必须是非空数组（reviewer + comments）')
  }
  const seen = new Set<string>()
  const reviews = input.reviews.map(entry => {
    const reviewer = typeof entry.reviewer === 'string' ? entry.reviewer.trim() : ''
    if (reviewer === '' || reviewer.length > 80) throw new ServiceError('INVALID', 'reviewer 必填且 ≤80 字符')
    if (!Array.isArray(entry.comments) || entry.comments.length === 0) {
      throw new ServiceError('INVALID', `reviewer ${reviewer} 的 comments 必须是非空数组`)
    }
    const comments = entry.comments.map((comment: ReviewComment) => {
      const id = typeof comment.id === 'string' ? comment.id : ''
      if (!ID_RE.test(id)) throw new ServiceError('INVALID', `意见 id 非法：${JSON.stringify(id)}（≤64，字母数字._-）`)
      if (seen.has(id)) throw new ServiceError('INVALID', `意见 id 重复：${id}`)
      seen.add(id)
      const text = typeof comment.text === 'string' ? comment.text.trim() : ''
      if (text === '' || text.length > 4000) throw new ServiceError('INVALID', `意见 ${id} 的 text 必填且 ≤4000 字符`)
      const area = typeof comment.area === 'string' && comment.area.trim() !== '' ? comment.area.trim().slice(0, 40) : undefined
      return { id, text, ...(area !== undefined ? { area } : {}) }
    })
    return { reviewer, comments }
  })
  return { schemaVersion: 1, round, venueId, baseSnapshotId: input.baseSnapshotId, reviews }
}

/** change 形状校验（不查 diff——证据门在 service 层做，因为要读盘）。 */
export function parseChanges(raw: unknown): readonly ResponseChange[] {
  if (!Array.isArray(raw)) throw new ServiceError('INVALID', 'changes 必须是数组')
  if (raw.length > 20) throw new ServiceError('INVALID', 'changes ≤20 条')
  return raw.map(item => {
    const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    const snapshotId = typeof record['snapshotId'] === 'string' ? record['snapshotId'] : ''
    if (!SNAP_RE.test(snapshotId) || snapshotId === '.' || snapshotId === '..') {
      throw new ServiceError('INVALID', `change.snapshotId 非法：${JSON.stringify(snapshotId)}`)
    }
    const file = typeof record['file'] === 'string' ? record['file'] : ''
    if (file === '' || file.length > 200 || file.includes('..') || file.startsWith('/')) {
      throw new ServiceError('INVALID', `change.file 非法：${JSON.stringify(file)}`)
    }
    const hunkIndex = record['hunkIndex']
    if (!Number.isInteger(hunkIndex) || (hunkIndex as number) < 0 || (hunkIndex as number) > 9999) {
      throw new ServiceError('INVALID', `change.hunkIndex 必须是非负整数：${JSON.stringify(hunkIndex)}`)
    }
    const note = typeof record['note'] === 'string' && record['note'].trim() !== '' ? record['note'].trim().slice(0, 200) : undefined
    return { snapshotId, file, hunkIndex: hunkIndex as number, ...(note !== undefined ? { note } : {}) }
  })
}

export function findComment(reviews: ReviewsFile, commentId: string): { reviewer: string; comment: ReviewComment } | undefined {
  for (const entry of reviews.reviews) {
    for (const comment of entry.comments) {
      if (comment.id === commentId) return { reviewer: entry.reviewer, comment }
    }
  }
  return undefined
}

/** 单条 change 的证据渲染：文件 + hunk 行摘要（最多 6 行）。 */
function hunkEvidence(file: PaperDiffFile | undefined, hunkIndex: number): { where: string; lines: readonly string[] } {
  if (file === undefined || file.hunks[hunkIndex] === undefined) return { where: '(missing)', lines: [] }
  const hunk = file.hunks[hunkIndex]!
  const where = `hunk#${hunkIndex}（a${hunk.aStart}:${hunk.aCount} → b${hunk.bStart}:${hunk.bCount}）`
  const lines = hunk.lines.slice(0, 6).map(line => `${line.op} ${line.text}`)
  return { where, lines }
}

export interface ExportInput {
  readonly reviews: ReviewsFile
  readonly responses: readonly ResponseItem[]
  /** snapshotId → diff（service 层用 paperDiff(base, snapshotId) 预取）。 */
  readonly diffs: Readonly<Record<string, PaperDiff>>
}

export function renderResponseMd({ reviews, responses, diffs }: ExportInput): string {
  const byComment = new Map(responses.map(item => [item.commentId, item]))
  const out: string[] = []
  out.push(`# 响应信（round ${reviews.round} · ${reviews.venueId}）`)
  out.push('')
  out.push(`证据基线快照：\`${reviews.baseSnapshotId}\`（各条修改相对它定位）。`)
  out.push('')
  const unanswered: string[] = []
  for (const entry of reviews.reviews) {
    out.push(`## ${entry.reviewer}`)
    out.push('')
    for (const comment of entry.comments) {
      const item = byComment.get(comment.id)
      out.push(`### ${comment.id}${comment.area !== undefined ? `（${comment.area}）` : ''}`)
      out.push('')
      out.push(`**意见**：${comment.text}`)
      out.push('')
      if (item === undefined) {
        unanswered.push(`${comment.id}（${entry.reviewer}）`)
        out.push('**回复**：（未回复）')
        out.push('')
        continue
      }
      out.push(`**回复**：${item.response}`)
      out.push('')
      if (item.changes.length > 0) {
        out.push('**修改位置**：')
        out.push('')
        for (const change of item.changes) {
          const diff = diffs[change.snapshotId]
          const file = diff?.files.find(candidate => candidate.path === change.file)
          const evidence = hunkEvidence(file, change.hunkIndex)
          out.push(`- \`${change.file}\` ${evidence.where} @ snapshot \`${change.snapshotId}\`${change.note !== undefined ? `（${change.note}）` : ''}`)
          for (const line of evidence.lines) {
            out.push(`  \`${line}\``)
          }
        }
        out.push('')
      }
    }
  }
  if (unanswered.length > 0) {
    out.push('## 未回复')
    out.push('')
    for (const id of unanswered) out.push(`- ${id}`)
    out.push('')
  }
  return out.join('\n')
}

export function renderResponseTex({ reviews, responses, diffs }: ExportInput): string {
  const byComment = new Map(responses.map(item => [item.commentId, item]))
  const out: string[] = []
  out.push(`\\section*{Response to Reviewers (Round ${reviews.round})}`)
  out.push('')
  out.push(`\\noindent Venue: ${reviews.venueId}. Evidence base snapshot: \\texttt{${reviews.baseSnapshotId}}.`)
  out.push('')
  for (const entry of reviews.reviews) {
    out.push(`\\subsection*{${entry.reviewer}}`)
    out.push('')
    for (const comment of entry.comments) {
      const item = byComment.get(comment.id)
      out.push(`\\noindent \\textbf{${comment.id}${comment.area !== undefined ? ` (${comment.area})` : ''}:} ${comment.text}`)
      out.push('')
      if (item === undefined) {
        out.push('\\noindent \\emph{(not yet answered)}')
        out.push('')
        continue
      }
      out.push(`\\noindent \\textbf{Response:} ${item.response}`)
      out.push('')
      for (const change of item.changes) {
        const diff = diffs[change.snapshotId]
        const file = diff?.files.find(candidate => candidate.path === change.file)
        const evidence = hunkEvidence(file, change.hunkIndex)
        out.push(`\\noindent \\textbf{Change:} \\texttt{${change.file}} ${evidence.where} @ snapshot \\texttt{${change.snapshotId}}.`)
        if (evidence.lines.length > 0) {
          out.push('\\begin{verbatim}')
          for (const line of evidence.lines) out.push(line)
          out.push('\\end{verbatim}')
        }
      }
    }
  }
  return out.join('\n')
}
