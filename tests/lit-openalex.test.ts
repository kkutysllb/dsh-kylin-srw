/** Task 2.3：OpenAlex 页解析与 URL 构造（fixture，无真网）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodePath from 'node:path'
import {
  abstractFromInvertedIndex,
  OPENALEX_PER_PAGE_MAX,
  parseOpenAlexResults,
  searchOpenAlexUrl,
  stripDoiPrefix,
  stripOpenAlexIdPrefix,
} from '../src/literature/openalex.ts'
import { LibraryStore } from '../src/literature/library.ts'
import type { LitCandidate } from '../src/literature/types.ts'
import { ServiceError } from '../src/service.ts'

const fixturePath = join(new URL('..', import.meta.url).pathname, 'tests', 'fixtures', 'openalex-page.json')

/** LibraryStore 护栏用的最小宿主 fs（与 lit-library.test.ts 同形）。 */
const fsLike = {
  resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
  contains: (parent: { key: string }, child: { key: string }) => {
    const p = nodePath.resolve(parent.key)
    const c = nodePath.resolve(child.key)
    return c === p || c.startsWith(`${p}/`)
  },
}

test('openalex：fixture 页 → 归一化条目（doi 剥前缀/OA 链接/venue/引用数）', async () => {
  const page = JSON.parse(await readFile(fixturePath, 'utf8')) as { results: unknown[] }
  const items = parseOpenAlexResults(page.results)
  assert.equal(items.length, 2)

  const [first, second] = items
  assert.equal(first?.source, 'openalex')
  assert.equal(first?.identity.doi, '10.1145/3568000.x')
  assert.equal(first?.identity.title, 'Attention Is Revisited, Again')
  assert.equal(first?.identity.year, 2023)
  assert.deepEqual(first?.authors, ['Dana Delta', 'Evan Epsilon'])
  assert.equal(first?.venue, 'Journal of Surveys')
  assert.equal(first?.oaUrl, 'https://example.org/oa/attention')
  assert.equal(first?.pdfUrl, 'https://example.org/oa/attention.pdf')
  assert.equal(first?.citedByCount, 42)
  assert.equal(first?.publishedAt, '2023-11-02')
  // P0-4：真实 API 只有 abstract_inverted_index，按 position 还原（fixture 键序故意乱）
  assert.equal(first?.abstract, 'We revisit attention mechanisms')
  assert.equal(first?.openalexId, 'W123')
  assert.equal(first?.retracted, false)

  // 缺失字段缺省：无 doi、无 venue、无 OA、作者空
  assert.equal(second?.identity.doi, undefined)
  assert.equal(second?.venue, '')
  assert.equal(second?.oaUrl, undefined)
  assert.equal(second?.pdfUrl, undefined)
  assert.deepEqual(second?.authors, [])
  // 第二条：空 inverted index → 空摘要；is_retracted=true 透传
  assert.equal(second?.abstract, '')
  assert.equal(second?.openalexId, 'W456')
  assert.equal(second?.retracted, true)
})

test('openalex：abstract 明文优先；inverted index 按 position 还原；坏形状不抛', () => {
  const [plain] = parseOpenAlexResults([{
    display_name: 'T',
    publication_year: 2024,
    abstract: 'Plain abstract wins',
    abstract_inverted_index: { ignored: [0] },
  }])
  assert.equal(plain?.abstract, 'Plain abstract wins', 'abstract 非空时优先于 inverted index')

  const [restored] = parseOpenAlexResults([{
    display_name: 'T',
    publication_year: 2024,
    abstract_inverted_index: { mechanisms: [3], We: [0], revisit: [1], attention: [2] },
  }])
  assert.equal(restored?.abstract, 'We revisit attention mechanisms')

  // helper 直接面：空对象 → 空串；裸 id 原样保留
  assert.equal(abstractFromInvertedIndex({}), '')
  assert.equal(stripOpenAlexIdPrefix('W789'), 'W789')
  assert.equal(stripOpenAlexIdPrefix('https://openalex.org/W789'), 'W789')

  // null/字符串/数字/数组/坏位置全部容忍（不得抛）
  for (const bad of [null, undefined, 'oops', 42, [], { a: 'not-an-array' }, { a: [null, '1', 1.5, -2] }]) {
    const [item] = parseOpenAlexResults([{ display_name: 'T', publication_year: 2024, abstract_inverted_index: bad }])
    assert.equal(item?.abstract, '', `坏形状 ${JSON.stringify(bad)} 应得空摘要`)
  }
})

