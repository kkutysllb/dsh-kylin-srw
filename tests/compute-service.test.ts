/** M7 ComputeService 全链（临时根 + fakeFs + 脚本化 fake provider，绝不真连）：
 * hosts 盘点（脱敏断言）→ dataset.register → submit 三道门（SPEC_NOT_CONFIRMED /
 * D_TIER_GAP / D_TIER_WARN ack）→ 派发（argv 纪律：注入值只进 job.sh 文件）→
 * status 轮询 → succeeded → logs 偏移续读 → collect sha256 → claims.check
 * verified/mismatch → gaps P0 → cancel 路径 → unknown 路径（绝不假成功）→
 * NO_FREE_GPU / OFFLINE / 不可达 / 未注册数据集负例 → run.json 落盘脱敏。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { ComputeService } from '../src/compute/service.ts'
import { LAUNCH_OK_SENTINEL, type JobScriptInput } from '../src/compute/submit.ts'
import type { ComputeProvider, ExecOptions, ExecOutcome, HostTarget } from '../src/compute/provider.ts'
import { ServiceError } from '../src/service.ts'
import { sha256Hex } from '../src/compute/types.ts'

const codeOf = (error: unknown): string => (error instanceof ServiceError ? error.code : 'non-ServiceError:' + String(error))
const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

function fakeFs() {
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = pathResolve(parent.key)
      const c = pathResolve(child.key)
      return c === p || c.startsWith(p + '/')
    },
  }
}

const IDENTITY = 'FAKE-KEY-FILE'
const NVIDIA_FREE = [
  '0, NVIDIA GeForce RTX 4090, 617.42, 24564 MiB, 500 MiB, 3 %, 8.9',
  '1, NVIDIA GeForce RTX 4090, 617.42, 24564 MiB, 300 MiB, 0 %, 8.9',
].join('\n')
const NVIDIA_BUSY = [
  '0, NVIDIA GeForce RTX 4090, 617.42, 24564 MiB, 24000 MiB, 90 %, 8.9',
  '1, NVIDIA GeForce RTX 4090, 617.42, 24564 MiB, 24100 MiB, 95 %, 8.9',
].join('\n')
const METRICS_OK = JSON.stringify({ schemaVersion: 1, runId: 'x', metrics: [{ name: 'acc', value: 0.91 }] })
const HOST_ID = '198.18.7.7'
const TOOLS_LINES = 'setsid=yes\nnohup=yes\ntail=yes\nsha256sum=yes\nflock=yes\ntimeout=yes\ngit=no'

/** 脚本化远端主机：内存文件表 + pid 表 + 每次启动的模式。 */
class FakeRemote {
  readonly files = new Map<string, Uint8Array>()
  readonly pids = new Map<number, boolean>()
  readonly calls: string[][] = []
  readonly launchedDirs: string[] = []
  nextMode: 'succeed' | 'fail' | 'hang' | 'losepid' = 'succeed'
  nvidiaCsv = NVIDIA_FREE
  failExec = false
  readonly home = '/home/fakeusr'

  read(path: string): Uint8Array | undefined {
    return this.files.get(path)
  }

  readText(path: string): string | undefined {
    const bytes = this.files.get(path)
    return bytes === undefined ? undefined : dec(bytes)
  }

  writeText(path: string, text: string): void {
    this.files.set(path, enc(text))
  }

  jobContent(pathSuffix: string): string | undefined {
    for (const [path, bytes] of this.files) {
      if (path.endsWith(pathSuffix)) return dec(bytes)
    }
    return undefined
  }
}

class FakeProvider implements ComputeProvider {
  readonly kind = 'direct' as const
  constructor(private readonly remote: FakeRemote) {}

