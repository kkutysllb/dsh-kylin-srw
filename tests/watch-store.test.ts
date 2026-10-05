/** watch.json 存储往返 + 校验门（0204 Task 3.1）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { ServiceError } from '../src/service.ts'
import { WatchStore } from '../src/watch/store.ts'
import { schedulePrompt, scheduleTitle, validateWatchInput, type WatchSub } from '../src/watch/model.ts'

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

function sub(overrides: Partial<WatchSub> = {}): WatchSub {
  return {
    id: 'sub-test01',
    project: 'review',
    source: 'arxiv',
    query: 'ti:"peer review"',
    everySeconds: 86_400,
    enabled: true,
    createdAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  }
}

async function makeStore(): Promise<{ store: WatchStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'srw-watch-'))
  return { store: new WatchStore(root, fakeFs()), root }
}

test('watch：空表 → upsert → 往返一致；revision 单调', async () => {
  const { store, root } = await makeStore()
  try {
    const empty = await store.load()
    assert.equal(empty.revision, 0)
    assert.deepEqual(empty.subs, [])
    await store.upsertSub(sub())
    const doc = await store.upsertSub(sub({ id: 'sub-test02', source: 'openalex', enabled: false }))
    assert.equal(doc.revision, 2)
    const reread = JSON.parse(await readFile(join(root, '.srw', 'watch.json'), 'utf8'))
    assert.equal(reread.schemaVersion, 1)
    assert.equal(reread.subs.length, 2)
    const loaded = await store.load()
    assert.deepEqual(loaded.subs.map(item => item.id).sort(), ['sub-test01', 'sub-test02'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：update 原地改 + remove；STALE 拒写', async () => {
  const { store, root } = await makeStore()
  try {
    await store.upsertSub(sub())
    const doc = await store.update(subs => subs.map(item =>
      item.id === 'sub-test01' ? { ...item, lastResult: { at: '2026-10-05T01:00:00.000Z', kind: 'ok', fresh: 3 } } : item))
    assert.equal(doc.subs[0]?.lastResult?.fresh, 3)
    // 陈旧期望版本拒绝
    await assert.rejects(
      () => store.save(doc, doc.revision - 1),
      (error: unknown) => error instanceof ServiceError && error.code === 'STALE',
    )
    await store.removeSub('sub-test01')
    assert.deepEqual((await store.load()).subs, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：坏 JSON 抛 INVALID 不清空', async () => {
  const { store, root } = await makeStore()
  try {
    await store.upsertSub(sub())
    await writeFile(join(root, '.srw', 'watch.json'), '{oops', 'utf8')
    await assert.rejects(
      () => store.load(),
      (error: unknown) => error instanceof ServiceError && error.code === 'INVALID',
    )
    const raw = await readFile(join(root, '.srw', 'watch.json'), 'utf8')
    assert.equal(raw, '{oops', '坏文件不许被静默清空')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：入参校验——query 空 / every<900 / source 非法 / slug 非法全拒', () => {
  assert.throws(() => validateWatchInput({ project: 'p', source: 'arxiv', query: '  ' }), /query/)
  assert.throws(() => validateWatchInput({ project: 'p', source: 'arxiv', query: 'x', everySeconds: 60 }), /900/)
  assert.equal(validateWatchInput({ project: 'p', source: 'arxiv', query: 'x', everySeconds: 604_800 }).everySeconds, 604_800, '每周订阅合法（宿主仅限 ≥60）')
  assert.throws(() => validateWatchInput({ project: 'p', source: 'semantic-scholar', query: 'x' }), /source/)
  assert.throws(() => validateWatchInput({ project: 'Bad Slug', source: 'arxiv', query: 'x' }), /slug/)
  const okInput = validateWatchInput({ project: 'p', source: 'crossref', query: 'x', everySeconds: 'junk' })
  assert.equal(okInput.everySeconds, 86_400, '缺省/非法频率回退每日')
})

test('watch：时钟任务标题与 prompt 确定性自包含', () => {
  const s = sub({ id: 'sub-abc', query: 'attention' })
  assert.equal(scheduleTitle(s), 'SRW订阅 sub-abc attention')
  assert.equal(scheduleTitle(sub({ id: 'sub-abc', query: 'a'.repeat(50) })), `SRW订阅 sub-abc ${'a'.repeat(40)}…`)
  const prompt = schedulePrompt({ id: 'sub-abc', project: 'review' })
  assert.match(prompt, /srw_watch/)
  assert.match(prompt, /action="run"/)
  assert.match(prompt, /sub-abc/)
})
