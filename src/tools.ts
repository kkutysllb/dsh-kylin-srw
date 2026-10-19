/** `srw_project` agent 工具（0202 Task 1.7）：根 Agent 作用域挂载的项目
 * 管理面（照 automation mountTools 形状）。
 *
 * 审批契约（dsh 0.1.7 同款，见 automation approvalDecision）：`reason` 是
 * 随审批请求入库的审计文本（不随读者语言变化），`displayReason` 是审批卡
 * 渲染的本地化文案。create/remove 需人工审批；list/open 豁免。
 */

import { ServiceError, type SrwService } from './service.ts'
import type { ProjectMeta } from './core/schema.ts'
import type { PatentMeta } from './patent/types.ts'
import type { ArtifactKind, Provenance } from './materials/types.ts'
import type { LitCandidate } from './literature/types.ts'
import { UNTRANSLATED_KINDS } from './reading/extract.ts'

export const SRW_TOOL_NAME = 'srw_project'
export const SRW_EXPERIMENT_TOOL_NAME = 'srw_experiment'
export const SRW_LIT_TOOL_NAME = 'srw_literature'
export const SRW_WATCH_TOOL_NAME = 'srw_watch'
export const SRW_PATENT_TOOL_NAME = 'srw_patent'
export const SRW_MATERIALS_TOOL_NAME = 'srw_materials'

