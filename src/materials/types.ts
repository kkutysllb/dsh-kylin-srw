/** 素材与证明链 schema（M6，analysis/goals/02-写论文.md §4 / 0102 §7.2）：
 * manifest.json / metrics.json / run.json 的手写校验器（照 patent/types.ts
 * 风格：零依赖、返回中文错误清单而非抛错——RPC INVALID 聚合与服务的
 * 「坏文件拒载」共用同一判定）。全部 schemaVersion:1。
 *
 * 状态语义（四级，UI/论文/投稿包统一）：
 * - verified：复算（重渲染）输出哈希与基线一致；
 * - mismatch：输入/产物/插入副本任一被改或缺失 → 阻断（insert/compile）；
 * - unverifiable：缺源、公式门（sympy）未接入、结构方法 → 允许插入但强制脚注；
 * - illustrative：示意数据（默认拒绝；显式开启后三处标注）。
 *
 * 确定性纪律：生成器是内置纯函数渲染——同 spec + 同 inputs 字节级相同；
 * 产物禁含时间戳/绝对路径/随机数（否则哈希不稳定，证明链失效）。 */

/** 素材 id：^[a-z][a-z0-9-]{1,40}$（小写 slug，作 \label 与文件名）。 */
export const ARTIFACT_ID_RE = /^[a-z][a-z0-9-]{1,40}$/

/** 实验运行 id：^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$（目录名，禁路径分隔符）。 */
export const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** 指标名：^[A-Za-z][A-Za-z0-9_]*$（数字宏 \srw<Name> 的名字段）。 */
export const METRIC_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

/** sha256 十六进制（64 位小写）。 */
export const SHA256_RE = /^[0-9a-f]{64}$/

export const MATERIALS_SCHEMA_VERSION = 1

