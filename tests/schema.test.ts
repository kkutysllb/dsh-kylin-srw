import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SLUG_RE, validateProjectMeta } from '../src/core/schema.ts'
import { DEFAULT_ROOT, readRootConfig, writeRootConfig } from '../src/workspace/root.ts'

test('validateProjectMeta：合法对象零错误', () => {
  const meta = {
    schemaVersion: 1,
    slug: 'transformer-survey',
    title: 'Transformer 综述',
    stage: 'idea',
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  }
  assert.deepEqual(validateProjectMeta(meta), [])
})

test('validateProjectMeta：坏 slug / 坏 stage / 非对象 / 坏时间各自报错', () => {
  assert.ok(validateProjectMeta({
    schemaVersion: 1, slug: '-bad', title: 't', stage: 'idea',
    createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z',
  }).some(e => e.includes('slug')))
  assert.ok(validateProjectMeta({
    schemaVersion: 1, slug: 'ok', title: 't', stage: 'hypothesis',
    createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z',
  }).some(e => e.includes('stage')))
  assert.deepEqual(validateProjectMeta('nope'), ['project.json 必须是对象'])
  assert.ok(validateProjectMeta({
    schemaVersion: 1, slug: 'ok', title: 't', stage: 'idea',
    createdAt: 'yesterday', updatedAt: '2026-10-04T00:00:00Z',
  }).some(e => e.includes('createdAt')))
  // title 必填与 200 上限
  assert.ok(validateProjectMeta({
    schemaVersion: 1, slug: 'ok', title: '', stage: 'idea',
    createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z',
  }).some(e => e.includes('title')))
  assert.ok(validateProjectMeta({
    schemaVersion: 1, slug: 'ok', title: 'x'.repeat(201), stage: 'idea',
    createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z',
  }).some(e => e.includes('title')))
})

test('SLUG_RE：小写数字连字符，1-64 位，首字非连字符', () => {
  assert.ok(SLUG_RE.test('a'))
  assert.ok(SLUG_RE.test('transformer-survey-2'))
  assert.ok(SLUG_RE.test('a'.repeat(64)))
  assert.ok(!SLUG_RE.test('-lead'))
  assert.ok(!SLUG_RE.test('Has-Caps'))
  assert.ok(!SLUG_RE.test('a'.repeat(65)))
  assert.ok(!SLUG_RE.test(''))
})

test('readRootConfig：缺文件回落默认；坏 JSON/坏字段逐项钳制', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srw-root-'))
  try {
    assert.deepEqual(await readRootConfig(dir), DEFAULT_ROOT)
    await mkdir(join(dir, '.srw'), { recursive: true })
    await writeFile(join(dir, '.srw', 'root.json'), '{broken')
    assert.deepEqual(await readRootConfig(dir), DEFAULT_ROOT)
    await writeFile(join(dir, '.srw', 'root.json'), JSON.stringify({
      schemaVersion: 9, defaultLangPair: 'xx', allowIllustrative: 'yes', offlineMode: true,
    }))
    assert.deepEqual(await readRootConfig(dir), {
      schemaVersion: 1, defaultLangPair: 'en-zh', allowIllustrative: false, offlineMode: true,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeRootConfig：合并写入、原子落盘、roundtrip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srw-root-'))
  try {
    const merged = await writeRootConfig(dir, { offlineMode: true, defaultLangPair: 'zh-en' })
    assert.deepEqual(merged, {
      schemaVersion: 1, defaultLangPair: 'zh-en', allowIllustrative: false, offlineMode: true,
    })
    assert.deepEqual(await readRootConfig(dir), merged)
    // 二次写入保留前次字段
    const again = await writeRootConfig(dir, { allowIllustrative: true })
    assert.equal(again.offlineMode, true)
    assert.equal(again.defaultLangPair, 'zh-en')
    // 无 tmp 残留
    const leftovers = (await readdir(join(dir, '.srw'))).filter(name => name.includes('.srw-tmp-'))
    assert.deepEqual(leftovers, [])
    // 落盘为可读 JSON（2 空格缩进 + 结尾换行）
    const text = await readFile(join(dir, '.srw', 'root.json'), 'utf8')
    assert.ok(text.endsWith('\n'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