/** 需要人工审批的动作（list/open/lib/search/bibtex 豁免）。 */
export const SRW_ASK_ACTIONS: ReadonlySet<string> = new Set(['create', 'remove'])
export const SRW_LIT_ASK_ACTIONS: ReadonlySet<string> = new Set(['import', 'pdf', 'fulltext'])

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
    ['fulltext', {
      reason: 'This resolves an OA copy via Unpaywall/publisher links, downloads it to the project, and records fulltext evidence (network egress + disk write).',
      displayReason: {
        en: 'This resolves an open-access full text (Unpaywall or publisher OA link), verifies it is a PDF, and writes it with provenance into the project.',
        zh: '此操作将通过 Unpaywall/出版商 OA 链接解析开放获取全文，校验 PDF 魔数后落盘并记录全文证据。',
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

/** srw_patent 的 ask 动作：create 建专利档案目录要问；其余动作豁免
 * （交底书/事件是项目域内草稿 IO，publication.check 是纯读计算）。 */
const PATENT_ASKS: ReadonlyMap<string, ApprovalAsk> = new Map([
  ['create', {
    reason: 'This creates a new patent record directory (.srw/patent/<patentId>/ with patent.json and events.jsonl) inside the project.',
    displayReason: {
      en: 'This creates a new patent record directory inside the project (patent.json + append-only events.jsonl).',
      zh: '此操作将在项目内创建新的专利档案目录（patent.json + 只增事件流水 events.jsonl）。',
    },
  }],
])

/** srw_materials 的 ask 动作：insert 写论文正文要问；其余豁免——
 * generate/verify/numbers 是项目域内确定性 IO（materials/、experiments/
 * manual/、paper/generated/），metrics.import 是补数据通道（M7 未开工时
 * 用户手工导数入库，写 experiments/manual/）。 */
const MATERIALS_ASKS: ReadonlyMap<string, ApprovalAsk> = new Map([
  ['insert', {
    reason: 'This writes a generated artifact into the paper: copies the .tex into paper/figs/ and appends an \\input line to a section file.',
    displayReason: {
      en: 'This inserts a generated artifact into the paper body (copies the .tex into paper/figs/ and appends \\input to a section file).',
      zh: '此操作将把生成的素材插入论文正文：复制 .tex 到 paper/figs/ 并在节文件末尾追加 \\input。',
    },
  }],
])

/** srw_experiment 的 ask 动作：submit 会在远端 GPU 主机上执行用户代码
 * （本插件风险最高的动作），cancel 会杀远端进程组——两者必须人工确认；
 * hosts/env/status/logs/collect/claims.check/gaps.list/dataset.register
 * 是只读或项目域内 IO，豁免（与 00 §8.2「IO 工具豁免、门在服务层」一致）。
 * spec 确认门与 D 档门在 compute/service.submit 里硬编码（GATE）。 */
const EXPERIMENT_ASKS: ReadonlyMap<string, ApprovalAsk> = new Map([
  ['submit', {
    reason: 'This uploads code and launches a job on the remote GPU host (remote code execution via SSH); the spec gate and depth-tier gate have already run at the service layer.',
    displayReason: {
      en: 'This uploads the code snapshot and launches a job on the remote GPU host over SSH (remote code execution).',
      zh: '此操作将通过 SSH 把代码快照上传到远程 GPU 主机并启动作业（远端代码执行）。',
    },
  }],
  ['cancel', {
    reason: 'This kills the remote job process group (SIGTERM then SIGKILL after a grace period) on the GPU host.',
    displayReason: {
      en: 'This kills the remote job process group on the GPU host (SIGTERM, then SIGKILL after a grace period).',
      zh: '此操作将终止 GPU 主机上的远端作业进程组（先 SIGTERM，宽限后 SIGKILL）。',
    },
  }],
])

/** 全部工具的 ask 表（approvalDecision 统一查这里）。 */
const ASK_TABLE: ReadonlyMap<string, ReadonlyMap<string, ApprovalAsk>> = new Map([
  [SRW_TOOL_NAME, ASKS],
  [SRW_LIT_TOOL_NAME, TOOL_ASKS.get(SRW_LIT_TOOL_NAME) ?? new Map()],
  [SRW_WATCH_TOOL_NAME, WATCH_ASKS],
  [SRW_PATENT_TOOL_NAME, PATENT_ASKS],
  [SRW_MATERIALS_TOOL_NAME, MATERIALS_ASKS],
  [SRW_EXPERIMENT_TOOL_NAME, EXPERIMENT_ASKS],
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
      '文献通路（科研工作台）：search 三源检索（arxiv/openalex/crossref）；import 检索结果入项目库（需审批，自动去重+撤稿标红+DOI 校验）；',
      'pdf 下载条目 PDF 到项目 literature/pdf/（需审批，白名单源+SSRF 防护）；fulltext 取开放获取全文（需审批：Unpaywall/条目 OA 链接 → 域确认 → PDF 魔数门 → 证据落盘；只取 OA，不绕付费墙）；',
      'bibtex 导出项目库到 paper/refs.bib（撤稿条目跳过并返回 skippedRetracted）；verify 校验 DOI（失败 UNRESOLVED）；citeGate 引用门（撤稿硬阻断，unresolved 警告）；',
      'migrate 身份迁移（默认 dry-run，apply=true 才写盘并备份）；plan.save/plan.run/plan.list/plan.replay 管理可重放检索计划（replay 离线只读本地结果）。',
      'import 前需要项目已存在（先用 srw_project create/open）；候选缺 authors/year 时入库自动从 arXiv 补全（离线退化原样）；科研总根未设置时提示用户在面板选择。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'import', 'pdf', 'fulltext', 'bibtex', 'lib', 'verify', 'citeGate', 'migrate', 'plan.save', 'plan.run', 'plan.list', 'plan.replay'],
          description: '要执行的动作',
        },
        source: { type: 'string', enum: ['arxiv', 'openalex', 'crossref'], description: 'search 的源' },
        query: { type: 'string', description: 'search 检索词（可带 arXiv 字段前缀 ti:/au:/all:）；plan.save 也可传对象 {text,filters}' },
        limit: { type: 'number', description: 'search 条数上限（≤50，缺省 20）；plan.save 下同 perSourceLimit' },
        project: { type: 'string', description: '项目 slug（import/pdf/fulltext/bibtex/lib/verify/citeGate/migrate/plan.* 必填）' },
        key: { type: 'string', description: '条目 key（pdf/fulltext 必填，来自 lib）' },
        keys: { type: 'array', items: { type: 'string' }, description: 'bibtex 的条目 key 子集（缺省全库）/ citeGate 的待检 key' },
        items: { type: 'array', description: 'import 的候选条目（来自 search 的原始条目）' },
        doi: { type: 'string', description: 'fulltext/verify 的 DOI（fulltext 下 key 与 doi 至少给一个）' },
        allowHost: { type: 'string', description: 'fulltext 可选：显式确认的 PDF 主机（会写回 root.json fulltext.confirmedHosts）' },
        planId: { type: 'string', description: 'plan.run/plan.replay 的计划 id（来自 plan.save/plan.list）' },
        text: { type: 'string', description: 'plan.save 的检索式文本' },
        filters: { type: 'object', description: 'plan.save 的过滤 {yearFrom,yearTo,source[]}' },
        sources: { type: 'array', items: { type: 'string' }, description: 'plan.save 的源列表（缺省三源）' },
        perSourceLimit: { type: 'number', description: 'plan.save 的每源条数上限（1..50，缺省 20）' },
        sort: { type: 'string', enum: ['relevance', 'citations', 'year'], description: 'plan.save 的源内排序偏好' },
        runId: { type: 'string', description: 'plan.replay 可选：指定历史 run（缺省最新）' },
        apply: { type: 'boolean', description: 'migrate：false/缺省 dry-run；true 才写盘（写前备份 library.json.bak）' },
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
          case 'fulltext': {
            const key = typeof record['key'] === 'string' && record['key'] !== '' ? record['key'] : undefined
            const doi = typeof record['doi'] === 'string' && record['doi'] !== '' ? record['doi'] : undefined
            const allowHost = typeof record['allowHost'] === 'string' && record['allowHost'] !== '' ? record['allowHost'] : undefined
            const result = await lit().fulltext(String(record['project'] ?? ''), {
              ...(key === undefined ? {} : { key }),
              ...(doi === undefined ? {} : { doi }),
              ...(allowHost === undefined ? {} : { allowHost }),
            })
            return {
              ok: true,
              value: {
                ...result,
                hint: '已落盘 PDF + literature/fulltext 证据；失败分型 PAYWALLED/HOST_NOT_ALLOWED/CONTENT_NOT_PDF/UNRESOLVED/SSRF_BLOCKED（HOST_NOT_ALLOWED 时把提示的主机作为 allowHost 重试）',
              },
            }
          }
          case 'bibtex': {
            const keys = Array.isArray(record['keys']) ? record['keys'].filter((k): k is string => typeof k === 'string') : undefined
            const result = await lit().bibtex(String(record['project'] ?? ''), keys)
            return { ok: true, value: { ...result, path: 'paper/refs.bib', hint: 'skippedRetracted=撤稿条目已跳过（硬门）' } }
          }
          case 'verify': {
            const result = await lit().verifyDoi(String(record['doi'] ?? ''))
            return { ok: true, value: result }
          }
          case 'citeGate': {
            const keys = Array.isArray(record['keys']) ? record['keys'].filter((k): k is string => typeof k === 'string') : undefined
            const result = await lit().citeGate(String(record['project'] ?? ''), keys)
            return { ok: true, value: { ...result, hint: 'blocked=撤稿硬阻断；warnings=DOI 未核验（不阻断但需先 verify）' } }
          }
          case 'migrate': {
            const result = await lit().migrate(String(record['project'] ?? ''), record['apply'] === true)
            return {
              ok: true,
              value: {
                ...result,
                hint: result.dryRun ? 'dry-run：报告将重命名/合并的条数，未写盘；确认后传 apply=true' : (result.applied ? '已写盘并备份 library.json.bak' : '无需迁移（已是最新键）'),
              },
            }
          }
          case 'plan.save': {
            const payload: Record<string, unknown> = {
              ...(typeof record['text'] === 'string' ? { text: record['text'] } : {}),
              ...(record['query'] !== undefined ? { query: record['query'] } : {}),
              ...(record['filters'] !== undefined ? { filters: record['filters'] } : {}),
              ...(Array.isArray(record['sources']) ? { sources: record['sources'] } : {}),
              ...(typeof record['perSourceLimit'] === 'number' ? { perSourceLimit: record['perSourceLimit'] } : {}),
              ...(typeof record['limit'] === 'number' ? { limit: record['limit'] } : {}),
              ...(typeof record['sort'] === 'string' ? { sort: record['sort'] } : {}),
              ...(typeof record['planId'] === 'string' ? { planId: record['planId'] } : {}),
            }
            const plan = await lit().planSave(String(record['project'] ?? ''), payload)
            return { ok: true, value: { ...plan, hint: '计划已保存（不触网）；action=plan.run 执行三源检索' } }
          }
          case 'plan.run': {
            const result = await lit().planRun(String(record['project'] ?? ''), String(record['planId'] ?? ''))
            return {
              ok: true,
              value: {
                ...result,
                hint: `运行完成：identified=${result.counts.identified} deduped=${result.counts.deduped} resultHash=${result.resultHash}；离线可用 action=plan.replay 复核`,
              },
            }
          }
          case 'plan.list': {
            const plans = await lit().planList(String(record['project'] ?? ''))
            return { ok: true, value: { count: plans.length, plans } }
          }
          case 'plan.replay': {
            const runId = typeof record['runId'] === 'string' && record['runId'] !== '' ? record['runId'] : undefined
            const result = await lit().planReplay(String(record['project'] ?? ''), String(record['planId'] ?? ''), runId)
            return {
              ok: true,
              value: {
                ...result,
                hint: result.consistent
                  ? `resultHash 一致（${result.keyCount} 条）；diff.added=${result.diff.added.length} diff.removed=${result.diff.removed.length}`
                  : `resultHash 不一致：文件可能被改动或旧版本生成（recomputed=${result.recomputedHash}）`,
              },
            }
          }
          default:
            throw new ServiceError('INVALID', `action 必须是 search|import|pdf|fulltext|bibtex|lib|verify|citeGate|migrate|plan.*，收到 ${JSON.stringify(record['action'])}`)
        }
      } catch (error) {
        return toolEnvelope(error)
      }
    },
  }
}