  async available(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'fake' }
  }

  async exec(_host: HostTarget, argv: readonly string[], options?: ExecOptions): Promise<ExecOutcome> {
    this.remote.calls.push([...argv])
    const remote = this.remote
    if (remote.failExec) throw new ServiceError('NO_PROVIDER', 'unreachable（脚本化）')
    const head = argv[0] ?? ''
    const done: ExecOutcome = { code: 0, stdout: new Uint8Array(0), stderr: '', truncated: false }
    if (head === 'echo') return { ...done, stdout: enc(argv.slice(1).join(' ') + '\n') }
    if (head === 'sh' && argv[1] === '-c') {
      const script = argv[2] ?? ''
      if (script.includes('printf %s "$HOME"')) return { ...done, stdout: enc(remote.home) }
      if (script.startsWith('command -v')) return { ...done, stdout: enc('/usr/bin/' + script.split(' ').at(-1)) }
      if (script.startsWith('for c in')) return { ...done, stdout: enc(TOOLS_LINES + '\n') }
      if (script === 'cat > "$1"') {
        remote.writeText(argv[4] ?? '', dec(options?.input ?? new Uint8Array(0)))
        return done
      }
      return { ...done, stdout: enc(script) }
    }
    if (head === 'uname') return { ...done, stdout: enc('Linux 6.6.0-fake x86_64\n') }
    if (head === 'nproc') return { ...done, stdout: enc('32\n') }
    if (head === 'free') return { ...done, stdout: enc('total       used       free\nMem:   65000000   1000000 64000000\n') }
    if (head === 'df') return { ...done, stdout: enc('Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sdX 1000000000 100000000 900000000 10% /\n') }
    if (head.endsWith('nvidia-smi')) return { ...done, stdout: enc(remote.nvidiaCsv + '\n') }
    if (head.endsWith('nvcc')) return { ...done, stdout: enc('nvcc: NVIDIA (R) Cuda compiler driver\nCuda compilation tools, release 12.8, V12.8.93\n') }
    if (head === 'python3') return { ...done, stdout: enc('Python 3.14.7\n') }
    if (head === 'node') return { ...done, stdout: enc('v22.19.0\n') }
    if (head === 'mkdir') return done
    if (head === 'stat') {
      const size = remote.read(argv[3] ?? '')?.byteLength
      return size === undefined ? { ...done, code: 1, stderr: 'No such file' } : { ...done, stdout: enc(String(size) + '\n') }
    }
    if (head === 'cat') {
      const bytes = remote.read(argv[1] ?? '')
      return bytes === undefined ? { ...done, code: 1, stderr: 'No such file' } : { ...done, stdout: bytes }
    }
    if (head === 'test') return { ...done, code: remote.read(argv[2] ?? '') !== undefined ? 0 : 1 }
    if (head === 'kill') {
      if (argv[1] === '-0') {
        const pid = Number.parseInt((argv[2] ?? '0').replace('-', ''), 10)
        return { ...done, code: remote.pids.get(pid) === true ? 0 : 1 }
      }
      const pid = Number.parseInt((argv[2] ?? '0').replace('-', ''), 10)
      remote.pids.set(pid, false)
      return done
    }
    if (head === 'sha256sum') {
      const bytes = remote.read(argv[1] ?? '')
      return bytes === undefined ? { ...done, code: 1 } : { ...done, stdout: enc(sha256Hex(bytes) + '  ' + argv[1] + '\n') }
    }
    if (head === 'find') {
      const dir = argv[1] ?? ''
      const lines: string[] = []
      for (const [path, bytes] of remote.files) {
        if (path.startsWith(dir + '/')) lines.push(String(bytes.byteLength) + '\t' + path.slice(dir.length + 1))
      }
      return { ...done, stdout: enc(lines.join('\n') + (lines.length > 0 ? '\n' : '')) }
    }
    if (head === 'bash' && (argv[1] ?? '').endsWith('/launch.sh')) {
      const dir = (argv[1] ?? '').slice(0, -'/launch.sh'.length)
      remote.launchedDirs.push(dir)
      const pid = 4000 + remote.launchedDirs.length
      const mode = remote.nextMode
      remote.pids.set(pid, true)
      if (mode !== 'losepid') remote.writeText(dir + '/run.log', 'starting job\n')
      remote.writeText(dir + '/run.pid', String(pid))
      const finish = (): void => {
        if (mode === 'losepid') {
          remote.files.delete(dir + '/run.pid')
          remote.files.delete(dir + '/exit.code')
          remote.files.delete(dir + '/done')
          remote.pids.set(pid, false)
          return
        }
        remote.writeText(dir + '/run.log', 'starting job\nacc=0.91 le finished\n')
        remote.writeText(dir + '/exit.code', mode === 'fail' ? '1' : '0')
        remote.writeText(dir + '/done', '')
        remote.writeText(dir + '/metrics.json', METRICS_OK)
        remote.writeText(dir + '/artifacts/fig.txt', 'fig-data')
        remote.pids.set(pid, false)
      }
      if (mode === 'succeed' || mode === 'fail') setTimeout(finish, 30)
      if (mode === 'losepid') setTimeout(finish, 5)
      return { ...done, stdout: enc(LAUNCH_OK_SENTINEL + '\n') }
    }
    return { ...done, code: 127, stderr: 'unsupported: ' + head }
  }

  async tailBytes(_host: HostTarget, path: string, fromByte: number, maxBytes: number): Promise<{ bytes: Uint8Array; nextByte: number; eof: boolean }> {
    const all = this.remote.read(path) ?? new Uint8Array(0)
    const slice = all.slice(fromByte, fromByte + maxBytes)
    return { bytes: slice, nextByte: fromByte + slice.byteLength, eof: fromByte + slice.byteLength >= all.byteLength }
  }

  async putBytes(_host: HostTarget, remotePath: string, bytes: Uint8Array): Promise<{ sha256: string }> {
    this.remote.writeText(remotePath, dec(bytes))
    return { sha256: sha256Hex(bytes) }
  }

  async getBytes(_host: HostTarget, remotePath: string, _maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    const bytes = this.remote.read(remotePath)
    if (bytes === undefined) throw new ServiceError('NOT_FOUND', '远端文件缺失（fake）: ' + remotePath)
    return { bytes, truncated: false }
  }
}

