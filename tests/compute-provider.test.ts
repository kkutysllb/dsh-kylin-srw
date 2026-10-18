/** M7 provider 面（全离线）：ssh argv 构造纯函数（① cm / ③ direct）、
 * 缺通道 → NO_PROVIDER、注入纪律（用户值只存在于单个 target argv 元素，
 * 远端命令逐元素传递）、put 固定脚本无插值；ssh 可用时的 loopback 快速拒绝
 * 降级为容错断言（无 ssh 的 CI 也绿）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ServiceError } from '../src/service.ts'
import { PROBE_SENTINEL, PUT_SCRIPT, SshProvider, remoteLine, sshArgv, type HostTarget } from '../src/compute/provider.ts'

const codeOf = (error: unknown): string => (error instanceof ServiceError ? error.code : 'non-ServiceError:' + String(error))

const cmTarget: HostTarget = {
  ref: 'h-a1b2c3d4',
  transport: 'cm',
  address: { host: '192.168.10.2', user: 'deploy', port: 18908 },
  cmSock: '/home/x/.kcoder/ssh-remote/cm/id.sock',
}
const directTarget: HostTarget = {
  ref: 'h-b2c3d4e5',
  transport: 'direct',
  address: { host: 'host.example', user: 'u' },
  identityFile: '/keys/id_ed25519',
}

test('sshArgv：① cm 复用（ControlPath + ControlMaster=no + BatchMode + -- 后命令）', () => {
  const argv = sshArgv(cmTarget, ['echo', PROBE_SENTINEL])
  assert.deepEqual(argv, [
    '-o', 'ControlPath=/home/x/.kcoder/ssh-remote/cm/id.sock',
    '-o', 'ControlMaster=no',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-p', '18908',
    'deploy@192.168.10.2',
    '--', 'echo', PROBE_SENTINEL,
  ])
})

test('sshArgv：③ direct（identityFile + accept-new + 自建 ControlMaster 复用）', () => {
  const argv = sshArgv(directTarget, ['cat', '/tmp/x'])
  assert.deepEqual(argv.slice(0, 4), ['-i', '/keys/id_ed25519', '-o', 'StrictHostKeyChecking=accept-new'])
  // 直连自建 master：一次认证、后续复用（否则连发会被远端限流）
  const joined = argv.join(' ')
  assert.ok(joined.includes('ControlMaster=auto'))
  assert.ok(/ControlPath=\S*srw-cm-h-b2c3d4e5\.sock/.test(joined))
  assert.ok(joined.includes('ControlPersist=600'))
  assert.ok(joined.includes('BatchMode=yes'))
  // sshArgv 本身仍逐元素传递；引号合成在 exec 层（remoteLine），见下一条用例
  const at = argv.indexOf('u@host.example')
  assert.ok(at > 0)
  assert.equal(argv[at + 1], '--')
  assert.equal(argv.length, at + 4)
  assert.deepEqual(argv.slice(at + 2), ['cat', '/tmp/x'])
})

test('remoteLine：argv 逐元素 POSIX 引号包裹后合成单命令串（远端 shell 不再重切词）', () => {
  assert.equal(remoteLine(['cat', '/tmp/x']), "'cat' '/tmp/x'")
  assert.equal(remoteLine(['sh', '-c', 'printf %s "$HOME"']), "'sh' '-c' 'printf %s \"$HOME\"'")
  // 单引号自转义：it's → 'it'\''s'
  assert.equal(remoteLine(["it's"]), "'it'\\''s'")
})

test('sshArgv：缺 socket / 缺私钥 → NO_PROVIDER（绝不密码回退）', () => {
  const cmNoSock: HostTarget = { ref: cmTarget.ref, transport: 'cm', address: cmTarget.address }
  const directNoKey: HostTarget = { ref: directTarget.ref, transport: 'direct', address: directTarget.address }
  assert.equal(codeOf((() => { try { sshArgv(cmNoSock, ['true']) } catch (e) { return e } })()), 'NO_PROVIDER')
  assert.equal(codeOf((() => { try { sshArgv(directNoKey, ['true']) } catch (e) { return e } })()), 'NO_PROVIDER')
})

test('注入纪律：恶意 host/user 只落在单个 target 元素；命令本体逐元素不被拼接', () => {
  const evil: HostTarget = { ref: 'h-x', transport: 'cm', address: { host: 'h; rm -rf /', user: 'a&&b' }, cmSock: '/s' }
  const argv = sshArgv(evil, ['echo', 'x; y'])
  const targetIdx = argv.indexOf('a&&b@h; rm -rf /')
  assert.ok(targetIdx > 0, 'target 必须是单个 argv 元素')
  // ; 只出现在 target 元素与命令参数元素里——没有任何拼接出的复合命令串
  assert.equal(argv.filter(part => part.includes(';')).length, 2)
  assert.deepEqual(argv.slice(targetIdx + 1), ['--', 'echo', 'x; y'])
})

test('PUT_SCRIPT 固定：路径走 $1 位置参数，绝无用户值进脚本串', () => {
  assert.equal(PUT_SCRIPT, 'cat > "$1"')
})

test('SshProvider.available：ssh 缺席 → ok=false（不炸）；在则 loopback 拒绝为 code 255/null', async () => {
  const provider = new SshProvider('direct')
  const availability = await provider.available()
  if (!availability.ok) {
    assert.ok(availability.detail.length > 0)
    return
  }
  const outcome = await provider.exec(
    { ref: 'h-loopback', transport: 'direct', address: { host: '127.0.0.1', port: 1, user: 'nobody' }, identityFile: '/nonexistent-key' },
    ['echo', 'hi'],
    { maxBytes: 1024, timeoutMs: 5000 },
  )
  // BatchMode + 不存在的 key + 拒绝连接：传输层失败（255 或信号），绝不假成功
  assert.ok(outcome.code === 255 || outcome.code === null || outcome.code !== 0)
})