/** `srw_paper` 工具：论文线执行面（M5）。全部动作豁免审批——写的是项目域内
 * paper/ 与 .srw/{venue,outline}.json；大纲/正文内容由会话里的 Agent 自己
 * 起草（agent 车道：工具只做 IO + 门），G1 确认门在服务层硬编码——未确认
 * 的大纲 section.write 直接拒绝。编译是本机进程（TeX 引擎全缺时报
 * ENGINE_MISSING + 安装引导，不算工具失败）。 */
/** `srw_submission` 工具：投稿与返修执行面（M8，分批交付：8.3 审稿响应信，
 * 8.4/8.6 补 draft/check/pack/format）。review.* 全豁免审批——写的是项目域内
 * reviews/ 草稿；证据门在服务层（RESPONSE_UNBACKED），只证「引用存在」。 */
export const SRW_SUBMISSION_TOOL_NAME = 'srw_submission'

export function srwSubmissionToolDef(service: SrwService): SrwToolDef {
  const writer = (): SrwService['writer'] => service.writer
  const run = async (args: unknown): Promise<Record<string, unknown>> => {
    const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
    const project = typeof record['project'] === 'string' ? record['project'] : ''
    switch (record['action']) {
      case 'review.open': {
        const round = typeof record['round'] === 'number' ? record['round'] : Number.NaN
        const venueId = typeof record['venueId'] === 'string' ? record['venueId'] : ''
        const baseSnapshotId = typeof record['baseSnapshotId'] === 'string' ? record['baseSnapshotId'] : ''
        const reviews = Array.isArray(record['reviews']) ? record['reviews'] as unknown[] : []
        const opened = await writer().reviewOpen(project, round, {
          venueId,
          baseSnapshotId,
          reviews: reviews as never,
        })
        return { ...opened, hint: '轮次已落盘——审稿人意见逐条 review.respond（changes 必须引用 action=diff 的真实 hunk）' }
      }
      case 'review.respond': {
        const round = typeof record['round'] === 'number' ? record['round'] : Number.NaN
        const commentId = typeof record['commentId'] === 'string' ? record['commentId'] : ''
        const response = typeof record['response'] === 'string' ? record['response'] : ''
        const changes = record['changes']
        const saved = await writer().reviewRespond(project, round, commentId, response, changes)
        return { round: saved.round, answered: saved.items.length, hint: '已记录——全部意见回复后 review.export 导出响应信' }
      }
      case 'review.export': {
        const round = typeof record['round'] === 'number' ? record['round'] : Number.NaN
        const format = record['format'] === 'tex' ? 'tex' : 'md'
        const exported = await writer().reviewExport(project, round, format)
        return {
          path: exported.path,
          bytes: exported.bytes,
          content: exported.content,
          unanswered: exported.unanswered,
          hint: exported.unanswered.length === 0 ? '全部意见已回复' : `未回复：${exported.unanswered.join('、')}`,
        }
      }
      case 'submission.draft': {
        const field = typeof record['field'] === 'string' ? record['field'] : ''
        const text = typeof record['text'] === 'string' ? record['text'] : ''
        const state = await writer().submissionDraft(project, field, text)
        return {
          ...state.draft,
          rendered: state.rendered,
          warnings: state.warnings,
          hint: `已落盘并重渲染（${state.rendered.join('、')}）——warnings ${state.warnings.length} 条`,
        }
      }
      case 'submission.show': {
        const draft = await writer().submissionShow(project)
        return { ...draft, hint: '当前投稿材料草稿状态（真相源 submissions/draft.json）' }
      }
      case 'format.check': {
        const tier = record['tier'] === 'D1' || record['tier'] === 'D2' || record['tier'] === 'D3' ? record['tier'] : undefined
        const report = await writer().formatCheck(project, tier)
        const failed = report.checks.filter(check => check.pass === false)
        return {
          ...report,
          failedCount: failed.length,
          hint: failed.length === 0
            ? '格式检查全部通过（或缺席项诚实降级）——可 submission.pack'
            : `不过 ${failed.length} 项：${failed.map(check => check.id).join('、')}——按 where 字段整改`,
        }
      }
      default:
        throw new ServiceError('INVALID', `未知 action：${JSON.stringify(record['action'])}`)
    }
  }
  return {
    name: SRW_SUBMISSION_TOOL_NAME,
    description: [
      '投稿与返修执行面（科研工作台 M8）：审稿轮管理（review.open 落审稿意见结构 +',
      '证据基线快照、review.respond 逐条回复——changes 必须引用 srw_paper action=diff',
      '的真实 file+hunk，否则 RESPONSE_UNBACKED 拒绝、review.export 导出 md/tex 响应信，',
      '含意见/回复/修改位置+diff 摘要/快照 id）、投稿材料草稿（submission.draft：',
      'coverLetter/highlights/声明逐项——数据可得性自动取证，取不到标「需作者确认」；',
      'submission.show 看状态）、格式检查（format.check：模板/页数/摘要/图表计数/',
      '引用样式/图片 DPI/栏数十项，激活刊物死字段；D2/D3 不过项需整改）。',
      '后续批次：submission.check/pack。',
      '纪律：回复与声明内容必须由你自己起草并如实对应真实情况，门只验证引用与证据存在。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['review.open', 'review.respond', 'review.export', 'submission.draft', 'submission.show', 'format.check'],
          description: '要执行的动作',
        },
        project: { type: 'string', description: '项目 slug' },
        round: { type: 'number', description: '审稿轮次（1–99）' },
        venueId: { type: 'string', description: 'review.open 必填：刊物 id' },
        baseSnapshotId: { type: 'string', description: 'review.open 必填：证据基线快照（首轮基线或上一轮投稿快照，snapshot.list 查询）' },
        reviews: { type: 'array', description: 'review.open 必填：[{reviewer, comments:[{id, text, area?}]}]', items: { type: 'object' } },
        commentId: { type: 'string', description: 'review.respond 必填：意见 id' },
        response: { type: 'string', description: 'review.respond 必填：回复正文（≤8000 字符）' },
        changes: { type: 'array', description: 'review.respond 可选：[{snapshotId, file, hunkIndex, note?}]——必须来自 action=diff 的真实 hunk', items: { type: 'object' } },
        format: { type: 'string', enum: ['md', 'tex'], description: 'review.export 可选：导出格式（默认 md）' },
        field: { type: 'string', description: 'submission.draft 必填：coverLetter | highlights（换行分隔 3–5 条，每条 ≤100 字符） | statement.<dataAvailability|codeAvailability|limitations|conflictOfInterest|ethics|authorContributions> | title | round' },
        text: { type: 'string', description: 'submission.draft 必填：对应字段内容' },
        tier: { type: 'string', enum: ['D1', 'D2', 'D3'], description: 'format.check 可选：档位（默认取已应用档位）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 600_000,
    execute: async (args) => {
      const value = await run(args)
      return { type: 'json' as const, value }
    },
  }
}

export const SRW_PAPER_TOOL_NAME = 'srw_paper'

export function srwPaperToolDef(service: SrwService): SrwToolDef {
  const writer = (): SrwService['writer'] => service.writer
  const run = async (args: unknown): Promise<Record<string, unknown>> => {
    const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
    const project = typeof record['project'] === 'string' ? record['project'] : ''
    switch (record['action']) {
      case 'state':
        return { ...(await writer().state(project)) }
      case 'venue.list':
        return { venues: writer().venueList() }
      case 'venue.apply': {
        const venueId = typeof record['venueId'] === 'string' ? record['venueId'] : ''
        const tier = record['tier'] === 'D1' || record['tier'] === 'D2' || record['tier'] === 'D3' ? record['tier'] : undefined
        const instance = await writer().venueApply(project, venueId, tier)
        return { ...instance, hint: `已应用 ${venueId}（档位 ${instance.tier}）——action=scaffold 生成骨架` }
      }
      case 'scaffold': {
        const title = typeof record['title'] === 'string' && record['title'].trim() !== '' ? record['title'].trim() : ''
        if (title === '') throw new ServiceError('INVALID', 'scaffold 需要 title（论文标题）')
        const authors = typeof record['authors'] === 'string' ? record['authors'] : undefined
        const plan = await writer().scaffold(project, { title, ...(authors !== undefined ? { authors } : {}) })
        return { written: plan.written, sections: plan.sections, hint: '骨架已生成（大纲草稿同步落盘）——action=outline.prompt 拿提示词起草大纲' }
      }
      case 'outline.get':
        return { ...(await writer().outlineGet(project) ?? { status: 'none', revision: 0, sections: [] }) }
      case 'outline.prompt': {
        const result = await writer().outlinePromptFor(project)
        return { ...result, hint: '按提示词拟好大纲 JSON，然后 action=outline.save 提交（sections 数组）' }
      }
      case 'outline.save': {
        const raw = record['sections']
        const sections = Array.isArray(raw)
          ? raw.map((item: unknown) => {
              const section = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
              return {
                title: typeof section['title'] === 'string' ? section['title'] : '',
                intent: typeof section['intent'] === 'string' ? section['intent'] : '',
                ...(typeof section['targetWords'] === 'number' ? { targetWords: section['targetWords'] } : {}),
              }
            }).filter(section => section.title !== '')
          : []
        const outline = await writer().outlineSave(project, sections)
        return { ...outline, hint: '大纲已保存（draft）——向用户逐节展示并请确认，用户同意后 action=outline.confirm（G1 门）' }
      }
      case 'outline.confirm': {
        const outline = await writer().outlineConfirm(project)
        return { ...outline, hint: `大纲已确认（revision ${outline.revision}，G1 通过）——可 action=section.write 逐节起草正文` }
      }
      case 'section.write': {
        const sectionId = typeof record['sectionId'] === 'string' ? record['sectionId'] : ''
        const tex = typeof record['tex'] === 'string' ? record['tex'] : ''
        if (tex.trim() === '') throw new ServiceError('INVALID', 'section.write 需要 tex（完整节 LaTeX）')
        const result = await writer().sectionWrite(project, sectionId, tex)
        return { ...result, hint: '节已写入——全部节写完后 action=compile 编译' }
      }
      case 'compile': {
        // M6 编译前门：插入副本被手改/缺失（ARTIFACT_DRIFT）→ 直接 GATE，不进编译
        //（副本不一致时编出的 PDF 与证明链脱钩——先恢复副本再编译）。
        await service.materials.checkInsertions(project)
        const outcome = await writer().compile(project)
        return {
          ok: outcome.ok,
          engine: outcome.engine,
          reran: outcome.reran,
          pdfWritten: outcome.pdfWritten,
          errors: outcome.parsed.errors,
          warnings: outcome.parsed.warnings.slice(0, 20),
          ...(outcome.snapshot !== undefined ? { snapshot: outcome.snapshot } : {}),
          hint: outcome.ok
            ? `编译成功（${outcome.engine}${outcome.snapshot !== undefined ? `，快照 ${outcome.snapshot.id}` : ''}）`
            : `编译失败——按 errors[].file/line 定位修改后重新编译（错误行可点）`,
        }
      }
      case 'cite.audit':
        return { ...(await writer().citeAudit(project)) }
      case 'refs.append': {
        const raw = record['keys']
        const keys = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
        if (keys.length === 0) throw new ServiceError('INVALID', 'refs.append 需要 keys（文献库条目 key）')
        return { ...(await writer().refsAppend(project, keys)) }
      }
      case 'snapshot.list':
        return { snapshots: await writer().snapshotList(project) }
      case 'snapshot.restore': {
        const id = typeof record['id'] === 'string' ? record['id'] : ''
        const result = await writer().snapshotRestore(project, id)
        return {
          ...result,
          hint: `已恢复 ${result.restored.length} 个文件${result.materialDrift === true ? '；⚠ materials manifest 与快照不一致（materialDrift）——素材证明链需重新 materials.verify' : ''}——重新 compile 验证产物一致`,
        }
      }
      case 'snapshot.tag': {
        const id = typeof record['id'] === 'string' ? record['id'] : ''
        const label = typeof record['label'] === 'string' ? record['label'] : ''
        const note = typeof record['note'] === 'string' ? record['note'] : undefined
        return {
          ...(await writer().snapshotTag(project, id, { label, ...(note !== undefined ? { note } : {}) })),
          hint: '标签已写入快照 manifest——snapshot.list 可见；响应信/投稿包用它锚定版本',
        }
      }
      case 'diff': {
        const from = typeof record['from'] === 'string' ? record['from'] : ''
        const to = typeof record['to'] === 'string' ? record['to'] : ''
        return {
          ...(await writer().paperDiff(project, from, to)),
          hint: 'diff 已持久化到 paper/diffs/——审稿响应信的 changes 必须引用这里的 hunk（否则 RESPONSE_UNBACKED）',
        }
      }
      case 'compliance': {
        const result = await writer().compliance(project)
        const failed = result.checks.filter(check => check.pass === false)
        return {
          ...result,
          failedCount: failed.length,
          hint: failed.length === 0 ? '全部合规检查通过（或事实缺失未判）' : `${failed.length} 项不过——按 where 字段跳转整改`,
        }
      }
      default:
        throw new ServiceError('INVALID', `未知 action：${JSON.stringify(record['action'])}`)
    }
  }
  return {
    name: SRW_PAPER_TOOL_NAME,
    description: [
      '论文线执行面（科研工作台）：骨架生成（scaffold，按刊物模板）、大纲工作流',
      '（outline.prompt 拿分档提示词 → 自己拟大纲 → outline.save → 向用户确认 →',
      'outline.confirm 过 G1 门）、逐节起草正文（section.write，G1 未过会拒绝）、',
      '编译（compile，本机 TeX 引擎；错误带 file/line 可定位）、引用审计与一键补',
      'BibTeX（cite.audit / refs.append）、快照回滚与标签（snapshot.list / snapshot.tag /',
      'snapshot.restore，restore 附 materialDrift 漂移提示）、快照间结构化 diff（diff，',
      '文件级 hunks，响应信证据的事实源）、',
      '合规检查（compliance，D1-D3 档位阈值 + 刊物要求，机读 checks）。',
      '纪律：正文内容必须由你自己起草（档位决定篇幅与完备度），工具只落盘；',
      '大纲未经用户确认不要调 outline.confirm。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['state', 'venue.list', 'venue.apply', 'scaffold', 'outline.get', 'outline.prompt', 'outline.save', 'outline.confirm', 'section.write', 'compile', 'cite.audit', 'refs.append', 'snapshot.list', 'snapshot.tag', 'snapshot.restore', 'diff', 'compliance'],
          description: '要执行的动作',
        },
        project: { type: 'string', description: '项目 slug' },
        venueId: { type: 'string', description: 'venue.apply 必填：刊物 id（venue.list 查询，如 ieee-journal）' },
        tier: { type: 'string', enum: ['D1', 'D2', 'D3'], description: 'venue.apply 可选：深度档位（默认取刊物默认）' },
        title: { type: 'string', description: 'scaffold 必填：论文标题' },
        authors: { type: 'string', description: 'scaffold 可选：作者行' },
        sections: { type: 'array', description: 'outline.save 必填：[{title, intent, targetWords}]', items: { type: 'object' } },
        sectionId: { type: 'string', description: 'section.write 必填：大纲节 id（如 s1）' },
        tex: { type: 'string', description: 'section.write 必填：该节完整 LaTeX 正文' },
        keys: { type: 'array', items: { type: 'string' }, description: 'refs.append 必填：文献库条目 key' },
        id: { type: 'string', description: 'snapshot.restore/tag 必填：快照 id' },
        label: { type: 'string', description: 'snapshot.tag 必填：标签名（≤80 字符，如 baseline / revision-r1）' },
        note: { type: 'string', description: 'snapshot.tag 可选：备注（≤500 字符）' },
        from: { type: 'string', description: 'diff 必填：起始快照 id（snapshot.list 查询）' },
        to: { type: 'string', description: 'diff 必填：目标快照 id' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 600_000,
    execute: async (args) => {
      try {
        return { ok: true, value: await run(args) }
      } catch (error: unknown) {
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
            .filter(block => block.translation === undefined && !UNTRANSLATED_KINDS.has(block.kind))
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
          ...(status.extracted && status.translated >= status.translatable && status.mismatch === 0 ? { hint: '全部已译——action=notes 生成全文导读与精读备注，然后 action=export 归档' } : {}),
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
        const remaining = Math.max(0, status.translatable - status.translated + status.mismatch)
        return {
          ...status,
          remaining,
          hint: remaining > 0
            ? `还有 ${remaining} 块待译——继续下一批（每批 ≤40 keys），每批完成向用户报一次进度`
            : '全部已译——action=notes 生成全文导读与每节精读备注（逐节调用，向用户报进度），然后 action=export 归档',
        }
      }
      case 'notes': {
        const result = await reading().generateNotes(project, paperKey)
        return {
          ...result,
          hint: result.pending > 0
            ? `导读已就绪；还有 ${result.pending} 节备注未生成（失败/超时）——重跑 action=notes 只补缺失节`
            : '全文导读与全部节备注已生成——action=export 归档译注版 PDF',
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
      '（translate，带哈希缓存；页眉页脚/图内碎片/参考文献不译，参考文献在 PDF 里保留英文原样）、',
      '查进度（status，含待译块清单）、生成译注版分析层（notes：全文导读 + 每节【本节速览】与',
      '◆精读备注，逐节调用宿主 LLM）、按日期归档成译注版 PDF（export，落 readings/<日期>/，',
      '含封面/阅读指南/导读/双语正文/图表清单/术语对照表/参考文献原样/免责说明）。',
      '翻译纪律：每批 ≤40 个块 id（按页号分组），逐批调用并向用户报告进度；不要一次整篇',
      '（长论文会超时）。notes 纪律：逐节生成，每节完成报进度。需要项目已存在、条目已取 PDF；',
      'LLM 用宿主默认模型。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'extract', 'translate', 'notes', 'export'], description: '要执行的动作' },
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

/** 专利单行摘要（模型面向，有界；照 projectSummary 形状）。 */
export function patentSummary(meta: PatentMeta): string {
  return [`patentId=${meta.patentId}`, `title=${meta.title}`, `status=${meta.status}`, `updatedAt=${meta.updatedAt}`].join(' ')
}

/** `srw_patent` 工具（M9-lite）：专利档案 + 技术交底书 + 公开时序门。
 * 审批：create 需人工 ask（建档案目录）；其余豁免——disclosure/event 是项目域
 * 内草稿 IO（与 srw_paper 同款豁免），publication.check 是纯读计算。
 * 红线进描述：先申请后公开，投稿/预印本/答辩/开源前必跑 publication.check。 */
export function srwPatentToolDef(service: SrwService): SrwToolDef {
  const patent = (): SrwService['patent'] => service.patent
  const run = async (args: unknown): Promise<Record<string, unknown>> => {
    const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
    const project = typeof record['project'] === 'string' ? record['project'] : ''
    const patentId = typeof record['patentId'] === 'string' ? record['patentId'] : ''
    switch (record['action']) {
      case 'state': {
        if (patentId !== '') {
          const meta = await patent().get(project, patentId)
          const disclosure = await patent().disclosureGet(project, patentId)
          return { project, patentId, patent: meta, hasDisclosure: disclosure !== undefined }
        }
        const patents = await patent().list(project)
        return { project, count: patents.length, patents: patents.map(patentSummary) }
      }
      case 'create': {
        const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
        if (patentId === '') throw new ServiceError('INVALID', 'create 需要 patentId（档案 slug）')
        if (title === '') throw new ServiceError('INVALID', 'create 需要 title（发明名称）')
        const inventors = stringArrayArg(record['inventors'])
        const applicants = stringArrayArg(record['applicants'])
        const meta = await patent().create(project, {
          patentId,
          title,
          ...(inventors.length > 0 ? { inventors } : {}),
          ...(applicants.length > 0 ? { applicants } : {}),
        })
        return { created: patentSummary(meta), hint: '档案已建（status=idea）——下一步 action=disclosure.save 写技术交底书' }
      }
      case 'disclosure.get': {
        const disclosure = await patent().disclosureGet(project, patentId)
        return disclosure !== undefined
          ? { status: 'saved', disclosure, hint: '交底书已保存——修改用 action=disclosure.save 整体替换' }
          : { status: 'none', hint: '尚无交底书——按技术领域/背景技术/问题/方案/实施例/有益效果起草后 action=disclosure.save' }
      }
      case 'disclosure.save': {
        const raw = record['disclosure']
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          throw new ServiceError('INVALID', 'disclosure.save 需要 disclosure 对象（technicalField/backgroundArt/problem/solution/embodiments/beneficialEffects）')
        }
        const saved = await patent().disclosureSave(project, patentId, raw)
        return { saved, hint: '交底书已保存（整体替换）——公开事件盘点用 action=event.add，投稿前必跑 action=publication.check' }
      }
      case 'event.add': {
        const raw = record['event']
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          throw new ServiceError('INVALID', 'event.add 需要 event 对象（kind/description/publicAt/graceCase）')
        }
        const event = await patent().eventAdd(project, patentId, raw)
        return { event, hint: '事件已登记（append-only）——投稿/预印本/答辩/开源前 action=publication.check' }
      }
      case 'publication.check': {
        const at = typeof record['publicationAt'] === 'string' && record['publicationAt'] !== '' ? record['publicationAt'] : undefined
        const result = await patent().publicationCheck(
          project,
          patentId,
          ...(at === undefined ? [] : [at] as const),
        )
        const hints: Record<string, string> = {
          safe: '公开时序安全（本检查不构成法律意见）',
          grace: '落入宽限期窗口——宽限期仅四种法定情形，须专利代理人确认适用',
          risk: '存在新颖性风险——先申请、后公开',
          blocked: '不可逆：公开在先且未申请——立即停止投稿并找专利代理人',
        }
        return { ...result, hint: hints[result.check.verdict] ?? '' }
      }
      default:
        throw new ServiceError('INVALID', `未知 action：${JSON.stringify(record['action'])}`)
    }
  }
  return {
    name: SRW_PATENT_TOOL_NAME,
    description: [
      '专利线执行面（科研工作台，M9-lite）：state 查档案；create 立项（需审批）；',
      'disclosure.get / disclosure.save 技术交底书（问题-方案-效果-实施例，整体替换）；',
      'event.add 登记公开事件（论文投稿/预印本/会议/学位论文/开源，append-only）；',
      'publication.check 公开时序门——任何投稿、预印本上传、会议报告、学位论文提交、开源之前必查。',
      '纪律：先申请、后公开；交底书内容由你自己起草（不编造对比文件与实验数据，无证据的效益标 TODO）；',
      '检查结果不构成法律意见，grace/risk/blocked 都要如实告知用户。检索/形式检查/导出未做。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['state', 'create', 'disclosure.get', 'disclosure.save', 'event.add', 'publication.check'], description: '要执行的动作' },
        project: { type: 'string', description: '项目 slug' },
        patentId: { type: 'string', description: '专利档案 id（create/state/disclosure/event/check 必填；^[a-z0-9][a-z0-9-]{0,63}$）' },
        title: { type: 'string', description: 'create 必填：发明名称（≤200 字）' },
        inventors: { type: 'array', items: { type: 'string' }, description: 'create 可选：发明人姓名列表' },
        applicants: { type: 'array', items: { type: 'string' }, description: 'create 可选：申请人（单位）名称列表' },
        disclosure: { type: 'object', description: 'disclosure.save 必填：交底书对象' },
        event: { type: 'object', description: 'event.add 必填：{kind, description, publicAt, graceCase?, source?}' },
        publicationAt: { type: 'string', description: 'publication.check 可选：计划公开时点（ISO，缺省现在）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 15_000,
    execute: async (args) => {
      try {
        return { ok: true, value: await run(args) }
      } catch (error: unknown) {
        return toolEnvelope(error)
      }
    },
  }
}

/** 工具入参的字符串数组宽容提取（非法元素静默过滤，服务层再校验）。 */
function stringArrayArg(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

/** srw_materials 工具（M6 素材与证明链）：metrics.import 导入手工实验数据；
 * generate 由 spec+metrics 确定性渲染五类素材；verify 复算（重渲染比对哈希）；
 * insert 过 G-M1 溯源门插进正文（需审批）；remove 撤销插入；numbers 生成
 * 数字宏表；numbers.audit 审计未溯源裸数字。红线：无 metrics 不生成、不编造、
 * mismatch 阻断、illustrative 默认拒绝、公式恒「未验证」须脚注。 */
export function srwMaterialsToolDef(service: SrwService): SrwToolDef {
  const materials = (): SrwService['materials'] => service.materials
  const run = async (args: unknown): Promise<Record<string, unknown>> => {
    const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
    const project = typeof record['project'] === 'string' ? record['project'] : ''
    switch (record['action']) {
      case 'list': {
        const manifest = await materials().manifest(project)
        return {
          schemaVersion: manifest.schemaVersion,
          count: manifest.artifacts.length,
          artifacts: manifest.artifacts.map(artifact => ({
            id: artifact.id,
            kind: artifact.kind,
            provenance: artifact.provenance,
            path: artifact.path,
            status: artifact.verification.status,
            method: artifact.verification.method,
            detail: artifact.verification.detail,
            inputs: artifact.inputs.length,
            inserted: artifact.insertedAt.length,
            illustrativeAllowed: artifact.illustrative.allowed,
          })),
          hint: 'generate 造素材（spec + metrics）→ verify 复算 → insert 插入正文 → numbers 出数字宏',
        }
      }
      case 'generate': {
        const kind = typeof record['kind'] === 'string' ? record['kind'] : ''
        const provenance = typeof record['provenance'] === 'string' ? record['provenance'] : ''
        const spec = record['spec']
        if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
          throw new ServiceError('INVALID', 'generate 需要 spec 对象（kind 特定参数：table 列 / plot series / steps / latex / code）')
        }
        const entry = await materials().generate(project, {
          id: typeof record['id'] === 'string' ? record['id'] : '',
          kind: kind as ArtifactKind,
          provenance: provenance as Provenance,
          spec: spec as Record<string, unknown>,
          ...(record['allowIllustrative'] === true ? { allowIllustrative: true } : {}),
        })
        return {
          id: entry.id,
          kind: entry.kind,
          provenance: entry.provenance,
          path: entry.path,
          status: entry.verification.status,
          detail: entry.verification.detail,
          outputSha256: entry.output.sha256,
          bytes: entry.output.bytes,
          inputCount: entry.inputs.length,
          hint: 'action=verify 复算通过后再 insert；表/图数字沿 inputs→metrics 可回指',
        }
      }
      case 'verify': {
        const entry = await materials().verify(project, typeof record['id'] === 'string' ? record['id'] : '')
        return {
          id: entry.id,
          status: entry.verification.status,
          method: entry.verification.method,
          detail: entry.verification.detail,
          checkedAt: entry.verification.checkedAt,
          ...(entry.verification.status === 'mismatch'
            ? { hint: '复算不一致：输入/产物/副本被改——恢复文件后重新 verify；不要改基线' }
            : entry.verification.status === 'verified'
              ? { hint: '复算一致——可 action=insert 插入正文' }
              : { hint: 'unverifiable：可插入但论文须脚注「未验证」' }),
        }
      }
      case 'insert': {
        const result = await materials().insert(
          project,
          typeof record['id'] === 'string' ? record['id'] : '',
          typeof record['sectionId'] === 'string' ? record['sectionId'] : '',
        )
        return {
          id: result.artifact.id,
          sectionId: result.inserted.sectionId,
          file: result.inserted.file,
          label: result.inserted.label,
          target: result.inserted.target,
          status: result.artifact.verification.status,
          hint: '已在节末追加 \\input{figs/<id>}；正文引用用 \\ref{' + result.inserted.label + '}；compile 前会核对副本哈希',
        }
      }
      case 'remove': {
        const result = await materials().removeInserted(project, typeof record['id'] === 'string' ? record['id'] : '')
        return { removed: true, removedFiles: result.removed, hint: '已删插入副本并清理节文件 \\input 行与 insertedAt' }
      }
      case 'metrics.import': {
        const metrics = record['metrics']
        if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
          throw new ServiceError('INVALID', 'metrics.import 需要 metrics 对象（{ values: { 指标: { value, unit?, stderr?, n?, seed? } }, series?: [{ name, points }] }）')
        }
        const result = await materials().importMetrics(project, {
          runId: typeof record['runId'] === 'string' ? record['runId'] : '',
          metrics,
        })
        return { ...result, hint: '已写 experiments/manual/<runId>/metrics.json + run.json——generate 时 spec.runId 指向它' }
      }
      case 'numbers': {
        const result = await materials().numbersGenerate(project)
        return {
          texPath: result.texPath,
          jsonPath: result.jsonPath,
          macroCount: result.macros.length,
          macros: result.macros.map(macro => macro.name),
          hint: 'main.tex 加 \\input{generated/srw-numbers} 后正文用 \\srw<Name> 引数字；数据变了重跑本动作再 compile',
        }
      }
      case 'numbers.audit': {
        const result = await materials().numbersAudit(project)
        return {
          count: result.count,
          truncated: result.truncated,
          findings: result.findings,
          ...(result.count === 0
            ? { hint: '无未溯源裸数字（或大纲未建）——D2/D3 投稿要求 0 条' }
            : { hint: '把裸数字换成 \\srw<Name> 宏（action=numbers 先生成）或给出可回指出处' }),
        }
      }
      default:
        throw new ServiceError('INVALID', '未知 action：' + JSON.stringify(record['action']))
    }
  }
  return {
    name: SRW_MATERIALS_TOOL_NAME,
    description: [
      '素材生成与证明链（科研工作台）：metrics.import 把手工实验数据导入 experiments/manual/<runId>/；',
      'generate 由 spec+metrics 确定性渲染五类素材（table 书籍表 / plot pgfplots 曲线 / pseudocode 伪代码 /',
      'formula 公式 / tikz 示意图，同输入字节级同输出）；verify 复算（重渲染比对哈希，mismatch 阻断）；',
      'insert 过溯源门把素材插进论文正文（需审批，节末 \\input + paper/figs 副本受哈希保护）；remove 撤销插入；',
      'numbers 生成数字宏表（\\srw<Name>，正文数字必须用宏、可回指 metrics）；numbers.audit 列未溯源裸数字。',
      '纪律：无 metrics 不生成、绝不编造数据；示意素材（provenance=illustrative）默认拒绝，显式开启也要',
      '水印/脚注/红标三处标注；mismatch 未复绿前不许插入；compile 会先核对插入副本（ARTIFACT_DRIFT 即拦截）；',
      '公式门（sympy）未接入，公式恒「未验证」，论文引用须脚注。素材内容由你按 spec 起草，工具只做确定性渲染。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'generate', 'verify', 'insert', 'remove', 'metrics.import', 'numbers', 'numbers.audit'], description: '要执行的动作' },
        project: { type: 'string', description: '项目 slug' },
        id: { type: 'string', description: '素材 id（generate/verify/insert/remove 必填；^[a-z][a-z0-9-]{1,40}$，如 tab-main）' },
        kind: { type: 'string', enum: ['table', 'plot', 'pseudocode', 'formula', 'tikz'], description: 'generate 必填：素材类型' },
        provenance: { type: 'string', enum: ['measured', 'derived', 'literature', 'illustrative'], description: 'generate 必填：数据出身（illustrative 默认拒绝）' },
        spec: { type: 'object', description: 'generate 必填：table{runId,columns:[{metric,header?,precision?}],title?,caption?}；plot{runId,seriesName,xLabel?,yLabel?,caption?}；pseudocode{steps:[...]}；formula{latex,caption?}；tikz{code,caption?}' },
        allowIllustrative: { type: 'boolean', description: 'generate 可选：显式允许示意素材（默认拒绝；开启后须三处标注）' },
        sectionId: { type: 'string', description: 'insert 必填：大纲节 id（如 s3）' },
        runId: { type: 'string', description: 'metrics.import 必填：运行 id（^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$，用扁平名如 run-01）' },
        metrics: { type: 'object', description: 'metrics.import 必填：{ values: { 指标: { value, unit?, stderr?, n?, seed? } }, series?: [{ name, xLabel?, yLabel?, points: [[x,y],...] }] }' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 15_000,
    execute: async (args) => {
      try {
        return { ok: true, value: await run(args) }
      } catch (error: unknown) {
        return toolEnvelope(error)
      }
    },
  }
}

/** srw_experiment 工具（M7 实验与算力 MVP，单主机）：hosts 盘点 GPU 主机
 * （可达性 + 环境/GPU 快照，输出只含 hostRef+label）；submit 提交实验
 * （需审批：spec 门 confirm + D 档缺口 ack + GPU 选卡 + setsid 脱离会话）；
 * status/logs/collect 轮询 7 态/偏移续读日志/回传指标与产物（sha256 对账）；
 * cancel 取消（需审批，进程组 TERM→KILL）；claims.check 论文数字对账；
 * gaps.list 补数据缺口；dataset.register 数据集注册。 */
export function srwExperimentToolDef(service: SrwService): SrwToolDef {
  const exp = (): SrwService['experiment'] => service.experiment
  const run = async (args: unknown): Promise<Record<string, unknown>> => {
    const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
    const project = typeof record['project'] === 'string' ? record['project'] : ''
    const expId = typeof record['expId'] === 'string' ? record['expId'] : ''
    const runId = typeof record['runId'] === 'string' ? record['runId'] : ''
    switch (record['action']) {
      case 'hosts': {
        const result = await exp().hosts(project, record['env'] === false ? { env: false } : {})
        return { ...result, hint: 'submit 前先看 usable/reachable 与 env.gpuCount/nvcc；输出只有 hostRef+label（无地址/用户名/端口）' }
      }
      case 'submit': {
        const spec = record['spec']
        const result = await exp().submit(project, {
          expId,
          ...(spec === undefined ? {} : { spec }),
          ...(Array.isArray(record['files']) ? { files: record['files'] as readonly unknown[] } : {}),
          ...(typeof record['hostRef'] === 'string' && record['hostRef'] !== '' ? { hostRef: record['hostRef'] } : {}),
          ...(typeof record['seed'] === 'number' ? { seed: record['seed'] } : {}),
          ...(record['confirm'] === true ? { confirm: true } : {}),
          ...(record['ack'] === true ? { ack: true } : {}),
          ...(runId !== '' ? { runId } : {}),
        })
        return { ...result, hint: '作业已脱离会话（setsid）——action=status 轮询（≤10s 一次），logs 续读日志，collect 回传指标/产物' }
      }
      case 'status':
        return { ...await exp().status(project, expId, runId === '' ? undefined : runId) }
      case 'logs':
        return { ...await exp().logs(project, expId, runId) }
      case 'collect':
        return { ...await exp().collect(project, expId, runId) }
      case 'cancel': {
        const result = await exp().cancel(project, expId, runId, typeof record['reason'] === 'string' ? record['reason'] : undefined)
        return { ...result, hint: 'cancelled=进程组已消失；interrupted=取消时主机不可达（远端可能仍在跑，恢复后 status 重试）' }
      }
      case 'env.setup':
        await exp().envSetup()
        return { ok: true }
      case 'claims.check': {
        const result = await exp().claimsCheck(project, {
          ...(expId !== '' ? { expId } : {}),
          ...(record['claim'] === undefined ? {} : { claim: record['claim'] }),
          ...(typeof record['id'] === 'string' && record['id'] !== '' ? { id: record['id'] } : {}),
        })
        return {
          ...result,
          hint: 'verified=可引用；mismatch=改论文数字或查 metrics（阻断插入）；unverifiable=证据缺（脚注「未验证」或补跑）',
        }
      }
      case 'gaps.list':
        return { ...await exp().gapsList(project, expId), hint: '补数据补完 = P0/P1 为空；按 priority+estGpuHours 顺序排期（单主机串行、单卡并发 1）' }
      case 'dataset.register': {
        const dataset = record['dataset']
        if (typeof dataset !== 'object' || dataset === null || Array.isArray(dataset)) {
          throw new ServiceError('INVALID', 'dataset.register 需要 dataset 对象（{id: ds-*, version: v1, title, hashPolicy: tree|file|none, locator?, license?, redistributable?}）')
        }
        return { ...await exp().datasetRegister(project, dataset) }
      }
      default:
        throw new ServiceError('INVALID', '未知 action：' + JSON.stringify(record['action']))
    }
  }
  return {
    name: SRW_EXPERIMENT_TOOL_NAME,
    description: [
      '实验与算力执行面（科研工作台，M7 MVP 单主机）：hosts 盘点 GPU 主机（可达性 + 环境/GPU 快照，输出脱敏）、',
      'submit 提交实验作业（需审批；spec 门：confirm 确认 + D1-D3 档位缺口显式 ack；GPU 选卡注入 CUDA_VISIBLE_DEVICES；',
      '脚本先落远端盘再 bash 执行，setsid 脱离会话断线不掉）、status 轮询 7 态（queued/running/succeeded/failed/cancelled/',
      'interrupted/unknown——pid/exit/done 全缺且日志无增长即 unknown，绝不假成功）、logs 偏移续读（超上限显式失败）、',
      'collect 回传 metrics.json 与 artifacts（sha256 双向对账）、cancel 取消（需审批，进程组 TERM→KILL）、',
      'claims.check 论文数字逐点对账（verified/mismatch/unverifiable）、gaps.list 补数据缺口与排期（P0/P1 清零才算补完）、',
      'dataset.register 数据集注册（license/redistributable 必看）。',
      '纪律：数据集先注册再引用；失败/缺失不插值不猜；重跑用新 runId（旧 run 保留）；env.setup 未实现（占位）。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['hosts', 'submit', 'status', 'logs', 'collect', 'cancel', 'env.setup', 'claims.check', 'gaps.list', 'dataset.register'], description: '要执行的动作' },
        project: { type: 'string', description: '项目 slug' },
        expId: { type: 'string', description: '实验 id（^[a-z0-9][a-z0-9-]{0,63}$，如 exp-01）' },
        runId: { type: 'string', description: '运行 id（^r-*，status/logs/collect/cancel 必填；submit 可选自定义）' },
        spec: { type: 'object', description: 'submit 的实验规格：{entry:[bash,job.sh], seeds:[0,1,2], datasets:[ds-*], baselines?, metrics:[acc], tier?, gpus?, outputs?, env?, maxHours?, ablation?, significance?, costAnalysis?}' },
        files: { type: 'array', description: 'submit 可选：上传文本文件 [{path: 相对路径, content: 文本}]（≤20 个、单个 ≤512KiB）' },
        hostRef: { type: 'string', description: 'submit 可选：目标主机 hostRef（hosts 输出；缺省选第一台可用）' },
        seed: { type: 'string', description: 'submit 可选：本次 run 的种子（缺省取 spec.seeds[0]）' },
        confirm: { type: 'boolean', description: 'submit 必须显式 true 才会真正派发（缺省只过门不提交）' },
        ack: { type: 'boolean', description: 'submit 可选：显式接受 D 档缺口（D_TIER_GAP）或档位警告' },
        reason: { type: 'string', description: 'cancel 可选：取消原因（进 run.json 审计）' },
        claim: { type: 'object', description: 'claims.check 可选：注册/更新一条 claim {id: clm-*, kind: number|table-cell, source:{expId, runIds, metric, split?, reducer}, value, digits, tolerance?}' },
        id: { type: 'string', description: 'claims.check 可选：只查这一条 claim' },
        dataset: { type: 'object', description: 'dataset.register 必填：{id: ds-*, version: v1, title, hashPolicy: tree|file|none, source?, locator?, license?, redistributable?, splits?, provenance?}' },
        env: { type: 'boolean', description: 'hosts 可选：false 跳过环境盘点（只测可达性）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 120_000,
    execute: async (args) => {
      try {
        return { ok: true, value: await run(args) }
      } catch (error: unknown) {
        return toolEnvelope(error)
      }
    },
  }
}