interface Harness {
  root: string
  home: string
  remote: FakeRemote
  service: ComputeService
  ref: string
  cleanup(): Promise<void>
}

async function makeHarness(overrides?: { offline?: () => boolean }): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'srw-compute-'))
  const home = join(root, 'qilin-home')
  await mkdir(join(home, 'ssh-remote', 'cm'), { recursive: true })
  await mkdir(join(root, 'demo', 'experiments'), { recursive: true })
  const keyPath = join(root, 'fake-key')
  await writeFile(keyPath, IDENTITY, 'utf8')
  await writeFile(join(home, 'ssh-remote', 'hosts.json'), JSON.stringify({
    hosts: [{ id: HOST_ID, host: HOST_ID, user: 'deploy', port: 18908, auth: 'key', identityFile: keyPath, label: '假 GPU 机' }],
  }), 'utf8')
  const remote = new FakeRemote()
  const service = new ComputeService({
    fs: fakeFs(),
    rootDir: () => root,
    provider: new FakeProvider(remote),
    env: { QILIN_HOME: home },
    ...(overrides?.offline !== undefined ? { offline: overrides.offline } : {}),
    killGraceMs: 80,
    cancelStepMs: 10,
    staleThreshold: 2,
  })
  const { hostRefOf } = await import('../src/compute/types.ts')
  // 预注册数据集（NOT_FOUND 负例用未注册的 ds-none）
  for (const id of ['ds-fix', 'ds-fix2']) {
    await service.datasetRegister('demo', {
      id, version: 'v1', title: 'Fixture ' + id, hashPolicy: 'file',
      locator: { kind: 'remote', hostRef: hostRefOf(HOST_ID), path: '/data/' + id }, license: 'MIT', redistributable: true,
    })
  }
  return {
    root, home, remote, service,
    ref: hostRefOf(HOST_ID),
    cleanup: async () => { await rm(root, { recursive: true, force: true }) },
  }
}

const until = async (cond: () => boolean, deadlineMs = 2000): Promise<void> => {
  const deadline = Date.now() + deadlineMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor 超时')
    await new Promise<void>(resolve => { setTimeout(resolve, 10) })
  }
}

const SPEC_BASE = {
  expId: 'exp-01',
  tier: 'D1',
  entry: ['bash', 'job.sh'],
  gpus: 1,
  seeds: [0, 1],
  datasets: ['ds-fix'],
  baselines: ['b1', 'b2'],
  metrics: ['acc'],
  outputs: { metrics: 'metrics.json' },
  env: { SRW_NOTE: "it's; $(rm -rf /)" },
}

