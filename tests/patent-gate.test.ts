/** M9-lite：公开时序门纯函数。覆盖 5 条判定规则 + 多事件取最严 +
 * 恰好 6 个月边界；全部用固定 UTC 时间戳保证确定性。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPublication } from '../src/patent/gate.ts'
import type { GraceCase, PatentMeta, PublicEvent } from '../src/patent/types.ts'

const NOW = '2026-10-18T00:00:00.000Z'

function patent(over: Partial<PatentMeta> = {}): PatentMeta {
  return {
    schemaVersion: 1,
    patentId: 'p-demo',
    title: '一种测试方法',
    kind: 'invention',
    status: 'idea',
    inventors: ['张三'],
    applicants: ['某大学'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function filed(fileAt: string): PatentMeta {
  return patent({ filing: { applicationNo: 'CN202610000000.X', filedAt: fileAt, jurisdiction: 'CN' } })
}

function event(over: Partial<PublicEvent> = {}): PublicEvent {
  return {
    at: NOW,
    kind: 'preprint-published',
    description: 'arXiv 上传',
    publicAt: '2026-04-01T00:00:00.000Z',
    graceCase: 'none',
    ...over,
  }
}

function withGrace(graceCase: GraceCase): Partial<PublicEvent> {
  return { graceCase, kind: 'conference-talk', description: '规定的学术会议首次发表' }
}

test('规则1：申请日 ≤ 计划公开时点 → safe', () => {
  const result = checkPublication({ patent: filed('2026-06-01T00:00:00.000Z'), events: [], publicationAt: '2026-08-01T00:00:00.000Z' })
  assert.equal(result.verdict, 'safe')
  assert.ok(result.reasons.length >= 1)
  assert.ok(result.reasons[0]!.includes('2026-06-01'))
  assert.ok(result.advice.length >= 1, 'advice 至少一条')
})

test('规则2：已公开事件 + 无 filing → blocked（不可逆，advice 停止投稿找代理人）', () => {
  const result = checkPublication({
    patent: patent(),
    events: [event({ publicAt: '2026-07-01T00:00:00.000Z' })],
    publicationAt: '2026-09-01T00:00:00.000Z',
  })
  assert.equal(result.verdict, 'blocked')
  assert.ok(result.reasons.some(reason => reason.includes('preprint-published@2026-07-01')), 'reason 带事件 kind/publicAt')
  assert.ok(result.advice.some(advice => advice.includes('停止投稿')))
  assert.ok(result.advice.some(advice => advice.includes('代理人')))
})

test('规则3a：公开早于申请日、6 个月内、宽限情形 ≠ none → grace', () => {
  const result = checkPublication({
    patent: filed('2026-07-01T00:00:00.000Z'),
    events: [event({ ...withGrace('prescribed-academic-conference'), publicAt: '2026-04-01T00:00:00.000Z' })],
    publicationAt: '2026-10-18T00:00:00.000Z',
  })
  assert.equal(result.verdict, 'grace')
  assert.ok(result.advice.some(advice => advice.includes('宽限期仅四种法定情形')))
  assert.ok(result.advice.some(advice => advice.includes('须专利代理人确认适用')))
})

test('规则3b：公开早于申请日、宽限情形 none → risk（新颖性已丧失）', () => {
  const result = checkPublication({
    patent: filed('2026-07-01T00:00:00.000Z'),
    events: [event({ publicAt: '2026-04-01T00:00:00.000Z' })],
    publicationAt: '2026-10-18T00:00:00.000Z',
  })
  assert.equal(result.verdict, 'risk')
  assert.ok(result.reasons.some(reason => reason.includes('未登记宽限情形')))
  assert.ok(result.reasons.some(reason => reason.includes('新颖性已丧失')))
})

test('规则3c：公开早于申请日、超出 6 个月窗口（即便登记宽限情形）→ risk', () => {
  const result = checkPublication({
    patent: filed('2027-04-02T00:00:00.000Z'),
    events: [event({ ...withGrace('international-exhibition'), publicAt: '2026-04-01T00:00:00.000Z' })],
    publicationAt: '2027-01-01T00:00:00.000Z',
  })
  assert.equal(result.verdict, 'risk')
  assert.ok(result.reasons.some(reason => reason.includes('超出 6 个月')))
})

test('规则4：无 filing、无已公开事件、公开时点在未来 → risk（先申请后公开）', () => {
  const result = checkPublication({
    patent: patent(),
    events: [],
    publicationAt: '2027-01-01T00:00:00.000Z',
    now: NOW,
  })
  assert.equal(result.verdict, 'risk')
  assert.ok(result.reasons.some(reason => reason.includes('filing 缺席')))
  assert.ok(result.advice.some(advice => advice.includes('先申请')))
})

test('规则5：事件全部在申请日之后 → safe', () => {
  const result = checkPublication({
    patent: filed('2026-01-01T00:00:00.000Z'),
    events: [event({ publicAt: '2026-02-01T00:00:00.000Z' })],
    publicationAt: '2026-03-01T00:00:00.000Z',
  })
  assert.equal(result.verdict, 'safe')
  assert.ok(result.reasons.some(reason => reason.includes('preprint-published@2026-02-01') && reason.includes('之后')))
})

test('多事件取最严：grace + risk → risk；blocked 压过一切（无 filing 场景）', () => {
  const mixed = checkPublication({
    patent: filed('2026-07-01T00:00:00.000Z'),
    events: [
      event({ ...withGrace('prescribed-academic-conference'), publicAt: '2026-04-01T00:00:00.000Z' }),
      event({ publicAt: '2025-01-01T00:00:00.000Z' }),
    ],
    publicationAt: '2026-10-18T00:00:00.000Z',
  })
  assert.equal(mixed.verdict, 'risk')
  assert.equal(mixed.reasons.length, 3, '规则1 safe + 两条事件各一条 reason')
  assert.ok(mixed.reasons.some(reason => reason.includes('preprint-published@2025-01-01')))
  assert.ok(mixed.reasons.some(reason => reason.includes('conference-talk@2026-04-01')))
  const blocked = checkPublication({
    patent: patent(),
    events: [event({ publicAt: '2026-07-01T00:00:00.000Z' }), event({ kind: 'code-release', publicAt: '2026-08-01T00:00:00.000Z' })],
    publicationAt: '2026-09-01T00:00:00.000Z',
  })
  assert.equal(blocked.verdict, 'blocked')
})

test('恰好 6 个月边界：filedAt = publicAt + 6 个月 → grace；再多一天 → risk', () => {
  const onBoundary = checkPublication({
    patent: filed('2026-07-15T00:00:00.000Z'),
    events: [event({ ...withGrace('prescribed-academic-conference'), publicAt: '2026-01-15T00:00:00.000Z' })],
    publicationAt: '2026-08-01T00:00:00.000Z',
  })
  assert.equal(onBoundary.verdict, 'grace', '恰好 6 个月仍算窗口内（≤）')
  const pastBoundary = checkPublication({
    patent: filed('2026-07-16T00:00:00.000Z'),
    events: [event({ ...withGrace('prescribed-academic-conference'), publicAt: '2026-01-15T00:00:00.000Z' })],
    publicationAt: '2026-08-01T00:00:00.000Z',
  })
  assert.equal(pastBoundary.verdict, 'risk', '超过 6 个月哪怕一天也丧失')
})

test('有 filing 但计划公开早于申请日 → risk（这次公开本身即申请前公开）', () => {
  const result = checkPublication({
    patent: filed('2026-12-01T00:00:00.000Z'),
    events: [],
    publicationAt: '2026-10-18T00:00:00.000Z',
    now: NOW,
  })
  assert.equal(result.verdict, 'risk')
  assert.ok(result.reasons.some(reason => reason.includes('早于申请日 2026-12-01')))
  assert.ok(result.advice.some(advice => advice.includes('申请日之后')))
})

test('未来时点的公开事件不构成在先公开；advice 全场景至少一条', () => {
  const result = checkPublication({
    patent: patent(),
    events: [event({ publicAt: '2027-06-01T00:00:00.000Z' })],
    publicationAt: '2026-10-18T00:00:00.000Z',
    now: NOW,
  })
  assert.equal(result.verdict, 'risk', '事件尚未发生：按规则4 先申请后公开')
  assert.ok(!result.reasons.some(reason => reason.includes('2027-06-01')), '未来事件不进 reasons（无在先公开）')
  assert.ok(result.advice.length >= 1)
})
