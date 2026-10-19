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
  /** unavailable 且属「按设计不注入」时的原因（供诊断面三态渲染：
   * 绿=可用 / 灰=按设计 / 红=意外缺席）。有 inject 围栏的宿主上，
   * 未注入服务读属性会抛 without-inject——那是围栏按设计触发，不是故障。 */
  readonly byDesign?: string
}

/** 按设计不注入的原因（0102 §5.3 / E3 实测 / 安全红线）。 */
const BY_DESIGN: Readonly<Record<string, string>> = {
  llm: '按设计不注入——LLM 全走会话 Agent（引擎车道），插件不私接模型',
  'llm.stream': '按设计不注入——LLM 全走会话 Agent（引擎车道），插件不私接模型',
  agentDefaultModel: '按设计不注入——默认模型随会话 Agent',
  ssh: '按设计不注入——实验卡用自建 SSH provider（hosts.json 三级链），不碰 ctx.ssh',
  schedule: '按设计不注入——ctx.schedule 只投递不建会话（E3 实测注入有 pending 风险），订阅绑宿主自动化任务',
  credentials: '按设计不注入——安全红线：永不读 credentials',
  sessions: '按设计不注入——无需求',
  jobs: '按设计不注入——无需求',
  commands: '按设计不注入——无需求',
  spillStore: '按设计不注入——大载荷走磁盘文件（路径+sha256）',
  directoryPickerController: '未注入——科研总根选择走 uiWorkspace.pickDirectory（已验证），此控制器无需求',
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
  const unavailable = (detail: string): CapRow => {
    const byDesign = BY_DESIGN[path]
    return { name: path, available: false, detail, ...(byDesign !== undefined ? { byDesign } : {}) }
  }
  let current: unknown = ctx
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return unavailable('parent absent')
    }
    try {
      current = (current as Record<string, unknown>)[part]
    } catch (error: unknown) {
      return unavailable(`threw: ${String(error)}`)
    }
    if (current === undefined) return unavailable('absent')
  }
  return { name: path, available: true, detail: typeof current }
}

export function collectCaps(ctx: unknown): readonly CapRow[] {
  return HOST_SERVICE_PATHS.map(path => probe(ctx, path))
}
