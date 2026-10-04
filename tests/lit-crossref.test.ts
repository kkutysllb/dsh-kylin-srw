/** Task 2.4：Crossref 归一化与 URL（fixture，无真网）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCrossrefWork, resolveDoiUrl, searchCrossrefUrl } from '../src/literature/crossref.ts'
import { ServiceError } from '../src/service.ts'

const fixturePath = join(new URL('..', import.meta.url).pathname, 'tests', 'fixtures', 'crossref-works.json')

test('crossref：fixture work → 归一化条目（family 名/issued 年月日补全/venue）', async () => {
  const envelope = JSON.parse(await readFile(fixturePath, 'utf8')) as { message: { items: Record<string, unknown>[] } }
  const items = envelope.message.items.map(parseCrossrefWork)
  assert.equal(items.length, 2)

  const [first, second] = items
  assert.equal(first?.identity.doi, '10.1145/3568000.x')
  assert.equal(first?.identity.title, 'Attention Is Revisited, Again: A Survey')
  assert.equal(first?.identity.year, 2023)
  assert.deepEqual(first?.authors, ['Delta', 'Evan Epsilon Org'])
  assert.equal(first?.venue, 'ACM Journal of Surveys')
  assert.equal(first?.publishedAt, '2023-11-02')

  // 只有年的 issued：月日补 01；无 author 字段 → 空数组
  assert.equal(second?.identity.year, 2021)
  assert.equal(second?.publishedAt, '2021-01-01')
  assert.deepEqual(second?.authors, [])
  assert.equal(second?.venue, '')
})

test('crossref：URL——rows 钳制、mailto 礼貌参数、DOI 编码', () => {
  const search = searchCrossrefUrl('attention survey', 500, 'lab@example.org')
  assert.equal(search.searchParams.get('rows'), '100')
  assert.equal(search.searchParams.get('mailto'), 'lab@example.org')
  assert.equal(search.searchParams.get('query'), 'attention survey')
  // 无 mailto：参数缺席（仍然可用，非礼貌池）
  assert.equal(searchCrossrefUrl('x', 5).searchParams.get('mailto'), null)
  assert.throws(() => searchCrossrefUrl('', 5), ServiceError)

  const doi = resolveDoiUrl('10.1145/3568000.X', 'lab@example.org')
  assert.equal(doi.pathname, '/works/10.1145%2F3568000.X')
  assert.equal(doi.searchParams.get('mailto'), 'lab@example.org')
  // doi.org 前缀剥离
  assert.equal(resolveDoiUrl('https://doi.org/10.1/x').pathname, '/works/10.1%2Fx')
  assert.throws(() => resolveDoiUrl(' '), ServiceError)
})
