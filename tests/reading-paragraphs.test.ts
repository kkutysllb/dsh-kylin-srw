/** 段落装配（0205 附记三/四 / 呈现层）：续段合并、句末不并、非正文块阻断、
 * 连字跨块拼接、状态聚合；译注版通道——杂讯/图内碎片/参考文献分流。
 * 块级基底层不动——这里只测呈现语义。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleReading, joinTexts, splitSections, worstState } from '../src/reading/paragraphs.ts'
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
  const { flow } = assembleReading([
    block('p1-b1', 'We propose a new simple network', { translation: '我们提出一种新的简单网络' }),
    block('p1-b2', 'architecture, the Transformer,', { translation: '架构——Transformer，' }),
    block('p2-b1', 'which we train on the WMT dataset.', { translation: '我们在 WMT 数据集上端到端训练。' }),
  ], {})
  assert.equal(flow.length, 1)
  const p = flow[0]
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
  const { flow } = assembleReading([
    block('p1-b1', 'The era of attention has begun.'),
    block('p1-b2', 'A brand new sentence starts here.', { translation: '全新的一句从这里开始。' }),
    block('p1-b3', '3.2 Scaled Dot-Product Attention', { kind: 'heading', translation: '3.2 缩放点积注意力' }),
    block('p1-b4', 'We compute the dot products.'),
    block('p1-b5', 'Figure 1: The model architecture.', { kind: 'caption' }),
    block('p1-b6', 'The encoder takes tokens as input.'),
  ], { 'p1-b1': 'verified', 'p1-b2': 'verified' })
  assert.deepEqual(flow.map(p => p.id), ['p1-b1', 'p1-b2', 'p1-b3', 'p1-b4', 'p1-b5', 'p1-b6'])
  assert.equal(flow[2]?.kind, 'heading')
  assert.equal(flow[4]?.kind, 'caption')
})

test('段落装配：跨块行尾连字拼接（taken → taken 形态），CJK 邻接不加空格', () => {
  assert.equal(joinTexts('transforma-', 'tion'), 'transformation')
  assert.equal(joinTexts('之前的中文', '接续不空格'), '之前的中文接续不空格')
  assert.equal(joinTexts('English ends.', 'Next begins'), 'English ends. Next begins')

  const { flow } = assembleReading([
    block('p1-b1', 'The representation is a linear transforma-'),
    block('p1-b2', 'tion of the input embeddings.'),
  ], {})
  assert.equal(flow[0]?.sourceText, 'The representation is a linear transformation of the input embeddings.')
})

test('段落装配：状态取段内最坏（mismatch > orphan > verified）', () => {
  assert.equal(worstState(['verified', 'verified']), 'verified')
  assert.equal(worstState(['verified', 'mismatch', 'orphan']), 'mismatch')
  assert.equal(worstState(['verified', 'orphan']), 'orphan')

  const { flow } = assembleReading(
    [block('p1-b1', 'Half of this paragraph is fine', { translation: '这段的前半没问题' }), block('p1-b2', 'but the rest was edited.', { translation: '但后半被改过。' })],
    { 'p1-b1': 'verified', 'p1-b2': 'mismatch' },
  )
  assert.equal(flow.length, 1)
  assert.equal(flow[0]?.state, 'mismatch')
})

test('译注版通道：杂讯不进正文流；图内碎片归所属图注；参考文献单独收集', () => {
  const assembled = assembleReading([
    block('p1-b1', 'September, 2026', { kind: 'furniture' }),
    block('p1-b2', 'Attention Is All You Need', { kind: 'title', translation: '注意力就是你所需要的一切' }),
    block('p1-b3', 'Which Cup?', { kind: 'figlabel' }),
    block('p1-b4', 'Block Under', { kind: 'figlabel' }),
    block('p1-b5', 'Figure 1: Which cup is under which block?', { kind: 'caption', translation: '图 1：哪个杯子在哪个积木下面？' }),
    block('p1-b6', 'The body of the paper continues here.', { translation: '正文在这里继续。' }),
    block('p1-b7', 'Vaswani et al. 2017. Attention is all you need.', { kind: 'reference' }),
    block('p1-b8', 'Bahdanau et al. 2015. Neural machine translation.', { kind: 'reference' }),
  ], {})
  // 正文流：只有 title + caption + 正文段；杂讯/碎片/参考文献全部剔除
  assert.deepEqual(assembled.flow.map(p => p.id), ['p1-b2', 'p1-b5', 'p1-b6'])
  // 图内碎片按阅读序归到其后最近的图注
  assert.deepEqual(assembled.figureNotes['p1-b5'], ['Which Cup?', 'Block Under'])
  // 参考文献英文原样保留（未经翻译管道的块 translation 缺席是合法状态）
  assert.deepEqual(assembled.references.map(p => p.id), ['p1-b7', 'p1-b8'])
  assert.equal(assembled.references[0]?.sourceText.includes('Vaswani et al. 2017'), true)
})

test('译注版通道：无后续图注的碎片退给之前最近的图注；没有图注就丢弃', () => {
  const withPrev = assembleReading([
    block('p1-b1', 'Figure 2: A lonely chart.', { kind: 'caption' }),
    block('p1-b2', 'Y axis label', { kind: 'figlabel' }),
  ], {})
  assert.deepEqual(withPrev.figureNotes['p1-b1'], ['Y axis label'])

  const none = assembleReading([
    block('p1-b1', 'A paragraph.', { translation: '一段。' }),
    block('p1-b2', 'Orphan label', { kind: 'figlabel' }),
  ], {})
  assert.deepEqual(none.figureNotes, {})
  assert.deepEqual(none.flow.map(p => p.id), ['p1-b1'])
})

test('分节：标题行切块；首标题前的导语部分 headingId=undefined', () => {
  const { flow } = assembleReading([
    block('p1-b1', 'Title Here', { kind: 'title', translation: '标题' }),
    block('p1-b2', 'Abstract text.', { kind: 'abstract', translation: '摘要。' }),
    block('p1-b3', '1 Introduction', { kind: 'heading', translation: '1 引言' }),
    block('p1-b4', 'Intro body.', { translation: '引言正文。' }),
    block('p1-b5', '2 Method', { kind: 'heading', translation: '2 方法' }),
    block('p1-b6', 'Method body.', { translation: '方法正文。' }),
  ], {})
  const sections = splitSections(flow)
  assert.deepEqual(sections.map(s => s.headingId), [undefined, 'p1-b3', 'p1-b5'])
  assert.equal(sections[0]?.paragraphs.length, 2)
  assert.equal(sections[1]?.headingSource, '1 Introduction')
  assert.equal(sections[1]?.paragraphs.length, 1)
})
