/** 快照与回滚（Task 5.6）：编译**成功**后留档（main.tex + sections/ +
 * refs.bib + build PDF）；manifest 记 sha256——restore 回读比对，不一致
 * 报 CORRUPT（不许静默恢复脏数据）。 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { ServiceError } from '../service.ts'

export type SnapshotKind = 'compile' | 'manual' | 'submission' | 'revision'

export interface SnapshotManifest {
  readonly schemaVersion: 1
  readonly createdAt: string
  readonly engine?: string
  readonly compileMs?: number
  /** 8.1 起可选：留档来源（默认 compile）。outlineHash/venueHash/pdfSha 不另设——
   * files 里 state/outline.json、state/venue.json、build/main.pdf 已带哈希，重复会漂移。 */
  readonly kind?: SnapshotKind
  readonly label?: string
  readonly note?: string
  /** 项目级 materials/manifest.json 的 sha256（不入快照本体，只记哈希）；
   * restore 时与现状比对 → materialDrift 提示（不阻断）。 */
  readonly materialsHash?: string
  readonly files: Readonly<Record<string, string>>
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 从 paper/ 收集要留档的文件（缺 build PDF 允许——留档编译成功时刻的
 * 源集合；PDF 存在才带走）。 */
async function collectFiles(paperDir: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {}
  const main = await readFile(join(paperDir, 'main.tex')).catch(() => undefined)
  if (main !== undefined) files['main.tex'] = main
  const bib = await readFile(join(paperDir, 'refs.bib')).catch(() => undefined)
  if (bib !== undefined) files['refs.bib'] = bib
  const sectionsDir = join(paperDir, 'sections')
  try {
    for (const name of await readdir(sectionsDir)) {
      if (!name.endsWith('.tex')) continue
      files[`sections/${name}`] = await readFile(join(sectionsDir, name))
    }
  } catch { /* 无 sections 目录 → 只留 main */ }
  const pdf = await readFile(join(paperDir, 'build', 'main.pdf')).catch(() => undefined)
  if (pdf !== undefined) files['build/main.pdf'] = pdf
  // 状态文件也进快照：只回滚 tex 而不回滚 outline/venue 会造成「正文与大纲不一致」。
  // 仅当 paperDir 确实是项目下的 paper/（直接对任意临时目录做快照的单测不要误读 /tmp/.srw）。
  if (basename(paperDir) === 'paper') {
    const projectDir = dirname(paperDir)
    for (const name of ['outline.json', 'venue.json'] as const) {
      const state = await readFile(join(projectDir, '.srw', name)).catch(() => undefined)
      if (state !== undefined) files[`state/${name}`] = state
    }
  }
  return files
}

export async function createSnapshot(paperDir: string, options: { engine?: string; compileMs?: number; kind?: SnapshotKind; note?: string } = {}): Promise<{ id: string; files: number; bytes: number }> {
  const files = await collectFiles(paperDir)
  if (files['main.tex'] === undefined) {
    throw new ServiceError('NOT_FOUND', 'paper/main.tex 不存在——先骨架生成再编译/留档')
  }
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  // materials manifest 只记哈希不复制（响应信/投稿包用它判漂移）；仅真项目域（paper/）生效。
  const materialsHash = basename(paperDir) === 'paper'
    ? await readFile(join(dirname(paperDir), 'materials', 'manifest.json')).then(data => sha256(data)).catch(() => undefined)
    : undefined
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: options.kind ?? 'compile',
    ...(options.engine !== undefined ? { engine: options.engine } : {}),
    ...(options.compileMs !== undefined ? { compileMs: options.compileMs } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
    ...(materialsHash !== undefined ? { materialsHash } : {}),
    files: Object.fromEntries(Object.entries(files).map(([path, data]) => [path, sha256(data)])),
  }
  const snapshotDir = join(paperDir, 'snapshots', id)
  await mkdir(snapshotDir, { recursive: true })
  let bytes = 0
  for (const [path, data] of Object.entries(files)) {
    const target = join(snapshotDir, path)
    await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true })
    await writeFile(target, data)
    bytes += data.length
  }
  await writeFile(join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { id, files: Object.keys(files).length, bytes }
}

export interface SnapshotInfo {
  readonly id: string
  readonly createdAt: string
  readonly engine?: string
  readonly kind?: SnapshotKind
  readonly label?: string
  readonly note?: string
  readonly materialsHash?: string
  readonly files: number
}

export async function listSnapshots(paperDir: string): Promise<readonly SnapshotInfo[]> {
  const entries = await readdir(join(paperDir, 'snapshots')).catch(() => [])
  const infos: SnapshotInfo[] = []
  for (const id of entries) {
    const raw = await readFile(join(paperDir, 'snapshots', id, 'manifest.json'), 'utf8').catch(() => undefined)
    if (raw === undefined) continue
    try {
      const manifest = JSON.parse(raw) as SnapshotManifest
      infos.push({
        id,
        createdAt: manifest.createdAt,
        ...(manifest.engine !== undefined ? { engine: manifest.engine } : {}),
        ...(manifest.kind !== undefined ? { kind: manifest.kind } : {}),
        ...(manifest.label !== undefined ? { label: manifest.label } : {}),
        ...(manifest.note !== undefined ? { note: manifest.note } : {}),
        ...(manifest.materialsHash !== undefined ? { materialsHash: manifest.materialsHash } : {}),
        files: Object.keys(manifest.files).length,
      })
    } catch { /* 坏 manifest 跳过 */ }
  }
  return infos.sort((a, b) => b.id.localeCompare(a.id))
}

