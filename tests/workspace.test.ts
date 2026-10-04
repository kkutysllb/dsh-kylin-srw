/** Task 1.3：WorkspaceStore CRUD 往返（tmp 真实 fs）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore } from '../src/workspace/project.ts'
import { ServiceError } from '../src/service.ts'

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? ''
}

async function withTempRoot(run: (root: string, store: WorkspaceStore) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-ws-'))
  try {
    await run(root, new WorkspaceStore(() => root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('workspace：create→list→open→rename→moveSlug→remove 往返', async () => {
  await withTempRoot(async (root, store) => {
    const meta = await store.create({ slug: 'survey-2026', title: '综述 2026', field: 'nlp' })
    assert.equal(meta.stage, 'idea')
    assert.equal(meta.field, 'nlp')
    // 子目录骨架
    for (const sub of ['literature/pdf', 'paper', 'experiments', 'materials', '.srw']) {
      const { stat } = await import('node:fs/promises')
      assert.ok((await stat(join(root, 'survey-2026', sub))).isDirectory(), sub)
    }
    // 重名 CONFLICT
    await assert.rejects(() => store.create({ slug: 'survey-2026', title: 'x' }),
      (e: unknown) => codeOf(e) === 'CONFLICT')
    // list 可见
    assert.equal((await store.list()).length, 1)
    // open
    assert.equal((await store.open('survey-2026')).title, '综述 2026')
    // rename：title 变、updatedAt 变、createdAt 不变
    await new Promise(resolve => setTimeout(resolve, 5))
    const renamed = await store.rename('survey-2026', '综述 2026（改）')
    assert.equal(renamed.title, '综述 2026（改）')
    assert.notEqual(renamed.updatedAt, meta.updatedAt)
    assert.equal(renamed.createdAt, meta.createdAt)
    // moveSlug：目录随迁 + slug 字段改写
    const moved = await store.moveSlug('survey-2026', 'survey-2027')
    assert.equal(moved.slug, 'survey-2027')
    assert.equal((await store.list())[0]?.slug, 'survey-2027')
    // remove：真删
    await store.remove('survey-2027')
    assert.equal((await store.list()).length, 0)
    await assert.rejects(() => store.open('survey-2027'), (e: unknown) => codeOf(e) === 'NOT_FOUND')
  })
})

test('workspace：坏 slug / 坏 title 拒；非项目目录跳过；无 root 拒', async () => {
  await withTempRoot(async (root, store) => {
    await assert.rejects(() => store.create({ slug: '-bad', title: 'x' }), (e: unknown) => codeOf(e) === 'INVALID')
    await assert.rejects(() => store.create({ slug: 'ok', title: '' }), (e: unknown) => codeOf(e) === 'INVALID')
    // 手工目录（无 project.json）与坏 project.json 都不算项目
    await mkdir(join(root, 'manual-dir'), { recursive: true })
    await mkdir(join(root, 'broken', '.srw'), { recursive: true })
    await writeFile(join(root, 'broken', '.srw', 'project.json'), 'not json')
    await mkdir(join(root, 'badstage', '.srw'), { recursive: true })
    await writeFile(join(root, 'badstage', '.srw', 'project.json'), JSON.stringify({
      schemaVersion: 1, slug: 'badstage', title: 't', stage: 'nope',
      createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z',
    }))
    assert.deepEqual(await store.list(), [])
    // 无 root（未设置）：list 空、create 拒
    const rootless = new WorkspaceStore(() => undefined)
    assert.deepEqual(await rootless.list(), [])
    await assert.rejects(() => rootless.create({ slug: 'ok', title: 'x' }), (e: unknown) => codeOf(e) === 'NO_ROOT')
    // remove 不存在：ENOENT 透传（fail loud，force:false）
    await assert.rejects(() => store.remove('ghost'))
  })
})
