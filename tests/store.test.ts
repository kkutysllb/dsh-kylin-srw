/** Task 1.4：srw_index spec 形状 + service 与 fake domain 的全局/缓存联动。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SrwIndexSpec, ProjectCacheEntry, assertValidDomainSpec } from '../src/store.ts'
import { SrwService } from '../src/service.ts'

const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

test('store：spec 形状——name/version/layout/global 初始值/表 schema', () => {
  assert.equal(SrwIndexSpec.name, 'srw_index')
  assert.match(SrwIndexSpec.name, UNIT_NAME_RE)
  assert.equal(SrwIndexSpec.version, 1)
  assert.equal(SrwIndexSpec.layout, 'single')
  assertValidDomainSpec(SrwIndexSpec) // 不抛
  // global 初始值；null 必须被拒（宿主 round-trip 哨兵）
  assert.deepEqual(SrwIndexSpec.global.initial, { rootDir: '', activeProject: '' })
  assert.equal(SrwIndexSpec.global.schema.safeParse(null).success, false)
  assert.deepEqual(SrwIndexSpec.global.schema.parse({}), { rootDir: '', activeProject: '' })
  // 表 schema 接受合法记录、拒绝缺字段
  const ok = ProjectCacheEntry.safeParse({ slug: 'a', title: 'T', stage: 'idea', updatedAt: '2026-10-04T00:00:00Z' })
  assert.equal(ok.success, true)
  assert.equal(ProjectCacheEntry.safeParse({ slug: 'a' }).success, false)
})

test('store：setRoot 走 contains 自检 + root.json 落盘 + storage 全局', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-store-'))
  try {
    // fake ctx.fs（canonical 语义）+ fake storageDomain
    const nodePath = await import('node:path')
    const fsLike = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = nodePath.resolve(parent.key)
        const c = nodePath.resolve(child.key)
        return c === p || c.startsWith(`${p}/`)
      },
    }
    let globalValue: { rootDir: string; activeProject: string } = { rootDir: '', activeProject: '' }
    const cache = new Map<string, unknown>()
    const storageDomain = {
      open: async () => ({
        global: {
          get: () => globalValue,
          set: async (value: typeof globalValue) => { globalValue = value },
        },
        table: (_name: string) => ({
          get: (key: string) => cache.get(key),
          entries: () => cache.entries(),
          put: async (key: string, value: unknown) => { cache.set(key, value) },
          delete: async (key: string) => cache.delete(key) !== undefined,
        }),
        close: async () => {},
      }),
    }
    const service = await SrwService.open({ fs: fsLike, storageDomain }, {})
    // 初始：global 空 → currentRoot undefined
    assert.equal(service.currentRoot(), undefined)
    assert.equal(service.indexGlobal().activeProject, '')
    // setRoot：合法目录
    await service.setRoot(root)
    assert.equal(service.currentRoot(), root)
    assert.deepEqual(service.indexGlobal(), { rootDir: root, activeProject: '' })
    // root.json 落盘（可写性证明）
    const onDisk = JSON.parse(await readFile(join(root, '.srw', 'root.json'), 'utf8'))
    assert.equal(onDisk.schemaVersion, 1)
    // 越界路径拒绝（目录不存在 → resolve 自检失败）
    await assert.rejects(() => service.setRoot('/nonexistent-srw-root-xyz/deeper'))
    // openProject：activeProject 持久 + 缓存投影
    await service.workspace.create({ slug: 'proj-a', title: 'A' })
    const meta = await service.openProject('proj-a')
    assert.equal((meta as { slug: string }).slug, 'proj-a')
    assert.equal(service.indexGlobal().activeProject, 'proj-a')
    assert.deepEqual(cache.get('proj-a'), { slug: 'proj-a', title: 'A', stage: 'idea', updatedAt: (meta as { updatedAt: string }).updatedAt })
    // dispose 关域（二次 dispose 安全）
    await service.dispose()
    await service.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store：storageDomain 打开失败 → 降级不阻断激活', async () => {
  // open 抛错（介质坏）
  const service = await SrwService.open({ storageDomain: { open: async () => { throw new Error('malformed-medium') } } }, {})
  assert.equal(service.currentRoot(), undefined) // 无 index 无 config → undefined
  // setRoot 在降级态：内存收编仍工作（无全局持久）
  const dir = await mkdtemp(join(tmpdir(), 'srw-store2-'))
  try {
    const nodePath = await import('node:path')
    const fsLike = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: () => true,
    }
    const degraded = await SrwService.open({ fs: fsLike }, {})
    await degraded.setRoot(dir)
    assert.equal(degraded.currentRoot(), dir)
    await degraded.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  void service
})
