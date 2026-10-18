/** M7 工具与 RPC 面（离线）：审批矩阵（submit/cancel ask、其余豁免、未挂载不问）、
 * srw_experiment 十动作 dispatch（含 env.setup INVALID 占位与错误信封）、
 * lossless 输出纪律、handleSrwRpc experiment.hosts/status 直测、
 * src/compute 全目录宿主凭据字样 0 命中（安全门）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { approvalDecision, SRW_EXPERIMENT_TOOL_NAME, srwExperimentToolDef } from '../src/tools.ts'
import { handleSrwRpc } from '../src/rpc.ts'
import { SrwService, ServiceError } from '../src/service.ts'
import { ComputeService } from '../src/compute/service.ts'
import type { SrwFsLike } from '../src/host.ts'
import type { ComputeProvider, ExecOptions, ExecOutcome, HostTarget } from '../src/compute/provider.ts'
import { LAUNCH_OK_SENTINEL } from '../src/compute/submit.ts'
import { sha256Hex } from '../src/compute/types.ts'

const exec = (name: string, args?: unknown) => ({ name, arguments: args, signal: new AbortController().signal })

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

test('approval：submit/cancel 问（英文 reason + 双语 displayReason），其余动作与未挂载一律豁免', () => {
  const askSubmit = approvalDecision(exec(SRW_EXPERIMENT_TOOL_NAME, { action: 'submit', project: 'p' }), true)
  assert.equal(askSubmit?.kind, 'ask')
  assert.ok(askSubmit.reason.length > 0)
  assert.ok(askSubmit.displayReason.en.length > 0)
  assert.ok(askSubmit.displayReason.zh.length > 0)
  const askCancel = approvalDecision(exec(SRW_EXPERIMENT_TOOL_NAME, { action: 'cancel', project: 'p' }), true)
  assert.equal(askCancel?.kind, 'ask')
  for (const action of ['hosts', 'status', 'logs', 'collect', 'env.setup', 'claims.check', 'gaps.list', 'dataset.register']) {
    assert.equal(approvalDecision(exec(SRW_EXPERIMENT_TOOL_NAME, { action }), true), undefined, action + ' 应豁免')
  }
  assert.equal(approvalDecision(exec(SRW_EXPERIMENT_TOOL_NAME, { action: 'submit' }), false), undefined)
  assert.equal(approvalDecision(exec('other_tool', { action: 'submit' }), true), undefined)
})

/** 工具面用的轻量 harness：无 hosts.json（盘点 0 台也必须可用）。 */
async function makeToolHarness(): Promise<{ root: string; service: ComputeService; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'srw-tools-c-'))
  await mkdir(join(root, 'demo', 'experiments'), { recursive: true })
  const emptyHome = join(root, 'no-home')
  const remote = {
    files: new Map<string, Uint8Array>(),
    pids: new Map<number, boolean>(),
  }
  const provider: ComputeProvider = {
    kind: 'direct',
    async available() { return { ok: true, detail: 'fake' } },
    async exec(_host: HostTarget, argv: readonly string[], options?: ExecOptions): Promise<ExecOutcome> {
      if (argv[0] === 'sh' && argv[1] === '-c' && (argv[2] ?? '').includes('printf %s "$HOME"')) {
        return { code: 0, stdout: new TextEncoder().encode('/home/fake'), stderr: '', truncated: false }
      }
      if (argv[0] === 'sh' && argv[1] === '-c' && argv[2] === 'cat > "$1"') {
        remote.files.set(argv[4] ?? '', options?.input ?? new Uint8Array(0))
        return { code: 0, stdout: new Uint8Array(0), stderr: '', truncated: false }
      }
      if (argv[0] === 'bash' && (argv[1] ?? '').endsWith('/launch.sh')) {
        const dir = (argv[1] ?? '').slice(0, -'/launch.sh'.length)
        remote.files.set(dir + '/run.pid', new TextEncoder().encode('4242'))
        remote.files.set(dir + '/run.log', new TextEncoder().encode('starting\n'))
        remote.pids.set(4242, true)
        return { code: 0, stdout: new TextEncoder().encode(LAUNCH_OK_SENTINEL + '\n'), stderr: '', truncated: false }
      }
      return { code: 0, stdout: new Uint8Array(0), stderr: '', truncated: false }
    },
    async tailBytes(_h, path, fromByte) {
      const all = remote.files.get(path) ?? new Uint8Array(0)
      return { bytes: all.slice(fromByte), nextByte: all.byteLength, eof: true }
    },
    async putBytes(_h, remotePath, bytes) {
      remote.files.set(remotePath, bytes)
      return { sha256: sha256Hex(bytes) }
    },
    async getBytes(_h, remotePath) {
      const bytes = remote.files.get(remotePath)
      if (bytes === undefined) throw new ServiceError('NOT_FOUND', 'missing: ' + remotePath)
      return { bytes, truncated: false }
    },
  }
  const service = new ComputeService({ fs: fakeFs(), rootDir: () => root, provider, env: { QILIN_HOME: emptyHome }, killGraceMs: 50, cancelStepMs: 5, staleThreshold: 2 })
  return { root, service, cleanup: async () => { await rm(root, { recursive: true, force: true }) } }
}

