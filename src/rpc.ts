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
import { ARTIFACT_KINDS, PROVENANCES, type ArtifactKind, type Provenance } from './materials/types.ts'
import { ServiceError, SRW_VERSION, type SrwService } from './service.ts'

export const RPC_CHANNEL = '/dsh-kylin-srw'

/** JSON body limit for RPC payloads（与 automation 同款 4 MiB 有界）。 */
const RPC_BODY_LIMIT_BYTES = 4 * 1024 * 1024

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: Record<string, never> } }

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

/** 错误信封必须带 `details` record：vendored 客户端
 * （connection/src/client/rpc.ts parseConnectionResponse）对失败分支校验
 * `error.details` 是对象，缺了直接抛 "invalid server-response failure"——
 * 业务错误在面板上显示成类型错误（2026-10-04 用户实测踩中）。 */
function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
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

function optString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '' || value.length > 5000) {
    throw new ServiceError('INVALID', `${key} must be a non-empty string (≤5000)`)
  }
  return value
}

function optNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  // 只做通用整数校验；范围语义归各领域层（E3 时代误把 86400 硬顶写在这里，
  // 每周订阅 604800 被我自己的入口拦下——用户实测踩中，宿主 schedule 仅限 ≥60）。
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ServiceError('INVALID', `${key} must be a safe integer >= 1`)
  }
  return value
}

/** materials.generate 的 kind/provenance 枚举校验（工具层同款语义）。 */
function materialsKind(value: unknown): ArtifactKind {
  const kind = ARTIFACT_KINDS.find(item => item === value)
  if (kind === undefined) throw new ServiceError('INVALID', 'kind 必须是 ' + ARTIFACT_KINDS.join('|'))
  return kind
}