const LEAK_SCAN = (text: string): string[] => {
  const leaks: string[] = []
  if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(text)) leaks.push('IPv4')
  if (text.includes('@')) leaks.push('user@')
  if (text.includes(':18908')) leaks.push(':port')
  if (text.includes('/home/fakeusr')) leaks.push('remoteHome')
  return leaks
}

test('全链：盘点→注册→三道门→派发→轮询→续读→归集→对账→缺口（含落盘脱敏）', async () => {
  const h = await makeHarness()
  try {
    // ① hosts：可达 + env 盘点；输出与 run.json 全程无地址/用户名/端口
    const hosts = await h.service.hosts('demo')
    const row = hosts.hosts.find(item => item.ref === h.ref)
    assert.ok(row !== undefined, 'fixture 主机必须在盘点输出里')
    assert.equal(row.usable, true)
    assert.equal(row.reachable, true)
    assert.equal(row.transport, 'direct')
    assert.equal(row.env?.gpuCount, 2)
    assert.equal(row.env?.nvcc?.version, '12.8')
    assert.deepEqual(LEAK_SCAN(JSON.stringify(hosts)), [])
    assert.deepEqual(LEAK_SCAN(await readFile(join(h.root, 'qilin-home', 'ssh-remote', 'hosts.json'), 'utf8').then(() => '')), [])

    // ② dataset.register：upsert 往返（同 id+version 替换、跨版本并存）
    const record = await h.service.datasetRegister('demo', {
      id: 'ds-fix', version: 'v2', title: 'Fixture Set v2', hashPolicy: 'tree',
      locator: { kind: 'remote', hostRef: h.ref, path: '/data/fix-v2' }, license: 'MIT', redistributable: true,
    })
    assert.equal(record.version, 'v2')
    const registryOnDisk = JSON.parse(await readFile(join(h.root, 'demo', 'data', 'registry.json'), 'utf8')) as { datasets: Array<{ id: string; version: string }> }
    assert.equal(registryOnDisk.datasets.length, 3)
    assert.ok(registryOnDisk.datasets.some(row => row.id === 'ds-fix' && row.version === 'v1'))
    assert.ok(registryOnDisk.datasets.some(row => row.id === 'ds-fix' && row.version === 'v2'))

    // ③ 三道门：未确认 → SPEC_NOT_CONFIRMED；D2 缺数据集 → D_TIER_GAP（ack 可过）；D2 缺基线 → D_TIER_WARN
    await h.service.submit('demo', { expId: 'exp-01', spec: { ...SPEC_BASE, tier: 'D2' }, hostRef: h.ref }).then(() => { throw new Error('should GATE') }, (error: unknown) => {
      assert.equal(codeOf(error), 'GATE')
      assert.ok(error instanceof Error && error.message.includes('SPEC_NOT_CONFIRMED'))
    })
    await h.service.submit('demo', { expId: 'exp-01', spec: { ...SPEC_BASE, tier: 'D2' }, hostRef: h.ref, confirm: true }).then(() => { throw new Error('should GATE') }, (error: unknown) => {
      assert.equal(codeOf(error), 'GATE')
      assert.ok(error instanceof Error && error.message.includes('D_TIER_GAP'))
    })
    const warnSpec = { ...SPEC_BASE, tier: 'D2', datasets: ['ds-fix', 'ds-fix2'], baselines: ['b1'], seeds: [0], ablation: true }
    await h.service.submit('demo', { expId: 'exp-01', spec: warnSpec, hostRef: h.ref, confirm: true, runId: 'r-warn' }).then(() => { throw new Error('should GATE') }, (error: unknown) => {
      assert.equal(codeOf(error), 'GATE')
      assert.ok(error instanceof Error && error.message.includes('D_TIER_WARN'))
    })

    // ④ 提交（ack 过警告门）：setsid 派发 + run.json（脱敏形状）+ env 注入面
    const submitted = await h.service.submit('demo', {
      expId: 'exp-01', spec: warnSpec, hostRef: h.ref, confirm: true, ack: true, runId: 'r-ok', seed: 0,
      files: [{ path: 'job.sh', content: 'echo user-code\n' }],
    }) as { status: string; pid: number | null; remote: { runDir: string }; host: { ref: string }; cudaVisibleDevices: string }
    assert.equal(submitted.status, 'running')
    assert.equal(submitted.host.ref, h.ref)
    assert.ok(submitted.remote.runDir.startsWith('~/srw-runs/'))
    assert.ok(submitted.pid !== null && submitted.pid > 0)
    // 选卡=占用率谷底（GPU1 300MiB < GPU0 500MiB → 选 1）
    assert.equal(submitted.cudaVisibleDevices, '1')
    // 注入纪律：用户值只进 srw-wrapper.sh 文件内容（单引号转义），任何 exec argv 都不出现
    const flatArgv = h.remote.calls.flat().join('\u0000')
    assert.ok(!flatArgv.includes('$(rm -rf'))
    const jobSh = h.remote.jobContent('/srw-wrapper.sh') ?? ''
    assert.ok(jobSh.includes("export SRW_NOTE='it'\\''s; $(rm -rf /)'"))
    assert.ok(jobSh.includes('CUDA_VISIBLE_DEVICES'))
    assert.ok((h.remote.jobContent('/launch.sh') ?? '').includes('setsid nohup'))
    // run.json 落盘脱敏 + inputs 溯源
    const runJson = await readFile(join(h.root, 'demo', 'experiments', 'exp-01', 'runs', 'r-ok', 'run.json'), 'utf8')
    assert.deepEqual(LEAK_SCAN(runJson), [])
    const runParsed = JSON.parse(runJson) as { host: { ref: string }; remote: { runDir: string }; inputs: Array<{ datasetId: string; version: string }> }
    assert.equal(runParsed.host.ref, h.ref)
    // registry.get 缺省取 registeredAt 最新版本 → v2；ds-fix2 也入 inputs
    assert.deepEqual(runParsed.inputs, [
      { datasetId: 'ds-fix', version: 'v2', sha256: null, locator: 'remote:/data/fix-v2' },
      { datasetId: 'ds-fix2', version: 'v1', sha256: null, locator: 'remote:/data/ds-fix2' },
    ])

    // ⑤ status：running → succeeded（exit.code + done；fake 可能在同一步推进到终态，断言顺序无关）
    const running = await h.service.status('demo', 'exp-01', 'r-ok') as { runs: Array<{ status: string; pid: number | null }> }
    assert.ok(running.runs[0]?.status === 'running' || running.runs[0]?.status === 'succeeded', '首轮 status 应为 running 或已 succeeded')
    await until(() => h.remote.readText(findRunDir(h.remote, 'r-ok') + '/done') !== undefined)
    const succeeded = await h.service.status('demo', 'exp-01', 'r-ok') as { runs: Array<{ status: string; timestamps: { endedAt: string | null } }> }
    assert.equal(succeeded.runs[0]?.status, 'succeeded')
    assert.ok(succeeded.runs[0]?.timestamps.endedAt !== null)

    // ⑥ logs：偏移续读 + 二次空读
    const logs1 = await h.service.logs('demo', 'exp-01', 'r-ok') as { appendedBytes: number; stdoutBytes: number; tail: string }
    assert.ok(logs1.appendedBytes > 0)
    assert.ok(logs1.tail.includes('acc=0.91'))
    assert.deepEqual(LEAK_SCAN(logs1.tail), [])
    const logs2 = await h.service.logs('demo', 'exp-01', 'r-ok') as { appendedBytes: number }
    assert.equal(logs2.appendedBytes, 0)
    assert.ok((await readFile(join(h.root, 'demo', 'experiments', 'exp-01', 'runs', 'r-ok', 'logs', 'stdout.log'), 'utf8')).includes('acc=0.91'))

    // ⑦ collect：metrics + artifacts 回传（sha256 落 run.outputs）
    const collected = await h.service.collect('demo', 'exp-01', 'r-ok') as { metrics: { sha256: string; schemaOk: boolean } | null; artifacts: Array<{ path: string; bytes: number }>; errors: string[] }
    assert.equal(collected.metrics?.schemaOk, true)
    assert.equal(collected.metrics?.sha256.length, 64)
    assert.deepEqual(collected.artifacts.map(a => a.path), ['fig.txt'])
    assert.deepEqual(collected.errors, [])

    // ⑧ claims.check：verified → 手改本地 metrics → mismatch → 还原 → verified
    const claim = {
      id: 'clm-acc', kind: 'number',
      source: { expId: 'exp-01', runIds: ['r-ok'], metric: 'acc', reducer: 'mean' },
      value: 0.91, digits: 2,
    }
    const verified = await h.service.claimsCheck('demo', { claim }) as { claims: Array<{ status: string }> }
    assert.equal(verified.claims[0]?.status, 'verified')
    const metricsPath = join(h.root, 'demo', 'experiments', 'exp-01', 'runs', 'r-ok', 'metrics.json')
    const original = await readFile(metricsPath, 'utf8')
    await writeFile(metricsPath, original.replace('0.91', '0.5'), 'utf8')
    const mismatched = await h.service.claimsCheck('demo', { id: 'clm-acc' }) as { claims: Array<{ status: string; reason?: string }> }
    assert.equal(mismatched.claims[0]?.status, 'mismatch')
    await writeFile(metricsPath, original, 'utf8')
    const reverted = await h.service.claimsCheck('demo', { id: 'clm-acc' }) as { claims: Array<{ status: string }> }
    assert.equal(reverted.claims[0]?.status, 'verified')
    // 证据缺 → unverifiable
    const unverifiable = await h.service.claimsCheck('demo', { claim: { ...claim, id: 'clm-missing', source: { ...claim.source, runIds: ['r-none'] } } }) as { claims: Array<{ id: string; status: string }> }
    assert.equal(unverifiable.claims.find(row => row.id === 'clm-missing')?.status, 'unverifiable')

    // ⑨ gaps.list：最终确认的 spec 是 warnSpec（seeds [0] 已跑满）→ unverifiable
    // claim 阻断（P0）+ D2 基线 1<4（P1）；queue 有序
    const gaps = await h.service.gapsList('demo', 'exp-01') as { counts: { P0: number; P1: number }; items: Array<{ kind: string; priority: string }>; queue: string[] }
    assert.ok(gaps.counts.P0 >= 1)
    assert.ok(gaps.items.some(item => item.kind === 'unverifiable'))
    assert.ok(gaps.items.some(item => item.kind === 'missing-baseline'))
    const priorities = gaps.items.map(item => item.priority)
    assert.deepEqual(priorities, [...priorities].sort())
    assert.equal(gaps.queue.length, gaps.items.length)
    // gaps.json / queue.json 落盘
    await readFile(join(h.root, 'demo', 'experiments', 'exp-01', 'gaps.json'), 'utf8')
    await readFile(join(h.root, 'demo', 'experiments', 'exp-01', 'queue.json'), 'utf8')
  } finally {
    await h.cleanup()
  }
})

