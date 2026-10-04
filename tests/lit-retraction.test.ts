/** Task 2.9：撤稿信号提取（fixture 两态）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isRetracted, retractionSignalsOf } from '../src/verify/retraction.ts'

test('retraction：updated-by 命中 → retracted', () => {
  const message = {
    DOI: '10.1/retracted-paper',
    title: ['Original Work'],
    'updated-by': [
      { DOI: '10.1/retraction-notice', type: 'retraction', updated: { 'date-parts': [[2025, 3, 1]] } },
    ],
  }
  assert.equal(retractionSignalsOf(message).updatedBy, true)
  assert.equal(isRetracted(message), true)
})

test('retraction：relation is-retraction-of 命中 → retracted', () => {
  const message = {
    DOI: '10.1/retraction-notice',
    relation: {
      'is-retraction-of': [{ 'id-type': 'doi', id: '10.1/original' }],
    },
  }
  assert.equal(retractionSignalsOf(message).isRetractionOf, true)
  assert.equal(isRetracted(message), true)
})

test('retraction：is-update-of（勘误非撤稿）也标记为信号；正常论文未命中', () => {
  // 勘误（corrigendum）：is-update-of——按保守口径一并标记（M3 区分类型）
  assert.equal(isRetracted({ relation: { 'is-update-of': [{ id: '10.1/orig' }] } }), true)
  // 正常：无任何信号
  const clean = { DOI: '10.1/fine', title: ['Fine Work'] }
  assert.deepEqual(retractionSignalsOf(clean), { updatedBy: false, isRetractionOf: false })
  assert.equal(isRetracted(clean), false)
})