export const ARTIFACT_KINDS = ['table', 'plot', 'pseudocode', 'formula', 'tikz'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const PROVENANCES = ['measured', 'derived', 'literature', 'illustrative'] as const
export type Provenance = (typeof PROVENANCES)[number]

export const VERIFICATION_STATUSES = ['verified', 'mismatch', 'unverifiable', 'illustrative'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const VERIFICATION_METHODS = ['recompute', 'structural'] as const
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

/* ── spec（kind 特定参数对象；生成器只做确定性渲染，内容由 spec 给定） ── */

export interface TableColumn {
  /** 指标名（须存在于 metrics.values）。 */
  readonly metric: string
  /** 表头（缺省用指标名）。 */
  readonly header?: string
  /** 有效数字位数（缺省 4，统一 toPrecision 去尾零）。 */
  readonly precision?: number
}

export interface TableSpec {
  /** metrics 运行 id（inputs 解析为 experiments/manual/<runId>/metrics.json）。 */
  readonly runId: string
  readonly title?: string
  readonly caption?: string
  readonly columns: readonly TableColumn[]
}

export interface PlotSpec {
  readonly runId: string
  /** series 名（须存在于 metrics.series）。 */
  readonly seriesName: string
  readonly caption?: string
  readonly xLabel?: string
  readonly yLabel?: string
}

export interface PseudocodeSpec {
  readonly caption?: string
  /** 逐步行；行内允许原始 LaTeX。行前缀 FOR/IF/ELSIF/ELSE/WHILE/RETURN/
   * ENDFOR/ENDIF/ENDWHILE 按 algorithmic 指令渲染，其余为 \STATE。 */
  readonly steps: readonly string[]
}

export interface FormulaSpec {
  readonly latex: string
  readonly caption?: string
}

export interface TikzSpec {
  readonly code: string
  readonly caption?: string
}

/* ── manifest.json ── */

export interface GeneratorInfo {
  /** 内置确定性生成器版本（script 型留待后续）。 */
  readonly builtin: 'table-v1' | 'plot-v1' | 'pseudocode-v1' | 'formula-v1' | 'tikz-v1'
  /** 生成时 spec 的 sha256（JSON 序列化）。 */
  readonly specSha256: string
}

export interface ArtifactInput {
  /** 项目相对路径（如 experiments/manual/<runId>/metrics.json）。 */
  readonly path: string
  /** 生成时该文件的 sha256。 */
  readonly sha256: string
  /** 选择器：'#accuracy' 取 values；'#series:loss' 取 series。 */
  readonly selector: string
}

export interface ArtifactOutput {
  readonly sha256: string
  readonly bytes: number
}

export interface Verification {
  readonly status: VerificationStatus
  readonly method: VerificationMethod
  /** 最近一次复算/生成时点（ISO）。只进 manifest，不进产物。 */
  readonly checkedAt: string
  readonly detail: string
}

export interface InsertionRecord {
  readonly sectionId: string
  /** 节文件（paper/ 内相对路径，如 sections/03-method.tex）。 */
  readonly file: string
  /** tab:/fig:/alg:/eq:<id>。 */
  readonly label: string
  /** 插入副本（项目相对，恒 paper/figs/<id>.tex）。 */
  readonly target: string
  /** 复制时刻副本哈希（编译前漂移门的基准）。 */
  readonly targetSha256: string
}

export interface Artifact {
  readonly id: string
  readonly kind: ArtifactKind
  readonly provenance: Provenance
  /** 产物（项目相对，如 materials/tables/<id>.tex）。 */
  readonly path: string
  /** kind 特定参数对象（复算用它重渲染）。 */
  readonly spec: Record<string, unknown>
  readonly generator: GeneratorInfo
  readonly inputs: readonly ArtifactInput[]
  readonly output: ArtifactOutput
  readonly verification: Verification
  readonly insertedAt: readonly InsertionRecord[]
  readonly illustrative: { readonly allowed: boolean }
}

export interface MaterialsManifest {
  readonly schemaVersion: typeof MATERIALS_SCHEMA_VERSION
  readonly artifacts: readonly Artifact[]
}

/* ── metrics.json / run.json ── */

export interface MetricValue {
  readonly value: number
  readonly unit?: string
  readonly stderr?: number
  readonly n?: number
  readonly seed?: number
}

export interface SeriesDef {
  readonly name: string
  readonly xLabel?: string
  readonly yLabel?: string
  /** [x, y] 数值对（pgfplots coordinates 的数据源）。 */
  readonly points: readonly (readonly [number, number])[]
}

/** experiments/manual/<runId>/metrics.json 的契约形状。 */
export interface MetricsFile {
  readonly schemaVersion: typeof MATERIALS_SCHEMA_VERSION
  readonly runId: string
  readonly values: Readonly<Record<string, MetricValue>>
  readonly series?: readonly SeriesDef[]
}

/** 导入载荷（runId 由 importMetrics 单独给，落盘时合并成 MetricsFile）。 */
export interface MetricsPayload {
  readonly values: Readonly<Record<string, MetricValue>>
  readonly series?: readonly SeriesDef[]
}

export interface RunMeta {
  readonly schemaVersion: typeof MATERIALS_SCHEMA_VERSION
  readonly runId: string
  readonly source: 'manual'
  readonly importedAt: string
}

/* ── 校验器（空数组 = 合法） ── */

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value))
}

/** 校验单个 MetricValue（把错误 push 进给定清单）。 */
function checkMetricValue(prefix: string, value: unknown, errors: string[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(prefix + ' 必须是对象')
    return
  }
  const m = value as Record<string, unknown>
  if (typeof m['value'] !== 'number' || !Number.isFinite(m['value'])) {
    errors.push(prefix + '.value 必须是有限数字')
  }
  if (m['unit'] !== undefined && (typeof m['unit'] !== 'string' || m['unit'].length > 30)) {
    errors.push(prefix + '.unit 必须是 ≤30 字的字符串')
  }
  if (m['stderr'] !== undefined && (typeof m['stderr'] !== 'number' || !Number.isFinite(m['stderr']) || m['stderr'] < 0)) {
    errors.push(prefix + '.stderr 必须是非负有限数字')
  }
  for (const key of ['n', 'seed'] as const) {
    const v = m[key]
    if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v))) {
      errors.push(prefix + '.' + key + ' 必须是整数')
    }
  }
}

