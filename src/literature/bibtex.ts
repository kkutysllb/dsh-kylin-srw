/** BibTeX 生成与追加（0203 Task 2.8）：citekey 确定性公式
 * `<首作者姓><年>-<首标题词>`（CJK 标题退化 `key<年>`）；冲突自动 -2/-3
 * 后缀；追加按 key 去重；LaTeX 特殊字符转义。 */

import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { ServiceError } from '../service.ts'
import { normalizeTitle } from './identity.ts'
import type { LitEntry } from './library.ts'

/** 首标题词（拉丁词；CJK 标题无词 → undefined）。 */
function firstTitleWord(title: string): string | undefined {
  const word = normalizeTitle(title).split(' ').find(part => /^[a-z]{3,}$/.test(part))
  return word
}

function firstAuthorSurname(entry: LitEntry): string {
  const name = entry.authors[0] ?? ''
  // Western: 最后一个空格段是姓（"Alice Alpha" → alpha）；CJK/单名：整体
  const parts = name.trim().split(/\s+/)
  const surname = parts.length > 1 ? parts[parts.length - 1] : parts[0]
  const ascii = (surname ?? 'unknown').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')
  return ascii === '' ? 'unknown' : ascii
}

/** citekey 确定性：同一条目两次生成必同 key。 */
export function citekeyOf(entry: LitEntry): string {
  const year = entry.identity.year > 0 ? String(entry.identity.year) : 'nd'
  const word = firstTitleWord(entry.identity.title)
  const head = word ?? (entry.identity.title.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12) || 'key')
  return `${firstAuthorSurname(entry)}${year}-${head}`
}

/** LaTeX 特殊字符转义（正文字段用）。 */
export function escapeLatex(text: string): string {
  return text
    .replaceAll('\\', '\\textbackslash{}')
    .replaceAll('&', '\\&')
    .replaceAll('%', '\\%')
    .replaceAll('#', '\\#')
    .replaceAll('_', '\\_')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('~', '\\textasciitilde{}')
    .replaceAll('^', '\\textasciicircum{}')
}

function authorField(entry: LitEntry): string {
  return entry.authors.map(escapeLatex).join(' and ')
}

/** 生成单条 @article/@inproceedings/@misc。 */
export function toBibtex(entry: LitEntry, citekey: string): string {
  const isProceedings = entry.venue.toLowerCase().includes('proceedings')
    || entry.venue.toLowerCase().includes('conference')
  const kind = isProceedings ? 'inproceedings' : (entry.venue === 'arXiv' || entry.venue === '' ? 'misc' : 'article')
  const lines = [
    `@${kind}{${citekey},`,
    `  title = {${escapeLatex(entry.identity.title)}},`,
    `  author = {${authorField(entry)}},`,
    `  year = {${entry.identity.year > 0 ? entry.identity.year : 'no date'}},`,
  ]
  if (entry.venue !== '' && kind !== 'misc') lines.push(`  venue = {${escapeLatex(entry.venue)}},`)
  if (entry.identity.doi !== undefined) lines.push(`  doi = {${entry.identity.doi}},`)
  const url = entry.pdfUrl ?? entry.oaUrl
  if (url !== undefined) lines.push(`  url = {${url}},`)
  lines.push('}')
  return lines.join('\n')
}

/** 现有 .bib 的 key 集合（正则粗扫 @type{key,）。 */
export function extractCitekeys(bib: string): Set<string> {
  const keys = new Set<string>()
  for (const match of bib.matchAll(/@\w+\s*{\s*([^,\s]+)\s*,/g)) {
    const key = match[1]
    if (key !== undefined) keys.add(key)
  }
  return keys
}

export interface AppendResult {
  readonly added: readonly string[]
  readonly skipped: number
}

/** 追加到 refs.bib（原子写）。
 * - `.bib` 已有同 key → 视为已存在，跳过（追加按 key 去重）；
 * - 批内 citekey 冲突（不同条目同公式键）→ `-2/-3` 确定性后缀，照常追加。
 * 返回新增 key 与跳过数。 */
export async function appendToRefs(
  refsPath: string,
  entries: readonly LitEntry[],
): Promise<AppendResult> {
  let existing = ''
  try {
    existing = await readFile(refsPath, 'utf8')
  } catch { /* 首写 */ }
  const keys = extractCitekeys(existing)
  const used = new Set(keys)
  const blocks: string[] = []
  const added: string[] = []
  let skipped = 0
  for (const entry of entries) {
    const base = citekeyOf(entry)
    if (keys.has(base)) {
      skipped += 1
      continue
    }
    let citekey = base
    let n = 2
    while (used.has(citekey)) {
      citekey = `${base}-${n}`
      n += 1
    }
    used.add(citekey)
    blocks.push(toBibtex(entry, citekey))
    added.push(citekey)
  }
  if (blocks.length > 0) {
    const tmp = `${refsPath}.tmp-${process.pid}-${Date.now().toString(36)}`
    try {
      await writeFile(tmp, `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}\n${blocks.join('\n\n')}\n`)
      await rename(tmp, refsPath)
    } catch (error: unknown) {
      await rm(tmp, { force: true }).catch(() => {})
      throw error
    }
  }
  return { added, skipped }
}

/** 库条目 → citekey 的批量视图（视图层导出前展示）。 */
export function citekeysFor(entries: readonly LitEntry[]): readonly { readonly key: string; readonly citekey: string }[] {
  return entries.map(entry => ({ key: entry.key, citekey: citekeyOf(entry) }))
}

/** 断言 key 属于库（导出单条用）。 */
export function entryOrThrow(entries: Record<string, LitEntry>, key: string): LitEntry {
  const entry = entries[key]
  if (entry === undefined) throw new ServiceError('NOT_FOUND', `条目不存在：${key}`)
  return entry
}