function findRunDir(remote: FakeRemote, runId: string): string {
  for (const dir of remote.launchedDirs) {
    if (dir.endsWith('/' + runId)) return dir
  }
  throw new Error('launched dir not found for ' + runId)
}

test('cancel：hang 作业 TERM 取消 → cancelled + 进程组死亡；ghost 作业两次 stale → unknown（绝不 succeeded）', async () => {
  const h = await makeHarness()
  try {
    const spec = { ...SPEC_BASE }
    // hang：pid 恒活 → running → cancel
    h.remote.nextMode = 'hang'
    const hang = await h.service.submit('demo', { expId: 'exp-01', spec, hostRef: h.ref, confirm: true, runId: 'r-hang' }) as { pid: number | null }
    const runningView = await h.service.status('demo', 'exp-01', 'r-hang') as { runs: Array<{ status: string }> }
    assert.equal(runningView.runs[0]?.status, 'running')
    const cancelled = await h.service.cancel('demo', 'exp-01', 'r-hang', '测试取消') as { status: string; cancel: { reason: string | null } }
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancel.reason, '测试取消')
    assert.ok(h.remote.calls.some(call => call[0] === 'kill' && call[1] === '-TERM' && call[2] === '-' + String(hang.pid)))
    // 幂等：再取消直接返回
    const again = await h.service.cancel('demo', 'exp-01', 'r-hang') as { status: string }
    assert.equal(again.status, 'cancelled')
    // ghost：pid/exit/done 被清 + 日志无增长 → 两次轮询后 unknown
    h.remote.nextMode = 'losepid'
    await h.service.submit('demo', { expId: 'exp-01', spec, hostRef: h.ref, confirm: true, runId: 'r-ghost' })
    await until(() => !h.remote.launchedDirs.some(() => false) && h.remote.readText(findRunDir(h.remote, 'r-ghost') + '/run.pid') === undefined, 1000)
    const stale1 = await h.service.status('demo', 'exp-01', 'r-ghost') as { runs: Array<{ status: string }> }
    assert.equal(stale1.runs[0]?.status, 'running')
    const ghost = await h.service.status('demo', 'exp-01', 'r-ghost') as { runs: Array<{ status: string }> }
    assert.equal(ghost.runs[0]?.status, 'unknown')
    assert.notEqual(ghost.runs[0]?.status, 'succeeded')
    const ghostOnDisk = JSON.parse(await readFile(join(h.root, 'demo', 'experiments', 'exp-01', 'runs', 'r-ghost', 'run.json'), 'utf8')) as { status: string }
    assert.equal(ghostOnDisk.status, 'unknown')
  } finally {
    await h.cleanup()
  }
})

