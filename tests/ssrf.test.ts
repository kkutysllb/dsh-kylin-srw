/** Task 2.7：SSRF 守卫（IP 判定表驱动/整组拒绝/白名单/重定向策略）与
 * PDF 流式落盘（本地 http 靶机，allowPrivateForTest 仅测试降级）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodePath from 'node:path'
import type { AddressInfo } from 'node:net'
import {
  assertWhitelisted,
  isAllowedRedirect,
  isPublicIp,
  parseFetchUrl,
  resolvePublicAddresses,
} from '../src/net/ssrf.ts'
import { fetchPdf } from '../src/literature/pdf.ts'
import { RateGate } from '../src/literature/rate-gate.ts'
import { ServiceError } from '../src/service.ts'

const fsLike = {
  resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
  contains: (parent: { key: string }, child: { key: string }) => {
    const p = nodePath.resolve(parent.key)
    const c = nodePath.resolve(child.key)
    return c === p || c.startsWith(`${p}/`)
  },
}

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? ''
}

test('ssrf：isPublicIp 表驱动——回环/私网/link-local/CGNAT/NAT64/mapped 全拒，公网过', () => {
  for (const bad of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1',
    'fc00::1', 'fd12::1', '64:ff9b::1.2.3.4', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPublicIp(bad), false, bad)
  }
  for (const good of ['1.2.3.4', '8.8.8.8', '172.32.0.1', '100.63.0.1', '2606:4700::1111']) {
    assert.equal(isPublicIp(good), true, good)
  }
})

test('ssrf：resolvePublicAddresses 整组拒绝（任一非公网）+ 注入解析', async () => {
  const allPublic = await resolvePublicAddresses('ok.test', async () => ['1.2.3.4', '2606:4700::1111'])
  assert.deepEqual(allPublic, ['1.2.3.4', '2606:4700::1111'])
  await assert.rejects(
    () => resolvePublicAddresses('rebind.test', async () => ['1.2.3.4', '127.0.0.1']),
    (e: unknown) => codeOf(e) === 'SSRF_BLOCKED',
  )
  await assert.rejects(
    () => resolvePublicAddresses('dead.test', async () => []),
    (e: unknown) => codeOf(e) === 'DNS_FAIL',
  )
})

test('ssrf：parseFetchUrl 白名单外凭据/协议/长度', () => {
  assert.equal(parseFetchUrl('https://arxiv.org/pdf/x').hostname, 'arxiv.org')
  assert.throws(() => parseFetchUrl('ftp://arxiv.org/x'), ServiceError)
  assert.throws(() => parseFetchUrl('https://user:pass@arxiv.org/x'), ServiceError)
  assert.throws(() => parseFetchUrl(`https://arxiv.org/${'a'.repeat(2100)}`), ServiceError)
  // 白名单断言
  const hosts = new Set(['arxiv.org'])
  assert.doesNotThrow(() => assertWhitelisted('arxiv.org', hosts))
  assert.throws(() => assertWhitelisted('evil.test', hosts), ServiceError)
  // 重定向策略：仅 http→https 同 host
  assert.equal(isAllowedRedirect(new URL('http://arxiv.org/a'), new URL('https://arxiv.org/b')), true)
  assert.equal(isAllowedRedirect(new URL('https://arxiv.org/a'), new URL('https://arxiv.org/b')), false)
  assert.equal(isAllowedRedirect(new URL('http://arxiv.org/a'), new URL('http://arxiv.org/b')), false)
  assert.equal(isAllowedRedirect(new URL('http://arxiv.org/a'), new URL('https://evil.test/b')), false)
})

async function withServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void, run: (port: number) => Promise<void>): Promise<void> {
  const server: Server = createServer(handler)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  try {
    await run((server.address() as AddressInfo).port)
  } finally {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  }
}

async function withTemp(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'srw-pdf-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function gateFor(dir: string): RateGate {
  return new RateGate({ ledgerPath: join(dir, 'ledger.json'), sleepFn: async () => {} })
}

test('pdf：非白名单域拒（连接前）；白名单 + allowPrivateForTest 下正常落盘与 sha256', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content for srw test')
  const expectedHash = createHash('sha256').update(pdfBytes).digest('hex')
  await withTemp(async (dir) => {
    await withServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(pdfBytes)
    }, async (port) => {
      const url = `http://127.0.0.1:${port}/paper.pdf`
      const gate = gateFor(dir)
      // ① 非白名单（127.0.0.1 不在默认白名单）：连接前拒绝
      await assert.rejects(
        () => fetchPdf(gate, url, join(dir, 'a.pdf'), fsLike, dir),
        (e: unknown) => codeOf(e) === 'SSRF_BLOCKED',
      )
      // ② 白名单但私网地址：SSRF 仍然拒绝（白名单永不绕过公网校验）
      await assert.rejects(
        () => fetchPdf(gate, url, join(dir, 'b.pdf'), fsLike, dir, { allowedHosts: new Set(['127.0.0.1']) }),
        (e: unknown) => codeOf(e) === 'SSRF_BLOCKED',
      )
      // ③ 测试降级（本地靶）→ 正常落盘
      const result = await fetchPdf(gate, url, join(dir, 'c.pdf'), fsLike, dir, {
        allowedHosts: new Set(['127.0.0.1']),
        allowPrivateForTest: true,
      })
      assert.equal(result.bytes, pdfBytes.length)
      assert.equal(result.sha256, expectedHash)
      assert.equal(result.contentType, 'application/pdf')
      const onDisk = await readFile(join(dir, 'c.pdf'))
      assert.deepEqual([...onDisk], [...pdfBytes])
      // 无 tmp 残留
      const { readdir } = await import('node:fs/promises')
      const leftovers = (await readdir(dir)).filter(name => name.includes('.srw-tmp-'))
      assert.deepEqual(leftovers, [])
    })
  })
})

test('pdf：跨源重定向拒绝 + 字节上限中止无残件', async () => {
  const bigChunk = Buffer.alloc(1024, 65)
  await withTemp(async (dir) => {
    // 跨源：8081 → 同 IP 不同端口（不同 origin）
    await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(bigChunk)
    }, async (targetPort) => {
      await withServer((_req, res) => {
        res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/elsewhere.pdf` })
        res.end()
      }, async (redirectPort) => {
        const gate = gateFor(dir)
        const opts = { allowedHosts: new Set(['127.0.0.1']), allowPrivateForTest: true }
        await assert.rejects(
          () => fetchPdf(gate, `http://127.0.0.1:${redirectPort}/a.pdf`, join(dir, 'd.pdf'), fsLike, dir, opts),
          (e: unknown) => codeOf(e) === 'SSRF_BLOCKED' && (e as Error).message.includes('跨源重定向'),
        )
      })
    })
    // 字节上限：16 字节上限 vs 1KiB 内容 → SIZE_LIMIT 且无残件
    await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(bigChunk)
    }, async (port) => {
      const gate = gateFor(dir)
      const opts = { allowedHosts: new Set(['127.0.0.1']), allowPrivateForTest: true, maxBytes: 16 }
      await assert.rejects(
        () => fetchPdf(gate, `http://127.0.0.1:${port}/big.pdf`, join(dir, 'e.pdf'), fsLike, dir, opts),
        (e: unknown) => codeOf(e) === 'SIZE_LIMIT',
      )
      const { readdir } = await import('node:fs/promises')
      const leftovers = (await readdir(dir)).filter(name => name.startsWith('e.pdf'))
      assert.deepEqual(leftovers, [])
    })
  })
})
