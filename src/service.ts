/** SRW Host 服务（M0 骨架）：承载 patch-row 配置、能力探测与生命周期。
 *
 * M1 起按 0102 §4 的领域模块（workspace/literature/watch/reading/writer/
 * venue/materials/verify/compute）逐步长出；本类只做装配根，不装领域逻辑。
 * 服务经 `ctx.reflect.provide('srw', …)` 暴露（ADR-19）：别的插件将来可以
 * inject——不做 dsh-kylin-automation 那样的「拿不到的服务」。
 */

import { collectCaps, type CapRow } from './diag.ts'
import { hostHome, type SrwFsLike, assertInsideRoot } from './host.ts'
import { WorkspaceStore } from './workspace/project.ts'
import { readRootConfig, writeRootConfig } from './workspace/root.ts'
import { openSrwIndex, type SrwIndexDomain, type SrwIndexGlobal } from './store.ts'
import { attachLiterature, type LiteratureService } from './literature/service.ts'
import { attachWatch, type WatchManager } from './watch/binding.ts'
/** 与 package.json 同步维护；diag.caps 的 info.version 数据源。 */
export const SRW_VERSION = '0.0.1'

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
  /** storage 全局里的总根（Task 1.4 srw_index 写入；config 缺省时的回落源）。 */
  private storageRootDir: string | undefined
  /** 活动项目的内存镜像（index 缺席的降级态下进程内仍然生效）。 */
  private activeProjectMem = ''
  /** srw_index 域 handle（storageDomain 不可达时保持 undefined，功能降级：
  * rootDir 仅来自 patch config、activeProject 不持久——见 open 的降级注释）。 */
  private index: SrwIndexDomain | undefined

  private constructor(
    /** 宿主 ctx（软探测只读使用；领域模块不得经它绕过本服务）。 */
    readonly ctx: unknown,
    readonly config: SrwConfig,
    private readonly startedAt: number,
    /** 项目 CRUD（目录即真相源）。 */
    readonly workspace: WorkspaceStore,
  ) {}

  private literatureRef: LiteratureService | undefined
  /** 文献通路（M2：检索/入库/PDF/BibTeX）。惰性装配（getter 自引用安全）。 */
  get literature(): LiteratureService {
    if (this.literatureRef === undefined) this.literatureRef = attachLiterature(this)
    return this.literatureRef
  }

  private watchRef: WatchManager | undefined
  /** 订阅抓取（M3：触发绑内置自动化任务 ctx.schedule，执行是本插件 host 代码）。 */
  get watch(): WatchManager {
    if (this.watchRef === undefined) this.watchRef = attachWatch(this, () => this.literature)
    return this.watchRef
  }

  static async open(ctx: unknown, rawConfig: SrwConfig): Promise<SrwService> {
    const config: SrwConfig = {
      rootDir: typeof rawConfig?.rootDir === 'string' ? rawConfig.rootDir : '',
      offlineMode: rawConfig?.offlineMode === true,
    }
    const service: SrwService = new SrwService(
      ctx, config, Date.now(),
      new WorkspaceStore(() => service.currentRoot()),
    )
    // srw_index 打开：失败降级不阻断插件激活（storage 是 M1 面板便捷面，
    // 真相源在文件系统）；两通道 inject 矩阵已保证 storageDomain 存在，
    // 这里 catch 的是 open 期的介质错误（坏记录/版本不符等）。
    const storageDomain = (ctx as { storageDomain?: unknown }).storageDomain
    if (storageDomain !== undefined) {
      try {
        await service.attachIndex(await openSrwIndex(storageDomain))
      } catch (error: unknown) {
        const logger = (ctx as { logger?: { warn(message: string): void } }).logger
        logger?.warn?.(`dsh-kylin-srw: srw_index 打开失败，持久索引降级（${String(error)}）`)
      }
    }
    return service
  }

  /** 挂上域 handle 并把持久 rootDir 收编进内存判定（config 仍优先）。 */
  private async attachIndex(index: SrwIndexDomain): Promise<void> {
    this.index = index
    const stored = index.global.get().rootDir
    if (stored !== '') this.adoptRoot(stored)
  }

  /** 当前科研总根（未设置 = undefined）。单源判定：config 优先，storage 全局回落。 */
  currentRoot(): string | undefined {
    const fromConfig = (this.config.rootDir ?? '').trim()
    if (fromConfig !== '') return fromConfig
    const fromStorage = this.storageRootDir?.trim()
    return fromStorage !== undefined && fromStorage !== '' ? fromStorage : undefined
  }

  /** Task 1.4：root.set 落定后的总根更新入口（进程内生效；持久化在 srw_index）。 */
  adoptRoot(rootDir: string): void {
    this.storageRootDir = rootDir
  }

  /** srw_index 全局快照（index 缺席时以内存判定兜底）。 */
  indexGlobal(): SrwIndexGlobal {
    if (this.index !== undefined) return this.index.global.get()
    return { rootDir: this.currentRoot() ?? '', activeProject: this.activeProjectMem }
  }

  /** root.set：路径自检（resolve→contains 自含 + 可写性经 root.json 落盘证明）
  * → root.json（根内配置）→ srw_index 全局（「哪个根」的持久记忆）→ 内存收编。 */
  async setRoot(path: string): Promise<SrwIndexGlobal> {
    const fs = (this.ctx as { fs?: SrwFsLike }).fs
    await assertInsideRoot(fs, path, path)
    await writeRootConfig(path, {})
    const next: SrwIndexGlobal = { ...this.indexGlobal(), rootDir: path }
    if (this.index !== undefined) await this.index.global.set(next)
    this.adoptRoot(path)
    return next
  }

  /** project.open：元数据 + activeProject 持久 + project_cache 投影。 */
  async openProject(slug: string): Promise<unknown> {
    const meta = await this.workspace.open(slug)
    const record = {
      slug: meta.slug,
      title: meta.title,
      stage: meta.stage,
      updatedAt: meta.updatedAt,
    }
    const next: SrwIndexGlobal = { ...this.indexGlobal(), activeProject: record.slug }
    this.activeProjectMem = record.slug
    if (this.index !== undefined) {
      await this.index.global.set(next)
      await this.index.table('project_cache').put(record.slug, record)
    }
    return meta
  }

  /** 当前活动项目的 stage（轻投影：只读 project_cache，不扫盘）。 */
  activeStage(): string | undefined {
    const active = this.indexGlobal().activeProject
    if (active === '' || this.index === undefined) return undefined
    const cached = this.index.table('project_cache').get(active) as { stage?: string } | undefined
    return cached?.stage
  }

  /** overview（≤200ms 轻投影，5s 轮询面）。 */
  async overview(): Promise<{
    rootDir: string
    projectCount: number
    activeProject: string
    activeStage?: string
    capsOk: number
    capsTotal: number
    version: string
    offlineMode: boolean
    watchSummary?: { total: number; enabled: number; lastFresh?: number; lastError?: string }
  }> {
    const projects = await this.workspace.list()
    const caps = collectCaps(this.ctx)
    const global = this.indexGlobal()
    const stage = this.activeStage()
    type WatchSummary = { total: number; enabled: number; lastFresh?: number; lastError?: string }
    let watchSummary: WatchSummary | undefined
    try {
      const subs = await this.watch.list()
      const enabled = subs.filter(item => item.enabled)
      const withResult = [...subs].filter(item => item.lastResult !== undefined)
        .sort((a, b) => (b.lastResult?.at ?? '').localeCompare(a.lastResult?.at ?? ''))
      const lastOk = withResult.find(item => item.lastResult?.kind === 'ok')
      const lastError = withResult.find(item => item.lastResult?.kind === 'error')
      watchSummary = {
        total: subs.length,
        enabled: enabled.length,
        ...(lastOk?.lastResult?.kind === 'ok' ? { lastFresh: lastOk.lastResult.fresh } : {}),
        ...(lastError?.lastResult?.kind === 'error' ? { lastError: lastError.lastResult.error } : {}),
      }
    } catch { /* 无根/读失败：订阅摘要缺席不炸 overview */ }
    return {
      rootDir: this.currentRoot() ?? '',
      projectCount: projects.length,
      activeProject: global.activeProject,
      ...(stage === undefined ? {} : { activeStage: stage }),
      capsOk: caps.filter(row => row.available).length,
      capsTotal: caps.length,
      version: SRW_VERSION,
      offlineMode: this.config.offlineMode === true,
      ...(watchSummary !== undefined ? { watchSummary } : {}),
    }
  }

  /** 面板建订阅时的默认绑定会话：最新根 agent 的会话（拿不到则不绑）。 */
  newestRootSessionId(): string | undefined {
    const agents = (this.ctx as Record<string, unknown>)['agents'] as
      | { roots?: () => readonly unknown[] }
      | undefined
    if (agents?.roots === undefined) return undefined
    for (const root of [...agents.roots()].reverse()) {
      const sessionId = (root as { session?: { id?: unknown } } | undefined)?.session?.id
      if (typeof sessionId === 'string' && sessionId !== '') return sessionId
    }
    return undefined
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

  /** 宿主 schedule 服务面（不进 inject 名单——宿主可能缺名，避免激活失败）。
   * Cordis 对未注入服务的**属性访问直接抛错**（3091 活体踩中），必须 try/catch
   * 包住读面，缺席归一 NO_PROVIDER（绑定层降级为「未排程」）。 */
  private schedule(): Record<string, (...args: unknown[]) => unknown> {
    // 两级读法：① 属性访问（服务在 inject 名单里时的正路）；②
    // ctx.reflect.get —— vendored cordis 的全局注册表读法，绕过
    // 「未 inject 属性访问直接抛错」的围栏（3091 活体：@qilin/schedule
    // 经 bundle 提供，但第三方 patch 行插件拿不到祖先链合法读）。
    try {
      const direct = (this.ctx as Record<string, unknown>)['schedule']
      if (direct !== undefined && direct !== null && typeof direct === 'object') {
        return direct as Record<string, (...args: unknown[]) => unknown>
      }
    } catch { /* 围栏拦下，走 reflect */ }
    const reflect = (this.ctx as { reflect?: { get?: (name: string, strict?: boolean) => unknown } }).reflect
    const viaReflect = reflect?.get?.('schedule')
    if (viaReflect !== undefined && viaReflect !== null && typeof viaReflect === 'object') {
      return viaReflect as Record<string, (...args: unknown[]) => unknown>
    }
    throw new ServiceError('NO_PROVIDER', '宿主 schedule 服务缺席（本 profile 未挂载自动化任务 bundle；时钟绑定不可用，订阅仍可手动 run）')
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
    // 域 handle 的关闭（caller owns the domain，见 storage-domain open 契约）。
    const index = this.index
    this.index = undefined
    if (index !== undefined) await index.close()
  }
}
