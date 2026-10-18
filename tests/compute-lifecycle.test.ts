/** M7 生命周期面（离线，脚本化 fake provider）：7 态分类（unknown 绝不假
 * 成功）、三条取消路径（TERM→KILL/已退出/不可达）、日志偏移续读（两段拼接
 * =全量无重复无缺口）、上限显式失败、镜像对账归零重读、脱敏落盘。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceError } from '../src/service.ts'
import { classifyRun, cancelRemote, type RemoteProbe } from '../src/compute/lifecycle.ts'
import { parseOffsetFile, pullRunLog, type LogOffsetFile } from '../src/compute/logs.ts'
import type { ComputeProvider, ExecOptions, ExecOutcome, HostTarget } from '../src/compute/provider.ts'
import { sha256Hex } from '../src/compute/types.ts'

const codeOf = (error: unknown): string => (error instanceof ServiceError ? error.code : 'non-ServiceError:' + String(error))
const HOST: HostTarget = { ref: 'h-test', transport: 'direct', address: { host: 'h', user: 'u' }, identityFile: '/k' }
const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const probeOf = (partial: Partial<RemoteProbe>): RemoteProbe => ({
  probeOk: true, pid: null, pidAlive: false, exitCode: null, exitRead: false, doneExists: false, logSize: 0, detail: 'ok',
  ...partial,
})

test('classifyRun：7 态判定表——exit+done 定终态、pid/日志定 running、全缺 stale→unknown、不可达保持原状', () => {
  // succeeded / failed：exit.code + done 齐备
  assert.equal(classifyRun({ prev: 'running', probe: probeOf({ exitRead: true, exitCode: 0, doneExists: true }), prevLogSize: 0, staleCount: 0 }).status, 'succeeded')
  const failed = classifyRun({ prev: 'running', probe: probeOf({ exitRead: true, exitCode: 2, doneExists: true }), prevLogSize: 0, staleCount: 0 })
  assert.equal(failed.status, 'failed')
  assert.ok((failed.reason ?? '').includes('2'))
  // exit 有但 done 未到 → 仍在跑
  assert.equal(classifyRun({ prev: 'running', probe: probeOf({ exitRead: true, exitCode: 0 }), prevLogSize: 0, staleCount: 0 }).status, 'running')
  // pid 活 → running
  assert.equal(classifyRun({ prev: 'running', probe: probeOf({ pid: 7, pidAlive: true }), prevLogSize: 5, staleCount: 1 }).status, 'running')
  // 日志涨 → running
  assert.equal(classifyRun({ prev: 'running', probe: probeOf({ logSize: 99 }), prevLogSize: 5, staleCount: 1 }).status, 'running')
  // 全缺 + 无增长：stale=0 宽限保持 running；stale 达阈值 → unknown（绝不 succeeded）
  const grace = classifyRun({ prev: 'running', probe: probeOf({}), prevLogSize: 5, staleCount: 0, staleThreshold: 2 })
  assert.equal(grace.status, 'running')
  const unknown = classifyRun({ prev: 'running', probe: probeOf({}), prevLogSize: 5, staleCount: 1, staleThreshold: 2 })
  assert.equal(unknown.status, 'unknown')
  assert.ok((unknown.reason ?? '').includes('unknown') || (unknown.reason ?? '').includes('人工'))
  // queued 首轮宽限保持 queued
  assert.equal(classifyRun({ prev: 'queued', probe: probeOf({}), prevLogSize: 0, staleCount: 0, staleThreshold: 2 }).status, 'queued')
  // 不可达：保持原状态（含终态与 unknown 都不被断线改写）
  const unreachable = probeOf({ probeOk: false, detail: 'timeout' })
  assert.equal(classifyRun({ prev: 'succeeded', probe: unreachable, prevLogSize: 0, staleCount: 0 }).status, 'succeeded')
  assert.equal(classifyRun({ prev: 'running', probe: unreachable, prevLogSize: 0, staleCount: 0 }).status, 'running')
  assert.equal(classifyRun({ prev: 'unknown', probe: unreachable, prevLogSize: 0, staleCount: 2 }).status, 'unknown')
})

/** 脚本化 provider：按 argv[0]+argv[1] 分发；kill 行为由脚本控制。 */
class ScriptedProvider implements ComputeProvider {
  readonly kind = 'direct' as const
  readonly calls: string[][] = []
  readonly puts: Array<{ path: string; bytes: Uint8Array }> = []
  /** kill -0 的逐次退出码（0=进程存在，非 0=已消失）：按调用顺序弹出；空数组=恒消失。 */
  killZeroCodes: number[] = []
  throwOnExec = false

