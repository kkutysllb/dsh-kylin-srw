/** 环境盘点与 GPU 选卡（§3 子能力 3/4）：全部命令为固定 argv（无用户值），
 * 解析器为纯函数（fixture 单测面）；二进制一律用探测到的绝对路径
 * （真机：nvidia-smi 仅 /usr/lib/wsl/lib/nvidia-smi、nvcc 不在 PATH）。 */

import { ServiceError } from '../service.ts'
import type { ComputeProvider, HostTarget } from './provider.ts'
import { PROBE_SENTINEL } from './provider.ts'
import type { EnvSnapshot, GpuInfo } from './types.ts'

const DECODER = new TextDecoder()

/** nvidia-smi CSV（--format=csv,noheader）→ GPU 列表（纯函数）。 */
export function parseNvidiaSmiCsv(text: string): GpuInfo[] {
  const gpus: GpuInfo[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const cells = trimmed.split(',').map(cell => cell.trim())
    const index = Number.parseInt(cells[0] ?? '', 10)
    if (!Number.isSafeInteger(index)) continue
    const memory = (cells[3] ?? '').match(/(\d+)/)
    const used = (cells[4] ?? '').match(/(\d+)/)
    const util = (cells[5] ?? '').match(/(\d+)/)
    gpus.push({
      index,
      name: cells[1] ?? 'unknown-gpu',
      ...(cells[2] !== undefined && cells[2] !== '' ? { driver: cells[2] } : {}),
      memoryTotalMiB: memory !== null ? Number(memory[1]) : 0,
      memoryUsedMiB: used !== null ? Number(used[1]) : 0,
      ...(util !== null ? { utilPct: Number(util[1]) } : {}),
      ...(cells[6] !== undefined && cells[6] !== '' ? { computeCap: cells[6] } : {}),
    })
  }
  return gpus
}

/** uname -s -r -m → {os,kernel,arch}。 */
export function parseUname(text: string): { os: string; kernel: string; arch: string } {
  const parts = text.trim().split(/\s+/)
  return { os: parts[0] ?? '', kernel: parts[1] ?? '', arch: parts[2] ?? '' }
}

/** df -Pk → 磁盘（取最后一个挂载点行，1024-blocks 与 Available）。 */
export function parseDfPk(text: string): { path: string; totalKiB: number; availKiB: number } | null {
  const lines = text.trim().split('\n').filter(line => line.trim() !== '')
  const last = lines[lines.length - 1]
  if (last === undefined) return null
  const cells = last.trim().split(/\s+/)
  const totalKiB = Number.parseInt(cells[1] ?? '', 10)
  const availKiB = Number.parseInt(cells[3] ?? '', 10)
  if (!Number.isSafeInteger(totalKiB) || !Number.isSafeInteger(availKiB)) return null
  return { path: cells[5] ?? '/', totalKiB, availKiB }
}

/** free -k → MemTotal（MiB）。 */
export function parseFreeK(text: string): number | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith('Mem:')) continue
    const cells = line.trim().split(/\s+/)
    const kib = Number.parseInt(cells[1] ?? '', 10)
    return Number.isSafeInteger(kib) ? Math.round(kib / 1024) : null
  }
  return null
}

/** nvcc --version → '12.8'（release 行）。 */
export function parseNvccVersion(text: string): string | null {
  const match = text.match(/release ([0-9.]+)/)
  return match !== null ? match[1] ?? null : null
}

/** python3 --version → '3.14.7'。 */
export function parsePythonVersion(text: string): string | null {
  const match = text.match(/Python ([0-9.]+)/)
  return match !== null ? match[1] ?? null : null
}

/** 工具在场检查（固定 sh -c 循环的输出：name=yes|no）。 */
export function parseToolCheck(text: string): Record<string, boolean> {
  const tools: Record<string, boolean> = {}
  for (const line of text.split('\n')) {
    const cells = line.trim().split('=')
    if (cells.length !== 2) continue
    tools[cells[0] ?? ''] = (cells[1] ?? '') === 'yes'
  }
  return tools
}

const GPU_BUSY_RATIO = 0.8

/** GPU 选卡：按 (used/total) 升序取 want 张，占用率阈值 0.8；全忙 → GATE
 * NO_FREE_GPU（不假跑，§8.1）。纯函数。 */
export function pickGpu(gpus: readonly GpuInfo[], options?: { want?: number; maxUsedRatio?: number }): number[] {
  const want = options?.want ?? 1
  const maxRatio = options?.maxUsedRatio ?? GPU_BUSY_RATIO
  const eligible = gpus
    .filter(gpu => gpu.memoryTotalMiB > 0 && gpu.memoryUsedMiB / gpu.memoryTotalMiB <= maxRatio)
    .sort((a, b) => a.memoryUsedMiB / a.memoryTotalMiB - b.memoryUsedMiB / b.memoryTotalMiB)
  if (eligible.length < want) {
    throw new ServiceError('GATE', 'NO_FREE_GPU：空闲 GPU ' + eligible.length + ' 张 < 需要 ' + want + ' 张（占用率阈值 ' + Math.round(maxRatio * 100) + '%，共 ' + gpus.length + ' 卡）')
  }
  return eligible.slice(0, want).map(gpu => gpu.index)
}

