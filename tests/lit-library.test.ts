/** Task 2.6：library.json 库存储（revision/STALE/原子写/护栏）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodePath from 'node:path'
import { LibraryStore } from '../src/literature/library.ts'
import type { LitCandidate } from '../src/literature/types.ts'

const fsLike = {
  resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
  contains: (parent: { key: string }, child: { key: string }) => {
    const p = nodePath.resolve(parent.key)
    const c = nodePath.resolve(child.key)
    return c === p || c.startsWith(`${p}/`)
  },
}

function candidate(slugTitle: string, doi: string): LitCandidate {
  return {
    source: 'arxiv',
    identity: { doi, title: slugTitle, year: 2024 },
    authors: ['A'],
    venue: 'V',
    abstract: 'abs',
  }
}

async function withStore(run: (root: string, store: LibraryStore) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-lib-'))
  try {
    await run(root, new LibraryStore(root, fsLike))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('library：upsert 幂等（同批重复 0 新增）+ 状态与 addedAt 保留', async () => {
  await withStore(async (root, store) => {
    const first = await store.upsert('proj', [candidate('Paper One', '10.1/one'), candidate('Paper Two', '10.1/two')])
    assert.equal(first.added, 2)
    assert.equal(first.duplicates, 0)
    // 同批重复入库：0 新增、2 重复
    const second = await store.upsert('proj', [
      candidate('Paper One', '10.1/one'),
      candidate('Paper Two', '10.1/two'),
      candidate('Paper Three', '10.1/three'),
    ])
    assert.equal(second.added, 1)
    assert.equal(second.duplicates, 2)
    assert.equal(Object.keys(second.doc.entries).length, 3)
    // revision 递增
    assert.ok(second.doc.revision > first.doc.revision)
    // updateEntry：状态迁移在再入库后保留
    const key = Object.keys(second.doc.entries)[0]!
    await store.updateEntry('proj', key, entry => ({ ...entry, status: 'has-pdf' }))
    const after = await store.upsert('proj', [candidate('Paper One', '10.1/one')])
    assert.equal(after.doc.entries[key]?.status, 'has-pdf')
  })
})

test('library：STALE 乐观并发拒绝 + 坏 JSON 抛 INVALID + 坏 slug 拒', async () => {
  await withStore(async (root, store) => {
    const doc = await store.load('proj')
    await store.upsert('proj', [candidate('P', '10.1/p')])
    // 用旧 revision 写 → STALE
    await assert.rejects(
      () => store.save('proj', doc, doc.revision),
      (e: unknown) => (e as { code?: string }).code === 'STALE',
    )
    // 坏 slug
    assert.throws(() => store.load('-bad'), (e: unknown) => (e as { code?: string }).code === 'INVALID')
    // 坏 JSON → INVALID（不清空）
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(join(root, 'broken', 'literature'), { recursive: true })
    await writeFile(join(root, 'broken', 'literature', 'library.json'), '{broken')
    await assert.rejects(() => store.load('broken'), (e: unknown) => (e as { code?: string }).code === 'INVALID')
    // 护栏：越界路径 fail-closed
    const unguarded = new LibraryStore(root, undefined)
    await assert.rejects(() => unguarded.load('proj'), (e: unknown) => e instanceof Error && e.message.includes('fail-closed'))
  })
})
