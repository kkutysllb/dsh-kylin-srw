/** `srw_project` agent 工具（0202 Task 1.7）：根 Agent 作用域挂载的项目
 * 管理面（照 automation mountTools 形状）。
 *
 * 审批契约（dsh 0.1.7 同款，见 automation approvalDecision）：`reason` 是
 * 随审批请求入库的审计文本（不随读者语言变化），`displayReason` 是审批卡
 * 渲染的本地化文案。create/remove 需人工审批；list/open 豁免。
 */

import { ServiceError, type SrwService } from './service.ts'
import type { ProjectMeta } from './core/schema.ts'
import type { LitCandidate } from './literature/types.ts'

export const SRW_TOOL_NAME = 'srw_project'
export const SRW_LIT_TOOL_NAME = 'srw_literature'
export const SRW_WATCH_TOOL_NAME = 'srw_watch'

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

/** srw_watch 的 ask 动作：创建/删除订阅要问（授权周期性写库）；run/pause/
 * resume/list 豁免——run 的授权发生在建订阅时，时钟唤醒轮再问必卡死。 */
const WATCH_ASKS: ReadonlyMap<string, ApprovalAsk> = new Map([
  ['create', {
    reason: 'This creates a recurring subscription that will periodically fetch literature into the project library via the host scheduler.',
    displayReason: {
      en: 'This creates a recurring subscription that periodically fetches literature into the project library (registered with the host scheduler).',
      zh: '此操作将创建周期订阅并注册到宿主自动化任务，到期自动向项目文献库入库。',
    },
  }],
  ['remove', {
    reason: 'This deletes the subscription and its host scheduler task.',
    displayReason: {
      en: 'This deletes the subscription and its scheduled task.',
      zh: '此操作将删除订阅及其在宿主自动化任务里的时钟任务。',
    },
  }],
])

/** 全部工具的 ask 表（approvalDecision 统一查这里）。 */
const ASK_TABLE: ReadonlyMap<string, ReadonlyMap<string, ApprovalAsk>> = new Map([
  [SRW_TOOL_NAME, ASKS],
  [SRW_LIT_TOOL_NAME, TOOL_ASKS.get(SRW_LIT_TOOL_NAME) ?? new Map()],
  [SRW_WATCH_TOOL_NAME, WATCH_ASKS],
])