/** 校验 values/series 载荷（importMetrics 的入参形状）。 */
export function validateMetricsPayload(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['metrics 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  const values = m['values']
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    errors.push('metrics.values 必须是对象（{ 指标名: { value, unit?, stderr?, n?, seed? } }）')
  } else {
    const entries = Object.entries(values as Record<string, unknown>)
    if (entries.length === 0 && m['series'] === undefined) {
      errors.push('metrics.values 与 metrics.series 至少要有一个非空')
    }
    for (const [name, item] of entries) {
      if (!METRIC_NAME_RE.test(name)) {
        errors.push('metrics.values 的指标名 ' + JSON.stringify(name) + ' 须匹配 ^[A-Za-z][A-Za-z0-9_]*$')
        continue
      }
      checkMetricValue('metrics.values.' + name, item, errors)
    }
  }
  const series = m['series']
  if (series !== undefined) {
    if (!Array.isArray(series)) {
      errors.push('metrics.series 必须是数组')
    } else {
      series.forEach((row, index) => {
        const prefix = 'metrics.series[' + index + ']'
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          errors.push(prefix + ' 必须是对象')
          return
        }
        const s = row as Record<string, unknown>
        if (typeof s['name'] !== 'string' || s['name'] === '' || s['name'].length > 120) {
          errors.push(prefix + '.name 必填（≤120 字）')
        }
        for (const key of ['xLabel', 'yLabel'] as const) {
          const v = s[key]
          if (v !== undefined && (typeof v !== 'string' || v === '' || v.length > 120)) {
            errors.push(prefix + '.' + key + ' 必须是 ≤120 字的非空字符串')
          }
        }
        const points = s['points']
        if (!Array.isArray(points) || points.length === 0) {
          errors.push(prefix + '.points 必须是非空数组')
        } else {
          points.forEach((point, pointIndex) => {
            if (!Array.isArray(point) || point.length !== 2
              || typeof point[0] !== 'number' || !Number.isFinite(point[0])
              || typeof point[1] !== 'number' || !Number.isFinite(point[1])) {
              errors.push(prefix + '.points[' + pointIndex + '] 必须是 [number, number]')
            }
          })
        }
      })
    }
  }
  return errors
}

/** 校验落盘后的 metrics.json 全形。 */
export function validateMetricsFile(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['metrics.json 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  if (m['schemaVersion'] !== 1) errors.push('metrics.json schemaVersion 必须为 1')
  if (typeof m['runId'] !== 'string' || !RUN_ID_RE.test(m['runId'])) {
    errors.push('metrics.json runId 必须匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
  }
  errors.push(...validateMetricsPayload({ values: m['values'], ...(m['series'] !== undefined ? { series: m['series'] } : {}) })
    .map(message => message.replace(/^metrics\./, 'metrics.json ')))
  return errors
}

function checkArtifactInputs(artifactId: string, value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('artifacts[' + artifactId + '].inputs 必须是数组')
    return
  }
  value.forEach((row, index) => {
    const prefix = 'artifacts[' + artifactId + '].inputs[' + index + ']'
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      errors.push(prefix + ' 必须是对象')
      return
    }
    const m = row as Record<string, unknown>
    if (typeof m['path'] !== 'string' || m['path'] === '') errors.push(prefix + '.path 必填（项目相对路径）')
    if (typeof m['sha256'] !== 'string' || !SHA256_RE.test(m['sha256'])) errors.push(prefix + '.sha256 必须是 64 位十六进制')
    if (typeof m['selector'] !== 'string' || !m['selector'].startsWith('#')) {
      errors.push(prefix + '.selector 必须以 # 开头（#accuracy 或 #series:loss）')
    }
  })
}

