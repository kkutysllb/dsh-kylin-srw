/** 订阅模型（0204 §2）：`<root>/.srw/watch.json` 的行形状 + 入参校验。
 * 时钟任务本体归宿主「自动化任务」（ctx.schedule，0204 §1 修订版），
 * 这里只存订阅本体与绑定 id——不复制宿主时钟字段。 */

import { SLUG_RE } from '../core/schema.ts'
import { ServiceError } from '../service.ts'

export const WATCH_SCHEMA_VERSION = 1

/** 频率地板：宿主 every≥60 之上再收紧——文献抓取没意义更频，且礼貌限速。 */
export const WATCH_EVERY_FLOOR = 900

export const WATCH_SOURCES = ['arxiv', 'openalex', 'crossref'] as const
export type WatchSource = (typeof WATCH_SOURCES)[number]

/** 一次运行的结果（面板可见性全靠它：失败可见 → 手动 run 或下个周期重试）。 */
export interface WatchResult {
  readonly at: string
  readonly kind: 'ok' | 'error'
  readonly fresh?: number
  readonly error?: string
}

export interface WatchSub {
  readonly id: string
  readonly project: string
  readonly source: WatchSource
  readonly query: string
  readonly everySeconds: number
  readonly enabled: boolean
  readonly createdAt: string
  /** schedule 投递目标会话（创建时的会话；面板创建绑最新根会话）。 */
  readonly boundSessionId?: string
  /** 绑定成功的宿主时钟任务 id；pause 即删任务、resume 重建。 */
  readonly scheduleId?: string
  readonly lastRunAt?: string
  readonly lastResult?: WatchResult
}

export interface WatchDoc {
  readonly schemaVersion: typeof WATCH_SCHEMA_VERSION
  revision: number
  subs: WatchSub[]
}

export function emptyWatchDoc(): WatchDoc {
  return { schemaVersion: WATCH_SCHEMA_VERSION, revision: 0, subs: [] }
}

export function watchDocPath(rootDir: string): string {
  return `${rootDir}/.srw/watch.json`
}

/** 新订阅入参校验（RPC/工具共用的唯一 choke point）。 */
export function validateWatchInput(input: {
  project?: unknown
  source?: unknown
  query?: unknown
  everySeconds?: unknown
}): { project: string; source: WatchSource; query: string; everySeconds: number } {
  const project = typeof input.project === 'string' ? input.project : ''
  if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
  const source = input.source
  if (typeof source !== 'string' || !(WATCH_SOURCES as readonly string[]).includes(source)) {
    throw new ServiceError('INVALID', `source 必须是 ${WATCH_SOURCES.join('|')}，收到 ${JSON.stringify(source)}`)
  }
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (query === '') throw new ServiceError('INVALID', 'query 不能为空')
  if (query.length > 500) throw new ServiceError('INVALID', 'query 过长（≤500 字符）')
  const everySeconds = input.everySeconds
  let every = typeof everySeconds === 'number' && Number.isInteger(everySeconds) ? everySeconds : 86_400
  if (every < WATCH_EVERY_FLOOR) {
    throw new ServiceError('INVALID', `everySeconds 至少 ${WATCH_EVERY_FLOOR}（15 分钟），收到 ${JSON.stringify(everySeconds)}`)
  }
  if (every > 365 * 86_400) every = 365 * 86_400
  return { project, source: source as WatchSource, query, everySeconds: every }
}

/** 确定性时钟任务标题（自动化任务页里人可读；对账锚点）。 */
export function scheduleTitle(sub: Pick<WatchSub, 'id' | 'query'>): string {
  const brief = sub.query.length > 40 ? `${sub.query.slice(0, 40)}…` : sub.query
  return `SRW订阅 ${sub.id} ${brief}`
}

/** 自包含投递 prompt：唤醒会话里的 agent 调 run 并一句话汇报（0 条也说）。 */
export function schedulePrompt(sub: Pick<WatchSub, 'id' | 'project'>): string {
  return [
    `执行科研文献订阅抓取（订阅 ${sub.id}，项目 ${sub.project}）：`,
    `调用 srw_watch 工具，action="run"，id="${sub.id}"。`,
    '把返回的新增条数用一句话汇报给用户（0 条也要说）；工具报错则原样转告错误信息。',
    '不要做订阅抓取之外的任何事。',
  ].join('')
}
