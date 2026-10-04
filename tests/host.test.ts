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
import { assertInsideRoot, hostHome, PathSafetyError, writeBinary } from '../src/host.ts'
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
  assert.deepEqual(hostHome(fakeEnv({ DSH_HOME: '/d' })),
    { channel: 'dsh', home: '/d' })
  // DSH 桌面端实测形态（两个 env 都不设）：unknown 且 home 空（不硬编 ~/.qilin 误导）
  assert.deepEqual(hostHome(fakeEnv({ QILIN_HOME: undefined, DSH_HOME: undefined })),
    { channel: 'unknown', home: '' })
})

test('assertInsideRoot：包含放行，../ 与绝对注入拒绝，能力缺失 fail-closed', async () => {
  // fake 的 resolve/contains 按 canonical 语义实现（与 ctx.fs 一致：
  // resolve 落绝对路径，contains 做规范化后的前缀判断）。
  const fs = {
    resolve: (rel: string, opts?: { cwd?: string }) => nodePath.resolve(opts?.cwd ?? process.cwd(), rel),
    contains: (parent: string, child: string) => {
      const p = nodePath.resolve(parent)
      const c = nodePath.resolve(child)
      return c === p || c.startsWith(`${p}/`)
    },
  }
  assert.equal(await assertInsideRoot(fs, '/root', 'a/b.txt'), '/root/a/b.txt')
  await assert.rejects(() => assertInsideRoot(fs, '/root', '../escape.txt'), PathSafetyError)
  await assert.rejects(() => assertInsideRoot(fs, '/root', '/etc/passwd'), PathSafetyError)
  // resolve 结果逃出 root（符号链接落点在外）
  const symlinkFs = {
    resolve: () => '/outside/x',
    contains: (parent: string, child: string) => child.startsWith(parent),
  }
  await assert.rejects(() => assertInsideRoot(symlinkFs, '/root', 'link'), PathSafetyError)
  // fail-closed：无 contains 能力必须拒绝，而不是放行
  await assert.rejects(() => assertInsideRoot(undefined, '/root', 'a.txt'), PathSafetyError)
  await assert.rejects(() => assertInsideRoot({}, '/root', 'a.txt'), PathSafetyError)
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