function checkInsertedAt(artifactId: string, value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('artifacts[' + artifactId + '].insertedAt 必须是数组')
    return
  }
  value.forEach((row, index) => {
    const prefix = 'artifacts[' + artifactId + '].insertedAt[' + index + ']'
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      errors.push(prefix + ' 必须是对象')
      return
    }
    const m = row as Record<string, unknown>
    for (const key of ['sectionId', 'file', 'label', 'target'] as const) {
      if (typeof m[key] !== 'string' || m[key] === '') errors.push(prefix + '.' + key + ' 必填')
    }
    if (typeof m['targetSha256'] !== 'string' || !SHA256_RE.test(m['targetSha256'])) {
      errors.push(prefix + '.targetSha256 必须是 64 位十六进制')
    }
  })
}

/** 校验单个 artifact 形状。 */
export function validateArtifact(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['artifact 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  const id = typeof m['id'] === 'string' ? m['id'] : ''
  if (!ARTIFACT_ID_RE.test(id)) errors.push('artifact.id 必须匹配 ^[a-z][a-z0-9-]{1,40}$')
  if (!(ARTIFACT_KINDS as readonly string[]).includes(m['kind'] as string)) {
    errors.push('artifact.kind 必须是 ' + ARTIFACT_KINDS.join('|'))
  }
  if (!(PROVENANCES as readonly string[]).includes(m['provenance'] as string)) {
    errors.push('artifact.provenance 必须是 ' + PROVENANCES.join('|'))
  }
  if (typeof m['path'] !== 'string' || !m['path'].startsWith('materials/')) {
    errors.push('artifact.path 必填且在 materials/ 下（项目相对）')
  }
  if (typeof m['spec'] !== 'object' || m['spec'] === null || Array.isArray(m['spec'])) {
    errors.push('artifact.spec 必须是对象')
  }
  const generator = m['generator']
  if (typeof generator !== 'object' || generator === null || Array.isArray(generator)) {
    errors.push('artifact.generator 必须是对象（{ builtin, specSha256 }）')
  } else {
    const g = generator as Record<string, unknown>
    if (typeof g['builtin'] !== 'string' || g['builtin'] === '') errors.push('artifact.generator.builtin 必填')
    if (typeof g['specSha256'] !== 'string' || !SHA256_RE.test(g['specSha256'])) errors.push('artifact.generator.specSha256 必须是 64 位十六进制')
  }
  const output = m['output']
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    errors.push('artifact.output 必须是对象（{ sha256, bytes }）')
  } else {
    const o = output as Record<string, unknown>
    if (typeof o['sha256'] !== 'string' || !SHA256_RE.test(o['sha256'])) errors.push('artifact.output.sha256 必须是 64 位十六进制')
    if (typeof o['bytes'] !== 'number' || !Number.isInteger(o['bytes']) || o['bytes'] < 0) errors.push('artifact.output.bytes 必须是非负整数')
  }
  const verification = m['verification']
  if (typeof verification !== 'object' || verification === null || Array.isArray(verification)) {
    errors.push('artifact.verification 必须是对象')
  } else {
    const v = verification as Record<string, unknown>
    if (!(VERIFICATION_STATUSES as readonly string[]).includes(v['status'] as string)) {
      errors.push('artifact.verification.status 必须是 ' + VERIFICATION_STATUSES.join('|'))
    }
    if (!(VERIFICATION_METHODS as readonly string[]).includes(v['method'] as string)) {
      errors.push('artifact.verification.method 必须是 ' + VERIFICATION_METHODS.join('|'))
    }
    if (!isIsoTime(v['checkedAt'])) errors.push('artifact.verification.checkedAt 必须是 ISO 时间')
    if (typeof v['detail'] !== 'string' || v['detail'] === '') errors.push('artifact.verification.detail 必填')
  }
  checkArtifactInputs(id === '' ? '?' : id, m['inputs'], errors)
  checkInsertedAt(id === '' ? '?' : id, m['insertedAt'], errors)
  const illustrative = m['illustrative']
  if (typeof illustrative !== 'object' || illustrative === null || Array.isArray(illustrative)
    || typeof (illustrative as Record<string, unknown>)['allowed'] !== 'boolean') {
    errors.push('artifact.illustrative 必须是 { allowed: boolean }')
  }
  return errors
}