/** 纯函数审批判定（单测面）：非本插件工具 / 未挂载 / 非敏感动作 → undefined。 */
export function approvalDecision(
  exec: { readonly name: string; readonly arguments?: unknown },
  mountedAgent: boolean,
): ({ readonly kind: 'ask' } & ApprovalAsk) | undefined {
  if (!mountedAgent) return undefined
  const asks = ASK_TABLE.get(exec.name)
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


/** search 动作的输出投影（纯函数，无损 JSON 单测面）。
 * 无损 JSON 纪律：宿主对工具结果校验 lossless 往返——可选字段显式写
 * `key: undefined` 会被 JSON.stringify 丢键、值因此非无损（2026-10-04
 * 桌面端实测踩中：arXiv 源从不设 oaUrl → search 100% 失败）。可选字段
 * 一律条件展开。 */
export function searchOutputFor(items: readonly LitCandidate[]): {
  readonly count: number
  readonly hint: string
  readonly items: readonly unknown[]
} {
  return {
    count: items.length,
    hint: '入库用 action=import，items 传这些条目原样（缺 authors/year 也会在入库时自动补全）；project 用目标项目 slug',
    items: items.map(item => ({
      source: item.source,
      identity: item.identity,
      authors: item.authors.slice(0, 6),
      venue: item.venue,
      abstract: item.abstract.slice(0, 300),
      ...(item.pdfUrl !== undefined ? { pdfUrl: item.pdfUrl } : {}),
      ...(item.oaUrl !== undefined ? { oaUrl: item.oaUrl } : {}),
    })),
  }
}

/** `srw_literature` 四动作工具定义（search/lib 豁免；import/pdf 需 ask）。 */
/** 订阅单行摘要（模型面向，有界；可选字段条件展开守无损）。 */
export function watchSummaryFor(sub: {
  id: string
  project: string
  source: string
  query: string
  everySeconds: number
  enabled: boolean
  boundSessionId?: string
  scheduleId?: string
  lastRunAt?: string
  lastResult?: { at: string; kind: string; fresh?: number; error?: string }
}): Record<string, unknown> {
  return {
    id: sub.id,
    project: sub.project,
    source: sub.source,
    query: sub.query,
    everySeconds: sub.everySeconds,
    enabled: sub.enabled,
    scheduled: sub.scheduleId !== undefined,
    ...(sub.boundSessionId !== undefined ? { boundSessionId: sub.boundSessionId } : {}),
    ...(sub.lastRunAt !== undefined ? { lastRunAt: sub.lastRunAt } : {}),
    ...(sub.lastResult !== undefined ? { lastResult: sub.lastResult } : {}),
  }
}

/** `srw_watch` 工具：订阅抓取管理。list/run/pause/resume 豁免（run 的授权
 * 发生在 create 审批时——时钟唤醒轮必须免问）；create/remove ask。 */
export function srwWatchToolDef(service: SrwService): SrwToolDef {
  const watch = (): SrwService['watch'] => service.watch
  return {
    name: SRW_WATCH_TOOL_NAME,
    description: [
      '文献订阅抓取（科研工作台）：按检索词定期自动入库到项目文献库；时钟用的是宿主内置「自动化任务」',
      '（用户可在宿主页看到/修改对应任务）。list 列订阅；create 建订阅（需审批，自动注册时钟任务，',
      '到期自动抓取并汇报）；run 立即抓一次（幂等，重复跑 0 新增）；pause/resume 暂停恢复；remove 删除（需审批）。',
      '需要科研总根已设置；离线模式下 run 报 OFFLINE。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'remove', 'pause', 'resume', 'run'], description: '要执行的动作' },
        project: { type: 'string', description: 'create 的目标项目 slug' },
        source: { type: 'string', enum: ['arxiv', 'openalex', 'crossref'], description: 'create 的检索源（缺省 arxiv）' },
        query: { type: 'string', description: 'create 的检索词' },
        everySeconds: { type: 'number', description: 'create 的抓取间隔秒（≥900 即至少 15 分钟，缺省每天）' },
        id: { type: 'string', description: '订阅 id（remove/pause/resume/run 必填，来自 list）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 120_000,
    execute: async (args, exec) => {
      const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
      try {
        switch (record['action']) {
          case 'list': {
            const subs = await watch().list()
            return { ok: true, value: { count: subs.length, hint: 'run 立即抓取（幂等）；create 建新订阅', subs: subs.map(watchSummaryFor) } }
          }
          case 'create': {
            const everySeconds = typeof record['everySeconds'] === 'number' ? record['everySeconds'] : undefined
            const caller = callerFrom(exec)
            const result = await watch().create({
              project: record['project'],
              source: record['source'],
              query: record['query'],
              everySeconds,
            }, caller.sessionId)
            return {
              ok: true,
              value: {
                id: result.sub.id,
                scheduled: result.scheduled,
                everySeconds: result.sub.everySeconds,
                project: result.sub.project,
                query: result.sub.query,
                hint: '到点由宿主自动化任务唤醒当前会话自动抓取并汇报；pause/resume/remove 可管理',
                ...(result.hint !== undefined ? { notice: result.hint } : {}),
              },
            }
          }
          case 'remove': {
            await watch().remove(String(record['id'] ?? ''))
            return { ok: true, value: { removed: true } }
          }
          case 'pause':
            return { ok: true, value: { paused: true, sub: watchSummaryFor(await watch().pause(String(record['id'] ?? ''))) } }
          case 'resume': {
            const sessionId = typeof record['sessionId'] === 'string' && record['sessionId'] !== ''
              ? record['sessionId']
              : callerFrom(exec).sessionId
            const result = await watch().resume(String(record['id'] ?? ''), sessionId)
            return {
              ok: true,
              value: {
                scheduled: result.scheduled,
                sub: watchSummaryFor(result.sub),
                ...(result.hint !== undefined ? { notice: result.hint } : {}),
              },
            }
          }
          case 'run': {
            const result = await watch().run(String(record['id'] ?? ''))
            return {
              ok: true,
              value: {
                fresh: result.fresh,
                duplicates: result.duplicates,
                enriched: [...result.enriched],
                hint: '向用户一句话汇报新增条数（0 条也要说）',
              },
            }
          }
          default:
            return { ok: false, error: { code: 'INVALID', message: `未知 action：${JSON.stringify(record['action'])}`, details: {} } }
        }
      } catch (error: unknown) {
        if (error instanceof ServiceError) {
          return { ok: false, error: { code: error.code, message: error.message, details: {} } }
        }
        return { ok: false, error: { code: 'UPSTREAM', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    },
  }
}

export function srwLiteratureToolDef(service: SrwService): SrwToolDef {
  const lit = (): SrwService['literature'] => service.literature
  return {
    name: SRW_LIT_TOOL_NAME,
    description: [
      '文献通路（科研工作台）：search 三源检索（arxiv/openalex/crossref）；import 检索结果入项目库（需审批，自动去重+撤稿标红）；',
      'pdf 下载条目 PDF 到项目 literature/pdf/（需审批，白名单源+SSRF 防护）；bibtex 导出项目库到 paper/refs.bib（撤稿条目跳过）。',
      'import 前需要项目已存在（先用 srw_project create/open）；候选缺 authors/year 时入库自动从 arXiv 补全（离线退化原样）；科研总根未设置时提示用户在面板选择。',
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
            return { ok: true, value: searchOutputFor(items) }
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

/** `srw_read` 工具：精读执行面（0205 附记 / 引擎车道）。全部动作豁免——
 * 写的是项目域内派生产物（reading/ 与 readings/），授权来自会话里的显式
 * 意图（面板「翻译」按钮的提示词或用户直接指令）；翻译烧宿主默认模型
 * token，工具描述把分批协议写成硬纪律（每批 ≤40 块 + 逐批汇报）。 */
export const SRW_READ_TOOL_NAME = 'srw_read'

/** status 动作返回的待译块 id 上限（防超长输出；超出给 truncated 提示）。 */
const READ_PENDING_CAP = 600

export function srwReadToolDef(service: SrwService): SrwToolDef {
  const reading = (): SrwService['reading'] => service.reading
  const run = async (args: unknown): Promise<Record<string, unknown>> => {
    const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
    const project = typeof record['project'] === 'string' ? record['project'] : ''
    const paperKey = typeof record['paperKey'] === 'string' ? record['paperKey'] : ''
    switch (record['action']) {
      case 'status': {
        const status = await reading().status(project, paperKey)
        let pendingIds: string[] = []
        let pendingTruncated = false
        // 待译清单直接读 map 的译文元数据（extract 后 paper.md 未生成也能用；
        // content/verify 要等首轮翻译渲染后才可用）
        const map = await reading().loadMap(project, paperKey)
        if (map !== undefined) {
          pendingIds = map.blocks
            .filter(block => block.translation === undefined)
            .map(block => block.id)
          if (pendingIds.length > READ_PENDING_CAP) {
            pendingIds = pendingIds.slice(0, READ_PENDING_CAP)
            pendingTruncated = true
          }
        }
        return {
          ...status,
          pendingIds,
          ...(pendingTruncated ? { hint: `待译块超过 ${READ_PENDING_CAP}，只列了前 ${READ_PENDING_CAP}——按页号分批，译完一批再用 status 刷新` } : {}),
          ...(status.extracted && pendingIds.length > 0 ? { hint: '分批翻译：每批 ≤40 个 key（按页号 p<页>-b<序> 分组），逐批调 translate 并向用户报进度' } : {}),
          ...(status.extracted && status.translated >= status.blocks && status.mismatch === 0 ? { hint: '全部已译——可直接 action=export 归档' } : {}),
        }
      }
      case 'extract': {
        const pdfPath = typeof record['pdfPath'] === 'string' ? record['pdfPath'] : ''
        const result = await reading().extract(project, paperKey, pdfPath)
        return { ...result, hint: '抽取完成；action=status 看待译清单，或直接分批 translate' }
      }
      case 'translate': {
        const rawKeys = record['keys']
        const keys = Array.isArray(rawKeys) ? rawKeys.filter((item): item is string => typeof item === 'string') : undefined
        const status = await reading().translate(project, paperKey, { ...(keys !== undefined && keys.length > 0 ? { keys } : {}) })
        const remaining = Math.max(0, status.blocks - status.translated + status.mismatch)
        return {
          ...status,
          remaining,
          hint: remaining > 0
            ? `还有 ${remaining} 块待译——继续下一批（每批 ≤40 keys），每批完成向用户报一次进度`
            : '全部已译——向用户汇报最终校验四态，然后 action=export 归档当日 PDF',
        }
      }
      case 'export': {
        return await reading().exportPdf(project, paperKey)
      }
      default:
        throw new ServiceError('INVALID', `未知 action：${JSON.stringify(record['action'])}`)
    }
  }
  return {
    name: SRW_READ_TOOL_NAME,
    description: [
      '精读执行面（科研工作台）：把项目文献库里的 PDF 抽成块（extract）、逐块 LLM 翻译成中文',
      '（translate，带哈希缓存——重复调用只译新增/被改块）、查进度（status，含待译块清单）、',
      '把双语结果按日期归档成 PDF（export，落 readings/<日期>/）。',
      '翻译纪律：每批 ≤40 个块 id（按页号分组），逐批调用并向用户报告进度；不要一次整篇',
      '（长论文会超时）。需要项目已存在、条目已取 PDF；LLM 用宿主默认模型。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'extract', 'translate', 'export'], description: '要执行的动作' },
        project: { type: 'string', description: '项目 slug' },
        paperKey: { type: 'string', description: '论文 key（reading/<paperKey> 目录名，如 arxiv-1706-03762）' },
        pdfPath: { type: 'string', description: 'extract 必填：PDF 在项目内的相对路径（如 literature/pdf/xxx.pdf）' },
        keys: { type: 'array', items: { type: 'string' }, description: 'translate 可选：本批要译的块 id（≤40 个，来自 status 的 pendingIds）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 300_000,
    execute: async (args) => {
      try {
        return { ok: true, value: await run(args) }
      } catch (error: unknown) {
        return toolEnvelope(error)
      }
    },
  }
}
