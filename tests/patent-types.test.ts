/** M9-lite：专利域 schema 校验器正反例（照 validateProjectMeta 的中文错误
 * 清单口径；校验是纯函数，不碰盘）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeDisclosure, normalizePublicEvent, validateDisclosure, validatePatentMeta, validatePublicEvent,
} from '../src/patent/types.ts'

const validMeta = {
  schemaVersion: 1,
  patentId: 'p-2026-001',
  title: '一种测试方法',
  kind: 'invention',
  status: 'idea',
  inventors: ['张三'],
  applicants: ['某大学'],
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
}

test('patent：合法 meta 过零错误；filing 缺席与在场均收', () => {
  assert.deepEqual(validatePatentMeta(validMeta), [])
  assert.deepEqual(validatePatentMeta({
    ...validMeta,
    filing: { applicationNo: 'CN202610000000.X', filedAt: '2026-10-01T00:00:00.000Z', jurisdiction: 'CN' },
  }), [])
})

test('patent：非法 meta 逐项报中文错', () => {
  const errors = validatePatentMeta({
    ...validMeta,
    schemaVersion: 2,
    patentId: 'Bad_Id',
    title: '',
    kind: 'utility',
    status: 'nope',
    inventors: '张三',
    applicants: ['某大学', ''],
    createdAt: 'not-a-time',
  })
  assert.equal(validatePatentMeta(null).length, 1)
  for (const fragment of ['schemaVersion', 'patentId', 'title', 'kind', 'status', 'inventors', 'applicants', 'createdAt']) {
    assert.ok(errors.some(error => error.includes(fragment)), fragment + ' → ' + JSON.stringify(errors))
  }
  // updatedAt 缺失（非 ISO）
  const missing = validatePatentMeta({ ...validMeta, updatedAt: undefined })
  assert.ok(missing.some(error => error.includes('updatedAt')))
  // filing 形状错误
  const badFiling = validatePatentMeta({ ...validMeta, filing: { applicationNo: '', filedAt: 'x', jurisdiction: 'US' } })
  assert.equal(badFiling.filter(error => error.includes('filing')).length >= 3, true, JSON.stringify(badFiling))
})

const validDisclosure = {
  schemaVersion: 1,
  technicalField: '自然语言处理',
  backgroundArt: '现有方法 A 的缺陷……',
  problem: '如何……',
  solution: '一种……的方法',
  embodiments: ['实施例 1：……'],
  beneficialEffects: [{ text: '准确率提升', evidence: 'TODO' }],
  attachments: [{ path: 'experiments/vecadd/metrics.json', note: '实测' }],
}

test('disclosure：合法交底书过零错误；normalize 补 TODO 与缺省数组', () => {
  assert.deepEqual(validateDisclosure(validDisclosure), [])
  const normalized = normalizeDisclosure({
    technicalField: 'NLP', backgroundArt: 'b', problem: 'p', solution: 's',
    beneficialEffects: [{ text: '更快' }],
  })
  assert.equal(normalized.beneficialEffects[0]?.evidence, 'TODO', '缺 evidence 归一为 TODO')
  assert.deepEqual(normalized.embodiments, [])
  assert.deepEqual(normalized.attachments, [])
  assert.deepEqual(validateDisclosure(normalized), [])
})

test('disclosure：缺字段/坏结构逐项报中文错', () => {
  const errors = validateDisclosure({ ...validDisclosure, schemaVersion: 3, solution: '', embodiments: ['ok', ''] })
  for (const fragment of ['schemaVersion', 'solution', 'embodiments']) {
    assert.ok(errors.some(error => error.includes(fragment)), fragment + ' → ' + JSON.stringify(errors))
  }
  const badEffects = validateDisclosure({
    ...validDisclosure,
    beneficialEffects: [{ text: '' }, '不是对象', { text: 'x', evidence: '' }],
  })
  assert.ok(badEffects.some(error => error.includes('beneficialEffects[0].text')))
  assert.ok(badEffects.some(error => error.includes('beneficialEffects[1]')))
  assert.ok(badEffects.some(error => error.includes('beneficialEffects[2].evidence')))
  const badAttachments = validateDisclosure({
    ...validDisclosure,
    attachments: [{ path: '' }, { path: 'p', note: '' }],
  })
  assert.ok(badAttachments.some(error => error.includes('attachments[0].path')))
  assert.ok(badAttachments.some(error => error.includes('attachments[1].note')))
  // 根不是对象
  assert.equal(validateDisclosure('nope').length, 1)
})

const validEvent = {
  at: '2026-10-18T00:00:00.000Z',
  kind: 'preprint-published',
  description: 'arXiv 上传',
  publicAt: '2026-10-17T00:00:00.000Z',
  graceCase: 'none',
}

test('event：合法事件过零错误；kind/graceCase 枚举与 ISO 报错', () => {
  assert.deepEqual(validatePublicEvent(validEvent), [])
  assert.deepEqual(validatePublicEvent({ ...validEvent, source: 'https://arxiv.org/abs/x' }), [])
  const errors = validatePublicEvent({ ...validEvent, kind: 'blog', graceCase: 'exhibition', publicAt: 'yesterday' })
  for (const fragment of ['kind', 'graceCase', 'publicAt']) {
    assert.ok(errors.some(error => error.includes(fragment)), fragment + ' → ' + JSON.stringify(errors))
  }
  assert.ok(validatePublicEvent({ ...validEvent, description: '' }).some(error => error.includes('description')))
  assert.ok(validatePublicEvent({ ...validEvent, at: '' }).some(error => error.includes('at')))
  // normalize：at 缺省取 nowIso、graceCase 缺省 none、source 缺省不带键
  const now = '2026-10-18T12:00:00.000Z'
  const normalized = normalizePublicEvent({ kind: 'thesis', description: '答辩', publicAt: '2026-06-01T00:00:00.000Z' }, now)
  assert.equal(normalized.at, now)
  assert.equal(normalized.graceCase, 'none')
  assert.equal('source' in normalized, false)
  assert.deepEqual(validatePublicEvent(normalized), [])
})
