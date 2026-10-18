/** M0 骨架测试：宿主纯逻辑（diag/host）与 RPC 分发的失败测试先行。
 * 不依赖外网、不依赖真实宿主——fake ctx 结构化注入。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodePath from 'node:path'
import { collectCaps } from '../src/diag.ts'
import { hostHome, writeBinary } from '../src/host.ts'
import { SrwService } from '../src/service.ts'
import { handleSrwRpc, registerSrwRpc } from '../src/rpc.ts'

const fakeEnv = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  ...process.env as Record<string, string | undefined>,
  ...over,
})

test('collectCaps：存在服务 true、缺席服务 false、路径探测不抛错', () => {
  const ctx = {
    connection: { requestRejection: () => undefined },
    webServer: { register: () => () => {} },
    fs: {},
  }
  const caps = collectCaps(ctx)
  const byName = new Map(caps.map(row => [row.name, row]))
  assert.equal(byName.get('connection')?.available, true)
  assert.equal(byName.get('connection.requestRejection')?.available, true)
  assert.equal(byName.get('webServer')?.available, true)
  // fs 存在但 contains/writeBytes 缺席（DSH 侧已知子集）
  assert.equal(byName.get('fs')?.available, true)
  assert.equal(byName.get('fs.contains')?.available, false)
  assert.equal(byName.get('fs.writeBytes')?.available, false)
  // 完全缺席
  assert.equal(byName.get('ssh')?.available, false)
  assert.equal(byName.get('llm.stream')?.available, false)
  // getter 抛错也不炸
  const hostile = new Proxy({}, { get() { throw new Error('boom') } })
  assert.equal(collectCaps(hostile).every(row => row.available === false), true)
})

test('hostHome：QILIN_HOME 优先，其次 DSH_HOME；都无则 unknown 且不猜 home', () => {
  assert.deepEqual(hostHome(fakeEnv({ QILIN_HOME: '/q', DSH_HOME: '/d' })),
    { channel: 'qilin', home: '/q' })
  // 注意：本用例在麒麟进程内跑时真实 env 带 QILIN_HOME，必须显式清空，
  // 否则用例断言的是宿主环境而不是被测函数（2026-10-09 实测踩中）。
  assert.deepEqual(hostHome(fakeEnv({ QILIN_HOME: undefined, DSH_HOME: '/d' })),
    { channel: 'dsh', home: '/d' })
  // DSH 桌面端实测形态（两个 env 都不设）：unknown 且 home 空（不硬编 ~/.qilin 误导）
  assert.deepEqual(hostHome(fakeEnv({ QILIN_HOME: undefined, DSH_HOME: undefined })),
    { channel: 'unknown', home: '' })
})

test('diagContains：resolve→contains 真值测量；越界 false、能力缺失 NO_PROVIDER、resolve 异常 false+detail', async () => {
  const fsLike = {
    resolve: (rel: string, opts?: { cwd?: string }) => ({
      key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel),
    }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = nodePath.resolve(parent.key)
      const c = nodePath.resolve(child.key)
      return c === p || c.startsWith(`${p}/`)
    },
  }
  const ok = await SrwService.open({ fs: fsLike }, {})
  assert.deepEqual(await ok.diagContains('/root', 'a/b.txt'), { contained: true })
  assert.deepEqual(await ok.diagContains('/root', '../escape'), { contained: false })
  // 能力缺失（fs 未注入）→ NO_PROVIDER
  const bare = await SrwService.open({}, {})
  await assert.rejects(() => bare.diagContains('/root', 'a.txt'),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'NO_PROVIDER')
  // resolve 抛错（路径不存在）→ contained:false + detail
  const broken: typeof fsLike = {
    resolve: (rel: string) => { throw new Error(`enoent: ${rel}`) },
    contains: () => true,
  }
  const withBroken = await SrwService.open({ fs: broken }, {})
  const bad = await withBroken.diagContains('/root', 'ghost.txt')
  assert.equal(bad.contained, false)
  assert.match(bad.detail ?? '', /enoent/)
})

test('handleSrwRpc R2：root.set/get、project 五端点、overview', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'srw-r2-'))
  try {
    const fsLike = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({
        key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel),
      }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = nodePath.resolve(parent.key)
        const c = nodePath.resolve(child.key)
        return c === p || c.startsWith(`${p}/`)
      },
    }
    const service = await SrwService.open({ fs: fsLike }, {})
    const signal = new AbortController().signal
    const call = async (endpoint: string, payload?: unknown) =>
      (await handleSrwRpc(service, endpoint, payload, signal)) as { ok: boolean; value?: unknown; error?: { code: string } }

    // root.set → root.get
    const set = await call('root.set', { path: root })
    assert.equal(set.ok, true)
    const got = await call('root.get')
    assert.equal(got.ok, true)
    const gotValue = got.value as { rootDir: string; projects: unknown[]; caps: unknown[]; info: { version: string } }
    assert.equal(gotValue.rootDir, root)
    assert.deepEqual(gotValue.projects, [])
    assert.ok(Array.isArray(gotValue.caps))
    assert.equal(gotValue.info.version, '0.0.1')
    // root.set 越界 → INVALID 语义错误（ok:false）
    const badSet = await call('root.set', { path: '/nonexistent-srw-xyz/deeper' })
    assert.equal(badSet.ok, false)
    // project.create → list → open → rename → remove
    assert.equal((await call('project.create', { slug: 'epic', title: 'Epic', field: 'nlp' })).ok, true)
    const list = await call('project.list')
    assert.equal((list.value as { slug: string }[]).length, 1)
    const opened = await call('project.open', { slug: 'epic' })
    assert.equal((opened.value as { title: string }).title, 'Epic')
    assert.equal(service.indexGlobal().activeProject, 'epic')
    const renamed = await call('project.rename', { slug: 'epic', title: 'Epic2' })
    assert.equal((renamed.value as { title: string }).title, 'Epic2')
    assert.equal((await call('project.remove', { slug: 'epic' })).ok, true)
    assert.equal(((await call('project.list')).value as unknown[]).length, 0)
    // overview 形状
    const overview = await call('overview')
    const ov = overview.value as { rootDir: string; projectCount: number; activeProject: string; capsOk: number; capsTotal: number; version: string; offlineMode: boolean }
    assert.equal(ov.rootDir, root)
    assert.equal(ov.projectCount, 0)
    assert.equal(ov.capsTotal, ov.capsOk + (ov.capsTotal - ov.capsOk))
    assert.equal(ov.version, '0.0.1')
    // 入参校验：缺 path/slug → INVALID
    assert.equal((await call('root.set', {})).error?.code, 'INVALID')
    assert.equal((await call('project.open', {})).error?.code, 'INVALID')
    assert.equal((await call('project.open', { slug: 'ghost' })).error?.code, 'NOT_FOUND')
    await service.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeBinary：ctx.fs.writeBytes 可用则走 ctx.fs；否则 node:fs 原子落盘', async () => {
  let ctxFsPath = ''
  const viaCtx = await writeBinary({ writeBytes: async (path: string) => { ctxFsPath = path } }, '/tmp/x.bin', new Uint8Array([1]))
  assert.equal(viaCtx.via, 'ctx.fs')
  assert.equal(ctxFsPath, '/tmp/x.bin')

  const dir = await mkdtemp(join(tmpdir(), 'srw-writebin-'))
  try {
    const target = join(dir, 'data.bin')
    const bytes = new Uint8Array([1, 2, 3, 250])
    const result = await writeBinary(undefined, target, bytes)
    assert.equal(result.via, 'node:fs')
    const written = await readFile(target)
    assert.deepEqual([...written], [1, 2, 3, 250])
    // 无残留 tmp 文件
    const leftovers = (await import('node:fs/promises')).readdir(dir)
    assert.deepEqual([...await leftovers].filter(name => name.includes('.srw-tmp-')), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('handleSrwRpc：ping/echo/caps 正常，未知端点 not-found', async () => {
  const service = await SrwService.open({ webServer: {} }, { rootDir: '', offlineMode: true })
  const signal = new AbortController().signal

  const ping = await handleSrwRpc(service, 'diag.ping', {}, signal)
  assert.equal(ping.ok, true)
  assert.equal((ping as { value: { pong: boolean } }).value.pong, true)

  const caps = await handleSrwRpc(service, 'diag.caps', {}, signal)
  assert.equal(caps.ok, true)
  const value = (caps as { value: { caps: unknown[]; info: { offlineMode: boolean } } }).value
  assert.equal(Array.isArray(value.caps), true)
  assert.equal(value.info.offlineMode, true)

  const echo = await handleSrwRpc(service, 'diag.echo', { a: 1 }, signal)
  assert.deepEqual((echo as { value: unknown }).value, { echoed: { a: 1 } })

  const unknown = await handleSrwRpc(service, 'diag.nope', {}, signal)
  assert.equal(unknown.ok, false)
  assert.equal((unknown as { error: { code: string } }).error.code, 'not-found')
  // 信封契约（vendored client parseConnectionResponse）：失败分支的 error
  // 必须是 record 且带 string code/message + **record details**——缺 details
  // 客户端直接抛 "invalid server-response failure"（2026-10-04 用户实测踩中）。
  if (unknown.ok !== false) throw new Error('unreachable')
  const err = unknown.error
  assert.equal(typeof err.code, 'string')
  assert.equal(typeof err.message, 'string')
  assert.equal(typeof err.details, 'object')
  assert.notEqual(err.details, null)
  assert.ok(!Array.isArray(err.details))
})

test('registerSrwRpc：webServer 缺席抛 NO_PROVIDER；fake 双服务可注册可注销', async () => {
  const service = await SrwService.open({}, {})
  assert.throws(() => registerSrwRpc({}, service), (error: unknown) =>
    (error as { code?: string }).code === 'NO_PROVIDER')

  let registeredPath = ''
  let disposed = false
  const disposers: Array<() => unknown> = []
  const ctx = {
    effect: (factory: () => unknown) => {
      const d = factory() as () => unknown
      disposers.push(d)
      return d
    },
    webServer: {
      register: (route: { path: string }) => {
        registeredPath = route.path
        return () => { disposed = true }
      },
    },
    connection: { requestRejection: () => undefined },
  }
  const remove = registerSrwRpc(ctx, service)
  assert.equal(registeredPath, '/dsh-kylin-srw')
  await remove()
  assert.equal(disposed, true)
  assert.equal(disposers.length, 1)
})
