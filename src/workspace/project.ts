/** workspace 领域模块（M1）：项目 CRUD，**目录即真相源**（0102 §6.2）——
 * 科研总根下一个 slug 目录 + `.srw/project.json` 即一个项目；没有数据库，
 * 没有 storage 域投影，list 是实扫。坏 project.json 的目录不是项目（跳过，
 * 不抛错）——用户手工目录不会被面板弄坏。 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG_RE, validateProjectMeta, type ProjectMeta } from '../core/schema.ts'
import { ServiceError } from '../service.ts'

export const PROJECT_SUBDIRS = [
  '.srw',
  'literature/pdf',
  'literature/notes',
  'literature/readings',
  'paper',
  'experiments',
  'materials',
] as const

const TITLE_LIMIT = 200

function assertTitle(title: string): void {
  if (typeof title !== 'string' || title.trim() === '' || title.length > TITLE_LIMIT) {
    throw new ServiceError('INVALID', `title 必填（≤${TITLE_LIMIT}）`)
  }
}

function projectMetaPath(rootAbs: string, slug: string): string {
  return join(rootAbs, slug, '.srw', 'project.json')
}

export class WorkspaceStore {
  constructor(private readonly rootAbs: () => string | undefined) {}

  private dir(slug: string): string {
    if (!SLUG_RE.test(slug)) throw new ServiceError('INVALID', `slug 非法：${JSON.stringify(slug)}`)
    const root = this.rootAbs()
    if (root === undefined || root === '') throw new ServiceError('NO_ROOT', '科研总根未设置（先在面板选择）')
    return join(root, slug)
  }

  /** 实扫总根：目录名合 slug 法 + project.json 可校验才算项目。 */
  async list(): Promise<ProjectMeta[]> {
    const root = this.rootAbs()
    if (root === undefined || root === '') return []
    const entries = await readdir(root, { withFileTypes: true })
    const projects: ProjectMeta[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !SLUG_RE.test(entry.name)) continue
      try {
        const meta: unknown = JSON.parse(await readFile(projectMetaPath(root, entry.name), 'utf8'))
        if (validateProjectMeta(meta).length === 0) projects.push(meta as ProjectMeta)
      } catch { /* 无 project.json 或坏文件：不是项目 */ }
    }
    return projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async create(input: { slug: string; title: string; field?: string }): Promise<ProjectMeta> {
    assertTitle(input.title)
    const dir = this.dir(input.slug)
    let exists = false
    try {
      await stat(dir)
      exists = true
    } catch { /* 不存在 = 可创建 */ }
    if (exists) throw new ServiceError('CONFLICT', `项目目录已存在：${input.slug}`)
    const now = new Date().toISOString()
    const meta: ProjectMeta = {
      schemaVersion: 1,
      slug: input.slug,
      title: input.title,
      ...(input.field === undefined ? {} : { field: input.field }),
      stage: 'idea',
      createdAt: now,
      updatedAt: now,
    }
    for (const sub of PROJECT_SUBDIRS) {
      await mkdir(join(dir, sub), { recursive: true })
    }
    await writeFile(join(dir, '.srw', 'project.json'), JSON.stringify(meta, null, 2) + '\n')
    return meta
  }

  async open(slug: string): Promise<ProjectMeta> {
    let raw: string
    try {
      raw = await readFile(join(this.dir(slug), '.srw', 'project.json'), 'utf8')
    } catch (error: unknown) {
      const code = (error as { code?: string }).code
      if (code === 'ENOENT') throw new ServiceError('NOT_FOUND', `项目不存在：${slug}`)
      throw error
    }
    let meta: unknown
    try {
      meta = JSON.parse(raw)
    } catch {
      throw new ServiceError('INVALID', `project.json 不是合法 JSON：${slug}`)
    }
    const errors = validateProjectMeta(meta)
    if (errors.length > 0) throw new ServiceError('INVALID', `project.json 损坏：${errors.join('；')}`)
    return meta as ProjectMeta
  }

  /** 危险操作：二次确认由调用方负责（面板对话框 / 工具 pre-execute ask）。 */
  async remove(slug: string): Promise<void> {
    await rm(this.dir(slug), { recursive: true, force: false })
  }

  async rename(slug: string, title: string): Promise<ProjectMeta> {
    assertTitle(title)
    const meta = await this.open(slug)
    const next: ProjectMeta = { ...meta, title, updatedAt: new Date().toISOString() }
    await writeFile(join(this.dir(slug), '.srw', 'project.json'), JSON.stringify(next, null, 2) + '\n')
    return next
  }

  /** 目录级重命名（slug 变更）：项目元数据随目录移动，slug 字段同步改写。 */
  async moveSlug(fromSlug: string, toSlug: string): Promise<ProjectMeta> {
    const from = this.dir(fromSlug)
    const to = this.dir(toSlug)
    let exists = false
    try {
      await stat(to)
      exists = true
    } catch { /* 不存在 = 可移动 */ }
    if (exists) throw new ServiceError('CONFLICT', `目标目录已存在：${toSlug}`)
    await rename(from, to)
    const meta = await this.open(toSlug)
    const next: ProjectMeta = { ...meta, slug: toSlug, updatedAt: new Date().toISOString() }
    await writeFile(join(to, '.srw', 'project.json'), JSON.stringify(next, null, 2) + '\n')
    return next
  }
}
