/** 元数据自愈（2026-10-05 桌面端实测：agent 组 import 参数剪掉 authors/year
 * → 库里 year=0、authors=[]、citekey 退化为 unknownnd-*）。三道闸：
 * 1) import 时带 arxivId 的瘦候选自动批量补全（只补空缺，失败/离线不阻断）；
 * 2) upsert 重复条目 enrich 治愈存量坏数据（year/authors）；
 * 3) 输出保持无损 JSON。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { LiteratureService } from '../src/literature/service.ts'
import type { LitCandidate } from '../src/literature/types.ts'

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

const FULL: LitCandidate = {
  source: 'arxiv',
  identity: { arxivId: '2606.09498v3', title: 'Self-Harness', year: 2026 },
  authors: ['Ada Lovelace', 'Grace Hopper'],
  venue: 'arXiv',
  abstract: 'authoritative abstract',
  pdfUrl: 'https://arxiv.org/pdf/2606.09498v3',
}

/** 瘦候选：agent 实测形态——只有 source/arxivId/title。 */
const THIN_INPUT = { source: 'arxiv', identity: { arxivId: '2606.09498v3', title: 'Self-Harness' } }

async function makeService(opts: {
  offline?: boolean
  enrich?: (ids: readonly string[]) => Promise<readonly LitCandidate[]>
}): Promise<{ service: LiteratureService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'srw-enrich-'))
  const service = new LiteratureService({
    fs: fakeFs(),
    offlineMode: () => opts.offline === true,
    rootDir: () => root,
    ...(opts.enrich !== undefined ? { enrichByIds: opts.enrich } : {}),
  })
  return { service, root }
}

async function storedEntries(root: string, slug: string): Promise<Record<string, {
  identity: { year: number; arxivId?: string }
  authors: readonly string[]
  pdfUrl?: string
}>> {
  const raw = await readFile(join(root, slug, 'literature', 'library.json'), 'utf8')
  return (JSON.parse(raw) as { entries: Record<string, never> })['entries'] as never
}

/** 无损断言（同 tools.test.ts 的门：值树禁 undefined）。 */
function assertLossless(value: unknown, path = '$'): void {
  if (value === undefined) throw new Error(`lossless violated: undefined at ${path}`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLossless(item, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) assertLossless(item, `${path}.${key}`)
  }
}

test('自愈：瘦候选入库前按 arxivId 批量补全（只补空缺；汇报 enriched）', async () => {
  const calls: string[][] = []
  const { service, root } = await makeService({
    enrich: async ids => {
      calls.push([...ids])
      return [FULL]
    },
  })
  try {
    await service.importEntries('heal', [THIN_INPUT])
    const entries = await storedEntries(root, 'heal')
    const entry = entries['arxiv:2606.09498']!
    assert.ok(entry !== undefined, '条目应存在')
    assert.equal(entry.identity.year, 2026)
    assert.deepEqual([...entry.authors], ['Ada Lovelace', 'Grace Hopper'])
    assert.equal(entry.pdfUrl, 'https://arxiv.org/pdf/2606.09498v3')
    // 调用方已给的 title 不被覆盖；id 去版本后批量（一次 id_list 调用）
    assert.deepEqual(calls, [['2606.09498']])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('自愈：完整候选不触发网络；调用方已给字段不被权威值覆盖', async () => {
  let calls = 0
  const { service, root } = await makeService({
    enrich: async ids => {
      calls += 1
      return [FULL]
    },
  })
  try {
    const complete = {
      source: 'arxiv',
      identity: { arxivId: '2606.09498', title: 'My Own Title', year: 2025 },
      authors: ['Local Author'],
      venue: 'arXiv',
      abstract: 'local',
    }
    const result = await service.importEntries('heal', [complete])
    assert.equal(calls, 0, 'year/authors 齐全 → 不应发起补全')
    assert.deepEqual(result.enriched, [])
    const entries = await storedEntries(root, 'heal')
    const entry = entries['arxiv:2606.09498']!
    assert.equal(entry.identity.year, 2025)
    assert.deepEqual([...entry.authors], ['Local Author'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('自愈：离线/补全失败都退化为原样入库（不阻断）', async () => {
  let calls = 0
  const bump = async (): Promise<{ service: LiteratureService; root: string }> => makeService({
    offline: false,
    enrich: async () => {
      calls += 1
      throw new Error('network down')
    },
  })
  const { service, root } = await bump()
  try {
    const result = await service.importEntries('heal', [THIN_INPUT])
    assert.equal(calls, 1)
    assert.deepEqual(result.enriched, [])
    const entries = await storedEntries(root, 'heal')
    const entry = entries['arxiv:2606.09498']!
    assert.equal(entry.identity.year, 0)
    assert.deepEqual([...entry.authors], [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  const offline = await makeService({ offline: true, enrich: async () => { throw new Error('不应被调用') } })
  try {
    const result = await offline.service.importEntries('heal2', [THIN_INPUT])
    assert.deepEqual(result.enriched, [])
    const entries = await storedEntries(offline.root, 'heal2')
    assert.equal(entries['arxiv:2606.09498']?.identity.year, 0)
  } finally {
    await rm(offline.root, { recursive: true, force: true })
  }
})

test('自愈：存量坏数据重导即愈——upsert 重复条目补 year/authors', async () => {
  let calls = 0
  const { service, root } = await makeService({
    offline: true, // 首次：离线瘦入库，制造 year=0/authors=[] 的存量
    enrich: async ids => {
      calls += 1
      return [FULL]
    },
  })
  try {
    await service.importEntries('heal', [THIN_INPUT])
    // 第二次：联网重导同一篇（完整候选走同一 importEntries；无 doi 不触网）
    const offlineFlag = { on: false }
    const live = new LiteratureService({
      fs: fakeFs(),
      offlineMode: () => offlineFlag.on,
      rootDir: () => root,
      enrichByIds: async ids => {
        calls += 1
        void ids
        return [FULL]
      },
    })
    offlineFlag.on = false
    const result = await live.importEntries('heal', [{
      source: 'arxiv',
      identity: { arxivId: '2606.09498', title: 'Self-Harness', year: 2026 },
      authors: ['Ada Lovelace', 'Grace Hopper'],
      venue: 'arXiv',
      abstract: 'authoritative abstract',
      pdfUrl: 'https://arxiv.org/pdf/2606.09498v3',
    }])
    assert.equal(result.added, 0, '同文重导应判重复')
    assert.equal(result.enriched.length, 0, '完整候选不需要自愈')
    const entries = await storedEntries(root, 'heal')
    const entry = entries['arxiv:2606.09498']!
    assert.equal(entry.identity.year, 2026, '存量 year=0 应被治愈')
    assert.deepEqual([...entry.authors], ['Ada Lovelace', 'Grace Hopper'], '存量空 authors 应被治愈')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('自愈：import 输出无损 JSON（enriched 数组含空态）', async () => {
  const { service, root } = await makeService({
    enrich: async () => [FULL],
  })
  try {
    const result = await service.importEntries('heal', [THIN_INPUT])
    assertLossless(result)
    assert.deepEqual(result.enriched, ['2606.09498'])
    assert.equal(JSON.parse(JSON.stringify(result)).enriched.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