function materialsProvenance(value: unknown): Provenance {
  const provenance = PROVENANCES.find(item => item === value)
  if (provenance === undefined) throw new ServiceError('INVALID', 'provenance 必须是 ' + PROVENANCES.join('|'))
  return provenance
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
  // 收集原始字节而不是逐 chunk String()：HTTP 分片边界不保证落在字符边界，
  // 多字节 UTF-8（中文/emoji）跨 chunk 时 String(chunk) 会把半个字符解成
  // U+FFFD（P1-5 实测 "中文测试A" 的首字变成 3 个 U+FFFD）。body 上限仍按字节算。
  const chunks: Buffer[] = []
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableEnded) abort.abort() })
  try {
    let received = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      received += buffer.byteLength
      if (received > RPC_BODY_LIMIT_BYTES) throw new Error('body too large')
      chunks.push(buffer)
    }
  } catch {
    res.writeHead(400, { connection: 'close' })
    res.end('body read failure')
    req.destroy()
    return
  }
  const raw = Buffer.concat(chunks).toString('utf8')
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
      case 'root.get':
        return ok({
          rootDir: service.currentRoot() ?? '',
          global: service.indexGlobal(),
          projects: await service.workspace.list(),
          caps: service.caps(),
          info: service.info(SRW_VERSION),
        })
      case 'root.set':
        return ok(await service.setRoot(reqString(record(payload), 'path')))
      case 'project.create': {
        const body = record(payload)
        const field = optString(body, 'field')
        return ok(await service.workspace.create({
          slug: reqString(body, 'slug'),
          title: reqString(body, 'title'),
          ...(field === undefined ? {} : { field }),
        }))
      }
      case 'project.list':
        return ok(await service.workspace.list())
      case 'project.open':
        return ok(await service.openProject(reqString(record(payload), 'slug')))
      case 'project.rename': {
        const body = record(payload)
        return ok(await service.workspace.rename(reqString(body, 'slug'), reqString(body, 'title')))
      }
      case 'project.remove':
        return ok({ removed: await service.workspace.remove(reqString(record(payload), 'slug')).then(() => true) })
      case 'literature.search': {
        const body = record(payload)
        const limit = optNumber(body, 'limit')
        return ok(await service.literature.search(
          reqString(body, 'source'),
          reqString(body, 'query'),
          ...(limit === undefined ? [] : [limit] as const),
        ))
      }
      case 'literature.import': {
        const body = record(payload)
        const items = body['items']
        if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
          throw new ServiceError('INVALID', 'items 必须是 1..100 的数组')
        }
        for (const item of items) {
          if (typeof item !== 'object' || item === null) throw new ServiceError('INVALID', 'items 元素必须是对象')
        }
        return ok(await service.literature.importEntries(
          reqString(body, 'project'),
          items as readonly unknown[],
        ))
      }
      case 'literature.fetchPdf':
        return ok(await service.literature.fetchPdf(
          reqString(record(payload), 'project'),
          reqString(record(payload), 'key'),
        ))
      case 'literature.lib':
        return ok({ entries: await service.literature.lib(reqString(record(payload), 'project')) })
      case 'literature.bibtex': {
        const body = record(payload)
        const keys = body['keys']
        if (keys !== undefined && !Array.isArray(keys)) throw new ServiceError('INVALID', 'keys 必须是数组')
        return ok(await service.literature.bibtex(
          reqString(body, 'project'),
          ...(keys === undefined ? [] : [keys as readonly string[]] as const),
        ))
      }
      // ── P0-4 全文获取（Unpaywall OA + 域确认 + 内容门 + 证据） ──
      case 'literature.fulltext': {
        const body = record(payload)
        const key = optString(body, 'key')
        const doi = optString(body, 'doi')
        const allowHost = optString(body, 'allowHost')
        if (key === undefined && doi === undefined) throw new ServiceError('INVALID', 'fulltext 需要 key 或 doi')
        return ok(await service.literature.fulltext(reqString(body, 'project'), {
          ...(key === undefined ? {} : { key }),
          ...(doi === undefined ? {} : { doi }),
          ...(allowHost === undefined ? {} : { allowHost }),
        }))
      }
      // ── P0-6 DOI 校验与引用门 ──
      case 'literature.verifyDoi':
        return ok(await service.literature.verifyDoi(reqString(record(payload), 'doi')))
      case 'literature.citeGate': {
        const body = record(payload)
        const keys = body['keys']
        if (keys !== undefined && !Array.isArray(keys)) throw new ServiceError('INVALID', 'keys 必须是数组')
        return ok(await service.literature.citeGate(
          reqString(body, 'project'),
          ...(keys === undefined ? [] : [keys as readonly string[]] as const),
        ))
      }
      // ── P0-3 身份迁移（dry-run 默认） ──
      case 'literature.migrate': {
        const body = record(payload)
        return ok(await service.literature.migrate(reqString(body, 'project'), body['apply'] === true))
      }
      // ── P0-5 检索计划（save/list/replay 不触网；run 触网） ──
      case 'literature.plan.save': {
        const body = record(payload)
        return ok(await service.literature.planSave(reqString(body, 'project'), body))
      }
      case 'literature.plan.run':
        return ok(await service.literature.planRun(
          reqString(record(payload), 'project'),
          reqString(record(payload), 'planId'),
        ))
      case 'literature.plan.list':
        return ok({ plans: await service.literature.planList(reqString(record(payload), 'project')) })
      case 'literature.plan.replay': {
        const body = record(payload)
        const runId = optString(body, 'runId')
        return ok(await service.literature.planReplay(
          reqString(body, 'project'),
          reqString(body, 'planId'),
          runId,
        ))
      }
      case 'overview':
        return ok(await service.overview())
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
      // ── M3 订阅抓取（0204）：触发绑内置自动化任务，执行是 host 代码 ──
      case 'watch.list':
        return ok(await service.watch.list())
      case 'watch.create': {
        const body = record(payload)
        const everySeconds = optNumber(body, 'everySeconds')
        // 面板创建：不显式带会话 → 绑最新根会话（没有则未排程，面板明示）
        const sessionId = typeof body['sessionId'] === 'string' && body['sessionId'] !== ''
          ? body['sessionId']
          : service.newestRootSessionId()
        return ok(await service.watch.create({
          project: body['project'],
          source: body['source'],
          query: body['query'],
          everySeconds,
        }, sessionId))
      }
      case 'watch.remove': {
        const body = record(payload)
        await service.watch.remove(reqString(body, 'id'))
        return ok({ removed: true })
      }
      case 'watch.pause': {
        const body = record(payload)
        return ok(await service.watch.pause(reqString(body, 'id')))
      }
      case 'watch.resume': {
        const body = record(payload)
        const sessionId = optString(body, 'sessionId')
        return ok(await service.watch.resume(reqString(body, 'id'), sessionId))
      }
      case 'watch.run': {
        const body = record(payload)
        return ok(await service.watch.run(reqString(body, 'id')))
      }
      // ── M4 精读（0205）：抽取→翻译→渲染→校验 ──
      case 'reading.extract': {
        const body = record(payload)
        return ok(await service.reading.extract(reqString(body, 'project'), reqString(body, 'paperKey'), reqString(body, 'pdfPath')))
      }
      case 'reading.translate': {
        const body = record(payload)
        const keys = body['keys']
        const force = body['force']
        return ok(await service.reading.translate(reqString(body, 'project'), reqString(body, 'paperKey'), {
          ...(Array.isArray(keys) ? { keys: keys.filter((item): item is string => typeof item === 'string') } : {}),
          ...(force === true ? { force: true } : {}),
        }))
      }
      case 'reading.status':
        return ok(await service.reading.status(reqString(record(payload), 'project'), reqString(record(payload), 'paperKey')))
      case 'reading.verify': {
        const body = record(payload)
        return ok(await service.reading.verify(reqString(body, 'project'), reqString(body, 'paperKey')))
      }
      case 'reading.content': {
        const body = record(payload)
        return ok(await service.reading.content(reqString(body, 'project'), reqString(body, 'paperKey')))
      }
      case 'reading.export': {
        const body = record(payload)
        return ok(await service.reading.exportPdf(reqString(body, 'project'), reqString(body, 'paperKey')))
      }
      case 'reading.glossary': {
        const body = record(payload)
        const entries = body['entries']
        if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
          throw new ServiceError('INVALID', 'entries 必须是 { 术语: 译名 } 对象')
        }
        return ok(await service.reading.setGlossary(
          reqString(body, 'project'),
          reqString(body, 'paperKey'),
          Object.fromEntries(Object.entries(entries as Record<string, unknown>)
            .filter((row): row is [string, string] => typeof row[1] === 'string')),
        ))
      }
      // ── M5 论文线（0206）：venue/骨架/大纲 G1/编译/快照/审计/合规 ──
      case 'paper.state':
        return ok(await service.writer.state(reqString(record(payload), 'project')))
      case 'venue.list':
        return ok({ venues: service.writer.venueList() })
      case 'venue.apply': {
        const body = record(payload)
        const tier = body['tier']
        return ok(await service.writer.venueApply(
          reqString(body, 'project'),
          reqString(body, 'venueId'),
          tier === 'D1' || tier === 'D2' || tier === 'D3' ? tier : undefined,
        ))
      }
      case 'paper.scaffold': {
        const body = record(payload)
        const authors = body['authors']
        const abstract = body['abstract']
        return ok(await service.writer.scaffold(reqString(body, 'project'), {
          title: reqString(body, 'title'),
          ...(typeof authors === 'string' ? { authors } : {}),
          ...(typeof abstract === 'string' ? { abstract } : {}),
        }))
      }
      case 'paper.outline.get': {
        const body = record(payload)
        return ok(await service.writer.outlineGet(reqString(body, 'project')) ?? { status: 'none', revision: 0, sections: [] })
      }
      case 'paper.outline.save': {
        const body = record(payload)
        const sections = body['sections']
        if (!Array.isArray(sections)) throw new ServiceError('INVALID', 'sections 必须是数组')
        return ok(await service.writer.outlineSave(reqString(body, 'project'), sections.map((item: unknown) => {
          const section = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
          return {
            title: typeof section['title'] === 'string' ? section['title'] : '',
            intent: typeof section['intent'] === 'string' ? section['intent'] : '',
            ...(typeof section['targetWords'] === 'number' ? { targetWords: section['targetWords'] } : {}),
          }
        }).filter(section => section.title !== '')))
      }
      case 'paper.outline.confirm':
        return ok(await service.writer.outlineConfirm(reqString(record(payload), 'project')))
      case 'paper.compile': {
        // M6 编译前门：插入副本被手改/缺失（ARTIFACT_DRIFT）→ 先拦，不进编译
        //（副本与证明链脱钩时编出的 PDF 不可信——先恢复副本再编译）。
        const project = reqString(record(payload), 'project')
        await service.materials.checkInsertions(project)
        return ok(await service.writer.compile(project))
      }
      case 'paper.citeAudit':
        return ok(await service.writer.citeAudit(reqString(record(payload), 'project')))
      case 'paper.refsAppend': {
        const body = record(payload)
        const keys = body['keys']
        if (!Array.isArray(keys)) throw new ServiceError('INVALID', 'keys 必须是数组')
        return ok(await service.writer.refsAppend(reqString(body, 'project'), keys.filter((item): item is string => typeof item === 'string')))
      }
      case 'paper.snapshot.list':
        return ok(await service.writer.snapshotList(reqString(record(payload), 'project')))
      case 'paper.snapshot.tag': {
        const body = record(payload)
        const note = typeof body['note'] === 'string' ? body['note'] : undefined
        return ok(await service.writer.snapshotTag(reqString(body, 'project'), reqString(body, 'id'), { label: reqString(body, 'label'), ...(note !== undefined ? { note } : {}) }))
      }
      case 'paper.snapshot.restore': {
        const body = record(payload)
        return ok(await service.writer.snapshotRestore(reqString(body, 'project'), reqString(body, 'id')))
      }
      case 'paper.compliance':
        return ok(await service.writer.compliance(reqString(record(payload), 'project')))
      // ── M9 专利线（M9-lite）：档案 / 交底书 / 公开事件 / 公开时序门 ──
      case 'patent.state': {
        const body = record(payload)
        const project = reqString(body, 'project')
        const patentId = optString(body, 'patentId')
        if (patentId !== undefined) {
          const patentMeta = await service.patent.get(project, patentId)
          const disclosure = await service.patent.disclosureGet(project, patentId)
          return ok({ project, patentId, patent: patentMeta, hasDisclosure: disclosure !== undefined })
        }
        return ok({ project, patents: await service.patent.list(project) })
      }
      case 'patent.create': {
        const body = record(payload)
        const inventors = body['inventors']
        const applicants = body['applicants']
        for (const [key, value] of [['inventors', inventors], ['applicants', applicants]] as const) {
          if (value !== undefined && (!Array.isArray(value) || !value.every(item => typeof item === 'string'))) {
            throw new ServiceError('INVALID', `${key} 必须是字符串数组`)
          }
        }
        return ok(await service.patent.create(reqString(body, 'project'), {
          patentId: reqString(body, 'patentId'),
          title: reqString(body, 'title'),
          ...(inventors === undefined ? {} : { inventors: inventors as readonly string[] }),
          ...(applicants === undefined ? {} : { applicants: applicants as readonly string[] }),
        }))
      }
      case 'patent.disclosure.get': {
        const body = record(payload)
        return ok(await service.patent.disclosureGet(reqString(body, 'project'), reqString(body, 'patentId')) ?? { status: 'none' })
      }
      case 'patent.disclosure.save': {
        const body = record(payload)
        const disclosure = body['disclosure']
        if (typeof disclosure !== 'object' || disclosure === null || Array.isArray(disclosure)) {
          throw new ServiceError('INVALID', 'disclosure 必须是对象')
        }
        return ok(await service.patent.disclosureSave(reqString(body, 'project'), reqString(body, 'patentId'), disclosure))
      }
      case 'patent.event.add': {
        const body = record(payload)
        const event = body['event']
        if (typeof event !== 'object' || event === null || Array.isArray(event)) {
          throw new ServiceError('INVALID', 'event 必须是对象')
        }
        return ok(await service.patent.eventAdd(reqString(body, 'project'), reqString(body, 'patentId'), event))
      }
      case 'patent.publication.check': {
        const body = record(payload)
        const publicationAt = optString(body, 'publicationAt')
        return ok(await service.patent.publicationCheck(
          reqString(body, 'project'),
          reqString(body, 'patentId'),
          ...(publicationAt === undefined ? [] : [publicationAt] as const),
        ))
      }
      // ── M6 素材与证明链（materials）：生成/复算/插入门/数字宏 ──
      case 'materials.list':
        return ok(await service.materials.manifest(reqString(record(payload), 'project')))
      case 'materials.generate': {
        const body = record(payload)
        const spec = body['spec']
        if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
          throw new ServiceError('INVALID', 'spec 必须是对象（kind 特定参数）')
        }
        const allowIllustrative = body['allowIllustrative']
        return ok(await service.materials.generate(reqString(body, 'project'), {
          id: reqString(body, 'id'),
          kind: materialsKind(body['kind']),
          provenance: materialsProvenance(body['provenance']),
          spec: spec as Record<string, unknown>,
          ...(allowIllustrative === true ? { allowIllustrative: true } : {}),
        }))
      }
      case 'materials.verify': {
        const body = record(payload)
        return ok(await service.materials.verify(reqString(body, 'project'), reqString(body, 'id')))
      }
      case 'materials.insert': {
        const body = record(payload)
        return ok(await service.materials.insert(reqString(body, 'project'), reqString(body, 'id'), reqString(body, 'sectionId')))
      }
      case 'materials.remove': {
        const body = record(payload)
        return ok(await service.materials.removeInserted(reqString(body, 'project'), reqString(body, 'id')))
      }
      case 'materials.metrics.import': {
        const body = record(payload)
        const metrics = body['metrics']
        if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
          throw new ServiceError('INVALID', 'metrics 必须是对象（{ values, series? }）')
        }
        return ok(await service.materials.importMetrics(reqString(body, 'project'), {
          runId: reqString(body, 'runId'),
          metrics,
        }))
      }
      case 'materials.numbers':
        return ok(await service.materials.numbersGenerate(reqString(record(payload), 'project')))
      case 'materials.numbers.audit':
        return ok(await service.materials.numbersAudit(reqString(record(payload), 'project')))
      // ── M7 实验与算力（compute）：单主机提交/生命周期/日志/归集/对账 ──
      case 'experiment.hosts': {
        const body = record(payload)
        return ok(await service.experiment.hosts(reqString(body, 'project'), body['env'] === false ? { env: false } : {}))
      }
      case 'experiment.submit': {
        const body = record(payload)
        return ok(await service.experiment.submit(reqString(body, 'project'), body as unknown as Parameters<typeof service.experiment.submit>[1]))
      }
      case 'experiment.status': {
        const body = record(payload)
        const runId = optString(body, 'runId')
        return ok(await service.experiment.status(reqString(body, 'project'), reqString(body, 'expId'), ...(runId === undefined ? [] : [runId] as const)))
      }
      case 'experiment.logs': {
        const body = record(payload)
        return ok(await service.experiment.logs(reqString(body, 'project'), reqString(body, 'expId'), reqString(body, 'runId')))
      }
      case 'experiment.collect': {
        const body = record(payload)
        return ok(await service.experiment.collect(reqString(body, 'project'), reqString(body, 'expId'), reqString(body, 'runId')))
      }
      case 'experiment.cancel': {
        const body = record(payload)
        const reason = optString(body, 'reason')
        return ok(await service.experiment.cancel(reqString(body, 'project'), reqString(body, 'expId'), reqString(body, 'runId'), ...(reason === undefined ? [] : [reason] as const)))
      }
      case 'experiment.claims.check': {
        const body = record(payload)
        const expId = optString(body, 'expId')
        const id = optString(body, 'id')
        return ok(await service.experiment.claimsCheck(reqString(body, 'project'), {
          ...(expId === undefined ? {} : { expId }),
          ...(id === undefined ? {} : { id }),
          ...(body['claim'] !== undefined ? { claim: body['claim'] } : {}),
        }))
      }
      case 'experiment.gaps.list':
        return ok(await service.experiment.gapsList(reqString(record(payload), 'project'), reqString(record(payload), 'expId')))
      case 'experiment.dataset.register': {
        const body = record(payload)
        return ok(await service.experiment.datasetRegister(reqString(body, 'project'), body['dataset']))
      }
      default:
        return fail('not-found', `unknown endpoint ${JSON.stringify(endpoint)}`)
    }
  } catch (error: unknown) {
    return toErrorResult(error, signal.aborted)
  }
}
