/** 缓存与术语表（0205 Task 4.5）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cacheKeyOf, invalidateAffected, lookup, store } from '../src/reading/cache.ts'
import { affectedBlocks, enforceGlossary, findViolation, glossaryHash, type Glossary } from '../src/reading/glossary.ts'

const glossary: Glossary = { entries: { transformer: '变换器', 'self-attention': '自注意力' } }

test('cache：cacheKey 四元组——任一元变化即不同', () => {
  const base = { target: 'zh', model: 'm1', srcHash: 'h1', glossary }
  const key = cacheKeyOf(base)
  assert.equal(key, cacheKeyOf({ ...base }), '同输入同键（确定性）')
  assert.notEqual(key, cacheKeyOf({ ...base, target: 'en' }))
  assert.notEqual(key, cacheKeyOf({ ...base, model: 'm2' }))
  assert.notEqual(key, cacheKeyOf({ ...base, srcHash: 'h2' }))
  assert.notEqual(key, cacheKeyOf({ ...base, glossary: { entries: { transformer: '变换器' } } }), '术语表变 → 键变')
  assert.equal(glossaryHash(glossary), glossaryHash({ entries: { 'self-attention': '自注意力', transformer: '变换器' } }), '键序无关')
})

test('cache：存取与定向失效——只剔受影响块', () => {
  let cache = { entries: {} as Record<string, { text: string; model: string; at: string }> }
  const k1 = cacheKeyOf({ target: 'zh', model: 'm', srcHash: 'h1', glossary })
  const k2 = cacheKeyOf({ target: 'zh', model: 'm', srcHash: 'h2', glossary })
  cache = store(cache, k1, { text: '译文一', model: 'm', at: 't1' })
  cache = store(cache, k2, { text: '译文二', model: 'm', at: 't2' })
  assert.equal(lookup(cache, k1)?.text, '译文一')
  cache = invalidateAffected(
    cache,
    [{ blockId: 'b1', oldKey: k1 }, { blockId: 'b2', oldKey: k2 }],
    ['b1'], // 只有 b1 的源文含变更术语
  )
  assert.equal(lookup(cache, k1), undefined, '受影响块失效')
  assert.equal(lookup(cache, k2)?.text, '译文二', '未受影响块保留')
})

test('glossary：译后硬约束——违规检出与替换（拉丁词边界 / CJK 直查）', () => {
  const check = enforceGlossary('The 变换器 architecture uses self-attention layers.', glossary)
  assert.deepEqual(check.violations, ['self-attention'], '只报英文原文残留的术语')
  // 构造真违规：译文里留了英文原文
  const violating = enforceGlossary('The transformer architecture uses self-attention layers.', glossary)
  assert.deepEqual([...violating.violations].sort(), ['self-attention', 'transformer'])
  assert.equal(violating.repaired, 'The 变换器 architecture uses 自注意力 layers.', '替换为指定译名')
  assert.equal(findViolation('使用了变换器', 'transformer'), false)
  assert.equal(findViolation('使用了 transformer', 'transformer'), true)
  assert.equal(enforceGlossary('纯中文译文', glossary).violations.length, 0)
  // report-only 模式不改写
  const reportOnly = enforceGlossary('the transformer', glossary, false)
  assert.equal(reportOnly.repaired, 'the transformer')
  assert.equal(reportOnly.violations.length, 1)
})

test('glossary：affectedBlocks——变更术语只圈相关块', () => {
  const blocks = [
    { id: 'b1', srcText: 'The transformer model is great.' },
    { id: 'b2', srcText: 'Plain paragraph without any terms.' },
    { id: 'b3', srcText: 'Self-Attention revisited.' },
  ]
  assert.deepEqual(affectedBlocks(blocks, ['transformer']), ['b1'])
  assert.deepEqual([...affectedBlocks(blocks, ['self-attention', 'transformer'])].sort(), ['b1', 'b3'])
  assert.deepEqual(affectedBlocks(blocks, ['nonexistent']), [])
})