/** 固定工具检查脚本（无用户值进命令）。 */
const TOOL_CHECK = 'for c in setsid nohup tail sha256sum flock timeout git; do command -v "$c" >/dev/null 2>&1 && echo "$c=yes" || echo "$c=no"; done'

/** 远端盘点：逐项探测（单项失败不影响整体，字段留 null）。返回快照（纯数据）。 */
export async function inventoryEnv(provider: ComputeProvider, host: HostTarget, nowIso: string): Promise<EnvSnapshot> {
  const text = async (argv: readonly string[]): Promise<string | null> => {
    try {
      const res = await provider.exec(host, argv, { maxBytes: 64 * 1024, timeoutMs: 20_000 })
      return res.code === 0 ? DECODER.decode(res.stdout) : null
    } catch {
      return null
    }
  }
  const unameText = await text(['uname', '-s', '-r', '-m'])
  const uname = unameText !== null ? parseUname(unameText) : { os: '', kernel: '', arch: '' }
  const nprocText = await text(['nproc'])
  const cpuCount = nprocText !== null ? Number.parseInt(nprocText.trim(), 10) : null
  const freeText = await text(['free', '-k'])
  const memTotalMiB = freeText !== null ? parseFreeK(freeText) : null
  const dfText = await text(['df', '-Pk', '/'])
  const disk = dfText !== null ? parseDfPk(dfText) : null
  // nvidia-smi：PATH → WSL2 固定位 → 常见位（真机 P3：WSL2 只有 /usr/lib/wsl/lib）
  const smiCandidates = ['nvidia-smi', '/usr/lib/wsl/lib/nvidia-smi', '/usr/bin/nvidia-smi']
  let gpus: GpuInfo[] = []
  let nvidiaSmiPath: string | null = null
  for (const candidate of smiCandidates) {
    const csv = await text([candidate, '--query-gpu=index,name,driver_version,memory.total,memory.used,utilization.gpu,compute_cap', '--format=csv,noheader'])
    if (csv !== null) {
      gpus = parseNvidiaSmiCsv(csv)
      if (gpus.length > 0) {
        nvidiaSmiPath = candidate
        break
      }
    }
  }
  // nvcc：PATH → /usr/local/cuda* 固定位（真机 P6：CUDA 12.8 不在 PATH）
  const nvccCandidates = ['nvcc', '/usr/local/cuda/bin/nvcc', '/usr/local/cuda-12.8/bin/nvcc', '/usr/local/cuda-12/bin/nvcc']
  let nvcc: EnvSnapshot['nvcc'] = null
  for (const candidate of nvccCandidates) {
    const version = await text([candidate, '--version'])
    if (version !== null) {
      const parsed = parseNvccVersion(version)
      if (parsed !== null) {
        nvcc = { path: candidate, version: parsed }
        break
      }
    }
  }
  const pythonVersion = await text(['python3', '--version'])
  const pythonPath = await text(['sh', '-c', 'command -v python3'])
  const python3 = pythonVersion !== null && pythonPath !== null
    ? { path: pythonPath.trim(), version: parsePythonVersion(pythonVersion) ?? '' }
    : null
  const nodeVersion = await text(['node', '--version'])
  const toolsText = await text(['sh', '-c', TOOL_CHECK])
  return {
    os: uname.os,
    kernel: uname.kernel,
    arch: uname.arch,
    cpuCount: cpuCount !== null && Number.isSafeInteger(cpuCount) ? cpuCount : null,
    memTotalMiB,
    gpus,
    nvidiaSmiPath,
    nvcc,
    python3,
    node: nodeVersion !== null ? nodeVersion.trim() : null,
    tools: toolsText !== null ? parseToolCheck(toolsText) : {},
    disk,
    probedAt: nowIso,
  }
}

/** 探针哨兵（可达性 + 延迟；不承载任何业务命令）。 */
export async function probeHost(provider: ComputeProvider, host: HostTarget, timeoutMs: number): Promise<{ reachable: boolean; latencyMs: number | null; detail: string }> {
  const started = Date.now()
  try {
    const res = await provider.exec(host, ['echo', PROBE_SENTINEL], { maxBytes: 1024, timeoutMs })
    const latencyMs = Date.now() - started
    const out = DECODER.decode(res.stdout).trim()
    if (res.code === 0 && out.includes(PROBE_SENTINEL)) return { reachable: true, latencyMs, detail: 'ok' }
    return { reachable: false, latencyMs, detail: 'exit ' + String(res.code) + (res.stderr !== '' ? '：' + res.stderr.trim().slice(0, 160) : '') }
  } catch (error) {
    return { reachable: false, latencyMs: null, detail: error instanceof Error ? error.message : String(error) }
  }
}
