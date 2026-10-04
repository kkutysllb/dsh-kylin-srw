/** Task 2.5：三级身份 fallback 与批内合并去重。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { identityKey, mergeInto, normalizeTitle } from '../src/literature/identity.ts'
import type { LitCandidate } from '../src/literature/types.ts'

function candidate(over: Partial<LitCandidate>): LitCandidate {
  const identity = { title: 'Some Title', year: 2024, ...(over.identity ?? {}) }
  return {
    source: 'arxiv',
    authors: [],
    venue: '',
    abstract: '',
    ...over,
    identity,
  }
}

test('identity：三级 fallback——DOI 优先、arXiv 次之（归并版本）、title+year 兜底', () => {
  const doi = identityKey({ doi: '10.1145/X', arxivId: '2401.1v2', title: 'T', year: 2024 })
  const doiLower = identityKey({ doi: '10.1145/x', title: 'T', year: 9999 })
  assert.equal(doi, doiLower) // DOI 小写归一，级高于 arXiv/标题

  const v1 = identityKey({ arxivId: '2401.12345v1', title: 'A', year: 1 })
  const v2 = identityKey({ arxivId: '2401.12345v2', title: 'B', year: 2 })
  assert.equal(v1, v2) // 版本号归并

  const t1 = identityKey({ title: 'Attention Is  Revisited!', year: 2023 })
  const t2 = identityKey({ title: 'attention is revisited', year: 2023 })
  assert.equal(t1, t2) // 标题归一 + 年
  assert.notEqual(t1, identityKey({ title: 'attention is revisited', year: 2024 }))
  assert.match(t1, /^title:[0-9a-f]{16}:2023$/)
})

test('identity：同文三路命中只留一条 + seenIn 累积；与库内重复判 duplicate', () => {
  const arxiv = candidate({
    source: 'arxiv',
    identity: { arxivId: '2401.12345v2', doi: '10.1/a', title: 'Electron Survey', year: 2024 },
    abstract: 'rich abstract',
    pdfUrl: 'https://arxiv.org/pdf/x',
    authors: ['A'],
  })
  const openalex = candidate({
    source: 'openalex',
    identity: { doi: '10.1/A', title: 'Electron Survey', year: 2024 },
    venue: 'Journal',
    citedByCount: 10,
  })
  const crossref = candidate({
    source: 'crossref',
    identity: { doi: '10.1/a', title: 'Electron  Survey', year: 2024 },
    venue: 'Other Journal',
  })

  const report = mergeInto([arxiv, openalex, crossref])
  assert.equal(report.fresh.length, 1)
  const merged = report.fresh[0]
  assert.deepEqual([...merged?.seenIn ?? []].sort(), ['arxiv', 'crossref', 'openalex'])
  // 信息量择优：abstract+pdf 的 arxiv 胜出，但 venue 缺失——merged 保留 arxiv 的身份与摘要
  assert.equal(merged?.abstract, 'rich abstract')
  assert.equal(merged?.pdfUrl, 'https://arxiv.org/pdf/x')
  // 已在库：duplicate 且不进 fresh
  const withExisting = mergeInto([arxiv], [{ identity: { doi: '10.1/a', title: 'x', year: 1 }, seenIn: [] }])
  assert.equal(withExisting.fresh.length, 0)
  assert.match(withExisting.verdicts[0]?.verdict ?? '', /^duplicate:doi:/)
  // 批内纯重复
  assert.equal(mergeInto([arxiv, arxiv]).fresh.length, 1)
})

test('identity：normalizeTitle 去标点/折叠空白/NFKC', () => {
  assert.equal(normalizeTitle('A—B  C!'), 'ab c')
  assert.equal(normalizeTitle('Ａｔｔｅｎｔｉｏｎ'), 'attention')
})