  async available(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'scripted' }
  }

  async exec(_host: HostTarget, argv: readonly string[], _options?: ExecOptions): Promise<ExecOutcome> {
    this.calls.push([...argv])
    if (this.throwOnExec) throw new ServiceError('NO_PROVIDER', 'unreachable（脚本化）')
    if (argv[0] === 'kill') {
      if (argv[1] === '-0') {
        const code = this.killZeroCodes.length > 0 ? this.killZeroCodes.shift() ?? 1 : 1
        return { code, stdout: new Uint8Array(0), stderr: '', truncated: false }
      }
      return { code: 0, stdout: new Uint8Array(0), stderr: '', truncated: false }
    }
    return { code: 0, stdout: new Uint8Array(0), stderr: '', truncated: false }
  }

  async putBytes(_host: HostTarget, remotePath: string, bytes: Uint8Array): Promise<{ sha256: string }> {
    this.puts.push({ path: remotePath, bytes })
    return { sha256: sha256Hex(bytes) }
  }

  async tailBytes(_host: HostTarget, _path: string, fromByte: number): Promise<{ bytes: Uint8Array; nextByte: number; eof: boolean }> {
    return { bytes: new Uint8Array(0), nextByte: fromByte, eof: true }
  }

  async getBytes(_host: HostTarget, _remotePath: string): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    return { bytes: new Uint8Array(0), truncated: false }
  }

  killedWith(signal: string): string | undefined {
    const hit = this.calls.find(call => call[0] === 'kill' && call[1] === signal)
    return hit?.[2]
  }
}

test('cancel：TERM → 宽限内消失 → killed（cancel.request 已落盘）', async () => {
  const provider = new ScriptedProvider()
  provider.killZeroCodes = [0, 1] // 第一轮仍存活，第二轮消失
  const outcome = await cancelRemote(provider, HOST, '/remote/run', 4242, { killGraceMs: 500, stepMs: 10 })
  assert.equal(outcome, 'killed')
  assert.equal(provider.killedWith('-TERM'), '-4242')
  assert.equal(provider.puts.length, 1)
  assert.ok(provider.puts[0]?.path.endsWith('/cancel.request'))
})

test('cancel：宽限超时 → KILL 兜底（进程组负号）', async () => {
  const provider = new ScriptedProvider()
  provider.killZeroCodes = Array.from({ length: 20 }, () => 0) // TERM 后持续存活（kill -0=0）→ 宽限耗尽 → KILL
  const outcome = await cancelRemote(provider, HOST, '/remote/run', 77, { killGraceMs: 60, stepMs: 10 })
  assert.equal(outcome, 'killed')
  assert.equal(provider.killedWith('-KILL'), '-77')
})

test('cancel：远端早已退出（kill -TERM 非零）→ 视为 killed；pid 缺失只落标记；不可达 → unreachable', async () => {
  const gone = new ScriptedProvider()
  // kill -TERM 返回 1（组不存在）
  gone.calls.push(['__mode__']) // no-op
  const origExec = gone.exec.bind(gone)
  gone.exec = async (host, argv, options) => {
    if (argv[0] === 'kill' && argv[1] === '-TERM') {
      gone.calls.push([...argv])
      return { code: 1, stdout: new Uint8Array(0), stderr: 'no such process', truncated: false }
    }
    return origExec(host, argv, options)
  }
  assert.equal(await cancelRemote(gone, HOST, '/r', 5, { killGraceMs: 50, stepMs: 5 }), 'killed')

  const noPid = new ScriptedProvider()
  assert.equal(await cancelRemote(noPid, HOST, '/r', null, { killGraceMs: 50, stepMs: 5 }), 'killed')
  assert.equal(noPid.puts.length, 1)
  assert.equal(noPid.calls.filter(call => call[0] === 'kill').length, 0)

  const unreachable = new ScriptedProvider()
  unreachable.throwOnExec = true
  assert.equal(await cancelRemote(unreachable, HOST, '/r', 9, { killGraceMs: 50, stepMs: 5 }), 'unreachable')
})

/** 日志面 fake：远端日志是字符串；stat/tail 走它。 */
class LogProvider implements ComputeProvider {
  readonly kind = 'direct' as const
  remoteLog = ''
  execCalls: string[][] = []

  async available(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'log-fake' }
  }

  async exec(_host: HostTarget, argv: readonly string[]): Promise<ExecOutcome> {
    this.execCalls.push([...argv])
    if (argv[0] === 'stat' && argv[2] === '%s') {
      const size = Buffer.byteLength(this.remoteLog)
      return { code: 0, stdout: enc(String(size)), stderr: '', truncated: false }
    }
    return { code: 1, stdout: new Uint8Array(0), stderr: 'unsupported', truncated: false }
  }

  async tailBytes(_host: HostTarget, path: string, fromByte: number, maxBytes: number): Promise<{ bytes: Uint8Array; nextByte: number; eof: boolean }> {
    const all = enc(this.remoteLog)
    const slice = all.slice(fromByte, fromByte + maxBytes)
    return { bytes: slice, nextByte: fromByte + slice.byteLength, eof: fromByte + slice.byteLength >= all.byteLength }
  }

  async putBytes(_host: HostTarget, remotePath: string, bytes: Uint8Array): Promise<{ sha256: string }> {
    return { sha256: sha256Hex(bytes) }
  }

  async getBytes(): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    return { bytes: new Uint8Array(0), truncated: false }
  }
}

