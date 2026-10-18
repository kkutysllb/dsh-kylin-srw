/** 数据集注册表（§5.5）：data/registry.json（文件即真相源）+ 只增不改的
 * upsert 语义（同 id+version 替换、跨版本并存）。hashPolicy:'none' 允许跑，
 * 但引用它的 claim 只能 unverifiable（不假 verified）——判定在 gaps/claims。 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'

export const DATASET_ID_RE = /^ds-[a-z0-9][a-z0-9-]{0,40}$/

export interface DatasetRecord {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly kind?: string
  readonly source?: { readonly type: 'download' | 'provided' | 'generated'; readonly url?: string; readonly retrievedAt?: string; readonly citation?: string }
  readonly locator?: { readonly kind: 'remote' | 'local'; readonly hostRef?: string; readonly path?: string }
  readonly hashPolicy: 'tree' | 'file' | 'none'
  readonly license?: string
  readonly redistributable?: boolean
  readonly splits?: Readonly<Record<string, number>>
  readonly provenance?: { readonly by: 'user' | 'download' | 'script'; readonly scriptSha256?: string | null }
  readonly registeredAt: string
}

export interface RegistryFile {
  readonly schemaVersion: 1
  readonly datasets: DatasetRecord[]
}

const VERSION_RE = /^v[0-9][A-Za-z0-9._-]{0,15}$/

/** 校验（中文错误清单；空数组 = 合法）。 */
export function validateDatasetRecord(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['dataset 必须是对象']
  const d = value as Record<string, unknown>
  const errors: string[] = []
  if (typeof d['id'] !== 'string' || !DATASET_ID_RE.test(d['id'])) errors.push('id 必须匹配 ds-* slug')
  if (typeof d['version'] !== 'string' || !VERSION_RE.test(d['version'])) errors.push('version 必须形如 v1')
  if (typeof d['title'] !== 'string' || d['title'] === '' || d['title'].length > 200) errors.push('title 必填（≤200）')
  if (d['hashPolicy'] !== 'tree' && d['hashPolicy'] !== 'file' && d['hashPolicy'] !== 'none') errors.push('hashPolicy 必须是 tree|file|none')
  if (d['kind'] !== undefined && (typeof d['kind'] !== 'string' || d['kind'].length > 64)) errors.push('kind ≤64 字')
  if (d['source'] !== undefined) {
    const s = d['source'] as Record<string, unknown>
    if (typeof s !== 'object' || s === null || !['download', 'provided', 'generated'].includes(String(s['type']))) {
      errors.push('source.type 必须是 download|provided|generated')
    }
  }
  if (d['locator'] !== undefined) {
    const l = d['locator'] as Record<string, unknown>
    if (typeof l !== 'object' || l === null || !['remote', 'local'].includes(String(l['kind']))) {
      errors.push('locator.kind 必须是 remote|local')
    } else if (l['kind'] === 'remote' && l['hostRef'] !== undefined && (typeof l['hostRef'] !== 'string' || !String(l['hostRef']).startsWith('h-'))) {
      errors.push('locator.hostRef 必须是 h- 前缀哈希（脱敏纪律）')
    }
  }
  if (d['redistributable'] !== undefined && typeof d['redistributable'] !== 'boolean') errors.push('redistributable 必须是布尔')
  return errors
}

export interface RegistryDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
}

export class RegistryStore {
  constructor(private readonly deps: RegistryDeps) {}

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_PROVIDER', '科研总根未设置（先在面板选择）')
    return root
  }

  private filePath(project: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(project)) throw new ServiceError('INVALID', '项目 slug 非法：' + JSON.stringify(project))
    return join(this.requireRoot(), project, 'data', 'registry.json')
  }

  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.deps.fs, this.requireRoot(), absPath)
  }

  /** 读注册表（缺文件 → 空表；坏 JSON → INVALID，绝不静默重建）。 */
  async load(project: string): Promise<RegistryFile> {
    const abs = this.filePath(project)
    await this.guard(abs)
    let text: string
    try {
      text = await readFile(abs, 'utf8')
    } catch {
      return { schemaVersion: 1, datasets: [] }
    }
    let raw: unknown
    try {
      raw = JSON.parse(text) as unknown
    } catch {
      throw new ServiceError('INVALID', 'data/registry.json 损坏（非法 JSON）——请手工修复后再操作')
    }
    const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const datasets = Array.isArray(row['datasets']) ? (row['datasets'] as unknown[]).filter(item => validateDatasetRecord(item).length === 0) as DatasetRecord[] : []
    return { schemaVersion: 1, datasets }
  }

  async save(project: string, file: RegistryFile): Promise<void> {
    const abs = this.filePath(project)
    await this.guard(abs)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, JSON.stringify(file, null, 2) + '\n', 'utf8')
  }

  async list(project: string): Promise<readonly DatasetRecord[]> {
    return (await this.load(project)).datasets
  }

  /** 取指定数据集（version 缺省取 registeredAt 最新的）。 */
  async get(project: string, id: string, version?: string): Promise<DatasetRecord | undefined> {
    const all = (await this.load(project)).datasets.filter(row => row.id === id)
    if (version !== undefined) return all.find(row => row.version === version)
    return all.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))[0]
  }

  /** upsert：同 id+version 替换，跨版本并存；数据只增不删。 */
  async register(project: string, input: unknown, nowIso: string): Promise<DatasetRecord> {
    const errors = validateDatasetRecord(input)
    if (errors.length > 0) throw new ServiceError('INVALID', 'dataset.register 校验失败：' + errors.join('；'))
    const record = { ...(input as Omit<DatasetRecord, 'registeredAt'>), registeredAt: nowIso }
    const file = await this.load(project)
    const rest = file.datasets.filter(row => !(row.id === record.id && row.version === record.version))
    await this.save(project, { schemaVersion: 1, datasets: [...rest, record] })
    return record
  }
}
