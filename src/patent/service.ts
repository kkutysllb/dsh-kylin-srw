/** PatentService（M9-lite 专利线编排）：档案（patent.json）+ 技术交底书
 * （disclosure.json）+ 公开事件流水（events.jsonl，append-only）+ 公开时序门。
 * 磁盘域 <root>/<project>/.srw/patent/<patentId>/，文件即真相源；全部读写过
 * assertInsideRoot 护栏（照 WriterService.guard 模式：fs 注入、护栏缺席
 * fail-closed）。LLM 起草不经本服务——agent 车道，工具只做 IO + 门。 */

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { checkPublication, type PublicationCheck } from './gate.ts'
import {
  normalizeDisclosure, normalizePublicEvent, validateDisclosure, validatePatentMeta, validatePublicEvent,
  type Disclosure, type PatentMeta, type PublicEvent,
} from './types.ts'

export interface PatentDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
}

export interface PatentCreateInput {
  readonly patentId: string
  readonly title: string
  readonly inventors?: readonly string[]
  readonly applicants?: readonly string[]
}

export class PatentService {
  constructor(private readonly deps: PatentDeps) {}

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_PROVIDER', '科研总根未设置（先在面板选择）')
    return root
  }

  private projectDir(project: string): string {
    if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
    return join(this.requireRoot(), project)
  }

  private patentDir(project: string, patentId: string): string {
    if (!SLUG_RE.test(patentId)) throw new ServiceError('INVALID', `patentId 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$：${JSON.stringify(patentId)}`)
    return join(this.projectDir(project), '.srw', 'patent', patentId)
  }

  /** 路径护栏（fail-closed）：fs.resolve/contains 缺席直接抛错，绝不静默放行。 */
  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.deps.fs, this.requireRoot(), absPath)
  }

  private patentJsonPath(project: string, patentId: string): string {
    return join(this.patentDir(project, patentId), 'patent.json')
  }

  private disclosurePath(project: string, patentId: string): string {
    return join(this.patentDir(project, patentId), 'disclosure.json')
  }

  private eventsPath(project: string, patentId: string): string {
    return join(this.patentDir(project, patentId), 'events.jsonl')
  }

  /** 读 JSON：护栏先行；不存在/解析失败返回 undefined（list 的坏文件跳过共用）。 */
  private async readJson(absPath: string): Promise<unknown> {
    await this.guard(absPath)
    try {
      return JSON.parse(await readFile(absPath, 'utf8')) as unknown
    } catch {
      return undefined
    }
  }

  private metaFromRaw(raw: unknown, patentId: string): PatentMeta {
    if (raw === undefined || validatePatentMeta(raw).length > 0) {
      throw new ServiceError('NOT_FOUND', `专利档案不存在或已损坏：.srw/patent/${patentId}/patent.json`)
    }
    return raw as PatentMeta
  }

  /** 面板列表：实扫 .srw/patent/ 下各 patent.json（目录即真相源）；坏文件跳过。 */
  async list(project: string): Promise<PatentMeta[]> {
    const dir = join(this.projectDir(project), '.srw', 'patent')
    await this.guard(dir)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    const result: PatentMeta[] = []
    for (const entry of entries) {
      if (!SLUG_RE.test(entry)) continue
      try {
        result.push(this.metaFromRaw(await this.readJson(this.patentJsonPath(project, entry)), entry))
      } catch (error) {
        if (error instanceof ServiceError && error.code === 'NOT_FOUND') continue
        throw error
      }
    }
    return result.sort((a, b) => a.patentId.localeCompare(b.patentId))
  }

  async get(project: string, patentId: string): Promise<PatentMeta> {
    return this.metaFromRaw(await this.readJson(this.patentJsonPath(project, patentId)), patentId)
  }

  /** 立项：建目录 + patent.json（status 'idea'）+ 空 events.jsonl。
   * 项目必须已存在；重复 patentId 报 CONFLICT（照 srw_project create 语义）。 */
  async create(project: string, input: PatentCreateInput): Promise<PatentMeta> {
    const patentId = input.patentId
    if (!SLUG_RE.test(patentId)) {
      throw new ServiceError('INVALID', `patentId 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$：${JSON.stringify(patentId)}`)
    }
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (title === '' || title.length > 200) throw new ServiceError('INVALID', 'title 必填（≤200 字）')
    for (const key of ['inventors', 'applicants'] as const) {
      const value = input[key]
      if (value !== undefined && (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item !== ''))) {
        throw new ServiceError('INVALID', `${key} 必须是非空字符串数组`)
      }
    }
    const projectDir = this.projectDir(project)
    await this.guard(projectDir)
    try {
      await stat(projectDir)
    } catch {
      throw new ServiceError('NOT_FOUND', `项目不存在：${project}（先 srw_project create/open）`)
    }
    const dir = this.patentDir(project, patentId)
    await this.guard(dir)
    try {
      await stat(dir)
      throw new ServiceError('INVALID', `专利已存在：${patentId}（同 id 档案目录已在）`)
    } catch (error) {
      if (error instanceof ServiceError) throw error
    }
    const nowIso = new Date().toISOString()
    const meta: PatentMeta = {
      schemaVersion: 1,
      patentId,
      title,
      kind: 'invention',
      status: 'idea',
      inventors: input.inventors ?? [],
      applicants: input.applicants ?? [],
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    await mkdir(dir, { recursive: true })
    await writeFile(this.patentJsonPath(project, patentId), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    await writeFile(this.eventsPath(project, patentId), '', 'utf8')
    return meta
  }

  /** 技术交底书：整体替换 + 校验；未保存过返回 undefined（工具层转 status:none）。 */
  async disclosureGet(project: string, patentId: string): Promise<Disclosure | undefined> {
    await this.get(project, patentId)
    const raw = await this.readJson(this.disclosurePath(project, patentId))
    if (raw === undefined || validateDisclosure(raw).length > 0) return undefined
    return raw as Disclosure
  }

  async disclosureSave(project: string, patentId: string, value: unknown): Promise<Disclosure> {
    await this.get(project, patentId)
    const disclosure = normalizeDisclosure(value)
    const errors = validateDisclosure(disclosure)
    if (errors.length > 0) throw new ServiceError('INVALID', `交底书校验失败：${errors.join('；')}`)
    const abs = this.disclosurePath(project, patentId)
    await this.guard(abs)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, `${JSON.stringify(disclosure, null, 2)}\n`, 'utf8')
    return disclosure
  }

  /** 公开事件登记：append-only（appendFile 前先 guard + mkdir）。 */
  async eventAdd(project: string, patentId: string, value: unknown): Promise<PublicEvent> {
    await this.get(project, patentId)
    const event = normalizePublicEvent(value, new Date().toISOString())
    const errors = validatePublicEvent(event)
    if (errors.length > 0) throw new ServiceError('INVALID', `公开事件校验失败：${errors.join('；')}`)
    const abs = this.eventsPath(project, patentId)
    await this.guard(abs)
    await mkdir(dirname(abs), { recursive: true })
    await appendFile(abs, `${JSON.stringify(event)}\n`, 'utf8')
    return event
  }

  /** 公开时序门：patent + events → checkPublication（纯函数）。
   * publicationAt 缺省取当前时刻。 */
  async publicationCheck(
    project: string,
    patentId: string,
    publicationAt?: string,
  ): Promise<{ patent: PatentMeta; publicationAt: string; check: PublicationCheck }> {
    const patent = await this.get(project, patentId)
    const at = publicationAt ?? new Date().toISOString()
    if (Number.isNaN(Date.parse(at))) throw new ServiceError('INVALID', 'publicationAt 必须是 ISO 时间')
    const events = await this.readEvents(project, patentId)
    return { patent, publicationAt: at, check: checkPublication({ patent, events, publicationAt: at }) }
  }

  /** 读事件流水：坏行跳过（append-only 流水的容错读法）。 */
  private async readEvents(project: string, patentId: string): Promise<PublicEvent[]> {
    await this.guard(this.eventsPath(project, patentId))
    let raw: string
    try {
      raw = await readFile(this.eventsPath(project, patentId), 'utf8')
    } catch {
      return []
    }
    const events: PublicEvent[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        events.push(JSON.parse(trimmed) as PublicEvent)
      } catch { /* 坏行跳过 */ }
    }
    return events
  }
}
