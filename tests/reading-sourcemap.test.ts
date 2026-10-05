/** source_map：归一/哈希/构建/块迁移（0205 Task 4.3）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSourceMap, migrateBlocks, normalizeSrc, srcHashOf, type SourceMap } from '../src/reading/source-map.ts'
import type { ExtractedBlock } from '../src/reading/extract.ts'

const block = (overrides: Partial<ExtractedBlock> & { id: string; text: string }): ExtractedBlock => ({
  page: 1,
  kind: 'para',
  order: 0,
  bbox: { x0: 0, yTop: 0, x1: 0, yBottom: 0 },
  quality: 'ok',
  ...overrides,
})

test('sourcemap：归一——连字断行合并、NFKC、统一连字符、折叠空白', () => {
  assert.equal(normalizeSrc('foo-\nbar'), 'foobar')
  assert.equal(normalizeSrc('a\u2013b   c'), 'a-b c')
  assert.equal(normalizeSrc('  x \n\n y  '), 'x y')
  assert.equal(normalizeSrc('ａｂｃ'), 'abc', 'NFKC 折叠全角')
  assert.equal(srcHashOf('foo-\nbar'), srcHashOf('foobar'), '重抽后同一物理文本同哈希')
  assert.notEqual(srcHashOf('foo bar'), srcHashOf('foo  bar').slice(0, 8) + 'x')
})

test('sourcemap：构建——id/order/srcHash/chars/pages', () => {
  const map = buildSourceMap({
    paperKey: 'vaswani2017-attention',
    pdfPath: 'literature/pdf/a.pdf',
    pdfSha256: 'deadbeef',
    blocks: [
      block({ id: 'p1-b1', text: 'Hello world', order: 0, page: 1 }),
      block({ id: 'p2-b1', text: 'Second page block', order: 1, page: 2, quality: 'suspicious' }),
    ],
  })
  assert.equal(map.schemaVersion, 1)
  assert.equal(map.source.pages, 2)
  assert.equal(map.blocks[0]?.srcHash, srcHashOf('Hello world'))
  assert.equal(map.blocks[1]?.chars, 'Second page block'.length)
  assert.equal(map.blocks[1]?.quality, 'suspicious')
})

test('sourcemap：迁移——同哈希带走译文元数据，新块 fresh，失踪旧块进 orphans', () => {
  const old = buildSourceMap({
    paperKey: 'p',
    pdfPath: 'a.pdf',
    pdfSha256: 'x',
    blocks: [
      block({ id: 'p1-b1', text: 'kept text', order: 0 }),
      block({ id: 'p1-b2', text: 'another kept', order: 1 }),
      block({ id: 'p1-b3', text: 'vanished paragraph', order: 2 }),
    ],
  })
  // 给旧块挂译文
  const withTranslation: SourceMap = {
    ...old,
    blocks: old.blocks.map(item => item.id === 'p1-b1'
      ? { ...item, translation: { target: 'zh', model: 'm', at: 't', cacheKey: 'k' } }
      : item),
  }
  const report = migrateBlocks(withTranslation, [
    // 切分版本变了：'kept text' 被切成两块——前半同哈希救回，后半全新
    block({ id: 'p1-b1', text: 'kept text', order: 0 }),
    block({ id: 'p1-b2', text: 'totally new content here', order: 1 }),
    block({ id: 'p1-b3', text: 'another kept', order: 2 }),
  ])
  assert.equal(report.migrated, 2)
  assert.equal(report.fresh, 1)
  assert.equal(report.orphans.length, 1)
  assert.equal(report.orphans[0]?.text ?? report.orphans[0]?.id, 'p1-b3', '失踪旧块是 vanished')
  const kept = report.blocks.find(item => item.srcHash === srcHashOf('kept text'))
  assert.equal(kept?.translation?.target, 'zh', '救回的块带走译文元数据')
  const fresh = report.blocks.find(item => item.srcHash === srcHashOf('totally new content here'))
  assert.equal(fresh?.translation, undefined)
})

test('sourcemap：迁移——重复哈希按序一一配对，不双倍认领', () => {
  const old = buildSourceMap({
    paperKey: 'p', pdfPath: 'a', pdfSha256: 'x',
    blocks: [block({ id: 'p1-b1', text: 'dup', order: 0 })],
  })
  const report = migrateBlocks(old, [
    block({ id: 'p1-b1', text: 'dup', order: 0 }),
    block({ id: 'p1-b2', text: 'dup', order: 1 }),
  ])
  assert.equal(report.migrated, 1, '只有一个旧块可认领')
  assert.equal(report.fresh, 1)
  assert.equal(report.orphans.length, 0)
})
