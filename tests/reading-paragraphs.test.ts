/** 段落装配（0205 附记三 / 呈现层）：续段合并、句末不并、非正文块阻断、
 * 连字跨块拼接、状态聚合。块级基底层不动——这里只测呈现语义。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleParagraphs, joinTexts, worstState } from '../src/reading/paragraphs.ts'
import type { ParsedBlock } from '../src/reading/render.ts'

function block(id: string, text: string, options: { kind?: string; translation?: string } = {}): ParsedBlock {
  return {
    id,
    ...(options.kind !== undefined ? { kind: options.kind } : {}),
    sourceText: text,
    ...(options.translation !== undefined ? { translation: options.translation } : {}),
  }
}

test('段落装配：前块未收句 → 跨块/跨页续段合并，源文与译文都续拼', () => {
  const paragraphs = assembleParagraphs([
    block('p1-b1', 'We propose a new simple network', { translation: '我们提出一种新的简单网络' }),
    block('p1-b2', 'architecture, the Transformer,', { translation: '架构——Transformer，' }),
    block('p2-b1', 'which we train on the WMT dataset.', { translation: '我们在 WMT 数据集上端到端训练。' }),
  ], {})
  assert.equal(paragraphs.length, 1)
  const p = paragraphs[0]
  assert.ok(p !== undefined, '装配结果非空')
  assert.equal(p.id, 'p1-b1')
  assert.deepEqual(p.blockIds, ['p1-b1', 'p1-b2', 'p2-b1'])
  assert.equal(p.sourceText, 'We propose a new simple network architecture, the Transformer, which we train on the WMT dataset.')
  // 译文续拼：三段都进了同一段，无换行残留
  assert.ok(p.translation?.includes('我们提出一种新的简单网络'))
  assert.ok(p.translation?.includes('我们在 WMT 数据集上端到端训练。'))
  assert.ok(!p.translation?.includes('\n'))
})

test('段落装配：句末标点收尾即断段；标题/图注块阻断合并', () => {
  const paragraphs = assembleParagraphs([
    block('p1-b1', 'The era of attention has begun.'),
    block('p1-b2', 'A brand new sentence starts here.', { translation: '全新的一句从这里开始。' }),
    block('p1-b3', '3.2 Scaled Dot-Product Attention', { kind: 'heading', translation: '3.2 缩放点积注意力' }),
    block('p1-b4', 'We compute the dot products.'),
    block('p1-b5', 'Figure 1: The model architecture.', { kind: 'caption' }),
    block('p1-b6', 'The encoder takes tokens as input.'),
  ], { 'p1-b1': 'verified', 'p1-b2': 'verified' })
  assert.deepEqual(paragraphs.map(p => p.id), ['p1-b1', 'p1-b2', 'p1-b3', 'p1-b4', 'p1-b5', 'p1-b6'])
  assert.equal(paragraphs[2]?.kind, 'heading')
  assert.equal(paragraphs[4]?.kind, 'caption')
})

test('段落装配：跨块行尾连字拼接（taken → taken 形态），CJK 邻接不加空格', () => {
  assert.equal(joinTexts('transforma-', 'tion'), 'transformation')
  assert.equal(joinTexts('之前的中文', '接续不空格'), '之前的中文接续不空格')
  assert.equal(joinTexts('English ends.', 'Next begins'), 'English ends. Next begins')

  const paragraphs = assembleParagraphs([
    block('p1-b1', 'The representation is a linear transforma-'),
    block('p1-b2', 'tion of the input embeddings.'),
  ], {})
  assert.equal(paragraphs[0]?.sourceText, 'The representation is a linear transformation of the input embeddings.')
})

test('段落装配：状态取段内最坏（mismatch > orphan > verified）', () => {
  assert.equal(worstState(['verified', 'verified']), 'verified')
  assert.equal(worstState(['verified', 'mismatch', 'orphan']), 'mismatch')
  assert.equal(worstState(['verified', 'orphan']), 'orphan')

  const paragraphs = assembleParagraphs(
    [block('p1-b1', 'Half of this paragraph is fine', { translation: '这段的前半没问题' }), block('p1-b2', 'but the rest was edited.', { translation: '但后半被改过。' })],
    { 'p1-b1': 'verified', 'p1-b2': 'mismatch' },
  )
  assert.equal(paragraphs.length, 1)
  assert.equal(paragraphs[0]?.state, 'mismatch')
})