/** 无损 JSON 断言（宿主对工具结果做 lossless 往返；显式 undefined 会丢键）。 */
function assertLossless(value: unknown, path = '$'): void {
  if (value === undefined) throw new Error('lossless violated: undefined at ' + path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLossless(item, path + '[' + String(index) + ']'))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) assertLossless(item, path + '.' + key)
  }
}

test('srw_experiment dispatch：register/hosts/gaps 走通、env.setup INVALID、未知 action 错误信封、render 纯文本、lossless', async () => {
  const h = await makeToolHarness()
  try {
    const def = srwExperimentToolDef({ experiment: h.service } as SrwService)
    assert.equal(def.name, 'srw_experiment')
    const run = async (args: unknown) => await def.execute(args, { agent: { session: { id: 's1', header: { cwd: '/w' } } } })
    // dataset.register
    const registered = await run({ action: 'dataset.register', project: 'demo', dataset: { id: 'ds-t', version: 'v1', title: 'T', hashPolicy: 'none' } }) as { ok: boolean; value: Record<string, unknown> }
    assert.equal(registered.ok, true)
    assertLossless(registered.value)
    // hosts：无 hosts.json → 0 台也 ok
    const hosts = await run({ action: 'hosts', project: 'demo', env: false }) as { ok: boolean; value: { count: number } }
    assert.equal(hosts.ok, true)
    assertLossless(hosts.value)
    // gaps：spec 缺 → 只剩 D1 缺数据集缺口
    const gaps = await run({ action: 'gaps.list', project: 'demo', expId: 'exp-x' }) as { ok: boolean; value: { counts: { P1: number } } }
    assert.equal(gaps.ok, true)
    assertLossless(gaps.value)
    // env.setup：占位 INVALID
    const envSetup = await run({ action: 'env.setup', project: 'demo' }) as { ok: boolean; error: { code: string } }
    assert.equal(envSetup.ok, false)
    assert.equal(envSetup.error.code, 'INVALID')
    // 未知 action
    const unknown = await run({ action: 'bogus' }) as { ok: boolean; error: { code: string } }
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'INVALID')
    // render 走纯文本 JSON
    const rendered = def.output.render({}, { a: 1 })
    assert.deepEqual(rendered, [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }])
  } finally {
    await h.cleanup()
  }
})

test('handleSrwRpc：experiment.hosts / experiment.status / experiment.dataset.register 直测', async () => {
  const h = await makeToolHarness()
  try {
    const stub = { experiment: h.service } as unknown as SrwService
    const hosts = await handleSrwRpc(stub, 'experiment.hosts', { project: 'demo', env: false }, new AbortController().signal)
    assert.equal(hosts.ok, true)
    const registered = await handleSrwRpc(stub, 'experiment.dataset.register', { project: 'demo', dataset: { id: 'ds-r', version: 'v1', title: 'R', hashPolicy: 'file' } }, new AbortController().signal)
    assert.equal(registered.ok, true)
    const status = await handleSrwRpc(stub, 'experiment.status', { project: 'demo', expId: 'exp-x' }, new AbortController().signal)
    assert.equal(status.ok, true)
    if (status.ok) assertLossless(status.value)
    const bad = await handleSrwRpc(stub, 'experiment.status', {}, new AbortController().signal)
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.equal(bad.error.code, 'INVALID')
    const notFound = await handleSrwRpc(stub, 'experiment.nope', {}, new AbortController().signal)
    assert.equal(notFound.ok, false)
  } finally {
    await h.cleanup()
  }
})

test('安全门：src/compute 全目录宿主凭据字样 0 命中；child_process 只出现在 provider', async () => {
  const srcRoot = new URL('..', import.meta.url).pathname + 'src/compute'
  const files = (await readdir(srcRoot)).filter(name => name.endsWith('.ts'))
  assert.ok(files.length >= 10, 'compute 模块应齐：' + files.join(','))
  for (const name of files) {
    const text = await readFile(join(srcRoot, name), 'utf8')
    assert.equal(/credentials/i.test(text), false, name + ' 不得出现凭据字样')
    assert.equal(/\.ssh\b|id_rsa|id_ed25519(?!.+)/.test(name) && false, false)
    if (name !== 'provider.ts') {
      assert.equal(text.includes('child_process'), false, name + ' 不应直接起进程（唯一例外 provider.ts）')
    }
  }
})
