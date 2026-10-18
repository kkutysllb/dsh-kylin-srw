/** ComputeProvider 三级链（§4.1/§4.2）：MVP 实现 ① cm 复用与 ③ 直连；
 * ② tool 通道（ctx.tools.execute 'ssh_run'）只留接口注释不实现——F1（无显式
 * cwd 时首句被静默吞、exit 0）与 F2（stdout 256 KiB 静默截断）使它**禁用于
 * 日志/产物**，仅可承载短命令/哨兵，若将来实现必须先过本服务的 submit 门。
 *
 * 派发纪律（§4.5 架构级）：spawn('ssh', [本地 argv…, '--', 远端命令串])——本地不经
 * shell；远端命令串由 remoteLine 对每个元素做 POSIX 引号包裹后合成，
 * 绝不拼接 shell 字符串；唯一的「拼接」是 ssh 协议自身的 target 与 -o 选项
 * （它们是单个 argv 元素，由 ssh 自己解析，不经远端 shell 二次展开——远端
 * 命令在 '--' 之后）。用户值只进文件字节（put 先落远端盘再 bash 绝对路径执行）。
 * 永不读宿主凭据、永不密码回退；地址/用户名/端口只存在于 HostTarget（内存）。 */

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceError } from '../service.ts'
import { sha256Hex } from './types.ts'

/** 内存态主机目标：地址/端口/私钥路径/cm socket 绝不落盘（§4.4）。 */
export interface HostTarget {
  readonly ref: string
  readonly transport: 'cm' | 'direct'
  readonly address: { readonly host: string; readonly user: string; readonly port?: number }
  readonly cmSock?: string
  readonly identityFile?: string
}

export interface ExecOptions {
  /** 写远端文件时经 stdin 喂字节（put）。 */
  readonly input?: Uint8Array
  readonly timeoutMs?: number
  /** stdout 收集上限（字节）；超限停止收集并置 truncated（显式标记，不静默）。 */
  readonly maxBytes?: number
}

export interface ExecOutcome {
  /** null = 进程被信号杀死/超时（transport 级异常由调用方区分）。 */
  readonly code: number | null
  readonly stdout: Uint8Array
  readonly stderr: string
  readonly truncated: boolean
}

/** §4.1 的可组合原语面（tail/put/get 由 exec 原语实现，便于 fake 注入）。 */
export interface ComputeProvider {
  readonly kind: 'cm' | 'direct'
  available(): Promise<{ ok: boolean; detail: string }>
  exec(host: HostTarget, argv: readonly string[], options?: ExecOptions): Promise<ExecOutcome>
  tailBytes(host: HostTarget, path: string, fromByte: number, maxBytes: number): Promise<{ bytes: Uint8Array; nextByte: number; eof: boolean }>
  putBytes(host: HostTarget, remotePath: string, bytes: Uint8Array): Promise<{ sha256: string }>
  getBytes(host: HostTarget, remotePath: string, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }>
}

export const PROBE_SENTINEL = '__SRW_OK__'
/** put 写文件的固定脚本：路径走 $1 位置参数，绝无用户值进命令字符串。 */
export const PUT_SCRIPT = 'cat > "$1"'
const STDERR_CAP = 64 * 1024
export const DEFAULT_EXEC_MAX_BYTES = 1024 * 1024

/** ssh argv 构造（纯函数，测试面）：BatchMode 防交互挂死；ConnectTimeout 防
 * 不可达拖死 submit；'--' 之后是远端命令 argv。 */
/** 单元素远端安全引号包裹（POSIX 单引号无转义位，用 '\'' 三段式）。
 * ssh -- 后的多个元素会被远端登录 shell 重新按空格切词，argv 含空格/引号的
 * 元素（如 sh -c 脚本、带空格路径）必须整体再包一层，否则语义被改写
 * （真机踩中：sh -c 'printf %s "$HOME"' 变成无参 printf → usage）。 */
