/** Task 2.3：OpenAlex 页解析与 URL 构造（fixture，无真网）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseOpenAlexResults, searchOpenAlexUrl, stripDoiPrefix, OPENALEX_PER_PAGE_MAX } from '../src/literature/openalex.ts'
import { ServiceError } from '../src/service.ts'

const fixturePath = join(new URL('..', import.meta.url).pathname, 'tests', 'fixtures', 'openalex-page.json')

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

  // 缺失字段缺省：无 doi、无 venue、无 OA、作者空
  assert.equal(second?.identity.doi, undefined)
  assert.equal(second?.venue, '')
  assert.equal(second?.oaUrl, undefined)
  assert.equal(second?.pdfUrl, undefined)
  assert.deepEqual(second?.authors, [])
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
