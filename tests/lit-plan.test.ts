/** P0-5 检索计划：保存/三源执行/去重排序/resultHash/离线重放。全程假
 * search（不连真网）+ 临时根；replay 断言零 search 调用。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import {
  listPlans,
  replayPlan,
  resultHashOf,
  runPlan,
  savePlan,
  type PlanDeps,
} from '../src/literature/plan.ts'
import { identityKey } from '../src/literature/identity.ts'
import type { LitCandidate, LitSource } from '../src/literature/types.ts'

function fakeFs() {
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = pathResolve(parent.key)
      const c = pathResolve(child.key)
      return c === p || c.startsWith(`${p}/`)
    },
  }
}

function candidate(source: LitSource, over: {
  title: string
  year: number
  doi?: string
  arxivId?: string
  authors?: string[]
  venue?: string
}): LitCandidate {
  return {
    source,
    identity: {
      title: over.title,
      year: over.year,
      ...(over.doi === undefined ? {} : { doi: over.doi }),
      ...(over.arxivId === undefined ? {} : { arxivId: over.arxivId }),
    },
    authors: over.authors ?? ['A'],
    venue: over.venue ?? '',
    abstract: '',
  }
}

const FIXTURES: Record<LitSource, LitCandidate[]> = {
  arxiv: [
    candidate('arxiv', { title: 'Shared Work', year: 2024, doi: '10.1000/shared', authors: ['Ada'] }),
    candidate('arxiv', { title: 'Arxiv Only', year: 2022, arxivId: '2401.00002v1' }),
  ],
  openalex: [
    candidate('openalex', { title: 'Shared Work', year: 2024, doi: '10.1000/shared', authors: ['Ada'], venue: 'J' }),
    candidate('openalex', { title: 'OpenAlex Only', year: 2025, doi: '10.2000/oa' }),
  ],
  crossref: [
    candidate('crossref', { title: 'Crossref Only', year: 2021, doi: '10.3000/cr' }),
  ],
}

interface Harness {
  readonly deps: PlanDeps
  calls: string[]
  setFixture(fixtures: Record<LitSource, LitCandidate[]>): void
  setOffline(offline: boolean): void
}

function harness(root: string): Harness {
  let fixtures = FIXTURES
  let offline = false
  let seq = 0
  const calls: string[] = []
  const deps: PlanDeps = {
    fs: fakeFs(),
    rootDir: root,
    offline: () => offline,
    search: async (source, query, limit) => {
      calls.push(`${source}:${query}:${limit}`)
      return fixtures[source].slice(0, limit)
    },
    newRunId: () => `run-test${++seq}`,
  }
  return {
    deps,
    get calls() { return calls },
    setFixture(next) { fixtures = next },
    setOffline(next) { offline = next },
  }
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-plan-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('plan：保存确定（同内容同 planId、保留 createdAt）+ list', async () => {
  await withRoot(async root => {
    const h = harness(root)
    const first = await savePlan(h.deps, 'proj', { text: 'retrieval augmented generation', perSourceLimit: 10 })
    const second = await savePlan(h.deps, 'proj', { text: 'retrieval augmented generation', perSourceLimit: 10 })
    assert.equal(first.planId, second.planId)
    assert.equal(first.createdAt, second.createdAt, '重复保存保留原 createdAt')
    assert.deepEqual([...first.sources], ['arxiv', 'openalex', 'crossref'])
    const listed = await listPlans(h.deps, 'proj')
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.planId, first.planId)
    const files = await readdir(join(root, 'proj', 'literature', 'searches'))
    assert.deepEqual(files, [`${first.planId}.json`])
    const planFile = JSON.parse(await readFile(join(root, 'proj', 'literature', 'searches', `${first.planId}.json`), 'utf8')) as Record<string, unknown>
    assert.equal(planFile['schemaVersion'], 1)
    assert.deepEqual(planFile['query'], { text: 'retrieval augmented generation' })
  })
})

test('plan.run：三源并发→identityKey 去重→稳定排序→快照；两次 run 同 resultHash', async () => {
  await withRoot(async root => {
    const h = harness(root)
    const plan = await savePlan(h.deps, 'proj', { text: 'graph neural networks' })
    const run1 = await runPlan(h.deps, 'proj', plan.planId)
    assert.equal(h.calls.length, 3, '恰好三源各一次')
    assert.equal(run1.counts.identified, 5)
    assert.equal(run1.counts.deduped, 4, '同 DOI 跨源合并')
    assert.deepEqual(run1.counts.bySource, { arxiv: 2, openalex: 2, crossref: 1 })
    const runDir1 = join(root, 'proj', 'literature', 'runs', run1.runId)
    const lines = (await readFile(join(runDir1, 'results.jsonl'), 'utf8')).split('\n').filter(Boolean)
    assert.equal(lines.length, 4)
    const keys = lines.map(line => (JSON.parse(line) as { identityKey: string }).identityKey)
    assert.deepEqual(keys, [...keys].sort(), '结果按 identityKey 升序')
    assert.equal(new Set(keys).size, keys.length, '无重复 identityKey')
    const summary = JSON.parse(await readFile(join(runDir1, 'summary.json'), 'utf8')) as { resultHash: string }
    assert.equal(summary.resultHash, run1.resultHash)
    assert.equal(run1.resultHash, resultHashOf([...keys].sort()))
    assert.equal(createHash('sha256').update(JSON.stringify([...keys].sort())).digest('hex'), run1.resultHash)
    const planCopy = JSON.parse(await readFile(join(runDir1, 'plan.json'), 'utf8')) as { planId: string }
    assert.equal(planCopy.planId, plan.planId)

    const run2 = await runPlan(h.deps, 'proj', plan.planId)
    assert.equal(run2.resultHash, run1.resultHash, '同一计划连续两次 resultHash 必须一致（确定性）')
    assert.notEqual(run2.runId, run1.runId)
  })
})

test('plan.replay：只读本地 results.jsonl（零 search 调用），离线可用，diff 为空', async () => {
  await withRoot(async root => {
    const h = harness(root)
    const plan = await savePlan(h.deps, 'proj', { text: 'replay test' })
    const run = await runPlan(h.deps, 'proj', plan.planId)
    const callsAfterRun = h.calls.length
    h.setOffline(true)
    // 离线：plan 存储与 replay 仍可用；run 必须 OFFLINE
    const listed = await listPlans(h.deps, 'proj')
    assert.equal(listed.length, 1)
    await assert.rejects(() => runPlan(h.deps, 'proj', plan.planId), (e: unknown) => (e as { code?: string }).code === 'OFFLINE')
    const replay = await replayPlan(h.deps, 'proj', plan.planId)
    assert.equal(h.calls.length, callsAfterRun, 'replay 零联网')
    assert.equal(replay.runId, run.runId)
    assert.equal(replay.resultHash, run.resultHash)
    assert.equal(replay.recomputedHash, run.resultHash)
    assert.equal(replay.consistent, true)
    assert.deepEqual(replay.diff.added, [])
    assert.deepEqual(replay.diff.removed, [])
    assert.deepEqual(replay.integrity.added, [])
    assert.deepEqual(replay.integrity.removed, [])
  })
})

test('plan.run：单源失败残留 errors 不拖垮整批；plan.replay diff 反映跨 run 新增/消失', async () => {
  await withRoot(async root => {
    const h = harness(root)
    const plan = await savePlan(h.deps, 'proj', { text: 'drift test' })
    const first = await runPlan(h.deps, 'proj', plan.planId)
    // 第二次：去掉 Crossref，新增一个 OpenAlex 条目
    h.setFixture({
      ...FIXTURES,
      crossref: [],
      openalex: [...FIXTURES.openalex, candidate('openalex', { title: 'Fresh Work', year: 2026, doi: '10.4000/fresh' })],
    })
    const second = await runPlan(h.deps, 'proj', plan.planId)
    const replay = await replayPlan(h.deps, 'proj', plan.planId)
    assert.equal(replay.consistent, true)
    assert.equal(replay.previousRunId, first.runId)
    assert.ok(replay.diff.added.includes('doi:10.4000/fresh'))
    assert.ok(replay.diff.removed.includes('doi:10.3000/cr'))
    assert.equal(second.resultHash, replay.resultHash)

    // 单源异常：错误写进 summary，不抛
    h.setFixture({ ...FIXTURES, crossref: [] })
    const failing = harness(root)
    failing.setFixture(FIXTURES)
    const failingDeps: PlanDeps = {
      ...failing.deps,
      search: async source => {
        if (source === 'crossref') throw Object.assign(new Error('crossref down'), { code: 'UPSTREAM' })
        return FIXTURES[source]
      },
    }
    const third = await runPlan(failingDeps, 'proj', plan.planId)
    assert.equal(third.errors.length, 1)
    assert.equal(third.errors[0]?.source, 'crossref')
    assert.equal(third.errors[0]?.code, 'UPSTREAM')
    assert.equal(third.counts.bySource.crossref, 0)
    assert.ok(third.counts.identified > 0)
  })
})

test('plan：year 过滤保留未知年（可解释），limit 服务端钳 1..50', async () => {
  await withRoot(async root => {
    const h = harness(root)
    const plan = await savePlan(h.deps, 'proj', {
      text: 'filters',
      filters: { yearFrom: 2024, yearTo: 2025 },
      perSourceLimit: 999,
    })
    assert.equal(plan.perSourceLimit, 50, 'perSourceLimit 钳到 50')
    const run = await runPlan(h.deps, 'proj', plan.planId)
    // arxiv：2024 保留、2022 过滤；openalex：2024/2025 保留；crossref 2021 过滤
    assert.equal(run.counts.bySource.arxiv, 1)
    assert.equal(run.counts.bySource.openalex, 2)
    assert.equal(run.counts.bySource.crossref, 0)
    const keys = run.resultKeys
    assert.ok(keys.includes(identityKey({ doi: '10.1000/shared', title: 'x', year: 2024 })))
  })
})
