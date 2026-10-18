/** P0-4 全文获取：Unpaywall fixture + 本地 http 靶机（不连真网）。
 * 覆盖 OA PDF 成功/证据落盘、缺邮箱 INVALID、未确认域 HOST_NOT_ALLOWED/
 * allowHost 写回、HTML→CONTENT_NOT_PDF、付费墙→PAYWALLED、404→UNRESOLVED、
 * 直链（无邮箱）与 SSRF 公网校验。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { fetchFulltext, keySlug, normalizeDoi, parseUnpaywall, unpaywallUrlFor, type FulltextDeps, type FulltextEntry } from '../src/literature/fulltext.ts'
import { RateGate } from '../src/literature/rate-gate.ts'
import { readRootConfig, writeRootConfig } from '../src/workspace/root.ts'
import { ServiceError } from '../src/service.ts'

function fakeFs() {
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = pathResolve(parent.key)
      const c = pathResolve(child.key)
      return c === p || c.startsWith(`${p}/`)
    },
  }
}

const PDF_BYTES = Buffer.from('%PDF-1.4 fake open access pdf for srw fulltext test')
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex')

const ENTRY: FulltextEntry = {
  key: 'doi:10.1000/fulltext',
  identity: { doi: '10.1000/fulltext', title: 'Full Text Paper', year: 2024 },
  authors: ['Ada Lovelace'],
  venue: 'Journal of Tests',
  abstract: '',
}

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? ''
}

async function withServer(
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  try {
    await run((server.address() as AddressInfo).port)
  } finally {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  }
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-fulltext-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function deps(root: string, over: Partial<FulltextDeps> = {}): FulltextDeps {
  return {
    fs: fakeFs(),
    rootDir: root,
    gate: new RateGate({ ledgerPath: join(root, 'ledger.json'), sleepFn: async () => {} }),
    resolveAddresses: async () => ['127.0.0.1'],
    allowPrivateForTest: true,
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    ...over,
  }
}

function unpaywallPdf(port: number): unknown {
  return {
    is_oa: true,
    oa_status: 'gold',
    best_oa_location: { url_for_pdf: `http://127.0.0.1:${port}/paper.pdf`, host_type: 'publisher', license: 'cc-by' },
  }
}

test('fulltext：Unpaywall OA → 域确认 → 下载 → 魔数门 → PDF + 证据落盘', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/pdf' })
    res.end(PDF_BYTES)
  }, async port => {
    await withRoot(async root => {
      await writeRootConfig(root, { unpaywallEmail: 'tester@example.com' })
      const result = await fetchFulltext(deps(root, {
        confirmedHosts: ['127.0.0.1'],
        unpaywallEmail: 'tester@example.com',
        fetchUnpaywallJson: async url => {
          assert.equal(url.hostname, 'api.unpaywall.org')
          assert.equal(url.searchParams.get('email'), 'tester@example.com')
          return unpaywallPdf(port)
        },
      }), 'proj', ENTRY)
      assert.equal(result.ok, true)
      assert.equal(result.file, join('proj', 'literature', 'pdf', 'lovelace2024-full.pdf'))
      assert.equal(await readFile(join(root, result.file), 'utf8'), PDF_BYTES.toString('latin1'))
      assert.equal(result.sha256, PDF_SHA)
      assert.equal(result.bytes, PDF_BYTES.length)
      assert.equal(result.source, 'unpaywall')
      assert.equal(result.host, '127.0.0.1')
      assert.equal(result.contentType, 'application/pdf')
      assert.equal(result.paperKey, 'doi-10-1000-fulltext')
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>
      assert.deepEqual(evidence, {
        finalUrl: `http://127.0.0.1:${port}/paper.pdf`,
        host: '127.0.0.1',
        sha256: PDF_SHA,
        bytes: PDF_BYTES.length,
        retrievedAt: '2026-01-02T03:04:05.000Z',
        source: 'unpaywall',
      })
    })
  })
})

test('fulltext：缺 Unpaywall 邮箱 → INVALID（无直链时不给网络请求）', async () => {
  await withRoot(async root => {
    let fetched = 0
    await assert.rejects(
      () => fetchFulltext(deps(root, {
        fetchUnpaywallJson: async () => { fetched += 1; return unpaywallPdf(1) },
      }), 'proj', ENTRY),
      (e: unknown) => codeOf(e) === 'INVALID' && (e as Error).message.includes('unpaywallEmail'),
    )
    assert.equal(fetched, 0)
  })
})

test('fulltext：未确认域 HOST_NOT_ALLOWED → allowHost 写回 confirmedHosts 后成功', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/pdf' })
    res.end(PDF_BYTES)
  }, async port => {
    await withRoot(async root => {
      await writeRootConfig(root, { unpaywallEmail: 'tester@example.com' })
      const base = {
        unpaywallEmail: 'tester@example.com',
        fetchUnpaywallJson: async () => unpaywallPdf(port),
      }
      await assert.rejects(
        () => fetchFulltext(deps(root, base), 'proj', ENTRY),
        (e: unknown) => codeOf(e) === 'HOST_NOT_ALLOWED' && (e as Error).message.includes('allowHost'),
      )
      const result = await fetchFulltext(deps(root, base), 'proj', ENTRY, { allowHost: '127.0.0.1' })
      assert.equal(result.ok, true)
      const config = await readRootConfig(root)
      assert.deepEqual([...config.fulltext?.confirmedHosts ?? []], ['127.0.0.1'], 'allowHost 已写回 root.json')
    })
  })
})

test('fulltext：HTML 200 → CONTENT_NOT_PDF（残件删除）；付费墙 → PAYWALLED；Unpaywall 404 → UNRESOLVED', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><body>not a pdf</body></html>')
  }, async port => {
    await withRoot(async root => {
      const htmlDeps = deps(root, {
        confirmedHosts: ['127.0.0.1'],
        unpaywallEmail: 'tester@example.com',
        fetchUnpaywallJson: async () => unpaywallPdf(port),
      })
      await assert.rejects(
        () => fetchFulltext(htmlDeps, 'proj', ENTRY),
        (e: unknown) => codeOf(e) === 'CONTENT_NOT_PDF',
      )
      const { readdir } = await import('node:fs/promises')
      const pdfDir = join(root, 'proj', 'literature', 'pdf')
      const leftovers = await readdir(pdfDir).catch(() => [])
      assert.deepEqual(leftovers, [], '非 PDF 残件必须删除')

      await assert.rejects(
        () => fetchFulltext(deps(root, {
          unpaywallEmail: 'tester@example.com',
          fetchUnpaywallJson: async () => ({ is_oa: false, oa_status: 'closed', best_oa_location: null }),
        }), 'proj', ENTRY),
        (e: unknown) => codeOf(e) === 'PAYWALLED',
      )
      await assert.rejects(
        () => fetchFulltext(deps(root, {
          unpaywallEmail: 'tester@example.com',
          fetchUnpaywallJson: async () => {
            throw new ServiceError('UPSTREAM', 'api.unpaywall.org 返回 HTTP 404')
          },
        }), 'proj', ENTRY),
        (e: unknown) => codeOf(e) === 'UNRESOLVED',
      )
    })
  })
})

test('fulltext：条目直链（无邮箱）→ publisher/direct；公网校验仍生效（SSRF_BLOCKED）', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/pdf' })
    res.end(PDF_BYTES)
  }, async port => {
    await withRoot(async root => {
      const directEntry: FulltextEntry = {
        ...ENTRY,
        oaUrl: `http://127.0.0.1:${port}/oa.pdf`,
      }
      const result = await fetchFulltext(deps(root, { confirmedHosts: ['127.0.0.1'] }), 'proj', directEntry)
      assert.equal(result.ok, true)
      assert.equal(result.source, 'publisher')
      assert.equal(result.contentType, 'application/pdf')
      // 生产只允许 https：测试降级关闭时 http 直链被域策略拒绝
      await assert.rejects(
        () => fetchFulltext(deps(root, {
          confirmedHosts: ['127.0.0.1'],
          allowPrivateForTest: false,
          resolveAddresses: async () => ['127.0.0.1'],
        }), 'proj', directEntry),
        (e: unknown) => codeOf(e) === 'HOST_NOT_ALLOWED',
      )
      // SSRF 层错误码原样透传（下载端口抛 SSRF_BLOCKED 时不得被吞成 UPSTREAM）
      await assert.rejects(
        () => fetchFulltext(deps(root, {
          confirmedHosts: ['127.0.0.1'],
          download: async () => { throw new ServiceError('SSRF_BLOCKED', '域名解析到非公网地址') },
        }), 'proj', directEntry),
        (e: unknown) => codeOf(e) === 'SSRF_BLOCKED',
      )
    })
  })
})

test('fulltext：URL/解析纯函数——DOI 归一、Unpaywall URL、keySlug、位置优先级', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1000/ABC'), '10.1000/abc')
  assert.throws(() => normalizeDoi('not-a-doi'), (e: unknown) => codeOf(e) === 'INVALID')
  const url = unpaywallUrlFor('10.1000/abc', 'a@b.c')
  assert.equal(url.toString(), 'https://api.unpaywall.org/v2/10.1000/abc?email=a%40b.c')
  assert.equal(keySlug('doi:10.1038/nature12373'), 'doi-10-1038-nature12373')
  assert.equal(keySlug('title:deadbeefdeadbeef'), 'title-deadbeefdeadbeef')
  const parsed = parseUnpaywall({
    is_oa: true,
    best_oa_location: { pdf_url: 'https://repo.test/a.pdf', url: 'https://repo.test/landing' },
    oa_locations: [
      { url_for_pdf: 'https://repo.test/a.pdf' },
      { url: 'https://repo.test/other.pdf' },
    ],
  })
  assert.equal(parsed.isOa, true)
  assert.deepEqual(parsed.locations.map(item => item.url), [
    'https://repo.test/a.pdf',
    'https://repo.test/landing',
    'https://repo.test/other.pdf',
  ])
  assert.deepEqual(parseUnpaywall({ is_oa: false, best_oa_location: null }), { isOa: false, locations: [] })
  assert.deepEqual(
    parseUnpaywall({ is_oa: false, best_oa_location: { pdf_url: 'https://publisher.test/paywalled.pdf' } }),
    { isOa: false, locations: [] },
    'closed 时残留 location 也不得当 OA（不绕付费墙）',
  )
})
