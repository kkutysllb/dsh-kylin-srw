/** `srw_project` agent 工具（0202 Task 1.7）：根 Agent 作用域挂载的项目
 * 管理面（照 automation mountTools 形状）。
 *
 * 审批契约（dsh 0.1.7 同款，见 automation approvalDecision）：`reason` 是
 * 随审批请求入库的审计文本（不随读者语言变化），`displayReason` 是审批卡
 * 渲染的本地化文案。create/remove 需人工审批；list/open 豁免。
 */

import { ServiceError, type SrwService } from './service.ts'
import type { ProjectMeta } from './core/schema.ts'

export const SRW_TOOL_NAME = 'srw_project'

/** 需要人工审批的动作（list/open 豁免）。 */
export const SRW_ASK_ACTIONS: ReadonlySet<string> = new Set(['create', 'remove'])

/** 调用者身份（照 automation callerFrom：从 pre-execute/execute 的 exec 提取）。 */
export interface ToolCaller {
  readonly cwd?: string | undefined
  readonly sessionId?: string | undefined
}

export function callerFrom(exec: unknown): ToolCaller {
  const agent = (exec as { agent?: { session?: { id?: unknown; header?: { cwd?: unknown } } } }).agent
  return {
    sessionId: typeof agent?.session?.id === 'string' ? agent.session.id : undefined,
    cwd: typeof agent?.session?.header?.cwd === 'string' ? agent.session.header.cwd : undefined,
  }
}

export interface ApprovalAsk {
  readonly reason: string
  readonly displayReason: { readonly en: string; readonly zh: string }
}

const ASKS: ReadonlyMap<string, ApprovalAsk> = new Map([
  ['create', {
    reason: 'This creates a new project directory (slug directory + skeleton + project.json) under the research root.',
    displayReason: {
      en: 'This creates a new project directory under the research root (slug directory + skeleton + project.json).',
      zh: '此操作将在科研总根下创建新项目目录（slug 目录 + 骨架 + project.json）。',
    },
  }],
  ['remove', {
    reason: 'This permanently deletes the project directory and everything in it; the action cannot be undone.',
    displayReason: {
      en: 'This permanently deletes the project directory and all its contents (cannot be undone).',
      zh: '此操作将永久删除项目目录及其全部内容，不可恢复。',
    },
  }],
])

function actionOf(args: unknown): string {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  return typeof record['action'] === 'string' ? record['action'] : ''
}

/** 纯函数审批判定（单测面）：非本工具 / 未挂载 / 非敏感动作 → undefined。 */
export function approvalDecision(
  exec: { readonly name: string; readonly arguments?: unknown },
  mountedAgent: boolean,
): ({ readonly kind: 'ask' } & ApprovalAsk) | undefined {
  if (!mountedAgent || exec.name !== SRW_TOOL_NAME) return undefined
  const ask = ASKS.get(actionOf(exec.arguments))
  return ask === undefined ? undefined : { kind: 'ask', ...ask }
}

/** 项目单行摘要（模型面向，有界）。 */
export function projectSummary(meta: ProjectMeta): string {
  const parts = [`slug=${meta.slug}`, `title=${meta.title}`, `stage=${meta.stage}`, `updatedAt=${meta.updatedAt}`]
  if (meta.field !== undefined) parts.push(`field=${meta.field}`)
  return parts.join(' ')
}

const jsonRender = (_args: unknown, value: unknown) => [
  { type: 'text' as const, text: JSON.stringify(value, null, 2) },
]

export interface SrwToolDef {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): readonly { readonly type: 'text'; readonly text: string }[]
  }
  readonly timeoutMs: number
  execute(args: unknown, exec: unknown): Promise<unknown>
}

function toolEnvelope(error: unknown): { ok: false; error: { code: string; message: string } } {
  if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
  return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }
}

/** `srw_project` 单工具四动作定义。 */
export function srwProjectToolDef(service: SrwService): SrwToolDef {
  return {
    name: SRW_TOOL_NAME,
    description: [
      '科研项目管理（科研工作台）：list 列出科研总根下的全部项目；create 新建项目（slug 目录 + 骨架）；',
      'open 打开项目（设为当前活动项目）；remove 删除项目（危险，需审批）。',
      '科研总根未设置时先让用户在「科研工作台」面板选择。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'open', 'remove'], description: '要执行的动作' },
        slug: { type: 'string', description: '项目标识（create/open/remove 必填；^[a-z0-9][a-z0-9-]{0,63}$）' },
        title: { type: 'string', description: '项目标题（create 必填，≤200 字）' },
        field: { type: 'string', description: '学科领域（create 可选，如 nlp）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 15_000,
    execute: async (args, _exec) => {
      const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
      try {
        switch (record['action']) {
          case 'list': {
            const projects = await service.workspace.list()
            return {
              ok: true,
              value: {
                root: service.currentRoot() ?? '',
                count: projects.length,
                projects: projects.map(projectSummary),
              },
            }
          }
          case 'create': {
            const slug = typeof record['slug'] === 'string' ? record['slug'] : ''
            const title = typeof record['title'] === 'string' ? record['title'] : ''
            if (slug === '') throw new ServiceError('INVALID', 'create 需要 slug')
            if (title === '') throw new ServiceError('INVALID', 'create 需要 title')
            const field = typeof record['field'] === 'string' && record['field'] !== ''
              ? record['field']
              : undefined
            const meta = await service.workspace.create({
              slug,
              title,
              ...(field === undefined ? {} : { field }),
            })
            return { ok: true, value: { created: projectSummary(meta) } }
          }
          case 'open': {
            const slug = typeof record['slug'] === 'string' ? record['slug'] : ''
            if (slug === '') throw new ServiceError('INVALID', 'open 需要 slug')
            const meta = await service.openProject(slug)
            return { ok: true, value: { opened: projectSummary(meta as ProjectMeta) } }
          }
          case 'remove': {
            const slug = typeof record['slug'] === 'string' ? record['slug'] : ''
            if (slug === '') throw new ServiceError('INVALID', 'remove 需要 slug')
            await service.workspace.remove(slug)
            return { ok: true, value: { removed: slug } }
          }
          default:
            throw new ServiceError('INVALID', `action 必须是 list|create|open|remove，收到 ${JSON.stringify(record['action'])}`)
        }
      } catch (error) {
        return toolEnvelope(error)
      }
    },
  }
}
