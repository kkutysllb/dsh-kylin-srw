/** M6：materials schema 校验器正反例（types.ts）——manifest/artifact/
 * metrics 载荷与落盘全形/kind 特定 spec/selector 解析。照 patent-types
 * 风格：纯函数断言，无 IO。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  validateArtifact, validateManifest, validateMetricsFile, validateMetricsPayload, validateSpec,
} from '../src/materials/types.ts'
import { parseSelector } from '../src/materials/metrics.ts'

const HEX64 = 'a'.repeat(64)
const ISO = '2026-10-18T00:00:00.000Z'

function goodArtifact(): Record<string, unknown> {
  return {
    id: 'tab-main',
    kind: 'table',
    provenance: 'measured',
    path: 'materials/tables/tab-main.tex',
    spec: { runId: 'run-01', columns: [{ metric: 'accuracy' }] },
    generator: { builtin: 'table-v1', specSha256: HEX64 },
    inputs: [{ path: 'experiments/manual/run-01/metrics.json', sha256: HEX64, selector: '#accuracy' }],
    output: { sha256: HEX64, bytes: 120 },
    verification: { status: 'verified', method: 'recompute', checkedAt: ISO, detail: '复算一致' },
    insertedAt: [],
    illustrative: { allowed: false },
  }
}

test('validateMetricsPayload：values+series 合法；空/坏名/非有限值/坏 points 拒绝', () => {
  assert.deepEqual(validateMetricsPayload({
    values: { accuracy: { value: 0.912, stderr: 0.004, n: 3, seed: 42 }, f1: { value: 0.887 } },
    series: [{ name: 'loss', points: [[0, 1], [1, 0.5]] }],
  }), [])
  // values 与 series 全空 → 拒（无数据不许占位）
  const empty = validateMetricsPayload({ values: {} })
  assert.ok(empty.some(message => message.includes('至少要有一个非空')))
  // values 缺失
  assert.ok(validateMetricsPayload({ series: [] }).some(message => message.includes('values')))
  // 坏指标名（不能成宏）
  const badName = validateMetricsPayload({ values: { '9lives': { value: 1 } } })
  assert.ok(badName.some(message => message.includes('9lives')))
  // 非有限 value / 负 stderr / 非整数 n
  const nan = validateMetricsPayload({ values: { accuracy: { value: Number.NaN } } })
  assert.ok(nan.some(message => message.includes('.value 必须是有限数字')))
  const negStderr = validateMetricsPayload({ values: { accuracy: { value: 1, stderr: -0.1 } } })
  assert.ok(negStderr.some(message => message.includes('stderr')))
  const fracN = validateMetricsPayload({ values: { accuracy: { value: 1, n: 2.5 } } })
  assert.ok(fracN.some(message => message.includes('n 必须是整数')))
  // series：空 points / 非数值点
  const emptyPoints = validateMetricsPayload({ values: { a: { value: 1 } }, series: [{ name: 'loss', points: [] }] })
  assert.ok(emptyPoints.some(message => message.includes('points 必须是非空数组')))
  const badPoint = validateMetricsPayload({ values: { a: { value: 1 } }, series: [{ name: 'loss', points: [[0, 'x']] }] })
  assert.ok(badPoint.some(message => message.includes('[number, number]')))
})

test('validateMetricsFile：全形校验（schemaVersion/runId 必填且合法）', () => {
  assert.deepEqual(validateMetricsFile({
    schemaVersion: 1, runId: 'run-01',
    values: { accuracy: { value: 0.912 } },
    series: [{ name: 'loss', points: [[1, 2]] }],
  }), [])
  assert.ok(validateMetricsFile({ schemaVersion: 2, runId: 'r', values: {} }).some(message => message.includes('schemaVersion')))
  assert.ok(validateMetricsFile({ schemaVersion: 1, runId: '../escape', values: { a: { value: 1 } } }).some(message => message.includes('runId')))
  // 载荷级错误消息前缀从 metrics. 改写成 metrics.json（可读性）
  const prefixed = validateMetricsFile({ schemaVersion: 1, runId: 'r1', values: {} })
  assert.ok(prefixed.length > 0)
  assert.ok(prefixed.every(message => message.startsWith('metrics.json')))
})

test('validateManifest / validateArtifact：合法形状过；坏 id/kind/provenance/哈希拒绝', () => {
  const artifact = goodArtifact()
  assert.deepEqual(validateArtifact(artifact), [])
  assert.deepEqual(validateManifest({ schemaVersion: 1, artifacts: [artifact] }), [])
  // manifest 级
  assert.ok(validateManifest({ schemaVersion: 2, artifacts: [] }).some(message => message.includes('schemaVersion')))
  assert.ok(validateManifest({ schemaVersion: 1, artifacts: 'nope' }).some(message => message.includes('artifacts')))
  // artifact 级（带 id 前缀的错误消息）
  const badId = { ...artifact, id: 'Tab_Main' }
  assert.ok(validateArtifact(badId).some(message => message.includes('id')))
  assert.ok(validateArtifact({ ...artifact, kind: 'figure' }).some(message => message.includes('kind')))
  assert.ok(validateArtifact({ ...artifact, provenance: 'fabricated' }).some(message => message.includes('provenance')))
  assert.ok(validateArtifact({ ...artifact, path: 'paper/figs/x.tex' }).some(message => message.includes('path')))
  assert.ok(validateArtifact({ ...artifact, generator: { builtin: 'table-v1', specSha256: 'zz' } }).some(message => message.includes('specSha256')))
  assert.ok(validateArtifact({ ...artifact, output: { sha256: HEX64, bytes: -1 } }).some(message => message.includes('bytes')))
  assert.ok(validateArtifact({ ...artifact, verification: { ...artifact.verification as Record<string, unknown>, status: 'ok' } }).some(message => message.includes('status')))
  assert.ok(validateArtifact({ ...artifact, inputs: 'nope' }).some(message => message.includes('inputs')))
  assert.ok(validateArtifact({ ...artifact, illustrative: { allowed: 'yes' } }).some(message => message.includes('illustrative')))
  // insertedAt 坏哈希
  const withInsertion = { ...artifact, insertedAt: [{ sectionId: 's1', file: 'sections/01-x.tex', label: 'tab:tab-main', target: 'paper/figs/tab-main.tex', targetSha256: 'short' }] }
  assert.ok(validateArtifact(withInsertion).some(message => message.includes('targetSha256')))
  // manifest 级错误带下标前缀
  const manifestErrors = validateManifest({ schemaVersion: 1, artifacts: [{ ...artifact, id: 'BAD' }] })
  assert.ok(manifestErrors.some(message => message.startsWith('artifacts[0]')))
})

test('validateSpec：table/plot 要 runId；pseudocode/formula/tikz 必填项与边界', () => {
  assert.deepEqual(validateSpec('table', { runId: 'run-01', columns: [{ metric: 'accuracy', precision: 4 }] }), [])
  assert.ok(validateSpec('table', { columns: [{ metric: 'a' }] }).some(message => message.includes('runId')))
  assert.ok(validateSpec('table', { runId: 'r' }).some(message => message.includes('columns')))
  assert.ok(validateSpec('table', { runId: 'r', columns: [{ metric: 'a', precision: 0 }] }).some(message => message.includes('precision')))
  assert.ok(validateSpec('plot', { runId: 'r' }).some(message => message.includes('seriesName')))
  assert.deepEqual(validateSpec('plot', { runId: 'r', seriesName: 'loss' }), [])
  assert.ok(validateSpec('pseudocode', { steps: [] }).some(message => message.includes('steps')))
  assert.deepEqual(validateSpec('pseudocode', { steps: ['FOR x in xs', 'RETURN x'] }), [])
  assert.ok(validateSpec('formula', { latex: '  ' }).some(message => message.includes('latex')))
  assert.deepEqual(validateSpec('formula', { latex: 'E = mc^2' }), [])
  assert.ok(validateSpec('tikz', {}).some(message => message.includes('code')))
  assert.deepEqual(validateSpec('tikz', { code: '\\draw (0,0) -- (1,1);' }), [])
  assert.deepEqual(validateSpec('tikz', { code: 'x', caption: '架构' }), [])
})

test('parseSelector：#metric / #series:name / 非法形状', () => {
  assert.deepEqual(parseSelector('#accuracy'), { kind: 'metric', name: 'accuracy' })
  assert.deepEqual(parseSelector('#series:loss'), { kind: 'series', name: 'loss' })
  assert.equal(parseSelector('accuracy'), undefined)
  assert.equal(parseSelector('#'), undefined)
  assert.equal(parseSelector(''), undefined)
})
