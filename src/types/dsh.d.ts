/** Minimal compile-time declarations for the DSH Host capabilities this plugin
 * injects at runtime. The Host provides every `@deepseek-ai/*` module; these
 * ambient declarations mirror the framework's own Context merges so the plugin
 * can typecheck and build without installing peer packages (其传递依赖不在
 * 公共 npm 上，见 .npmrc）。
 *
 * Scope discipline (automation 同款): only members this plugin touches,
 * each shaped from the framework source (QiLin 3.0.10 / DSH 0.2.0-rc.2).
 * Tightening later is mechanical. M1+ 领域模块进场时按需扩（llm / schedule /
 * agents …）。storageDomain / workspaceRegistry / settings / fs 于 M1 Task 1.0
 * 进场，形状对照 QiLin 源码（packages/storage/storage-domain、workspace、
 * settings/settings、fs/fs 的 `declare module` 合并）。
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    /** Host/Origin 栅栏 + RPC 通道面（`@deepseek-ai/dsh-client-connection`）。 */
    readonly connection: {
      requestRejection(request: unknown): number | undefined
      readonly rpc?: {
        handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>): Promise<void>
        intercept(channel: '/api', matches: unknown, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>): () => Promise<void>
      }
    }
    /** HTTP route registration (`@deepseek-ai/dsh-host-webserver`)。 */
    readonly webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): unknown
      }): () => void
    }
    readonly logger: {
      info(message: string): void
      warn(message: string): void
      error(message: string): void
    }
    /** The Loader row service when running under the composition Loader. */
    readonly loader?: { await(): Promise<void> }
    effect<T>(factory: () => T | Promise<T>, label?: string): T
    on(name: string, listener: (...args: any[]) => any): () => void
    get(name: string): unknown
    /** 服务暴露（ADR-19）：reflect.provide 之外直接赋值会抛
     * "cannot set property without provide"。 */
    readonly reflect?: {
      provide(name: string, service: unknown): () => void
    }
    /** 存储域设施（`@deepseek-ai/dsh-storage-domain` DomainFacility）：
     * `open` 按 spec 打开一个声明域，调用方持有返回 handle 并负责 close。
     * spec 完整形状见 defineDomain（version 恒 1，只加可选字段）。 */
    readonly storageDomain: {
      open(spec: {
        readonly name: string
        readonly version: number
        readonly tables: Record<string, unknown>
      }): Promise<unknown>
    }
    /** 工作区实体注册表（workspace 插件）：引擎侧工作区的 durable 记录。
     * SRW 只读核对（M1 验收断言 2），不做双向同步。 */
    readonly workspaceRegistry: {
      create(path: string, title?: string): Promise<unknown>
      list(): readonly unknown[]
      get(id: unknown): unknown
      delete(id: unknown): Promise<boolean>
    }
    /** 用户设置能力缝（settings 插件）：ns 小写连字符、重复注册抛错；
     * schema 是宿主 z DSL（schemastery 形状，V15 前不启用 register）。 */
    readonly settings: {
      register(
        ns: string,
        schema: unknown,
        options?: { readonly base?: Record<string, unknown> },
      ): {
        get(): unknown
        watch(callback: (newValue: unknown, oldValue: unknown) => void): () => void
        update(patch: unknown): Promise<unknown>
        replace(section: unknown): Promise<unknown>
      }
    }
    /** 宿主文件系统提供者（fs 插件 FileSystem）：resolve 产出稳定目标
     * （可能做 I/O），contains 收两个目标、同步返回；护栏必须走
     * resolve→contains 两步，不能拿字符串路径自判。 */
    readonly fs: {
      resolve(path: string, opts?: { readonly cwd?: string; readonly signal?: AbortSignal }): Promise<unknown>
      contains(parent: unknown, child: unknown): boolean
      processPath?(target: unknown): string
      writeBytes?(path: string, data: Uint8Array): unknown
    }
  }
}
