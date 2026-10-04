/** Task 2.2：arXiv Atom 解析与 URL 构造（fixture，无真网）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  arxivIdFromUrl,
  arxivQueryField,
  chunkIds,
  fetchByIdsUrl,
  forceHttps,
  parseArxivAtom,
  searchArxivUrl,
  ARXIV_ID_BATCH,
} from '../src/literature/arxiv.ts'
import { ServiceError } from '../src/service.ts'

const fixturePath = join(new URL('..', import.meta.url).pathname, 'tests', 'fixtures', 'arxiv-atom.xml')

test('arxiv：fixture Atom → 归一化条目（多作者/doi/pdf/版本号/空白折叠）', async () => {
  const xml = await readFile(fixturePath, 'utf8')
  const items = parseArxivAtom(xml)
  assert.equal(items.length, 2)

  const [first, second] = items
  assert.equal(first?.identity.arxivId, '2401.12345v2')
  assert.equal(first?.identity.title, 'A Survey of Electron & Photon Methods')
  assert.equal(first?.identity.year, 2024)
  assert.equal(first?.identity.doi, '10.48550/arxiv.2401.12345')
  assert.deepEqual(first?.authors, ['Alice Alpha', 'Bob Beta'])
  assert.equal(first?.venue, 'arXiv')
  assert.equal(first?.publishedAt, '2024-01-15T00:00:00Z')
  assert.equal(first?.updatedAt, '2024-02-01T00:00:00Z')
  // 摘要多行空白折叠 + 实体解码
  assert.equal(first?.abstract, 'We survey electron methods with irregular spacing.')
  // pdf 链接升级 https
  assert.equal(first?.pdfUrl, 'https://arxiv.org/pdf/2401.12345v2')

  // 最小条目：无 doi / 无 pdf 链接 → 字段缺省而非空串
  assert.equal(second?.identity.arxivId, '2312.99999v1')
  assert.equal(second?.identity.doi, undefined)
  assert.equal(second?.pdfUrl, undefined)
  assert.deepEqual(second?.authors, ['Carol Gamma'])
})

test('arxiv：id 提取与 https 强制', () => {
  assert.equal(arxivIdFromUrl('http://arxiv.org/abs/2401.12345v2'), '2401.12345v2')
  assert.equal(arxivIdFromUrl('https://arxiv.org/abs/2401.12345'), '2401.12345')
  // 旧式分类 id（cond-mat/0703123）
  assert.equal(arxivIdFromUrl('http://arxiv.org/abs/cond-mat/0703123v1'), 'cond-mat/0703123v1')
  assert.throws(() => arxivIdFromUrl('http://arxiv.org/abs/not-an-id'), ServiceError)
  assert.equal(forceHttps('http://arxiv.org/pdf/x'), 'https://arxiv.org/pdf/x')
  assert.equal(forceHttps('https://arxiv.org/pdf/x'), 'https://arxiv.org/pdf/x')
})

test('arxiv：URL 构造——all: 前缀、字段透传、limit 钳制、id_list 分片', () => {
  const s1 = searchArxivUrl('electron microscopy', 20)
  assert.equal(s1.searchParams.get('search_query'), 'all:"electron microscopy"')
  assert.equal(s1.searchParams.get('max_results'), '20')
  // 字段前缀 + 空格短语 → 整体加引号（裸空格在 arXiv 返回 0 条——真网实测）
  const s2 = searchArxivUrl('ti:attention is all you need', 5)
  assert.equal(s2.searchParams.get('search_query'), 'ti:"attention is all you need"')
  // AND 连接词保留：逐子句加引号
  const s3 = searchArxivUrl('ti:electron AND au:hase', 5)
  assert.equal(s3.searchParams.get('search_query'), 'ti:"electron" AND au:"hase"')
  // 已带引号原样
  const s4 = searchArxivUrl('ti:"exact phrase"', 5)
  assert.equal(s4.searchParams.get('search_query'), 'ti:"exact phrase"')
  // limit 钳制
  assert.equal(searchArxivUrl('x', 999).searchParams.get('max_results'), '200')
  assert.equal(searchArxivUrl('x', 0).searchParams.get('max_results'), '1')
  // 空查询拒绝
  assert.throws(() => searchArxivUrl('  ', 10), ServiceError)
  // id_list
  const batch = fetchByIdsUrl(['2401.12345v2', '2312.99999v1'])
  assert.equal(batch.searchParams.get('id_list'), '2401.12345v2,2312.99999v1')
  assert.throws(() => fetchByIdsUrl([]), ServiceError)
  assert.throws(() => fetchByIdsUrl(Array.from({ length: ARXIV_ID_BATCH + 1 }, (_, i) => `2401.${String(i).padStart(5, '0')}v1`)), ServiceError)
  // 分片
  const ids = Array.from({ length: ARXIV_ID_BATCH + 7 }, (_, i) => `id${i}`)
  const chunks = chunkIds(ids)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0]?.length, ARXIV_ID_BATCH)
  assert.equal(chunks[1]?.length, 7)
})