/** 打标签（8.1）：给既有快照写 label/note——manifest 是普通 JSON，直接改写后
 * 落回（不复制快照本体）。label 必填 ≤80 字符，note ≤500。 */
export async function tagSnapshot(paperDir: string, id: string, tag: { readonly label: string; readonly note?: string }): Promise<SnapshotInfo> {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw new ServiceError('INVALID', `快照 id 非法：${JSON.stringify(id)}`)
  }
  const label = tag.label.trim()
  if (label === '' || label.length > 80) {
    throw new ServiceError('INVALID', `label 必填且 ≤80 字符：${JSON.stringify(tag.label)}`)
  }
  if (tag.note !== undefined && tag.note.length > 500) {
    throw new ServiceError('INVALID', 'note ≤500 字符')
  }
  const manifestPath = join(paperDir, 'snapshots', id, 'manifest.json')
  const raw = await readFile(manifestPath, 'utf8').catch(() => {
    throw new ServiceError('NOT_FOUND', `快照不存在：${id}`)
  })
  const manifest = JSON.parse(raw) as SnapshotManifest
  const next: SnapshotManifest = { ...manifest, label, ...(tag.note !== undefined ? { note: tag.note } : {}) }
  await writeFile(manifestPath, JSON.stringify(next, null, 2) + '\n')
  return {
    id,
    createdAt: manifest.createdAt,
    ...(manifest.engine !== undefined ? { engine: manifest.engine } : {}),
    ...(manifest.kind !== undefined ? { kind: manifest.kind } : {}),
    label,
    ...(tag.note !== undefined ? { note: tag.note } : {}),
    ...(manifest.materialsHash !== undefined ? { materialsHash: manifest.materialsHash } : {}),
    files: Object.keys(manifest.files).length,
  }
}

/** 快照允许回滚的路径白名单：manifest 是磁盘上的普通 JSON，可能被手改/注入，
 * 只认这些形状，任何 ../、绝对路径、未知文件一律 FORBIDDEN（不是静默跳过）。 */
export function isSnapshotPathAllowed(path: string): boolean {
  if (path === 'main.tex' || path === 'refs.bib' || path === 'build/main.pdf') return true
  if (path === 'state/outline.json' || path === 'state/venue.json') return true
  return /^sections\/[A-Za-z0-9._-]+\.tex$/.test(path)
}

export interface RestoreSnapshotOptions {
  /** 宿主 containment 护栏（服务层传入）；直接调用 snapshot 模块的测试可省。 */
  readonly guard?: (rel: string) => Promise<void>
}

/** 回滚：逐文件哈希比对 manifest；覆盖当前 paper/（state/* 写回项目 .srw/）。
 * 返回恢复的文件清单；快照带 materialsHash 时附 materialDrift（现状 materials
 * manifest 与留档不一致/丢失 → true，仅提示不阻断——漂移可能是正常新素材）。 */
export async function restoreSnapshot(paperDir: string, id: string, options: RestoreSnapshotOptions = {}): Promise<{ restored: readonly string[]; materialDrift?: boolean }> {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw new ServiceError('INVALID', `快照 id 非法：${JSON.stringify(id)}`)
  }
  const snapshotDir = join(paperDir, 'snapshots', id)
  const raw = await readFile(join(snapshotDir, 'manifest.json'), 'utf8').catch(() => {
    throw new ServiceError('NOT_FOUND', `快照不存在：${id}`)
  })
  const manifest = JSON.parse(raw) as SnapshotManifest
  const projectDir = dirname(paperDir)
  const restored: string[] = []
  for (const [path, expectedHash] of Object.entries(manifest.files)) {
    if (!isSnapshotPathAllowed(path)) {
      throw new ServiceError('FORBIDDEN', `快照路径越界/不在白名单：${id}/${path}`)
    }
    await options.guard?.(path)
    const data = await readFile(join(snapshotDir, path)).catch(() => {
      throw new ServiceError('CORRUPT', `快照文件缺失：${id}/${path}`)
    })
    if (sha256(data) !== expectedHash) {
      throw new ServiceError('CORRUPT', `快照文件哈希不一致：${id}/${path}（留档被改动）`)
    }
    if (path.startsWith('state/')) {
      const target = join(projectDir, '.srw', path.slice('state/'.length))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
    } else if (path.startsWith('build/')) {
      const target = join(paperDir, path)
      await mkdir(join(paperDir, 'build'), { recursive: true })
      await copyFile(join(snapshotDir, path), target)
    } else {
      const target = join(paperDir, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
    }
    restored.push(path)
  }
  // 清掉快照里不存在的陈旧节文件（保持 paper/ 与快照集合一致）
  const sectionsDir = join(paperDir, 'sections')
  try {
    for (const name of await readdir(sectionsDir)) {
      const rel = `sections/${name}`
      if (name.endsWith('.tex') && manifest.files[rel] === undefined) {
        await rm(join(sectionsDir, name), { force: true })
        restored.push(`-${rel}`)
      }
    }
  } catch { /* 无 sections 目录 */ }
  if (manifest.materialsHash !== undefined) {
    const current = await readFile(join(projectDir, 'materials', 'manifest.json')).catch(() => undefined)
    const materialDrift = current === undefined || sha256(current) !== manifest.materialsHash
    return { restored, materialDrift }
  }
  return { restored }
}
