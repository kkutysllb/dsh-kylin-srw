/** WatchManager（0204 §1 修订版）：触发绑定内置「自动化任务」（ctx.schedule）
 * ——订阅创建即建宿主时钟任务（自包含 prompt 唤醒绑定会话调 `srw_watch run`）；
 * 执行是我的 host 确定性代码（search→importEntries 幂等入库）。pause=删时钟
 * 任务留订阅；resume=重建（E3 验明的 create/delete 面，不依赖 update）。
 * 会话死亡 → schedule 投递 warn 卡 active（宿主已知语义）→ lastResult 停滞
 * 即面板信号，resume 可重绑新会话。 */

import { randomBytes } from 'node:crypto'
import { ServiceError } from '../service.ts'
import type { LiteratureService } from '../literature/service.ts'
import { WatchStore } from './store.ts'
import { schedulePrompt, scheduleTitle, validateWatchInput, type WatchSource, type WatchSub } from './model.ts'
import type { SrwFsLike } from '../host.ts'

/** 绑定层眼里的宿主时钟（只依赖 E3 验明过的 create/delete 两面）。 */
export interface SchedulePort {
  create(sessionId: string, request: Record<string, unknown>): Promise<unknown>
  remove(input: { sessionId: string; id: string }): Promise<unknown>
}

/** 绑定层眼里的文献服务（窄面，测试注入 fake）。 */
export interface WatchLiterature {
  search(source: string, query: string, limit: number): Promise<readonly unknown[]>
  importEntries(project: string, candidates: readonly unknown[]): Promise<{
    added: number
    duplicates: number
    retracted: string[]
    enriched: string[]
  }>
}

export interface WatchDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
  readonly offlineMode: () => boolean
  readonly schedule: SchedulePort
  readonly literature: () => WatchLiterature
}

/** 从 create 响应里抽任务 id（形状防御：抽不到返回 undefined）。 */
function taskIdOf(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) return undefined
  const id = (response as Record<string, unknown>)['id']
  return typeof id === 'string' && id !== '' ? id : undefined
}

