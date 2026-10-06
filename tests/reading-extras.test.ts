/** 预算门 / 推荐门 / 公式策略（0205 Task 4.8–4.10，纯函数面）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calibrationRatio, estimate } from '../src/reading/budget.ts'
import { acceptRecommendation, INITIAL_RECOMMENDATION_STATE, recommendBatch, rejectRecommendation, type RecommendCandidate } from '../src/reading/recommend.ts'
import { looksLikeFormula, looksLikeTable, placeholderFormulaBlock } from '../src/reading/formula.ts'

test('budget：估算与确认门；校准比率', () => {
  const blocks = Array.from({ length: 10 }, () => ({ chars: 2000 })) // 共 20000 chars
  const estimate0 = estimate(blocks, 5_000)
  assert.equal(estimate0.estimatedTokens, 10_000, '20000/4×2')
  assert.equal(estimate0.needsConfirmation, true, '超预算需确认')
  assert.equal(estimate(blocks, 20_000).needsConfirmation, false)
  assert.equal(estimate(blocks, 0).needsConfirmation, false, '预算 0 = 不设门')
  assert.equal(calibrationRatio([{ estimated: 100, actual: 120, at: 't' }]), 1.2)
  assert.equal(calibrationRatio([]), undefined)
})

const candidates: RecommendCandidate[] = [
  { key: 'k-old', title: 'Old low-cited', year: 2016, status: 'unread', citedByCount: 2 },
  { key: 'k-hot', title: 'Hot new survey', year: 2025, status: 'unread', citedByCount: 3000 },
  { key: 'k-mid', title: 'Mid', year: 2023, status: 'unread', citedByCount: 50 },
  { key: 'k-read', title: 'Already read', year: 2025, status: 'has-pdf', citedByCount: 9000 },
  { key: 'k-rej', title: 'Previously rejected', year: 2025, status: 'unread', citedByCount: 9000 },
]

test('recommend：打分排序 + G2 门——已读/已拒不出批，同意/拒绝落状态', () => {
  const preRejected = { rejected: ['k-rej'], accepted: [] }
  const batch = recommendBatch(candidates, preRejected, 3)
  assert.deepEqual(batch.map(item => item.key), ['k-hot', 'k-mid', 'k-old'], '已读与已拒不在批内，按分排序')
  const state = rejectRecommendation(acceptRecommendation(INITIAL_RECOMMENDATION_STATE, 'k-hot'), 'k-mid')
  assert.deepEqual(state.accepted, ['k-hot'])
  assert.deepEqual(state.rejected, ['k-mid'])
  const next = recommendBatch(candidates, state, 3)
  assert.ok(!next.some(item => item.key === 'k-mid'), '拒绝后不再推')
  assert.ok(!next.some(item => item.key === 'k-hot'), '同意后不再推')
})

test('formula：嫌疑判定 + 占位块标注「图像，非可编辑源」', () => {
  assert.equal(looksLikeFormula('E = mc^2 and \\frac{a}{b} with x_i'), true)
  assert.equal(looksLikeFormula('Plain prose paragraph without any math markers at all.'), false)
  assert.equal(looksLikeTable('Table 1: Results across datasets'), true)
  const block = placeholderFormulaBlock(3, { x0: 100, yTop: 700, x1: 500, yBottom: 650 })
  assert.equal(block.kind, 'formula')
  assert.deepEqual(block.imageRef, { page: 3, bbox: block.bbox })
  assert.ok(block.note.includes('非可编辑源'))
})