test('logs：偏移续读两段拼接=全量（无重复无缺口）+ offset.json 落盘 + 二次空读', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srw-logs-'))
  try {
    const provider = new LogProvider()
    const localLog = join(dir, 'stdout.log')
    const localOffset = join(dir, 'offset.json')
    const prevZero: LogOffsetFile = { stdoutBytes: 0, lastReadAt: null, mirrorSha256: null }
    provider.remoteLog = 'line-1 tail 10.0.0.1\nline-2\n'
    const first = await pullRunLog({ provider, host: HOST, runDirAbs: '/r', localLogPath: localLog, localOffsetPath: localOffset, prev: prevZero, maxLogBytes: 1024, now: 't1' })
    assert.equal(first.appendedBytes, Buffer.byteLength(provider.remoteLog))
    assert.equal(first.offset.stdoutBytes, Buffer.byteLength(provider.remoteLog))
    const mirror1 = await readFile(localLog, 'utf8')
    assert.equal(mirror1, 'line-1 tail <ip>\nline-2\n')
    const offsetOnDisk = parseOffsetFile(JSON.parse(await readFile(localOffset, 'utf8')) as unknown)
    assert.equal(offsetOnDisk.stdoutBytes, first.offset.stdoutBytes)
    assert.ok(offsetOnDisk.mirrorSha256 !== null)
    // 增量：远端追加 → 只拉新段
    provider.remoteLog += 'line-3 deploy@10.0.0.9:22\n'
    const second = await pullRunLog({ provider, host: HOST, runDirAbs: '/r', localLogPath: localLog, localOffsetPath: localOffset, prev: first.offset, maxLogBytes: 1024, now: 't2' })
    assert.equal(second.appendedBytes, Buffer.byteLength('line-3 deploy@10.0.0.9:22\n'))
    const mirror2 = await readFile(localLog, 'utf8')
    assert.equal(mirror2, 'line-1 tail <ip>\nline-2\nline-3 <ssh-target>:<port>\n')
    assert.ok(!mirror2.includes('10.0.0.9') && !mirror2.includes('deploy@'))
    // 无增长：appended=0、镜像不动
    const third = await pullRunLog({ provider, host: HOST, runDirAbs: '/r', localLogPath: localLog, localOffsetPath: localOffset, prev: second.offset, maxLogBytes: 1024, now: 't3' })
    assert.equal(third.appendedBytes, 0)
    assert.equal(await readFile(localLog, 'utf8'), mirror2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('logs：超上限显式失败（LOG_CAP_EXCEEDED）；镜像被手改/远端回退 → 归零整段重读', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srw-logs2-'))
  try {
    const provider = new LogProvider()
    provider.remoteLog = 'x'.repeat(100)
    await assert.rejects(
      pullRunLog({ provider, host: HOST, runDirAbs: '/r', localLogPath: join(dir, 'a.log'), localOffsetPath: join(dir, 'a.json'), prev: { stdoutBytes: 0, lastReadAt: null, mirrorSha256: null }, maxLogBytes: 10, now: 't' }),
      (error: unknown) => codeOf(error) === 'GATE' && (error instanceof Error) && error.message.includes('LOG_CAP_EXCEEDED'),
    )
    // 镜像对账：offset=6 后镜像被手改 → reconciled 且全文重读
    provider.remoteLog = 'alpha bravo charlie\n'
    const first = await pullRunLog({ provider, host: HOST, runDirAbs: '/r', localLogPath: join(dir, 'b.log'), localOffsetPath: join(dir, 'b.json'), prev: { stdoutBytes: 0, lastReadAt: null, mirrorSha256: null }, maxLogBytes: 1024, now: 't' })
    await writeFile(join(dir, 'b.log'), '手改内容', 'utf8')
    const second = await pullRunLog({ provider, host: HOST, runDirAbs: '/r', localLogPath: join(dir, 'b.log'), localOffsetPath: join(dir, 'b.json'), prev: first.offset, maxLogBytes: 1024, now: 't' })
    assert.equal(second.reconciled, true)
    assert.equal(await readFile(join(dir, 'b.log'), 'utf8'), provider.remoteLog)
    // 远端回退（尺寸 < offset）→ 归零重读
    provider.remoteLog = 'tiny'
    const third = await pullRunLog({ provider, host: HOST, runDirAbs: '/r', localLogPath: join(dir, 'b.log'), localOffsetPath: join(dir, 'b.json'), prev: second.offset, maxLogBytes: 1024, now: 't' })
    assert.equal(third.reconciled, true)
    assert.equal(await readFile(join(dir, 'b.log'), 'utf8'), 'tiny')
    // offset.json 坏 → 宽松归零
    assert.deepEqual(parseOffsetFile(undefined), { stdoutBytes: 0, lastReadAt: null, mirrorSha256: null })
    assert.equal(parseOffsetFile({ stdoutBytes: 42 }).stdoutBytes, 42)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
