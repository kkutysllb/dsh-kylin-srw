/** SRW Host 服务（M0 骨架）：承载 patch-row 配置、能力探测与生命周期。
 *
 * M1 起按 0102 §4 的领域模块（workspace/literature/watch/reading/writer/
 * venue/materials/verify/compute）逐步长出；本类只做装配根，不装领域逻辑。
 * 服务经 `ctx.reflect.provide('srw', …)` 暴露（ADR-19）：别的插件将来可以
 * inject——不做 dsh-kylin-automation 那样的「拿不到的服务」。
 */

import { collectCaps, type CapRow } from './diag.ts'
import { hostHome, type SrwFsLike } from './host.ts'
export interface SrwConfig {
  /** 科研总根；空 = 首次由面板引导选择（M1）。 */
  readonly rootDir?: string
  /** 离线模式：停用一切外联动作。 */
  readonly offlineMode?: boolean
}

export class ServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
  }
}

async function awaited<T>(value: T | Promise<T>): Promise<T> {
  return await value
}

export interface SrwInfo {
  readonly version: string
  readonly offlineMode: boolean
  readonly rootDir: string
  readonly home: { readonly channel: string; readonly home: string }
}

export class SrwService {
  private constructor(
    /** 宿主 ctx（软探测只读使用；领域模块不得经它绕过本服务）。 */
    readonly ctx: unknown,
    readonly config: SrwConfig,
    private readonly startedAt: number,
  ) {}

  static async open(ctx: unknown, rawConfig: SrwConfig): Promise<SrwService> {
    const config: SrwConfig = {
      rootDir: typeof rawConfig?.rootDir === 'string' ? rawConfig.rootDir : '',
      offlineMode: rawConfig?.offlineMode === true,
    }
    return new SrwService(ctx, config, Date.now())
  }

  /** 轻量探活（`diag.ping` 端点）。 */
  ping(): { readonly pong: true; readonly at: string; readonly uptimeMs: number } {
    return { pong: true, at: new Date().toISOString(), uptimeMs: Date.now() - this.startedAt }
  }

  info(version: string): SrwInfo {
    return {
      version,
      offlineMode: this.config.offlineMode === true,
      rootDir: this.config.rootDir ?? '',
      home: hostHome(),
    }
  }

  /** 宿主能力表（`diag.caps` 端点；E1/E2 与 V 系列核对的数据源）。 */
  caps(): readonly CapRow[] {
    return collectCaps(this.ctx)
  }

  /** `diag.contains`（Task 1.2 / V4 实测端点）：宿主 fs 的 resolve→contains
   * 真值测量。**这是诊断不是护栏**——越界返回 contained:false 而非抛错；
   * 正式放行必须走 assertInsideRoot（fail-closed）。 */
  async diagContains(rootAbs: string, targetRel: string): Promise<{ contained: boolean; detail?: string }> {
    const fs = (this.ctx as { fs?: SrwFsLike }).fs
    if (fs?.resolve === undefined || fs.contains === undefined) {
      throw new ServiceError('NO_PROVIDER', '宿主 fs.resolve/contains 缺席')
    }
    try {
      const rootTarget = await awaited(fs.resolve(rootAbs))
      const target = await awaited(fs.resolve(targetRel, { cwd: rootAbs }))
      return { contained: fs.contains(rootTarget, target) === true }
    } catch (error: unknown) {
      // resolve 失败（路径不存在等）：按不可包含上报，附宿主原因。
      return { contained: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 宿主 schedule 服务面（E3 边界试验专用；经 ctx.get 动态取，不进 inject
   * 名单——避免缺名导致激活失败）。M3 正式接入时再按 ADR-8 定稿。 */
  private schedule(): Record<string, (...args: unknown[]) => unknown> {
    const schedule = (this.ctx as Record<string, unknown>)['schedule'] as Record<string, (...args: unknown[]) => unknown> | undefined
    if (schedule === undefined) {
      throw new ServiceError('NO_PROVIDER', '宿主 schedule 服务缺席（ctx.get 未取到；宿主或 profile 未挂载）')
    }
    return schedule
  }

  /** E3-A/B：创建提醒（恰一个 selector）。 */
  async scheduleCreate(input: {
    readonly sessionId: string
    readonly title: string
    readonly prompt: string
    readonly afterSeconds?: number
    readonly everySeconds?: number
  }): Promise<unknown> {
    const schedule = this.schedule()
    const request: Record<string, unknown> = { title: input.title, prompt: input.prompt }
    if (input.afterSeconds !== undefined) request['after_seconds'] = input.afterSeconds
    if (input.everySeconds !== undefined) request['every_seconds'] = input.everySeconds
    return await schedule['create']?.call(schedule, input.sessionId, request)
  }

  /** E3：列出某会话的 active 任务。 */
  async scheduleList(sessionId: string): Promise<unknown> {
    const schedule = this.schedule()
    return await schedule['list']?.call(schedule, { sessionId })
  }

  /** E3：删除任务。 */
  async scheduleDelete(sessionId: string, id: string): Promise<unknown> {
    const schedule = this.schedule()
    return await schedule['delete']?.call(schedule, { sessionId, id })
  }

  /** E3-C：读 schedule 存储落点（宿主 home 下 storages/schedule.json）。 */
  scheduleStoragePath(): string {
    return `${hostHome().home}/storages/schedule.json`
  }

  async dispose(): Promise<void> {
    // M0：无持有资源。领域模块进场后在此逆序释放。
  }
}