export class WatchManager {
  constructor(private readonly deps: WatchDeps) {}

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_ROOT', '科研总根未设置（先在面板选择）')
    return root
  }

  private store(): WatchStore {
    return new WatchStore(this.requireRoot(), this.deps.fs)
  }

  async list(): Promise<readonly WatchSub[]> {
    return [...(await this.store().load()).subs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  private async requireSub(id: string): Promise<WatchSub> {
    const sub = (await this.store().load()).subs.find(item => item.id === id)
    if (sub === undefined) throw new ServiceError('NOT_FOUND', `订阅不存在：${id}`)
    return sub
  }

  private async patchById(id: string, patch: Partial<Pick<WatchSub, 'scheduleId'>>): Promise<WatchSub> {
    const doc = await this.store().update(subs => subs.map(item => item.id === id ? { ...item, ...patch } : item))
    const sub = doc.subs.find(item => item.id === id)
    if (sub === undefined) throw new ServiceError('NOT_FOUND', `订阅不存在：${id}`)
    return sub
  }

  /** 宿主时钟任务建投递（订阅已落盘后调用；失败只降级为「未排程」）。 */
  private async bind(sub: WatchSub, sessionId: string): Promise<string | undefined> {
    const response = await this.deps.schedule.create(sessionId, {
      title: scheduleTitle(sub),
      prompt: schedulePrompt(sub),
      every_seconds: sub.everySeconds,
    })
    return taskIdOf(response)
  }

  private async unbind(sub: WatchSub): Promise<void> {
    const sessionId = sub.boundSessionId
    const scheduleId = sub.scheduleId
    if (sessionId === undefined || scheduleId === undefined) return
    try {
      await this.deps.schedule.remove({ sessionId, id: scheduleId })
    } catch { /* 删任务失败不阻断订阅操作（宿主页可手动删） */ }
  }

  /** 建订阅：先落盘（订阅本体是真相源），再尽量绑时钟。绑定失败/无会话都
   * 不回滚——面板明示「未排程」，resume 可补绑。 */
  async create(input: {
    project?: unknown
    source?: unknown
    query?: unknown
    everySeconds?: unknown
  }, sessionId?: string): Promise<{ sub: WatchSub; scheduled: boolean; hint?: string }> {
    const validated = validateWatchInput(input)
    const sub: WatchSub = {
      id: `sub-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`,
      project: validated.project,
      source: validated.source as WatchSource,
      query: validated.query,
      everySeconds: validated.everySeconds,
      enabled: true,
      createdAt: new Date().toISOString(),
      ...(sessionId !== undefined && sessionId !== '' ? { boundSessionId: sessionId } : {}),
    }
    await this.store().upsertSub(sub)
    if (sub.boundSessionId === undefined) {
      return { sub, scheduled: false, hint: '未绑定会话：到点不会自动抓。resume 时传当前会话即可排程。' }
    }
    try {
      const scheduleId = await this.bind(sub, sub.boundSessionId)
      return { sub: await this.patchById(sub.id, scheduleId === undefined ? {} : { scheduleId }), scheduled: scheduleId !== undefined,
        ...(scheduleId === undefined ? { hint: '时钟任务已建但未取到 id（不影响到点投递）；pause/resume 会重建。' } : {}) }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      return { sub, scheduled: false, hint: `时钟任务建立失败（${reason}）；订阅已保存，可 resume 重试。` }
    }
  }

  /** 删订阅：先解绑时钟（best-effort），再删本体。 */
  async remove(id: string): Promise<void> {
    const sub = await this.requireSub(id)
    await this.unbind(sub)
    await this.store().removeSub(id)
  }

  /** 暂停：删时钟任务（订阅与绑定会话保留）。 */
  async pause(id: string): Promise<WatchSub> {
    const sub = await this.requireSub(id)
    await this.unbind(sub)
    return await this.store().update(subs => subs.map(item => {
      if (item.id !== id) return item
      const { scheduleId: _drop, ...rest } = item
      return { ...rest, enabled: false }
    })).then(doc => doc.subs.find(item => item.id === id) ?? sub)
  }

  /** 恢复：重建时钟任务。显式 sessionId 优先（重绑到当前会话），否则用原绑定。 */
  async resume(id: string, sessionId?: string): Promise<{ sub: WatchSub; scheduled: boolean; hint?: string }> {
    const prev = await this.requireSub(id)
    const targetSession = sessionId ?? prev.boundSessionId
    if (targetSession === undefined || targetSession === '') {
      return { sub: prev, scheduled: false, hint: '无可绑会话：把订阅转给任意会话里的 agent，或面板 resume 时选择会话。' }
    }
    await this.unbind(prev) // 先解绑旧任务再重建——否则换绑/重复 resume 会留下双任务
    const base: WatchSub = { ...prev, enabled: true, boundSessionId: targetSession }
    const { scheduleId: _drop, ...cleared } = prev
    await this.store().update(subs => subs.map(item => item.id === id ? { ...cleared, enabled: true, boundSessionId: targetSession } : item))
    try {
      const scheduleId = await this.bind(base, targetSession)
      const saved = await this.patchById(id, scheduleId === undefined ? {} : { scheduleId })
      return scheduleId === undefined
        ? { sub: saved, scheduled: false, hint: '时钟任务已建但未取到 id（不影响到点投递）。' }
        : { sub: saved, scheduled: true }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      return { sub: prev, scheduled: false, hint: `时钟任务重建失败（${reason}）。` }
    }
  }

  /** 立即抓一次（也是时钟唤醒轮的执行体）：search→importEntries（幂等+自愈）
   * → lastResult 落账。失败/离线也落账后原样抛（调用方决定怎么呈现）。 */
  async run(id: string): Promise<{ fresh: number; duplicates: number; enriched: readonly string[] }> {
    const sub = await this.requireSub(id)
    this.requireRoot()
    try {
      if (this.deps.offlineMode()) throw new ServiceError('OFFLINE', '离线模式开启：抓取停用（可在面板关闭）')
      const candidates = await this.deps.literature().search(sub.source, sub.query, 20)
      const result = await this.deps.literature().importEntries(sub.project, candidates)
      await this.record(sub.id, { kind: 'ok', fresh: result.added })
      return { fresh: result.added, duplicates: result.duplicates, enriched: result.enriched }
    } catch (error: unknown) {
      const message = error instanceof ServiceError
        ? `${error.code}: ${error.message}`
        : (error instanceof Error ? error.message : String(error))
      await this.record(sub.id, { kind: 'error', error: message })
      throw error
    }
  }

  private async record(id: string, partial: { kind: 'ok'; fresh: number } | { kind: 'error'; error: string }): Promise<void> {
    const at = new Date().toISOString()
    await this.store().update(subs => subs.map(item => item.id === id
      ? {
          ...item,
          lastRunAt: at,
          lastResult: partial.kind === 'ok'
            ? { at, kind: 'ok', fresh: partial.fresh }
            : { at, kind: 'error', error: partial.error },
        }
      : item))
  }
}

/** 装配：从 SrwService 取动态参数（schedule 面 = E3 验明的 create/delete）。 */
export function attachWatch(
  service: import('../service.ts').SrwService,
  literature: () => LiteratureService,
): WatchManager {
  return new WatchManager({
    fs: (service.ctx as { fs?: SrwFsLike }).fs,
    rootDir: () => service.currentRoot(),
    offlineMode: () => service.config.offlineMode === true,
    schedule: {
      create: async (sessionId, request) => await service.scheduleCreate({
        sessionId,
        title: typeof request['title'] === 'string' ? request['title'] : '',
        prompt: typeof request['prompt'] === 'string' ? request['prompt'] : '',
        ...(typeof request['every_seconds'] === 'number' ? { everySeconds: request['every_seconds'] } : {}),
      }),
      remove: async input => await service.scheduleDelete(input.sessionId, input.id),
    },
    literature,
  })
}
