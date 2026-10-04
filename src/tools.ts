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
export const SRW_LIT_TOOL_NAME = 'srw_literature'

/** 需要人工审批的动作（list/open/lib/search/bibtex 豁免）。 */
export const SRW_ASK_ACTIONS: ReadonlySet<string> = new Set(['create', 'remove'])
export const SRW_LIT_ASK_ACTIONS: ReadonlySet<string> = new Set(['import', 'pdf'])

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

/** 工具 → 该工具敏感动作的 ask 文案表。 */
const TOOL_ASKS: ReadonlyMap<string, ReadonlyMap<string, ApprovalAsk>> = new Map([
  [SRW_TOOL_NAME, ASKS],
  [SRW_LIT_TOOL_NAME, new Map([
    ['import', {
      reason: 'This writes external literature metadata into the project library (library.json) and may contact Crossref for retraction checks.',
      displayReason: {
        en: 'This writes external literature metadata into the project library and may query Crossref for retraction checks.',
        zh: '此操作将把外部文献元数据写入项目文献库，并可能请求 Crossref 做撤稿核查。',
      },
    }],
    ['pdf', {
      reason: 'This downloads a PDF from a whitelisted source to the project directory (network egress + disk write).',
      displayReason: {
        en: 'This downloads a PDF from a whitelisted academic source into the project directory.',
        zh: '此操作将从白名单学术源下载 PDF 到项目目录。',
      },
    }],
  ])],
])

/** 纯函数审批判定（单测面）：非本插件工具 / 未挂载 / 非敏感动作 → undefined。 */
export function approvalDecision(
  exec: { readonly name: string; readonly arguments?: unknown },
  mountedAgent: boolean,
): ({ readonly kind: 'ask' } & ApprovalAsk) | undefined {
  if (!mountedAgent) return undefined
  const asks = exec.name === SRW_TOOL_NAME ? ASKS : exec.name === SRW_LIT_TOOL_NAME ? TOOL_ASKS.get(SRW_LIT_TOOL_NAME) : undefined
  if (asks === undefined) return undefined
  const ask = asks.get(actionOf(exec.arguments))
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


/** `srw_literature` 四动作工具定义（search/lib 豁免；import/pdf 需 ask）。 */
export function srwLiteratureToolDef(service: SrwService): SrwToolDef {
  const lit = (): SrwService['literature'] => service.literature
  return {
    name: SRW_LIT_TOOL_NAME,
    description: [
      '文献通路（科研工作台）：search 三源检索（arxiv/openalex/crossref）；import 检索结果入项目库（需审批，自动去重+撤稿标红）；',
      'pdf 下载条目 PDF 到项目 literature/pdf/（需审批，白名单源+SSRF 防护）；bibtex 导出项目库到 paper/refs.bib（撤稿条目跳过）。',
      'import 前需要项目已存在（先用 srw_project create/open）；科研总根未设置时提示用户在面板选择。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'import', 'pdf', 'bibtex', 'lib'], description: '要执行的动作' },
        source: { type: 'string', enum: ['arxiv', 'openalex', 'crossref'], description: 'search 的源' },
        query: { type: 'string', description: 'search 检索词（可带 arXiv 字段前缀 ti:/au:/all:）' },
        limit: { type: 'number', description: 'search 条数上限（≤50，缺省 20）' },
        project: { type: 'string', description: '项目 slug（import/pdf/bibtex/lib 必填）' },
        key: { type: 'string', description: '条目 key（pdf 必填，来自 lib）' },
        keys: { type: 'array', items: { type: 'string' }, description: 'bibtex 的条目 key 子集（缺省全库）' },
        items: { type: 'array', description: 'import 的候选条目（来自 search 的原始条目）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 120_000,
    execute: async (args, _exec) => {
      const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
      try {
        switch (record['action']) {
          case 'search': {
            const limit = typeof record['limit'] === 'number' ? record['limit'] : 20
            const items = await lit().search(
              typeof record['source'] === 'string' ? record['source'] : 'arxiv',
              typeof record['query'] === 'string' ? record['query'] : '',
              limit,
            )
            return {
              ok: true,
              value: {
                count: items.length,
                hint: '入库用 action=import，items 传这些条目原样；project 用目标项目 slug',
                items: items.map(item => ({
                  source: item.source,
                  identity: item.identity,
                  authors: item.authors.slice(0, 6),
                  venue: item.venue,
                  abstract: item.abstract.slice(0, 300),
                  pdfUrl: item.pdfUrl,
                  oaUrl: item.oaUrl,
                })),
              },
            }
          }
          case 'lib': {
            const entries = await lit().lib(String(record['project'] ?? ''))
            return {
              ok: true,
              value: {
                count: entries.length,
                entries: entries.map(e => ({
                  key: e.key, title: e.identity.title, year: e.identity.year,
                  status: e.status, seenIn: e.seenIn, hasPdf: e.pdf !== undefined,
                })),
              },
            }
          }
          case 'import': {
            const items = Array.isArray(record['items']) ? record['items'] : []
            if (items.length === 0) throw new ServiceError('INVALID', 'import 需要 items（来自 search）')
            const result = await lit().importEntries(String(record['project'] ?? ''), items)
            return { ok: true, value: { ...result, hint: 'added=新增 duplicates=去重跳过 retracted=撤稿标红' } }
          }
          case 'pdf': {
            const result = await lit().fetchPdf(String(record['project'] ?? ''), String(record['key'] ?? ''))
            return { ok: true, value: { ...result, hint: '已回填条目 pdf 字段；面板可见 has-pdf 徽章' } }
          }
          case 'bibtex': {
            const keys = Array.isArray(record['keys']) ? record['keys'].filter((k): k is string => typeof k === 'string') : undefined
            const result = await lit().bibtex(String(record['project'] ?? ''), keys)
            return { ok: true, value: { ...result, path: 'paper/refs.bib' } }
          }
          default:
            throw new ServiceError('INVALID', `action 必须是 search|import|pdf|bibtex|lib，收到 ${JSON.stringify(record['action'])}`)
        }
      } catch (error) {
        return toolEnvelope(error)
      }
    },
  }
}
