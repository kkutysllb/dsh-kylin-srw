/** M7 纯函数面：脱敏（IPv4/IPv6/user@/:port//home）、哈希引用、run.json/
 * spec/claim/dataset 校验、D 档设计门、claims 三态对账、gaps 生成与排队。
 * 全部无 IO——真连面在 compute-real（SRW_REAL_SSH 门控）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostRefOf, projectRefOf, redact, redactJson, sha256Hex, validateRunRecord } from '../src/compute/types.ts'
import { gateSpec, normalizeSpec, validateExperimentSpec, type ExperimentSpec } from '../src/compute/spec.ts'
import { checkClaim, reduceValues, validateClaimRecord, validateMetricsFile, type ClaimRecord, type MetricsByRun } from '../src/compute/claims.ts'
import { generateGaps, sortGapQueue, type GapInput, type GapRunSummary } from '../src/compute/gaps.ts'
import { validateDatasetRecord } from '../src/compute/registry.ts'

test('redact：IPv4/IPv6/user@host:port//home 全脱敏，hh:mm:ss 与普通文本不受影响', () => {
  assert.equal(redact('connect alice@192.168.1.7:18908 now'), 'connect <ssh-target>:<port> now')
  assert.equal(redact('see 10.0.0.1 and fe80::1 ok'), 'see <ip> and <ip> ok')
  assert.equal(redact('at 22:48:03 fine'), 'at 22:48:03 fine')
  assert.equal(redact('path /home/alice/run'), 'path <home>/run')
  assert.equal(redact('path /Users/bob/x'), 'path <home>/x')
  // 已脱敏标记后随端口（user@ip:port 形态的两段式）
  assert.ok(!redact('a deploy@172.16.0.9 -p 18908').includes('172.16.0.9'))
  assert.ok(!redact('a deploy@172.16.0.9 -p 18908').includes('deploy@'))
  // 结构化脱敏往返
  assert.deepEqual(redactJson({ nested: { ip: '10.1.2.3', keep: 42 } }), { nested: { ip: '<ip>', keep: 42 } })
})

test('哈希引用：hostRef 稳定且前缀 h-，projectRef 12 位十六进制', () => {
  const ref = hostRefOf('125-39-97')
  assert.ok(ref.startsWith('h-') && ref.length === 10)
  assert.equal(ref, hostRefOf('125-39-97'))
  assert.notEqual(ref, hostRefOf('other-id'))
  const pRef = projectRefOf('/tmp/some-project')
  assert.equal(pRef.length, 12)
  assert.match(pRef, /^[0-9a-f]{12}$/)
  assert.equal(sha256Hex('x').length, 64)
})

const goodRun = {
  schemaVersion: 1,
  runId: 'r-abc',
  expId: 'exp-01',
  attempt: 1,
  parentRunId: null,
  status: 'running' as const,
  host: { ref: 'h-a1b2c3d4', label: '测试机', provider: 'direct' as const },
  remote: { runDir: '~/srw-runs/p/r-abc', pidFile: 'run.pid', logFile: 'run.log', exitFile: 'exit.code', doneFile: 'done' },
  pid: 42,
  env: { cudaVisibleDevices: '1', gpus: [] },
  seed: 0,
  inputs: [],
  outputs: { metrics: null, artifacts: [] },
  log: { stdoutBytes: 0, lastReadAt: null, staleCount: 0 },
  cancel: { requestedAt: null, reason: null },
  timestamps: { createdAt: '2026-10-18T00:00:00Z', submittedAt: null, endedAt: null, lastPolledAt: null },
  lastError: null,
}

test('run.json 校验：合法通过；原始 hostId（IP 形态）当 host.ref 必拒', () => {
  assert.deepEqual(validateRunRecord(goodRun), [])
  const bad = { ...goodRun, host: { ...goodRun.host, ref: '125-39-97' } }
  const errors = validateRunRecord(bad)
  assert.ok(errors.some(e => e.includes('h-')))
  assert.ok(validateRunRecord({ ...goodRun, status: 'flown' }).some(e => e.includes('status')))
})

test('spec：校验器抓必填/越界，normalize 填默认', () => {
  const errors = validateExperimentSpec({ expId: 'exp-01', entry: [], seeds: [], metrics: [] })
  assert.ok(errors.some(e => e.includes('entry')))
  assert.ok(errors.some(e => e.includes('seeds')))
  assert.ok(errors.some(e => e.includes('metrics')))
  assert.ok(validateExperimentSpec({ expId: 'exp-01', entry: ['bash', 'x'], seeds: ['0'], metrics: ['acc'], env: { 'BAD-KEY': 'v' }, maxHours: 999 }).length > 0)
  const spec = normalizeSpec({ expId: 'exp-01', entry: ['bash', 'job.sh'], seeds: ['0', '1'], metrics: ['acc'] }, 'exp-01')
  assert.equal(spec.gpus, 1)
  assert.equal(spec.maxHours, 8)
  assert.equal(spec.outputs.metrics, 'metrics.json')
  assert.deepEqual(spec.seeds, [0, 1])
})

function specOf(partial: Partial<ExperimentSpec>): ExperimentSpec {
  return normalizeSpec({ expId: 'exp-01', entry: ['bash', 'job.sh'], seeds: [0], datasets: ['ds-a'], baselines: ['b1', 'b2'], metrics: ['acc'], ...partial }, 'exp-01')
}

test('D 档设计门：D1 放行、D2 缺数据集阻断、D2 缺基线仅警告、D3 缺显著性阻断', () => {
  const d1 = gateSpec(specOf({ tier: 'D1' }))
  assert.equal(d1.ok, true)
  assert.deepEqual(d1.blockers, [])
  const d2 = gateSpec(specOf({ tier: 'D2', datasets: ['ds-a'], seeds: [0] }))
  assert.equal(d2.ok, false)
  assert.ok(d2.blockers.some(b => b.includes('数据集')))
  assert.ok(d2.blockers.every(b => b.startsWith('数据集') || b.startsWith('随机种子')))
  const d2warn = gateSpec(specOf({ tier: 'D2', datasets: ['ds-a', 'ds-b'], baselines: ['b1'], seeds: [0, 1], ablation: true }))
  assert.equal(d2warn.ok, true)
  assert.ok(d2warn.warnings.some(w => w.includes('基线')))
  const d3 = gateSpec(specOf({ tier: 'D3', datasets: ['a', 'b', 'c'], seeds: [0, 1, 2] }))
  assert.equal(d3.ok, false)
  assert.ok(d3.blockers.some(b => b.includes('显著性')))
  const d3ok = gateSpec(specOf({ tier: 'D3', datasets: ['a', 'b', 'c'], seeds: [0, 1, 2], significance: true, costAnalysis: true, ablation: true }))
  assert.equal(d3ok.ok, true)
})

test('claims：校验器 + reducer + 三态对账（verified/mismatch/unverifiable）', () => {
  assert.ok(validateClaimRecord({ id: 'bad', kind: 'number', source: { expId: 'e', runIds: ['r-1'], metric: 'acc', reducer: 'mode' }, value: 1, digits: 2 }).length > 0)
  assert.deepEqual(validateMetricsFile({ runId: 'r-1', metrics: [{ name: 'acc', value: 1 }] }), [])
  assert.ok(validateMetricsFile({ runId: 'r-1', metrics: [{ name: 'acc' }] }).length > 0)
  assert.equal(reduceValues([1, 2, 3], 'mean'), 2)
  assert.equal(reduceValues([1, 2, 3], 'median'), 2)
  assert.equal(reduceValues([1, 2, 3, 4], 'median'), 2.5)
  assert.equal(reduceValues([1, 2, 3], 'last'), 3)

  const sha = 'a'.repeat(64)
  const byRun: MetricsByRun = new Map([
    ['r-1', { sha256: sha, file: { schemaVersion: 1, runId: 'r-1', metrics: [{ name: 'acc', value: 0.9 }, { name: 'acc', value: 0.92 }] } }],
  ])
  const at = '2026-10-18T00:00:00Z'
  const claimOf = (partial: Partial<ClaimRecord>): ClaimRecord => ({
    id: 'clm-acc',
    kind: 'number',
    source: { expId: 'exp-01', runIds: ['r-1'], metric: 'acc', reducer: 'mean' },
    value: 0.91,
    digits: 2,
    ...partial,
  })
  assert.equal(checkClaim(claimOf({}), byRun, at).status, 'verified')
  assert.equal(checkClaim(claimOf({}), byRun, at).computed, 0.91)
  assert.equal(checkClaim(claimOf({ value: 0.95 }), byRun, at).status, 'mismatch')
  // 容差覆盖：|0.905-0.91|=0.005 ≤ 0.01（超出 digits 默认容差 0.0005 的情形）
  assert.equal(checkClaim(claimOf({ value: 0.905, digits: 3, tolerance: 0.01, source: { expId: 'e', runIds: ['r-1'], metric: 'acc', reducer: 'mean' } }), byRun, at).status, 'verified')
  // 缺 run / 缺指标 / failed run → unverifiable（不假 verified）
  assert.equal(checkClaim(claimOf({ source: { expId: 'e', runIds: ['r-x'], metric: 'acc', reducer: 'mean' } }), byRun, at).status, 'unverifiable')
  assert.equal(checkClaim(claimOf({ source: { expId: 'e', runIds: ['r-1'], metric: 'f1', reducer: 'mean' } }), byRun, at).status, 'unverifiable')
  const failedRun: MetricsByRun = new Map([['r-1', { sha256: sha, file: { schemaVersion: 1, runId: 'r-1', status: 'failed' as const, metrics: [{ name: 'acc', value: 1 }] } }]])
  assert.equal(checkClaim(claimOf({}), failedRun, at).status, 'unverifiable')
})

test('gaps：生成八类判定 + P0/P1/P2 排序', () => {
  const spec = specOf({ tier: 'D2', datasets: ['ds-a'], seeds: [0, 1, 2], maxHours: 2 })
  const runs: GapRunSummary[] = [
    { runId: 'r-1', status: 'succeeded', seed: 0, metricsNames: ['acc'], inputs: [{ datasetId: 'ds-a', version: 'v1' }] },
    { runId: 'r-2', status: 'failed', seed: 1, metricsNames: [], inputs: [] },
  ]
  const claims: ClaimRecord[] = [
    { id: 'clm-1', kind: 'number', source: { expId: 'exp-01', runIds: ['r-9'], metric: 'acc', reducer: 'mean' }, value: 1, digits: 2, verification: { status: 'unverifiable', computed: null, reason: 'x', checkedAt: 't', metricsSha256: [] } },
  ]
  const input: GapInput = { spec, tier: 'D2', runs, claims, registry: [{ id: 'ds-a', version: 'v2' }] }
  const items = generateGaps(input)
  const kinds = items.map(item => item.kind)
  for (const expected of ['missing-run', 'failed-run', 'stale-input', 'missing-dataset', 'missing-baseline', 'unverifiable']) {
    assert.ok(kinds.includes(expected as never), '缺 ' + expected)
  }
  // missing-run(seed 2 没跑过) 与 unverifiable 被 claim 阻断 → P0；failed-run(seed 1) 未被引用 → P1；stale-input 未被引用 → P1
  const missingRun = items.find(item => item.kind === 'missing-run')
  assert.ok(missingRun?.detail.includes('2'))
  assert.equal(items.find(item => item.kind === 'failed-run')?.priority, 'P1')
  assert.equal(missingRun?.priority, 'P0')
  assert.ok(missingRun?.blockingClaims.includes('clm-1'))
  assert.equal(items.find(item => item.kind === 'stale-input')?.priority, 'P1')
  // 排序：P0 全在 P1 前；同级 estGpuHours 升序
  const sorted = sortGapQueue(items)
  const priorities = sorted.map(item => item.priority)
  assert.deepEqual(priorities, [...priorities].sort((a, b) => (a === b ? 0 : a === 'P0' ? -1 : b === 'P0' ? 1 : a === 'P1' ? -1 : 1)))
})

test('dataset 校验：id/版本/hashPolicy/hostRef 脱敏形状', () => {
  assert.deepEqual(validateDatasetRecord({ id: 'ds-cifar10', version: 'v1', title: 'CIFAR-10', hashPolicy: 'none' }), [])
  assert.ok(validateDatasetRecord({ id: 'bad', version: 'v1', title: 'x', hashPolicy: 'tree' }).length > 0)
  assert.ok(validateDatasetRecord({ id: 'ds-ok', version: '1x', title: 'x', hashPolicy: 'tree' }).length > 0)
  assert.ok(validateDatasetRecord({ id: 'ds-ok', version: 'v1', title: 'x', hashPolicy: 'remote' }).length > 0)
  assert.ok(validateDatasetRecord({ id: 'ds-ok', version: 'v1', title: 'x', hashPolicy: 'file', locator: { kind: 'remote', hostRef: '192.168.1.2' } }).length > 0)
})
