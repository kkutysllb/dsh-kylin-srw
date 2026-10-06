/** 引用审计（Task 5.5）：`\cite`/`\nocite` vs refs.bib 差集。纯函数；
 * BibTeX 渲染复用 literature 的 toBibtex（refsAppend 由服务层接文献库）。 */

import { extractCitekeys } from '../literature/bibtex.ts'

/** 提取正文引用 key（`\cite{a,b}` / `\cite[p.5]{a}` / `\nocite{c}`；
 * `\nocite{*}` 记为 '*'——表示「全部入库」，审计单独提示）。 */
export function extractCiteKeys(tex: string): { keys: string[]; nociteAll: boolean } {
  const keys: string[] = []
  let nociteAll = false
  for (const match of tex.matchAll(/\\(cite|nocite)\*?(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
    const command = match[1] ?? 'cite'
    const body = match[2] ?? ''
    if (command === 'nocite' && body.trim() === '*') {
      nociteAll = true
      continue
    }
    for (const raw of body.split(',')) {
      const key = raw.trim()
      if (key !== '') keys.push(key)
    }
  }
  return { keys: [...new Set(keys)], nociteAll }
}

export interface CiteAudit {
  /** 正文引了但 refs.bib 没有 → 编译会出现 ? 引用。 */
  readonly missing: readonly string[]
  /** refs.bib 有但正文没引（提示不报错——投稿前可清）。 */
  readonly unused: readonly string[]
  readonly nociteAll: boolean
}

export function auditCites(texFiles: readonly { readonly name: string; readonly text: string }[], bib: string): CiteAudit {
  const cited = new Set<string>()
  let nociteAll = false
  for (const file of texFiles) {
    const extracted = extractCiteKeys(file.text)
    for (const key of extracted.keys) cited.add(key)
    if (extracted.nociteAll) nociteAll = true
  }
  const bibKeys = extractCitekeys(bib)
  const missing = [...cited].filter(key => !bibKeys.has(key)).sort()
  const unused = [...bibKeys].filter(key => !cited.has(key)).sort()
  return { missing, unused, nociteAll }
}
