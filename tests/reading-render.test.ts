/** render + verify 往返（0205 Task 4.6）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePaper, renderPaperWithSources } from '../src/reading/render.ts'
import { verifyPaper } from '../src/reading/verify.ts'
import { buildSourceMap } from '../src/reading/source-map.ts'
import type { ExtractedBlock } from '../src/reading/extract.ts'

const block = (id: string, text: string, order: number): ExtractedBlock => ({
  id, text, order, page: 1, kind: 'para',
  bbox: { x0: 0, yTop: 0, x1: 0, yBottom: 0 },
  quality: 'ok',
})

function makeMap(): ReturnType<typeof buildSourceMap> {
  return buildSourceMap({
    paperKey: 'test-paper',
    pdfPath: 'a.pdf',
    pdfSha256: 'x',
    blocks: [
      block('p1-b1', 'First paragraph about attention.', 0),
      block('p1-b2', 'Second paragraph about transformers.', 1),
    ],
  })
}

test('render→parse 往返：源文/译文/锚全保留', () => {
  const map = makeMap()
  const markdown = renderPaperWithSources(map, {
    'p1-b1': 'First paragraph about attention.',
    'p1-b2': 'Second paragraph about transformers.',
  }, { 'p1-b1': '关于注意力的第一段。' })
  const parsed = parsePaper(markdown)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0]?.id, 'p1-b1')
  assert.equal(parsed[0]?.sourceText, 'First paragraph about attention.')
  assert.equal(parsed[0]?.translation, '关于注意力的第一段。')
  assert.equal(parsed[1]?.translation, undefined)
  assert.equal(parsed[1]?.kind, 'para')
})

test('verify：全新渲染全绿', () => {
  const map = makeMap()
  const markdown = renderPaperWithSources(map, {
    'p1-b1': 'First paragraph about attention.',
    'p1-b2': 'Second paragraph about transformers.',
  }, { 'p1-b1': '关于注意力的第一段。' })
  const report = verifyPaper(markdown, map)
  assert.deepEqual(report.mismatch, [])
  assert.deepEqual(report.orphan, [])
  assert.deepEqual(report.missing, [])
  assert.equal(report.verified.length, 2)
  assert.equal(report.states['p1-b1'], 'verified')
})

test('verify：手改一个源段 → 该块 mismatch，其余不受影响；译文随便改不触发', () => {
  const map = makeMap()
  const markdown = renderPaperWithSources(map, {
    'p1-b1': 'First paragraph CHANGED by hand.',
    'p1-b2': 'Second paragraph about transformers.',
  }, { 'p1-b2': '用户自己润色过的译文，随便改。' })
  const report = verifyPaper(markdown, map)
  assert.deepEqual(report.mismatch, ['p1-b1'])
  assert.deepEqual(report.verified, ['p1-b2'])
  assert.equal(report.states['p1-b1'], 'mismatch')
})

test('verify：手造 orphan 锚 + 删块 → orphan/missing 各归各类', () => {
  const map = makeMap()
  const markdown = [
    '<!-- srw-paper test-paper -->',
    '',
    '<!-- srw:p1-b1 kind=para -->',
    'First paragraph about attention.',
    '<!-- /srw -->',
    '',
    '<!-- srw:p9-b9 kind=para -->',
    'A block that never existed in the map.',
    '<!-- /srw -->',
  ].join('\n') + '\n'
  const report = verifyPaper(markdown, map)
  assert.deepEqual(report.orphan, ['p9-b9'])
  assert.deepEqual(report.missing, ['p1-b2'])
  assert.equal(report.states['p9-b9'], 'orphan')
})
