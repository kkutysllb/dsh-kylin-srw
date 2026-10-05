/** WatchManager 绑定层（0204 Task 3.2/3.3）：fake 时钟 + fake 文献服务。
 * 关键语义：订阅本体先落盘（真相源）；时钟绑定失败只降级不回滚；
 * run 幂等（重复 run 0 新增）；失败/离线落 lastResult。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { ServiceError } from '../src/service.ts'
import { WatchManager, type SchedulePort, type WatchLiterature } from '../src/watch/binding.ts'

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

interface FakeTask { id: string; sessionId: string; title: string; prompt: string; everySeconds: number }

/** 可用的 fake 时钟（上面的类型体操太绕，直接手写）。 */
function clock(): { port: SchedulePort; tasks: FakeTask[]; createShouldFail: { on: boolean } } {
  const tasks: FakeTask[] = []
  const createShouldFail = { on: false }
  let seq = 0
  return {
    tasks,
    createShouldFail,
    port: {
      create: async (sessionId, request) => {
        if (createShouldFail.on) throw new Error('schedule down')
        seq += 1
        const task: FakeTask = {
          id: `task-${seq}`,
          sessionId,
          title: String(request['title'] ?? ''),
          prompt: String(request['prompt'] ?? ''),
          everySeconds: typeof request['every_seconds'] === 'number' ? request['every_seconds'] : 0,
        }
        tasks.push(task)
        return { id: task.id }
      },
      remove: async input => {
        const index = tasks.findIndex(task => task.id === input.id && task.sessionId === input.sessionId)
        if (index === -1) throw new ServiceError('NOT_FOUND', `no task ${input.id}`)
        tasks.splice(index, 1)
      },
    },
  }
}

function literature(options: { fresh?: number[]; fail?: boolean } = {}): {
  port: WatchLiterature
  calls: { source: string; query: string; imports: number }[]
} {
  const calls: { source: string; query: string; imports: number }[] = []
  let run = 0
  return {
    calls,
    port: {
      search: async (source, query) => {
        if (options.fail === true) throw new ServiceError('UPSTREAM', 'arXiv 限速熔断')
        calls.push({ source, query, imports: 0 })
        return [{ source, identity: { title: `paper ${calls.length}`, year: 2026 }, authors: ['A'], venue: 'arXiv', abstract: 'x' }]
      },
      importEntries: async (_project, items) => {
        run += 1
        const fresh = options.fresh?.[run - 1] ?? items.length
        return { added: fresh, duplicates: 0, retracted: [], enriched: [] }
      },
    },
  }
}

async function makeManager(options?: { offline?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'srw-watchmgr-'))
  const schedule = clock()
  const lit = literature()
  const manager = new WatchManager({
    fs: fakeFs(),
    rootDir: () => root,
    offlineMode: () => options?.offline === true,
    schedule: schedule.port,
    literature: () => lit.port,
  })
  return { manager, root, schedule, lit }
}

