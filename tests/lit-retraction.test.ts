/** Task 2.9 + 0204 3.6：撤稿/勘误信号提取（fixture，类型区分口径）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isRetracted, retractionSignalsOf, retractionStateOf } from '../src/verify/retraction.ts'

test('retraction：updated-by[type=retraction] → retracted', () => {
  const message = {
    DOI: '10.1/retracted-paper',
    title: ['Original Work'],
    'updated-by': [
      { DOI: '10.1/retraction-notice', type: 'retraction', updated: { 'date-parts': [[2025, 3, 1]] } },
    ],
  }
  assert.deepEqual(retractionSignalsOf(message), { retracted: true, corrigendum: false })
  assert.equal(isRetracted(message), true)
  assert.equal(retractionStateOf(message), 'retracted')
})

test('retraction：withdrawal/removal 同属撤稿类；relation is-retraction-of → retracted', () => {
  assert.equal(isRetracted({ 'updated-by': [{ type: 'withdrawal' }] }), true)
  assert.equal(isRetracted({ 'updated-by': [{ type: 'removal' }] }), true)
  const notice = { relation: { 'is-retraction-of': [{ 'id-type': 'doi', id: '10.1/original' }] } }
  assert.equal(isRetracted(notice), true)
  assert.equal(retractionStateOf(notice), 'retracted')
})

test('retraction：corrigendum/erratum 与 is-update-of → 只挂勘误通知，不标红（M2 遗留修正）', () => {
  const corrigendum = {
    DOI: '10.1/updated-paper',
    'updated-by': [{ DOI: '10.1/corrigendum', type: 'corrigendum' }],
  }
  assert.deepEqual(retractionSignalsOf(corrigendum), { retracted: false, corrigendum: true })
  assert.equal(isRetracted(corrigendum), false, '勘误不是撤稿')
  assert.equal(retractionStateOf(corrigendum), 'corrigendum')
  assert.equal(retractionStateOf({ relation: { 'is-update-of': [{ id: '10.1/orig' }] } }), 'corrigendum')
  assert.equal(retractionStateOf({ 'updated-by': [{ type: 'erratum' }] }), 'corrigendum')
})

test('retraction：撤稿优先于勘误；无 type 旧式记录保守归勘误；干净论文 ok', () => {
  const mixed = {
    'updated-by': [
      { type: 'corrigendum' },
      { type: 'retraction' },
    ],
  }
  assert.equal(retractionStateOf(mixed), 'retracted', '双信号并存判撤稿')
  assert.deepEqual(retractionSignalsOf({ 'updated-by': ['legacy-no-type'] }), { retracted: false, corrigendum: true })
  const clean = { DOI: '10.1/fine', title: ['Fine Work'] }
  assert.deepEqual(retractionSignalsOf(clean), { retracted: false, corrigendum: false })
  assert.equal(retractionStateOf(clean), 'ok')
})
