/** Task 2.5：三级身份 fallback 与批内合并去重。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { identityKey, mergeInto, normalizeIdentity, normalizeTitle, sameWork } from '../src/literature/identity.ts'
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

test('identity：三级 fallback——DOI 优先、arXiv 次之（归并版本）、title 弱键（不含 year）兜底', () => {
  const doi = identityKey({ doi: '10.1145/X', arxivId: '2401.1v2', title: 'T', year: 2024 })
  const doiLower = identityKey({ doi: '10.1145/x', title: 'T', year: 9999 })
  assert.equal(doi, doiLower) // DOI 小写归一，级高于 arXiv/标题

  const v1 = identityKey({ arxivId: '2401.12345v1', title: 'A', year: 1 })
  const v2 = identityKey({ arxivId: '2401.12345v2', title: 'B', year: 2 })
  assert.equal(v1, v2) // 版本号归并

  const t1 = identityKey({ title: 'Attention Is  Revisited!', year: 2023 })
  const t2 = identityKey({ title: 'attention is revisited', year: 2023 })
  assert.equal(t1, t2) // 标题归一
  // P0-3：title 键不再含 year——year 漂移/为 0 都同键（同不同文交给 merge 守卫）
  assert.equal(t1, identityKey({ title: 'attention is revisited', year: 2024 }))
  assert.equal(t1, identityKey({ title: 'attention is revisited', year: 0 }))
  assert.match(t1, /^title:[0-9a-f]{16}$/)
})

test('identity：P0-3 弱键合并守卫——作者任一重合 / year 差≤1 / venue 相同才判同文', () => {
  const base = { title: 'Same Title', year: 2020 }
  // 作者全名重合（不同 year、不同 venue）
  assert.equal(sameWork(
    { identity: base, authors: ['Ada Lovelace'], venue: 'A' },
    { identity: { ...base, year: 2010 }, authors: ['Ada Lovelace'], venue: 'B' },
  ), true)
  // Crossref 只留 family vs arXiv 全名：姓相同即可
  assert.equal(sameWork(
    { identity: base, authors: ['Lovelace'], venue: 'A' },
    { identity: { ...base, year: 2010 }, authors: ['Ada Lovelace'], venue: 'B' },
  ), true)
  // year 差 ≤1
  assert.equal(sameWork({ identity: base, authors: [], venue: '' }, { identity: { ...base, year: 2021 }, authors: [], venue: '' }), true)
  // venue 相同（case/标点归一）
  assert.equal(sameWork(
    { identity: base, authors: [], venue: 'Journal of Testing' },
    { identity: { ...base, year: 2010 }, authors: [], venue: 'journal of testing!' },
  ), true)
  // 三项都不重合 → 不同文
  assert.equal(sameWork(
    { identity: base, authors: ['Ada Lovelace'], venue: 'A' },
    { identity: { ...base, year: 2010 }, authors: ['Grace Hopper'], venue: 'B' },
  ), false)
})

test('identity：P0-3 同题不同文保留两条（不同 key），同文才合并', () => {
  const candidate = (over: {
    year: number
    authors: string[]
    venue: string
    source?: LitCandidate['source']
  }): LitCandidate => ({
    source: over.source ?? 'crossref',
    identity: { title: 'Graph Neural Networks', year: over.year },
    authors: over.authors,
    venue: over.venue,
    abstract: '',
  })
  const oldWork = candidate({ year: 2005, authors: ['Ada Lovelace'], venue: 'Old Journal' })
  const newWork = candidate({ year: 2024, authors: ['Grace Hopper'], venue: 'New Journal' })
  const report = mergeInto([oldWork, newWork])
  assert.equal(report.fresh.length, 2, '守卫失败：同题不同文保留两条')
  assert.equal(new Set(report.fresh.map(item => item.key)).size, 2, '两条必须使用不同库键')
  assert.match(report.fresh[1]?.key ?? '', /^title:[0-9a-f]{16}:[0-9a-f]{8}$/)

  // 同作者 → 合并（year/venue 都不同也判同文）
  const sameAuthor = candidate({ year: 2024, authors: ['Ada Lovelace'], venue: 'New Journal' })
  const merged = mergeInto([oldWork, sameAuthor])
  assert.equal(merged.fresh.length, 1)
  assert.equal(merged.fresh[0]?.seenIn.length, 1)

  // 与库内旧键匹配：同一弱键且守卫通过 → duplicate，不新增
  const existing = [{ key: 'title:deadbeefdeadbeef:2005', identity: oldWork.identity, authors: oldWork.authors, venue: oldWork.venue, seenIn: [] }]
  const duplicate = mergeInto([candidate({ year: 2006, authors: ['Ada Lovelace'], venue: 'X' })], existing)
  assert.equal(duplicate.fresh.length, 0)
  assert.equal(duplicate.verdicts[0]?.key, 'title:deadbeefdeadbeef:2005', '回写实际旧键')
})

test('identity：P0-3 arXiv 自赋 DOI 折叠保留 canonicalDoi（身份键仍归 arxiv）', () => {
  const folded = normalizeIdentity({ doi: '10.48550/arXiv.2606.09498', title: 'Self-Harness', year: 2026 })
  assert.equal(folded.arxivId, '2606.09498')
  assert.equal(folded.doi, undefined)
  assert.equal(folded.canonicalDoi, '10.48550/arXiv.2606.09498')
  assert.equal(identityKey(folded), 'arxiv:2606.09498')
  const again = normalizeIdentity(folded)
  assert.equal(again.canonicalDoi, '10.48550/arXiv.2606.09498', '重复归一不丢 canonicalDoi')
  // 普通 DOI 不折叠、不带 canonicalDoi
  const plain = normalizeIdentity({ doi: '10.1000/other', title: 'X', year: 2024 })
  assert.equal(plain.canonicalDoi, undefined)
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

test('identity：批内同 key 合并保留 openalexId（先有值）与 retracted（OR，只升级不降级）', () => {
  const arxivFull = candidate({
    source: 'arxiv',
    identity: { doi: '10.1/a', title: 'Electron Survey', year: 2024 },
    abstract: 'rich abstract',
    pdfUrl: 'https://arxiv.org/pdf/x',
    authors: ['A'],
  })
  const openalexRetracted = candidate({
    source: 'openalex',
    identity: { doi: '10.1/A', title: 'Electron Survey', year: 2024 },
    openalexId: 'W111',
    retracted: true,
  })

  // arXiv 更完整、先到：OpenAlex 候选落选信息量择优，但撤稿/id 必须保留
  const arxivFirst = mergeInto([arxivFull, openalexRetracted])
  assert.equal(arxivFirst.fresh.length, 1)
  assert.equal(arxivFirst.fresh[0]?.source, 'arxiv')
  assert.equal(arxivFirst.fresh[0]?.abstract, 'rich abstract')
  assert.equal(arxivFirst.fresh[0]?.openalexId, 'W111', '落选候选的 openalexId 不应丢')
  assert.equal(arxivFirst.fresh[0]?.retracted, true, '落选候选的撤稿信号不应丢')

  // OpenAlex 先到、arXiv 后到且更完整：胜出者换成 arXiv，源侧标记仍不丢
  const openalexFirst = mergeInto([openalexRetracted, arxivFull])
  assert.equal(openalexFirst.fresh.length, 1)
  assert.equal(openalexFirst.fresh[0]?.abstract, 'rich abstract')
  assert.equal(openalexFirst.fresh[0]?.openalexId, 'W111')
  assert.equal(openalexFirst.fresh[0]?.retracted, true)

  // 反向 false 不降级；openalexId 保留先有值
  const laterClean = candidate({
    source: 'openalex',
    identity: { doi: '10.1/a', title: 'Electron Survey', year: 2024 },
    openalexId: 'W222',
    retracted: false,
  })
  const keeps = mergeInto([openalexRetracted, laterClean])
  assert.equal(keeps.fresh[0]?.retracted, true, 'false 不得把 true 改回')
  assert.equal(keeps.fresh[0]?.openalexId, 'W111', 'openalexId 取先有值')
})

test('identity：normalizeTitle 去标点/折叠空白/NFKC', () => {
  assert.equal(normalizeTitle('A—B  C!'), 'ab c')
  assert.equal(normalizeTitle('Ａｔｔｅｎｔｉｏｎ'), 'attention')
})
