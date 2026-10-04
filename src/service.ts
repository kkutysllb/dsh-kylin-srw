/** SRW Host 服务（M0 骨架）：承载 patch-row 配置、能力探测与生命周期。
 *
 * M1 起按 0102 §4 的领域模块（workspace/literature/watch/reading/writer/
 * venue/materials/verify/compute）逐步长出；本类只做装配根，不装领域逻辑。
 * 服务经 `ctx.reflect.provide('srw', …)` 暴露（ADR-19）：别的插件将来可以
 * inject——不做 dsh-kylin-automation 那样的「拿不到的服务」。
 */

import { collectCaps, hostHomeFromEnv, type CapRow } from './diag.ts'
import { homedir } from 'node:os'

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
      home: hostHomeFromEnv(process.env as Record<string, string | undefined>, homedir()),
    }
  }

  /** 宿主能力表（`diag.caps` 端点；E1/E2 与 V 系列核对的数据源）。 */
  caps(): readonly CapRow[] {
    return collectCaps(this.ctx)
  }

  async dispose(): Promise<void> {
    // M0：无持有资源。领域模块进场后在此逆序释放。
  }
}
