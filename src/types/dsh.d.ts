/** Minimal compile-time declarations for the DSH Host capabilities this plugin
 * injects at runtime. The Host provides every `@deepseek-ai/*` module; these
 * ambient declarations mirror the framework's own Context merges so the plugin
 * can typecheck and build without installing peer packages (其传递依赖不在
 * 公共 npm 上，见 .npmrc）。
 *
 * Scope discipline (automation 同款): only members this plugin touches,
 * each shaped from the framework source (QiLin 3.0.10 / DSH 0.2.0-rc.2).
 * Tightening later is mechanical. M1+ 领域模块进场时按需扩（storageDomain /
 * workspaceRegistry / llm / schedule / agents / settings / fs …）。
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
  }
}
