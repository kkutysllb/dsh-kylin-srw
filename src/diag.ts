/** 能力探测（M0 诊断面 / Phase 0 V 系列的数据源）。
 *
 * 纯函数：给定任意宿主 ctx（真实 cordis ctx 或测试 fake），逐个软探测
 * 宿主服务与关键方法是否存在。绝不抛错——缺席就是「不可用」这个事实本身。
 * 探测清单与 0102 §5.3 兼容矩阵一一对应，E1/E2 的结论据此回填。
 */

export interface CapRow {
  readonly name: string
  readonly available: boolean
  readonly detail: string
}

/** 宿主侧探测面：服务名（或 `服务.子成员` 路径）。 */
const HOST_SERVICE_PATHS: readonly string[] = [
  'connection',
  'connection.rpc',
  'connection.requestRejection',
  'webServer',
  'settings',
  'storageDomain',
  'workspaceRegistry',
  'fs',
  'fs.contains',
  'fs.writeBytes',
  'fs.watch',
  'llm',
  'llm.stream',
  'agentDefaultModel',
  'ssh',
  'schedule',
  'agents',
  'sessions',
  'jobs',
  'tools',
  'skills',
  'commands',
  'credentials',
  'systemPrompt',
  'directoryPickerController',
  'spillStore',
  'reflect',
]

function probe(ctx: unknown, path: string): CapRow {
  let current: unknown = ctx
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return { name: path, available: false, detail: 'parent absent' }
    }
    try {
      current = (current as Record<string, unknown>)[part]
    } catch (error: unknown) {
      return { name: path, available: false, detail: `threw: ${String(error)}` }
    }
    if (current === undefined) return { name: path, available: false, detail: 'absent' }
  }
  return { name: path, available: true, detail: typeof current }
}

export function collectCaps(ctx: unknown): readonly CapRow[] {
  return HOST_SERVICE_PATHS.map(path => probe(ctx, path))
}

/** 宿主 home 口径（0102 §5.3：双通道 home 不同，经此单点解析，不硬编码）。 */
export function hostHomeFromEnv(env: Record<string, string | undefined>, homedir: string): {
  channel: 'qilin' | 'dsh' | 'unknown'
  home: string
} {
  const qilin = env['QILIN_HOME'] ?? `${homedir}/.qilin`
  const dsh = env['DSH_HOME'] ?? `${homedir}/.dsh`
  if (env['QILIN_HOME'] !== undefined) return { channel: 'qilin', home: qilin }
  if (env['DSH_HOME'] !== undefined) return { channel: 'dsh', home: dsh }
  return { channel: 'unknown', home: `${homedir}/.qilin` }
}
