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

import type { IncomingMessage, ServerResponse } from 'node:http'
import { ServiceError, type SrwService } from './service.ts'

export const RPC_CHANNEL = '/dsh-kylin-srw'

/** JSON body limit for RPC payloads（与 automation 同款 4 MiB 有界）。 */
const RPC_BODY_LIMIT_BYTES = 4 * 1024 * 1024

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } }
}

function toErrorResult(error: unknown, aborted: boolean): RpcResult<never> {
  if (aborted) return fail('aborted', 'The request was aborted.')
  if (error instanceof ServiceError) return fail(error.code, error.message)
  return fail('internal', error instanceof Error ? error.message : String(error))
}

/* ── 载荷校验（diag 端点最小集）── */

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ServiceError('INVALID', 'payload must be an object')
  }
  return value as Record<string, unknown>
}

function reqString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value === '' || value.length > 5000) {
    throw new ServiceError('INVALID', `${key} must be a non-empty string (≤5000)`)
  }
  return value
}

function optNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 86_400) {
    throw new ServiceError('INVALID', `${key} must be an integer 1..86400`)
  }
  return value
}

interface SrwWebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): unknown
}

interface SrwConnectionLike {
  requestRejection?(req: IncomingMessage): number | undefined
}

export interface SrwHostContext {
  readonly webServer?: SrwWebServerLike
  readonly connection?: SrwConnectionLike
  /** cordis ctx.effect（真实宿主必有；测试 fake 可省）。 */
  effect?(factory: () => unknown, label: string): unknown
}

/** Register the `/dsh-kylin-srw` channel; returns a disposer. */
export function registerSrwRpc(ctx: SrwHostContext, service: SrwService): () => Promise<void> {
  const webServer = ctx.webServer
  if (webServer?.register === undefined) {
    throw new ServiceError('NO_PROVIDER', '宿主 webServer 服务缺席，RPC 通道无法注册')
  }
  const route = {
    kind: 'prefix' as const,
    path: RPC_CHANNEL,
    handler: (req: IncomingMessage, res: ServerResponse) => { void serveRpcRequest(ctx, service, req, res) },
  }
  if (ctx.effect !== undefined) {
    return ctx.effect(() => webServer.register(route), 'dsh-kylin-srw: rpc channel') as unknown as () => Promise<void>
  }
  const disposer = webServer.register(route)
  return async () => { await (disposer as (() => Promise<void>) | undefined)?.() }
}

async function serveRpcRequest(
  ctx: SrwHostContext,
  service: SrwService,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const reply = (status: number, payload: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
    res.end(JSON.stringify(payload))
  }
  // The same Host/Origin + persistent browser-auth fence the /api route uses.
  const rejection = ctx.connection?.requestRejection?.(req)
  if (rejection !== undefined) {
    res.writeHead(rejection)
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const endpoint = url.pathname === RPC_CHANNEL ? '' : url.pathname.startsWith(`${RPC_CHANNEL}/`)
    ? url.pathname.slice(RPC_CHANNEL.length + 1)
    : undefined
  if (endpoint === undefined || !/^[A-Za-z0-9_$.:-]+$/.test(endpoint)) {
    reply(404, { type: 'server-response', rpcId: 'invalid-request', result: fail('not-found', 'unknown endpoint') })
    return
  }
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    reply(415, { type: 'server-response', rpcId: 'invalid-request', result: fail('invalid', 'content type must be application/json') })
    return
  }
  const declared = req.headers['content-length']
  if (declared !== undefined && Number(declared) > RPC_BODY_LIMIT_BYTES) {
    res.writeHead(413, { connection: 'close' })
    res.end()
    return
  }
  let raw = ''
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableEnded) abort.abort() })
  try {
    let received = 0
    for await (const chunk of req) {
      received += (chunk as Buffer).byteLength
      if (received > RPC_BODY_LIMIT_BYTES) throw new Error('body too large')
      raw += String(chunk)
    }
  } catch {
    res.writeHead(400, { connection: 'close' })
    res.end('body read failure')
    req.destroy()
    return
  }
  let envelope: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
  try {
    envelope = JSON.parse(raw) as typeof envelope
  } catch {
    reply(400, { type: 'server-response', rpcId: 'invalid-request', result: fail('invalid', 'body is not JSON') })
    return
  }
  if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string'
    || typeof envelope.method !== 'string') {
    reply(200, {
      type: 'server-response',
      rpcId: typeof envelope?.rpcId === 'string' ? envelope.rpcId : 'invalid-request',
      result: fail('invalid', 'invalid client-request message'),
    })
    return
  }
  if (envelope.method !== endpoint) {
    reply(200, {
      type: 'server-response',
      rpcId: envelope.rpcId,
      result: fail('invalid', `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`),
    })
    return
  }
  const result = await handleSrwRpc(service, envelope.method, envelope.payload, abort.signal)
  reply(200, { type: 'server-response', rpcId: envelope.rpcId, result })
}

/** One endpoint dispatch — exported for direct unit tests. */
export async function handleSrwRpc(
  service: SrwService,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<RpcResult<unknown>> {
  try {
    signal.throwIfAborted()
    switch (endpoint) {
      case 'diag.ping':
        return ok(service.ping())
      case 'diag.caps':
        return ok({ caps: service.caps(), info: service.info(SRW_VERSION) })
      case 'diag.echo':
        return ok({ echoed: payload })
      case 'diag.contains': {
        const body = record(payload)
        return ok(await service.diagContains(reqString(body, 'root'), reqString(body, 'target')))
      }
      case 'diag.schedule.create': {
        const body = record(payload)
        const afterSeconds = optNumber(body, 'afterSeconds')
        const everySeconds = optNumber(body, 'everySeconds')
        return ok(await service.scheduleCreate({
          sessionId: reqString(body, 'sessionId'),
          title: reqString(body, 'title'),
          prompt: reqString(body, 'prompt'),
          ...(afterSeconds === undefined ? {} : { afterSeconds }),
          ...(everySeconds === undefined ? {} : { everySeconds }),
        }))
      }
      case 'diag.schedule.list':
        return ok(await service.scheduleList(reqString(record(payload), 'sessionId')))
      case 'diag.schedule.delete': {
        const body = record(payload)
        return ok(await service.scheduleDelete(reqString(body, 'sessionId'), reqString(body, 'id')))
      }
      case 'diag.schedule.storage':
        return ok({ path: service.scheduleStoragePath() })
      default:
        return fail('not-found', `unknown endpoint ${JSON.stringify(endpoint)}`)
    }
  } catch (error: unknown) {
    return toErrorResult(error, signal.aborted)
  }
}

/** 与 package.json 同步维护；单点仅供 diag.info 使用。 */
export const SRW_VERSION = '0.0.1'
