/** Host RPC adapter for the SRW Web client over the harness webServer
 * (`/dsh-kylin-srw` prefix channel).
 *
 * 为什么走 `webServer.register` 直连而不是 `connection.rpc.handle`（0102
 * ADR-14 的「退路」在此环境是**已验证主路**）：同族 dsh-kylin-automation
 * 双通道实测的写法——vendored `connection.rpc.handle` 的路由 effect 跑在
 * connection 插件自己的 fiber 上，第三方 patch row 拿不到；而本通道复制
 * Connection 传输语义（同源/浏览器鉴权栅栏 `connection.requestRejection`、
 * 同款 client-request/server-response 信封、有界 body）。E1 若实测
 * `rpc.handle` 对第三方可用，再按 ADR-14 修订回首选路径。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type SrwService } from './service.ts';
export declare const RPC_CHANNEL = "/dsh-kylin-srw";
export type RpcResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
    };
};
interface SrwWebServerLike {
    register(route: {
        kind: 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void;
    }): unknown;
}
interface SrwConnectionLike {
    requestRejection?(req: IncomingMessage): number | undefined;
}
export interface SrwHostContext {
    readonly webServer?: SrwWebServerLike;
    readonly connection?: SrwConnectionLike;
    /** cordis ctx.effect（真实宿主必有；测试 fake 可省）。 */
    effect?(factory: () => unknown, label: string): unknown;
}
/** Register the `/dsh-kylin-srw` channel; returns a disposer. */
export declare function registerSrwRpc(ctx: SrwHostContext, service: SrwService): () => Promise<void>;
/** One endpoint dispatch — exported for direct unit tests. */
export declare function handleSrwRpc(service: SrwService, endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>>;
export {};
