/** 提交与派发原语（§4.5 派发纪律）：脚本先落远端盘（provider.put）再
 * bash 绝对路径执行；setsid nohup 脱离会话 + run.pid + 哨兵；exit.code/done
 * 是作业契约终态标记（真机 V12 已实测该套契约）。entry/env 用户值只进
 * job.sh 文件内容（单引号转义），绝不做命令字符串插值——argv 数组纪律由
 * provider 层保证，本模块只生成「文件字节」。 */

/** launch 成功哨兵（F1 教训：无哨兵时首句被吞、exit 0 假成功）。 */
export const LAUNCH_OK_SENTINEL = '__SRW_LAUNCH_OK__'

/** shell 单引号转义（唯一允许的用户值进脚本方式，§8.2）。 */
export function shellSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, String.raw`'\''`) + "'"
}

/** 波浪号路径展开（远端绝对路径拼装用；home 只在内存）。 */
export function expandTilde(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return home + path.slice(1)
  return path
}

/** 远端 runDir（可落盘的波浪号形式，§5.2）。 */
export function remoteRunDirTilde(projectRef: string, runId: string): string {
  return '~/srw-runs/' + projectRef + '/' + runId
}

export interface JobScriptInput {
  readonly runDirAbs: string
  readonly entry: readonly string[]
  readonly seed: number
  readonly cudaVisibleDevices: string
  readonly env?: Readonly<Record<string, string>>
}

/** srw-wrapper.sh：用户入口 + 契约终态。无论 entry 退出码如何，exit.code/done 必写。
 * 文件名固定 srw-wrapper.sh（不叫 job.sh）：用户上传的 entry 脚本常名 job.sh，
 * 同名会把用户文件覆盖成「自递归包装器」（真机踩中：SHLVL 爆表 exit 254）。 */
export function buildJobScript(input: JobScriptInput): string {
  const lines = [
    '#!/usr/bin/env bash',
    '# 由 srw 生成（M7）：entry/env 逐值单引号转义；exit.code/done 为作业契约终态。',
    'set -uo pipefail',
    'cd ' + shellSingleQuote(input.runDirAbs) + ' || { echo 97 > exit.code; exit 97; }',
    'export CUDA_VISIBLE_DEVICES=' + shellSingleQuote(input.cudaVisibleDevices),
    'export SRW_SEED=' + shellSingleQuote(String(input.seed)),
  ]
  for (const [key, value] of Object.entries(input.env ?? {})) {
    lines.push('export ' + key + '=' + shellSingleQuote(value))
  }
  lines.push(input.entry.map(part => shellSingleQuote(part)).join(' '))
  lines.push(
    'code=$?',
    'printf %s "$code" > exit.code',
    ': > done',
    'exit "$code"',
    '',
  )
  return lines.join('\n')
}

/** launch.sh：setsid 会话首进程 = 进程组（kill -TERM -<pid> 可整组取消），
 * 写 run.pid，回显哨兵。 */
export function buildLaunchScript(runDirAbs: string): string {
  return [
    '#!/usr/bin/env bash',
    '# 由 srw 生成（M7）：setsid 脱离会话（ssh/宿主退出不影响远端作业）+ run.pid + 哨兵。',
    'cd ' + shellSingleQuote(runDirAbs) + ' || exit 97',
    // stdout/stderr 统一进 run.log（作业契约 logFile，logs 动作按偏移尾读它）。
    'setsid nohup bash ' + shellSingleQuote(runDirAbs + '/srw-wrapper.sh') + ' > ' + shellSingleQuote(runDirAbs + '/run.log') + ' 2>&1 &',
    'echo $! > run.pid',
    'echo ' + LAUNCH_OK_SENTINEL,
    '',
  ].join('\n')
}