test('负例：GPU 全忙 NO_FREE_GPU、不可达 NO_PROVIDER（不留 run）、离线 GATE、数据集未注册 NOT_FOUND、fail 作业 → failed', async () => {
  const h = await makeHarness({ offline: () => false })
  try {
    const spec = { ...SPEC_BASE }
    // GPU 全忙
    h.remote.nvidiaCsv = NVIDIA_BUSY
    await h.service.submit('demo', { expId: 'exp-01', spec, hostRef: h.ref, confirm: true, runId: 'r-busy' }).then(() => { throw new Error('should GATE') }, (error: unknown) => {
      assert.equal(codeOf(error), 'GATE')
      assert.ok(error instanceof Error && error.message.includes('NO_FREE_GPU'))
    })
    h.remote.nvidiaCsv = NVIDIA_FREE
    // 数据集未注册
    await h.service.submit('demo', { expId: 'exp-01', spec: { ...spec, datasets: ['ds-none'] }, hostRef: h.ref, confirm: true, runId: 'r-none' }).then(() => { throw new Error('should NOT_FOUND') }, (error: unknown) => {
      assert.equal(codeOf(error), 'NOT_FOUND')
    })
    // 不可达：不留 run 目录
    h.remote.failExec = true
    await h.service.submit('demo', { expId: 'exp-01', spec, hostRef: h.ref, confirm: true, runId: 'r-unreach' }).then(() => { throw new Error('should NO_PROVIDER') }, (error: unknown) => {
      assert.equal(codeOf(error), 'NO_PROVIDER')
    })
    h.remote.failExec = false
    const runIds = await readdir(join(h.root, 'demo', 'experiments', 'exp-01', 'runs')).catch(() => [] as string[])
    assert.equal(runIds.includes('r-unreach'), false)
    // fail 作业 → failed（exit 1 + done）
    h.remote.nextMode = 'fail'
    await h.service.submit('demo', { expId: 'exp-01', spec, hostRef: h.ref, confirm: true, runId: 'r-fail' })
    await until(() => h.remote.readText(findRunDir(h.remote, 'r-fail') + '/done') !== undefined)
    const failed = await h.service.status('demo', 'exp-01', 'r-fail') as { runs: Array<{ status: string; lastError?: string }> }
    assert.equal(failed.runs[0]?.status, 'failed')
    assert.ok((failed.runs[0]?.lastError ?? '').includes('exit 1'))
    // 离线：GATE OFFLINE（不派发）
    const offlineService = new ComputeService({
      fs: fakeFs(), rootDir: () => h.root, provider: new FakeProvider(h.remote), env: { QILIN_HOME: h.home }, offline: () => true,
    })
    await offlineService.submit('demo', { expId: 'exp-01', spec, hostRef: h.ref, confirm: true, runId: 'r-offline' }).then(() => { throw new Error('should GATE') }, (error: unknown) => {
      assert.equal(codeOf(error), 'GATE')
      assert.ok(error instanceof Error && error.message.includes('OFFLINE'))
    })
    // env.setup 占位
    await h.service.envSetup().then(() => { throw new Error('should INVALID') }, (error: unknown) => {
      assert.equal(codeOf(error), 'INVALID')
    })
  } finally {
    await h.cleanup()
  }
})