export function remoteQuote(part: string): string {
  return "'" + part.replaceAll("'", "'\\''") + "'"
}

/** 远端命令行：把 argv 合成**单个**已引号包裹的命令串（交给 ssh -- 执行）。 */
export function remoteLine(argv: readonly string[]): string {
  return argv.map(part => remoteQuote(part)).join(' ')
}

export function sshArgv(target: HostTarget, argv: readonly string[]): string[] {
  const parts: string[] = []
  if (target.transport === 'cm') {
    if (target.cmSock === undefined || target.cmSock === '') {
      throw new ServiceError('NO_PROVIDER', '① 通道缺 ControlMaster socket（先跑 action=hosts 盘点）')
    }
    parts.push('-o', 'ControlPath=' + target.cmSock, '-o', 'ControlMaster=no')
  } else {
    if (target.identityFile === undefined || target.identityFile === '') {
      throw new ServiceError('NO_PROVIDER', '③ 通道缺 identityFile（hosts.json 该条目须有 key 私钥路径）')
    }
    parts.push('-i', target.identityFile, '-o', 'StrictHostKeyChecking=accept-new')
    // ③ 直连自建 ControlMaster：一次认证、后续 exec 复用同一连接。
    // 否则每个 put/exec/tail 都新建 ssh —— 全量测试连发十余次会被远端
    // sshd/网络限流（真机踩中 kex_exchange_identification reset / Connection
    // closed），且每次握手都慢。ControlPersist 10 分钟，宿主重启后自动重建。
    parts.push('-o', 'ControlMaster=auto', '-o', 'ControlPath=' + join(tmpdir(), 'srw-cm-' + target.ref + '.sock'), '-o', 'ControlPersist=600')
  }
  parts.push('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
  if (target.address.port !== undefined) parts.push('-p', String(target.address.port))
  parts.push(target.address.user + '@' + target.address.host, '--', ...argv)
  return parts
}

/** ② tool 通道接口位（MVP 不实现，见文件头 F1/F2 注释）：
 * execViaTool(ctx.tools.execute({ name: 'ssh_run', arguments: { hostId, command, cwd } }))
 * ——实现时必须：显式绝对 cwd + 首句哨兵 + 输出按渲染文本解析 + 禁用于 tail/put/get。 */

/** 真实 ssh 通道（① cm / ③ direct 同构，仅 argv 前缀不同）。 */
export class SshProvider implements ComputeProvider {
  readonly kind: 'cm' | 'direct'

  constructor(kind: 'cm' | 'direct' = 'cm') {
    this.kind = kind
  }

  async available(): Promise<{ ok: boolean; detail: string }> {
    try {
      const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn('ssh', ['-V'], { timeout: 5000 })
        let stderr = ''
        child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
        child.on('error', reject)
        child.on('close', code => resolve({ code, stderr }))
      })
      return { ok: outcome.code === 0, detail: outcome.stderr.trim().slice(0, 120) }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  exec(host: HostTarget, argv: readonly string[], options?: ExecOptions): Promise<ExecOutcome> {
    const maxBytes = options?.maxBytes ?? DEFAULT_EXEC_MAX_BYTES
    const timeoutMs = options?.timeoutMs ?? 60_000
    return new Promise<ExecOutcome>((resolve, reject) => {
      let child: ReturnType<typeof spawn>
      try {
        // 远端登录 shell 会重切词：合成单个已引号包裹的命令串（见 remoteLine）。
        child = spawn('ssh', sshArgv(host, [remoteLine(argv)]), { timeout: timeoutMs, windowsHide: true })
      } catch (error) {
        reject(new ServiceError('NO_PROVIDER', 'ssh 进程启动失败：' + (error instanceof Error ? error.message : String(error))))
        return
      }
      const stdout: Buffer[] = []
      let stdoutBytes = 0
      let truncated = false
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBytes >= maxBytes) {
          truncated = true
          return
        }
        stdout.push(chunk)
        stdoutBytes += chunk.byteLength
        if (stdoutBytes >= maxBytes) truncated = true
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8')
      })
      child.on('error', (error: Error) => {
        const code = (error as NodeJS.ErrnoException).code
        reject(new ServiceError('NO_PROVIDER', 'ssh 通道不可用（' + (code ?? 'error') + '）：' + error.message))
      })
      // stdin 喂入（put）：ssh 提前退出时 write 可能 EPIPE——吞掉，让 close 定胜负。
      child.stdin?.on('error', () => {})
      if (options?.input !== undefined) {
        child.stdin?.end(Buffer.from(options.input))
      } else {
        child.stdin?.end()
      }
      child.on('close', code => {
        resolve({ code, stdout: new Uint8Array(Buffer.concat(stdout)), stderr, truncated })
      })
    })
  }

  async tailBytes(host: HostTarget, path: string, fromByte: number, maxBytes: number): Promise<{ bytes: Uint8Array; nextByte: number; eof: boolean }> {
    // 先 stat 拿尺寸（GNU stat；拿不到就按「读多少算多少」降级，eof 靠空读判定）
    const stat = await this.exec(host, ['stat', '-c', '%s', path], { maxBytes: 1024 })
    const size = stat.code === 0 ? Number.parseInt(new TextDecoder().decode(stat.stdout).trim(), 10) : -1
    if (size >= 0 && fromByte >= size) {
      return { bytes: new Uint8Array(0), nextByte: fromByte, eof: true }
    }
    // tail -c +N 为 1-based：fromByte 是已消费字节数（0-based），起点 = fromByte+1
    const res = await this.exec(host, ['tail', '-c', '+' + String(fromByte + 1), path], { maxBytes })
    const nextByte = fromByte + res.stdout.byteLength
    const eof = size >= 0 ? nextByte >= size : res.stdout.byteLength === 0
    return { bytes: res.stdout, nextByte, eof }
  }

  async putBytes(host: HostTarget, remotePath: string, bytes: Uint8Array): Promise<{ sha256: string }> {
    const dir = remotePath.includes('/') ? remotePath.slice(0, remotePath.lastIndexOf('/')) : '.'
    const mkdir = await this.exec(host, ['mkdir', '-p', dir], { maxBytes: 4096 })
    if (mkdir.code !== 0) {
      throw new ServiceError('GATE', '远端目录创建失败（mkdir ' + dir + '）：' + mkdir.stderr.slice(0, 200))
    }
    const write = await this.exec(host, ['sh', '-c', PUT_SCRIPT, 'srw-put', remotePath], { input: bytes, maxBytes: 4096 })
    if (write.code !== 0) {
      throw new ServiceError('GATE', '远端写文件失败（' + remotePath + '）：' + write.stderr.slice(0, 200))
    }
    // 回读远端哈希对账（artifacts.sha256 契约的写方向）
    const sum = await this.exec(host, ['sha256sum', remotePath], { maxBytes: 4096 })
    const remoteSha = sum.code === 0 ? new TextDecoder().decode(sum.stdout).trim().split(/\s+/)[0] ?? '' : ''
    const localSha = sha256Hex(bytes)
    if (remoteSha !== '' && remoteSha !== localSha) {
      throw new ServiceError('GATE', '远端写文件哈希不一致（' + remotePath + '）：远端 ' + remoteSha.slice(0, 12) + ' ≠ 本地 ' + localSha.slice(0, 12))
    }
    return { sha256: localSha }
  }

  async getBytes(host: HostTarget, remotePath: string, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    const res = await this.exec(host, ['cat', remotePath], { maxBytes })
    if (res.code !== 0) {
      throw new ServiceError('NOT_FOUND', '远端文件缺失（' + remotePath + '）：' + res.stderr.slice(0, 200))
    }
    return { bytes: res.stdout, truncated: res.truncated }
  }
}
