/** 指标/产物归集（§3 子能力 11/12）：metrics.json 与 artifacts/* 回传 +
 * sha256 双向对账（远端 sha256sum vs 本地重算）；schema 坏 → schemaOk=false
 * （进 gap，不假成功）；文件被改 → ARTIFACT_CHANGED（不覆盖旧哈希）。 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComputeProvider, HostTarget } from './provider.ts'
import { validateMetricsFile, type MetricsFile } from './claims.ts'

export interface CollectedArtifact {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export interface CollectOutcome {
  readonly metrics: { readonly path: string; readonly sha256: string; readonly schemaOk: boolean; readonly parsed: MetricsFile | null } | null
  readonly artifacts: readonly CollectedArtifact[]
  readonly errors: readonly string[]
}

export interface CollectRunInput {
  readonly provider: ComputeProvider
  readonly host: HostTarget
  readonly runDirAbs: string
  readonly metricsRel: string
  readonly localRunDir: string
  readonly maxFileBytes?: number
}

const DEFAULT_FILE_CAP = 8 * 1024 * 1024
const DECODER = new TextDecoder()

function shaOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 远端 sha256sum（对账用；拿不到返回 ''）。 */
async function remoteSha256(provider: ComputeProvider, host: HostTarget, absPath: string): Promise<string> {
  try {
    const res = await provider.exec(host, ['sha256sum', absPath], { maxBytes: 1024, timeoutMs: 20_000 })
    if (res.code !== 0) return ''
    return DECODER.decode(res.stdout).trim().split(/\s+/)[0] ?? ''
  } catch {
    return ''
  }
}

export async function collectRun(input: CollectRunInput): Promise<CollectOutcome> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_FILE_CAP
  const errors: string[] = []
  // ① metrics.json（作业未写 → null，不算错误）
  let metrics: CollectOutcome['metrics'] = null
  try {
    const fetched = await input.provider.getBytes(input.host, input.runDirAbs + '/' + input.metricsRel, maxFileBytes)
    if (fetched.truncated) {
      errors.push('metrics 超过单文件上限 ' + String(maxFileBytes) + ' 字节——不采（防假数据）')
    } else {
      const text = DECODER.decode(fetched.bytes)
      let parsed: MetricsFile | null = null
      try {
        const candidate = JSON.parse(text) as unknown
        if (validateMetricsFile(candidate).length === 0) parsed = candidate as MetricsFile
      } catch { /* 保持 null → schemaOk=false */ }
      await mkdir(input.localRunDir, { recursive: true })
      await writeFile(join(input.localRunDir, 'metrics.json'), text, 'utf8')
      metrics = { path: input.metricsRel, sha256: shaOf(fetched.bytes), schemaOk: parsed !== null, parsed }
    }
  } catch { /* 作业未完：metrics 还没生成 */ }
  // ② artifacts/*（find 单层枚举；每文件回传 + 双向 sha256 对账）
  const artifacts: CollectedArtifact[] = []
  const artifactsAbs = input.runDirAbs + '/artifacts'
  try {
    const list = await input.provider.exec(input.host, ['find', artifactsAbs, '-maxdepth', '1', '-type', 'f', '-printf', '%s\\t%P\\n'], { maxBytes: 64 * 1024, timeoutMs: 20_000 })
    if (list.code === 0) {
      for (const line of DECODER.decode(list.stdout).split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        const cells = trimmed.split('\t')
        const size = Number.parseInt(cells[0] ?? '', 10)
        const rel = cells[1] ?? ''
        if (!Number.isSafeInteger(size) || rel === '' || rel.includes('..')) continue
        try {
          const file = await input.provider.getBytes(input.host, artifactsAbs + '/' + rel, maxFileBytes)
          if (file.truncated) {
            errors.push('artifact ' + rel + ' 超过单文件上限——不采')
            continue
          }
          const sha = shaOf(file.bytes)
          const rsha = await remoteSha256(input.provider, input.host, artifactsAbs + '/' + rel)
          if (rsha !== '' && rsha !== sha) {
            errors.push('ARTIFACT_CHANGED：' + rel + ' 采集期间远端哈希变化——不覆盖旧数据')
            continue
          }
          await mkdir(join(input.localRunDir, 'artifacts'), { recursive: true })
          await writeFile(join(input.localRunDir, 'artifacts', rel), file.bytes)
          artifacts.push({ path: rel, sha256: sha, bytes: file.bytes.byteLength })
        } catch (error) {
          errors.push('artifact ' + rel + ' 采集失败：' + (error instanceof Error ? error.message : String(error)))
        }
      }
    }
  } catch (error) {
    errors.push('artifacts 目录枚举失败：' + (error instanceof Error ? error.message : String(error)))
  }
  return { metrics, artifacts, errors }
}
