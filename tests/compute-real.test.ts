/** M7 真机验收（compute-real）：**只在 SRW_REAL_SSH=1 时跑**，缺省 skip 并
 * 说明原因（不假绿）。流程：真 hosts 盘点 → 选一台可用主机 → 提交最小指标
 * 作业（写 metrics.json 的 bash，不依赖 torch）→ 轮询 succeeded → logs 续读 →
 * collect 回传 → claims verified。对应 04 §7.2 的 A1/A3（简化版）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { ComputeService } from '../src/compute/service.ts'
import { SshProvider } from '../src/compute/provider.ts'
import type { SrwFsLike } from '../src/host.ts'

function fakeFs(): SrwFsLike {
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = pathResolve(parent.key)
      const c = pathResolve(child.key)
      return c === p || c.startsWith(p + '/')
    },
  }
}

const JOB_SH = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'nvidia-smi --query-gpu=index,name --format=csv,noheader | head -1 > gpu.txt || true',
  "printf '%s' '{\"schemaVersion\":1,\"runId\":\"REAL\",\"metrics\":[{\"name\":\"acc\",\"value\":0.5}]}' > metrics.json",
  'echo real-job-done',
].join('\n')

test('compute-real：真机 GPU 主机端到端（SRW_REAL_SSH=1 才跑，否则 skip 不假绿）', async t => {
  if (process.env.SRW_REAL_SSH !== '1') {
    t.skip('SRW_REAL_SSH 未设置——真机验收跳过（CI/本地缺省不真连）')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'srw-compute-real-'))
  try {
    await mkdir(join(root, 'demo', 'experiments'), { recursive: true })
    const service = new ComputeService({ fs: fakeFs(), rootDir: () => root, provider: new SshProvider() })
    // A1：盘点（真 probe + 真 env）
    const hosts = await service.hosts('demo')
    const usable = hosts.hosts.find(row => row.usable && row.reachable)
    assert.ok(usable !== undefined, '无可用主机：' + JSON.stringify(hosts))
    assert.ok((usable.env?.gpuCount ?? 0) >= 1, '真机应至少 1 张 GPU')
    const text = JSON.stringify(hosts)
    assert.ok(!/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(text), '盘点输出不得含 IPv4')
    assert.ok(!text.includes('@'), '盘点输出不得含 user@')
    // 提交最小作业
    const submitted = await service.submit('demo', {
      expId: 'exp-real',
      spec: { expId: 'exp-real', entry: ['bash', 'job.sh'], seeds: [0], datasets: [], baselines: [], metrics: ['acc'], tier: 'D1' },
      hostRef: usable.ref,
      confirm: true,
      ack: true, // 真机冒烟作业无数据集：显式接受 D1 档位缺口（门本身另测）
      runId: 'r-real',
      files: [{ path: 'job.sh', content: JOB_SH }],
    }) as { status: string; runId: string }
    assert.equal(submitted.status, 'running')
    // 轮询 ≤120s（10s 间隔）
    const deadline = Date.now() + 120_000
    let status = 'running'
    while (Date.now() < deadline) {
      await new Promise<void>(resolve => { setTimeout(resolve, 10_000) })
      const view = await service.status('demo', 'exp-real', 'r-real') as { runs: Array<{ status: string }> }
      status = view.runs[0]?.status ?? 'running'
      if (status === 'succeeded' || status === 'failed' || status === 'unknown') break
    }
    assert.equal(status, 'succeeded')
    // 日志 + 归集 + 对账
    const logs = await service.logs('demo', 'exp-real', 'r-real') as { stdoutBytes: number }
    assert.ok(logs.stdoutBytes > 0)
    const collected = await service.collect('demo', 'exp-real', 'r-real') as { metrics: { schemaOk: boolean } | null }
    assert.equal(collected.metrics?.schemaOk, true)
    const verified = await service.claimsCheck('demo', {
      claim: { id: 'clm-real', kind: 'number', source: { expId: 'exp-real', runIds: ['r-real'], metric: 'acc', reducer: 'mean' }, value: 0.5, digits: 1 },
    }) as { claims: Array<{ id: string; status: string }> }
    assert.equal(verified.claims.find(row => row.id === 'clm-real')?.status, 'verified')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