test('watch：create 带 sessionId → 订阅落盘 + 时钟任务绑定（标题/prompt/频率正确）', async () => {
  const { manager, root, schedule } = await makeManager()
  try {
    const result = await manager.create({ project: 'review', source: 'arxiv', query: 'ti:"peer review"', everySeconds: 3600 }, 'sess-1')
    assert.equal(result.scheduled, true)
    assert.equal(result.sub.boundSessionId, 'sess-1')
    assert.equal(result.sub.scheduleId, 'task-1')
    assert.equal(schedule.tasks.length, 1)
    assert.match(schedule.tasks[0]?.title ?? '', /SRW订阅 /)
    assert.match(schedule.tasks[0]?.prompt ?? '', /action="run"/)
    assert.equal(schedule.tasks[0]?.everySeconds, 3600)
    // 订阅本体在盘上
    const subs = await manager.list()
    assert.equal(subs.length, 1)
    assert.equal(subs[0]?.scheduleId, 'task-1')
    void root
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：无会话建订阅 → 未排程有提示；时钟失败 → 降级不回滚', async () => {
  const { manager, root, schedule } = await makeManager()
  try {
    const noSession = await manager.create({ project: 'review', source: 'arxiv', query: 'x' })
    assert.equal(noSession.scheduled, false)
    assert.match(noSession.hint ?? '', /未绑定会话/)
    assert.equal(schedule.tasks.length, 0)
    assert.equal((await manager.list()).length, 1, '无会话订阅仍落盘')

    schedule.createShouldFail.on = true
    const failed = await manager.create({ project: 'review2', source: 'openalex', query: 'y' }, 'sess-2')
    assert.equal(failed.scheduled, false)
    assert.match(failed.hint ?? '', /时钟任务建立失败/)
    assert.equal((await manager.list()).length, 2, '失败不回滚订阅本体')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：pause 删时钟留订阅；resume 重建绑定；remove 双删', async () => {
  const { manager, root, schedule } = await makeManager()
  try {
    const created = await manager.create({ project: 'review', source: 'arxiv', query: 'x' }, 'sess-1')
    const id = created.sub.id
    const paused = await manager.pause(id)
    assert.equal(paused.enabled, false)
    assert.equal(paused.scheduleId, undefined)
    assert.equal(schedule.tasks.length, 0, '暂停即删时钟任务')
    assert.equal(paused.boundSessionId, 'sess-1', '绑定会话保留')

    const resumed = await manager.resume(id)
    assert.equal(resumed.scheduled, true)
    assert.equal(resumed.sub.enabled, true)
    assert.equal(schedule.tasks.length, 1, '恢复重建时钟任务')
    assert.equal(schedule.tasks[0]?.sessionId, 'sess-1')

    // resume 换绑会话
    const rebound = await manager.resume(id, 'sess-9')
    assert.equal(rebound.sub.boundSessionId, 'sess-9')
    assert.equal(schedule.tasks.length, 1)
    assert.equal(schedule.tasks[0]?.sessionId, 'sess-9')

    await manager.remove(id)
    assert.equal((await manager.list()).length, 0)
    assert.equal(schedule.tasks.length, 0, '删除即双删')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：run 搜索→入库→lastResult=ok；重复 run 幂等（第二次 fresh=0）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-watchmgr-'))
  const schedule = clock()
  const lit = literature({ fresh: [1, 0] })
  const manager = new WatchManager({ fs: fakeFs(), rootDir: () => root, offlineMode: () => false, schedule: schedule.port, literature: () => lit.port })
  try {
    const created = await manager.create({ project: 'review', source: 'crossref', query: 'peer review' }, 'sess-1')
    const id = created.sub.id
    const first = await manager.run(id)
    assert.equal(first.fresh, 1)
    assert.equal(lit.calls[0]?.source, 'crossref')
    const second = await manager.run(id)
    assert.equal(second.fresh, 0, '重复 run 幂等：第二次 0 新增')
    const subs = await manager.list()
    assert.equal(subs[0]?.lastResult?.kind, 'ok')
    assert.equal(subs[0]?.lastRunAt !== undefined, true)
    void root
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：run 失败/离线 → lastResult=error 落账后原样抛', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-watchmgr-'))
  const schedule = clock()
  const lit = literature({ fail: true })
  const manager = new WatchManager({
    fs: fakeFs(),
    rootDir: () => root,
    offlineMode: () => false,
    schedule: schedule.port,
    literature: () => lit.port,
  })
  try {
    const created = await manager.create({ project: 'review', source: 'arxiv', query: 'x' }, 'sess-1')
    await assert.rejects(
      () => manager.run(created.sub.id),
      (error: unknown) => error instanceof ServiceError && error.code === 'UPSTREAM',
    )
    const subs = await manager.list()
    assert.equal(subs[0]?.lastResult?.kind, 'error')
    assert.match(subs[0]?.lastResult?.error ?? '', /UPSTREAM/)

    const offline = new WatchManager({
      fs: fakeFs(),
      rootDir: () => root,
      offlineMode: () => true,
      schedule: schedule.port,
      literature: () => literature().port,
    })
    await assert.rejects(
      () => offline.run(created.sub.id),
      (error: unknown) => error instanceof ServiceError && error.code === 'OFFLINE',
    )
    const after = await manager.list()
    assert.match(after[0]?.lastResult?.error ?? '', /OFFLINE/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('watch：run 错误优先级——未设根 NO_ROOT 先于 NOT_FOUND（存储读取需根）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-watchmgr-'))
  const schedule = clock()
  const noRoot = new WatchManager({
    fs: fakeFs(),
    rootDir: () => undefined,
    offlineMode: () => false,
    schedule: schedule.port,
    literature: () => literature().port,
  })
  const withRoot = new WatchManager({
    fs: fakeFs(),
    rootDir: () => root,
    offlineMode: () => false,
    schedule: schedule.port,
    literature: () => literature().port,
  })
  try {
    await assert.rejects(
      () => noRoot.run('sub-nope'),
      (error: unknown) => error instanceof ServiceError && error.code === 'NO_ROOT',
    )
    await assert.rejects(
      () => withRoot.run('sub-nope'),
      (error: unknown) => error instanceof ServiceError && error.code === 'NOT_FOUND',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