test('openalex→library：openalexId 落库；is_retracted=true 的新条目直接 status=retracted', async () => {
  const page = JSON.parse(await readFile(fixturePath, 'utf8')) as { results: unknown[] }
  const items = parseOpenAlexResults(page.results)
  const root = await mkdtemp(join(tmpdir(), 'srw-oa-lib-'))
  try {
    const store = new LibraryStore(root, fsLike)
    const { doc } = await store.upsert('proj', items)
    const entries = Object.values(doc.entries)
    const first = entries.find(entry => entry.identity.doi === '10.1145/3568000.x')
    assert.ok(first !== undefined, '第一条应入库')
    assert.equal(first.openalexId, 'W123')
    assert.equal(first.retracted, false)
    assert.equal(first.status, 'unread')
    const second = entries.find(entry => entry.identity.title === 'No DOI Anywhere')
    assert.ok(second !== undefined, '第二条应入库')
    assert.equal(second.openalexId, 'W456')
    assert.equal(second.retracted, true)
    assert.equal(second.status, 'retracted')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('openalex→library：重复入库补全 openalexId；撤稿信号把 has-pdf 升级为 retracted（只升级不降级）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-oa-lib-'))
  try {
    const store = new LibraryStore(root, fsLike)
    const arxiv: LitCandidate = {
      source: 'arxiv',
      identity: { doi: '10.1145/3568000.x', title: 'Attention Is Revisited, Again', year: 2023 },
      authors: ['Dana Delta'],
      venue: '',
      abstract: '',
    }
    const first = await store.upsert('proj', [arxiv])
    const key = Object.keys(first.doc.entries)[0]!
    await store.updateEntry('proj', key, entry => ({ ...entry, status: 'has-pdf' }))

    const [retracting] = parseOpenAlexResults([{
      id: 'https://openalex.org/W999',
      doi: 'https://doi.org/10.1145/3568000.X',
      display_name: 'Attention Is Revisited, Again',
      publication_year: 2023,
      is_retracted: true,
    }])
    assert.ok(retracting !== undefined)
    const second = await store.upsert('proj', [retracting])
    assert.equal(second.added, 0, '同文应判重复')
    const upgraded = second.doc.entries[key]!
    assert.equal(upgraded.openalexId, 'W999', '重复候选应补全 openalexId')
    assert.equal(upgraded.retracted, true)
    assert.equal(upgraded.status, 'retracted', '撤稿优先于 has-pdf')

    // 后续 is_retracted=false 的重复候选不得把已撤稿条目改回
    const [clean] = parseOpenAlexResults([{
      id: 'https://openalex.org/W999',
      doi: 'https://doi.org/10.1145/3568000.X',
      display_name: 'Attention Is Revisited, Again',
      publication_year: 2023,
      is_retracted: false,
    }])
    assert.ok(clean !== undefined)
    const third = await store.upsert('proj', [clean])
    const after = third.doc.entries[key]!
    assert.equal(after.retracted, true, '撤稿标记只升级不降级')
    assert.equal(after.status, 'retracted')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('openalex：URL 构造——per_page 钳 ≤100、cursor 携带、空查询拒绝', () => {
  const url = searchOpenAlexUrl('transformer survey', 500, 'IzAzOQ==')
  assert.equal(url.searchParams.get('search'), 'transformer survey')
  assert.equal(url.searchParams.get('per_page'), String(OPENALEX_PER_PAGE_MAX))
  assert.equal(url.searchParams.get('cursor'), 'IzAzOQ==')
  assert.equal(searchOpenAlexUrl('x', 0).searchParams.get('per_page'), '1')
  assert.throws(() => searchOpenAlexUrl(' ', 10), ServiceError)
  // doi 前缀剥离大小写不敏感
  assert.equal(stripDoiPrefix('https://DOI.org/10.1/X'), '10.1/x')
})
