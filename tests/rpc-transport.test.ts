/** RPC 传输层回归（P1-5）：真实 node:http server + registerSrwRpc，
 * 不 mock 传输。核心用例把请求 body 切在「中」的 UTF-8 三字节内部，
 * 逐 chunk 发送，断言 diag.echo 原样返回、响应里没有 U+FFFD。
 *
 * 旧实现 `raw += String(chunk)` 会按 chunk 边界解 UTF-8，跨 chunk 的半个
 * 字符变成 U+FFFD（基线实测 "中文测试A" → "���文测试A"）。 */

import assert from 'node:assert/strict'
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { test } from 'node:test'
import { RPC_CHANNEL, registerSrwRpc, type SrwHostContext } from '../src/rpc.ts'
import { SrwService } from '../src/service.ts'

const tick = (ms = 5): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })
const BODY_LIMIT_BYTES = 4 * 1024 * 1024

async function startServer(): Promise<{ server: Server; port: number; service: SrwService }> {
  const service = await SrwService.open({}, { rootDir: '', offlineMode: true })
  let handler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined
  const ctx: SrwHostContext = {
    webServer: {
      register: route => {
        handler = route.handler
        return () => {}
      },
    },
    connection: { requestRejection: () => undefined },
  }
  registerSrwRpc(ctx, service)
  const server = createServer((req, res) => { handler?.(req, res) })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server has no port')
  return { server, port: address.port, service }
}

/** 收完整个响应体；chunks 逐个 write 并用 tick 隔开，确保服务端按 HTTP
 * chunk（Transfer-Encoding: chunked）逐片收到，而不是被 TCP/Node 合并。 */
function postChunks(port: number, path: string, chunks: readonly Buffer[], headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
    }, res => {
      const parts: Buffer[] = []
      res.on('data', chunk => { parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }) })
    })
    req.on('error', reject)
    void (async () => {
      for (const chunk of chunks) {
        req.write(chunk)
        await tick(5)
      }
      req.end()
    })().catch(reject)
  })
}

test('RPC UTF-8：「中」的三字节中间分片发送 → diag.echo 逐字还原、无 U+FFFD', async () => {
  const { server, port, service } = await startServer()
  try {
    const text = '中文测试A，多字节🙂'
    const payload = { text, nested: { 中文: '值' } }
    const envelope = { type: 'client-request', rpcId: 'rpc-utf8-1', method: 'diag.echo', payload }
    const body = Buffer.from(JSON.stringify(envelope), 'utf8')
    const marker = Buffer.from('中', 'utf8')
    assert.equal(marker.length, 3, '「中」必须是 3 字节 UTF-8')
    const at = body.indexOf(marker)
    assert.ok(at > 0, 'body 中必须能找到「中」')
    // E4 B8 AD 切成 [E4] [B8] [AD ...]：前两片都是非法独立字节序列
    const chunks = [body.subarray(0, at + 1), body.subarray(at + 1, at + 2), body.subarray(at + 2)]
    const response = await postChunks(port, `${RPC_CHANNEL}/diag.echo`, chunks)
    assert.equal(response.status, 200)
    assert.ok(!response.body.includes('\uFFFD'), `响应不得含替换字符：${response.body}`)
    const parsed = JSON.parse(response.body) as {
      type: string
      rpcId: string
      result: { ok: boolean; value: { echoed: unknown } }
    }
    assert.equal(parsed.type, 'server-response')
    assert.equal(parsed.rpcId, 'rpc-utf8-1')
    assert.equal(parsed.result.ok, true)
    assert.deepEqual(parsed.result.value.echoed, payload)
    const echoed = parsed.result.value.echoed as { text: string }
    assert.equal(echoed.text, text, '逐字相等（含 emoji）')
  } finally {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    await service.dispose()
  }
})

test('RPC 传输：非 application/json → 415；声明 content-length 超 4 MiB → 413', async () => {
  const { server, port, service } = await startServer()
  try {
    const envelope = JSON.stringify({ type: 'client-request', rpcId: 'rpc-415', method: 'diag.echo', payload: {} })
    const wrongType = await postChunks(port, `${RPC_CHANNEL}/diag.echo`, [Buffer.from(envelope)], { 'content-type': 'text/plain' })
    assert.equal(wrongType.status, 415)
    assert.equal((JSON.parse(wrongType.body) as { result: { error: { code: string } } }).result.error.code, 'invalid')

    const oversized = await new Promise<number>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path: `${RPC_CHANNEL}/diag.echo`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(BODY_LIMIT_BYTES + 1),
        },
      }, res => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(oversized, 413)
  } finally {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    await service.dispose()
  }
})