/** 校验 manifest.json 形状；返回中文错误清单（空数组 = 合法）。 */
export function validateManifest(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['manifest.json 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  if (m['schemaVersion'] !== 1) errors.push('manifest.json schemaVersion 必须为 1')
  if (!Array.isArray(m['artifacts'])) {
    errors.push('manifest.json artifacts 必须是数组')
  } else {
    m['artifacts'].forEach((artifact, index) => {
      for (const message of validateArtifact(artifact)) errors.push('artifacts[' + index + '] ' + message)
    })
  }
  return errors
}

/** 校验 kind 特定 spec 形状（generate 入口与复算重渲染前共用）。 */
export function validateSpec(kind: ArtifactKind, spec: unknown): string[] {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return ['spec 必须是对象']
  const s = spec as Record<string, unknown>
  const errors: string[] = []
  const optString = (key: string, max: number): void => {
    const v = s[key]
    if (v !== undefined && (typeof v !== 'string' || v === '' || v.length > max)) {
      errors.push('spec.' + key + ' 必须是 ≤' + max + ' 字的非空字符串')
    }
  }
  const needRunId = (): void => {
    if (typeof s['runId'] !== 'string' || !RUN_ID_RE.test(s['runId'])) {
      errors.push('spec.runId 必填且须匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
    }
  }
  switch (kind) {
    case 'table': {
      needRunId()
      optString('title', 300)
      optString('caption', 500)
      const columns = s['columns']
      if (!Array.isArray(columns) || columns.length === 0 || columns.length > 50) {
        errors.push('spec.columns 必须是 1..50 的数组')
      } else {
        columns.forEach((column, index) => {
          const prefix = 'spec.columns[' + index + ']'
          if (typeof column !== 'object' || column === null || Array.isArray(column)) {
            errors.push(prefix + ' 必须是对象')
            return
          }
          const c = column as Record<string, unknown>
          if (typeof c['metric'] !== 'string' || !METRIC_NAME_RE.test(c['metric'])) {
            errors.push(prefix + '.metric 必须匹配 ^[A-Za-z][A-Za-z0-9_]*$')
          }
          if (c['header'] !== undefined && (typeof c['header'] !== 'string' || c['header'] === '' || c['header'].length > 120)) {
            errors.push(prefix + '.header 必须是 ≤120 字的非空字符串')
          }
          if (c['precision'] !== undefined
            && (typeof c['precision'] !== 'number' || !Number.isInteger(c['precision']) || c['precision'] < 1 || c['precision'] > 12)) {
            errors.push(prefix + '.precision 必须是 1..12 的整数')
          }
        })
      }
      break
    }
    case 'plot': {
      needRunId()
      if (typeof s['seriesName'] !== 'string' || s['seriesName'] === '' || s['seriesName'].length > 120) {
        errors.push('spec.seriesName 必填（≤120 字）')
      }
      optString('caption', 500)
      optString('xLabel', 120)
      optString('yLabel', 120)
      break
    }
    case 'pseudocode': {
      optString('caption', 500)
      const steps = s['steps']
      if (!Array.isArray(steps) || steps.length === 0 || steps.length > 500) {
        errors.push('spec.steps 必须是 1..500 的数组')
      } else {
        steps.forEach((step, index) => {
          if (typeof step !== 'string' || step.trim() === '' || step.length > 2000) {
            errors.push('spec.steps[' + index + '] 必须是 ≤2000 字的非空字符串')
          }
        })
      }
      break
    }
    case 'formula': {
      if (typeof s['latex'] !== 'string' || s['latex'].trim() === '' || s['latex'].length > 5000) {
        errors.push('spec.latex 必填（≤5000 字的 LaTeX 源）')
      }
      optString('caption', 500)
      break
    }
    case 'tikz': {
      if (typeof s['code'] !== 'string' || s['code'].trim() === '' || s['code'].length > 20000) {
        errors.push('spec.code 必填（≤20000 字的 TikZ 源）')
      }
      optString('caption', 500)
      break
    }
  }
  return errors
}
