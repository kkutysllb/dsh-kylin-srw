/** P0-3 身份迁移 + P0-6 DOI 校验/引用门：旧 title:<sha1>:<year> 键重算、
 * dry-run 默认、apply 备份、可重复执行；同题不同文保留两条；upsert 迁移前
 * 命中旧键不产生新重复；arXiv 自赋 DOI 折叠保留 canonicalDoi。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { LibraryStore, type LitEntry } from '../src/literature/library.ts'
import { LiteratureService } from '../src/literature/service.ts'
import { normalizeTitle } from '../src/literature/identity.ts'
import type { LitCandidate } from '../src/literature/types.ts'

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

function titleKey(title: string): string {
  return createHash('sha1').update(normalizeTitle(title)).digest('hex').slice(0, 16)
}

function entry(over: {
  key: string
  title: string
  year: number
  authors?: string[]
  venue?: string
  status?: LitEntry['status']
  verification?: LitEntry['verification']
}): LitEntry {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    key: over.key,
    identity: { title: over.title, year: over.year },
    source: 'crossref',
    seenIn: ['crossref'],
    authors: over.authors ?? [],
    venue: over.venue ?? '',
    abstract: '',
    status: over.status ?? 'unread',
    addedAt: now,
    updatedAt: now,
    ...(over.verification === undefined ? {} : { verification: over.verification }),
  }
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-migrate-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function writeLibrary(root: string, project: string, entries: readonly LitEntry[]): Promise<void> {
  const dir = join(root, project, 'literature')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'library.json'), JSON.stringify({
    schemaVersion: 1,
    revision: 3,
    entries: Object.fromEntries(entries.map(item => [item.key, item])),
  }, null, 2))
}

async function readLibrary(root: string, project: string): Promise<{ revision: number; entries: Record<string, LitEntry> }> {
  return JSON.parse(await readFile(join(root, project, 'literature', 'library.json'), 'utf8')) as {
    revision: number
    entries: Record<string, LitEntry>
  }
}

test('migrate：旧 title+year 两键 → dry-run 报告、apply 备份并合并；重复执行无变化', async () => {
  await withRoot(async root => {
    const title = 'Attention Is All You Need'
    const hash = titleKey(title)
    await writeLibrary(root, 'proj', [
      entry({ key: `title:${hash}:0`, title, year: 0, authors: ['Ashish Vaswani'] }),
      entry({ key: `title:${hash}:2025`, title, year: 2025, authors: ['Ashish Vaswani'], venue: 'NeurIPS' }),
    ])
    const store = new LibraryStore(root, fakeFs())
    const before = await readFile(join(root, 'proj', 'literature', 'library.json'), 'utf8')

    const dry = await store.migrate('proj')
    assert.equal(dry.dryRun, true)
    assert.equal(dry.applied, false)
    assert.equal(dry.entriesBefore, 2)
    assert.equal(dry.entriesAfter, 1)
    assert.equal(dry.merged, 1)
    assert.equal(dry.renamed, 2)
    assert.equal(await readFile(join(root, 'proj', 'literature', 'library.json'), 'utf8'), before, 'dry-run 不写盘')
    await assert.rejects(() => readFile(join(root, 'proj', 'literature', 'library.json.bak')), /ENOENT/)

    const applied = await store.migrate('proj', { apply: true })
    assert.equal(applied.applied, true)
    assert.ok(applied.backup !== undefined)
    assert.equal(await readFile(applied.backup!, 'utf8'), before, '备份是迁移前原文')
    const doc = await readLibrary(root, 'proj')
    assert.equal(doc.revision, 4)
    assert.deepEqual(Object.keys(doc.entries), [`title:${hash}`])
    assert.equal(doc.entries[`title:${hash}`]?.identity.year, 2025, 'year 治愈取已知最大年')
    assert.deepEqual([...doc.entries[`title:${hash}`]?.authors ?? []], ['Ashish Vaswani'])
    assert.equal(doc.entries[`title:${hash}`]?.key, `title:${hash}`)

    const again = await store.migrate('proj', { apply: true })
    assert.equal(again.applied, false)
    assert.equal(again.renamed, 0)
    assert.equal(again.merged, 0)
    assert.equal((await readLibrary(root, 'proj')).revision, 4, '无变化不递增 revision')
  })
})

test('migrate：同题不同文守卫失败保留两条（冲突计数 + 判别键）', async () => {
  await withRoot(async root => {
    const title = 'Graph Neural Networks: A Review'
    const hash = titleKey(title)
    await writeLibrary(root, 'proj', [
      entry({ key: `title:${hash}:2005`, title, year: 2005, authors: ['Ada Lovelace'], venue: 'Old Journal' }),
      entry({ key: `title:${hash}:2024`, title, year: 2024, authors: ['Grace Hopper'], venue: 'New Journal' }),
    ])
    const store = new LibraryStore(root, fakeFs())
    const report = await store.migrate('proj', { apply: true })
    assert.equal(report.conflicts, 1)
    assert.equal(report.merged, 0)
    const doc = await readLibrary(root, 'proj')
    assert.equal(Object.keys(doc.entries).length, 2)
    const keys = Object.keys(doc.entries).sort()
    assert.equal(keys[0], `title:${hash}`)
    assert.match(keys[1] ?? '', new RegExp(`^title:${hash}:[0-9a-f]{8}$`))
  })
})

test('migrate 前 upsert：匹配用重算 identityKey（旧键命中不产生新重复）', async () => {
  await withRoot(async root => {
    const title = 'Neural Machine Translation'
    const hash = titleKey(title)
    const oldKey = `title:${hash}:2020`
    await writeLibrary(root, 'proj', [
      entry({ key: oldKey, title, year: 2020, authors: ['Ada Lovelace'], venue: 'J' }),
    ])
    const store = new LibraryStore(root, fakeFs())
    const candidate: LitCandidate = {
      source: 'openalex',
      identity: { title, year: 2021 },
      authors: ['Ada Lovelace'],
      venue: 'J',
      abstract: 'new abstract',
    }
    const result = await store.upsert('proj', [candidate])
    assert.equal(result.added, 0, '旧键条目应判重复，不新增')
    const doc = await readLibrary(root, 'proj')
    assert.deepEqual(Object.keys(doc.entries), [oldKey], '回写实际旧键，不产生新键')
    assert.deepEqual([...doc.entries[oldKey]?.seenIn ?? []], ['crossref', 'openalex'], '重复≠丢弃：seenIn 并集')
  })
})

test('P0-3/P0-6：import 保留 canonicalDoi，verification 标 verified/unresolved 且不改变 status', async () => {
  await withRoot(async root => {
    const service = new LiteratureService({
      fs: fakeFs(),
      offlineMode: () => false,
      rootDir: () => root,
      verifyDoiResolver: async doi => {
        if (doi === '10.1000/bad') throw Object.assign(new Error('DOI 无法解析（404）'), { code: 'UNRESOLVED' })
        return { source: 'crossref', identity: { doi, title: 'Verified', year: 2024 }, authors: ['A'], venue: 'J', abstract: '' }
      },
      retractionCheck: async () => 'ok',
    })
    const imported = await service.importEntries('proj', [
      {
        source: 'arxiv',
        identity: { doi: '10.48550/arxiv.2401.12345', title: 'Canonical DOI Paper', year: 2024 },
        authors: ['A'],
        venue: 'arXiv',
        abstract: '',
      },
      {
        source: 'crossref',
        identity: { doi: '10.1000/good', title: 'Good DOI', year: 2024 },
        authors: ['A'],
        venue: 'J',
        abstract: '',
      },
      {
        source: 'crossref',
        identity: { doi: '10.1000/bad', title: 'Bad DOI', year: 2024 },
        authors: ['B'],
        venue: 'J',
        abstract: '',
      },
    ])
    assert.equal(imported.added, 3)
    assert.deepEqual(imported.verified, ['10.1000/good'])
    assert.deepEqual(imported.unresolved, ['10.1000/bad'])
    const entries = await service.lib('proj')
    const canonical = entries.find(item => item.key === 'arxiv:2401.12345')
    assert.equal(canonical?.identity.canonicalDoi, '10.48550/arxiv.2401.12345')
    const good = entries.find(item => item.key === 'doi:10.1000/good')
    assert.equal(good?.verification?.status, 'verified')
    assert.equal(good?.status, 'unread', 'verification 不改变 status')
    const bad = entries.find(item => item.key === 'doi:10.1000/bad')
    assert.equal(bad?.verification?.status, 'unresolved')
    assert.equal(bad?.status, 'unread')

    const gate = await service.citeGate('proj')
    assert.deepEqual([...gate.ok].sort(), ['arxiv:2401.12345', 'doi:10.1000/good'])
    assert.deepEqual([...gate.warnings], ['doi:10.1000/bad'])
    assert.deepEqual([...gate.blocked], [])
  })
})

test('P0-6：verifyDoi 返回元数据与撤稿状态；citeGate 撤稿硬阻断', async () => {
  await withRoot(async root => {
    const service = new LiteratureService({
      fs: fakeFs(),
      offlineMode: () => false,
      rootDir: () => root,
      verifyDoiResolver: async doi => ({
        source: 'crossref',
        identity: { doi, title: 'Retracted Paper', year: 2020 },
        authors: ['A'],
        venue: 'J',
        abstract: '',
      }),
      retractionCheck: async () => 'retracted',
    })
    const verified = await service.verifyDoi('https://doi.org/10.1000/retracted')
    assert.equal(verified.doi, '10.1000/retracted', 'DOI 前缀归一')
    assert.equal(verified.resolved, true)
    assert.equal(verified.retracted, true)
    assert.equal(verified.retractionState, 'retracted')
    assert.equal(verified.metadata.identity.title, 'Retracted Paper')

    await service.importEntries('proj', [{
      source: 'crossref',
      identity: { doi: '10.1000/retracted', title: 'Retracted Paper', year: 2020 },
      authors: ['A'],
      venue: 'J',
      abstract: '',
    }])
    const gate = await service.citeGate('proj')
    assert.deepEqual([...gate.blocked], ['doi:10.1000/retracted'])
    assert.deepEqual([...gate.ok], [])
    assert.equal(gate.reasons['doi:10.1000/retracted'], 'RETRACTED')
    const bib = await service.bibtex('proj')
    assert.deepEqual([...bib.skippedRetracted], ['doi:10.1000/retracted'], 'bibtex 硬门跳过撤稿并返回 skippedRetracted')
  })
})
