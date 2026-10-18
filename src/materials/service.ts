/** MaterialsService（M6 素材与证明链，analysis/goals/02-写论文.md §4）：
 * manifest.json（证明链唯一真相源）+ metrics 导入 + 确定性生成 + 复算
 * （recompute）+ 插入正文（G-M1 溯源门）+ 数字宏（srw-numbers）+ 编译前
 * 漂移门（ARTIFACT_DRIFT）。磁盘域 <root>/<project>/{materials,experiments/
 * manual,paper/{figs,generated}}；文件即真相源；全部读写过 assertInsideRoot
 * 护栏（照 PatentService 模式：fs 注入、护栏缺席 fail-closed）。
 *
 * LLM 起草不经本服务——spec 内容由 agent 写好，生成器只做确定性渲染；
 * 红线：无 metrics 不生成、不编造、mismatch 阻断、illustrative 默认拒绝。 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { parseOutline, type Outline } from '../writer/outline.ts'
import { isSafeSectionFile } from '../writer/scaffold.ts'
import { BUILTIN_GENERATOR, KIND_DIR, KIND_LABEL_PREFIX, renderArtifact } from './generate.ts'
import { macroNameFor, metricsFileText, numbersTexText, scanBareNumbers } from './metrics.ts'
import {
  ARTIFACT_ID_RE,
  RUN_ID_RE,
  validateManifest,
  validateMetricsFile,
  validateMetricsPayload,
  validateSpec,
  type Artifact,
  type ArtifactInput,
  type ArtifactKind,
  type InsertionRecord,
  type MaterialsManifest,
  type MetricsFile,
  type Provenance,
  type RunMeta,
  type Verification,
  type VerificationMethod,
  type VerificationStatus,
  type SeriesDef,
} from './types.ts'

export interface MaterialsDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
}

export interface GenerateInput {
  readonly id: string
  readonly kind: ArtifactKind
  readonly provenance: Provenance
  /** kind 特定参数对象（validateSpec 按 kind 校验）。 */
  readonly spec: Record<string, unknown>
  /** 示意开关：provenance='illustrative' 时必须显式 true（默认拒绝）。 */
  readonly allowIllustrative?: boolean
}

export interface InsertOutcome {
  readonly artifact: Artifact
  readonly inserted: InsertionRecord
}

export interface ImportMetricsInput {
  readonly runId: string
  readonly metrics: unknown
}

export interface NumberMacro {
  readonly name: string
  readonly metric: string
  readonly path: string
  readonly value: number
}

export interface BareNumberFinding {
  readonly file: string
  readonly line: number
  readonly text: string
}

/** 裸数字审计条目上限（防超长输出；超出给 truncated 提示）。 */
const AUDIT_CAP = 200

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export class MaterialsService {
  constructor(private readonly deps: MaterialsDeps) {}

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_PROVIDER', '科研总根未设置（先在面板选择）')
    return root
  }

  private projectDir(project: string): string {
    if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', '项目 slug 非法：' + JSON.stringify(project))
    return join(this.requireRoot(), project)
  }

  /** 路径护栏（fail-closed）：fs.resolve/contains 缺席直接抛错，绝不静默放行。 */
  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.deps.fs, this.requireRoot(), absPath)
  }

  private async assertProjectExists(project: string): Promise<void> {
    const dir = this.projectDir(project)
    await this.guard(dir)
    try {
      await stat(dir)
    } catch {
      throw new ServiceError('NOT_FOUND', '项目不存在：' + project + '（先 srw_project create/open）')
    }
  }

  private async readText(absPath: string): Promise<string | undefined> {
    await this.guard(absPath)
    try {
      return await readFile(absPath, 'utf8')
    } catch {
      return undefined
    }
  }

  private async writeText(absPath: string, text: string): Promise<void> {
    await this.guard(absPath)
    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, text, 'utf8')
  }

  private manifestPath(project: string): string {
    return join(this.projectDir(project), 'materials', 'manifest.json')
  }

  private async writeManifest(project: string, manifest: MaterialsManifest): Promise<void> {
    await this.writeText(this.manifestPath(project), JSON.stringify(manifest, null, 2) + '\n')
  }

  private async outlineOf(project: string): Promise<Outline | undefined> {
    const raw = await this.readText(join(this.projectDir(project), '.srw', 'outline.json'))
    return raw === undefined ? undefined : parseOutline(raw)
  }

  private parseMetricsFile(text: string, relPath: string): MetricsFile {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ServiceError('INVALID', relPath + ' 不是合法 JSON')
    }
    const errors = validateMetricsFile(parsed)
    if (errors.length > 0) throw new ServiceError('INVALID', relPath + ' 校验失败：' + errors.join('；'))
    return parsed as MetricsFile
  }

  /* ── manifest ── */

  /** 整个 manifest；无文件返回空 artifacts（坏文件报 INVALID，不静默吞）。 */
  async manifest(project: string): Promise<MaterialsManifest> {
    const raw = await this.readText(this.manifestPath(project))
    if (raw === undefined) return { schemaVersion: 1, artifacts: [] }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ServiceError('INVALID', 'materials/manifest.json 不是合法 JSON')
    }
    const errors = validateManifest(parsed)
    if (errors.length > 0) throw new ServiceError('INVALID', 'materials/manifest.json 校验失败：' + errors.join('；'))
    return parsed as MaterialsManifest
  }

  /* ── 生成（内置确定性渲染，同 spec + 同 inputs → 字节级相同） ── */

  /** spec → inputs 的选择器解析表（table：每列一个 '#metric'；plot：'#series:name'）。 */
  private selectorInputsFor(kind: ArtifactKind, spec: Record<string, unknown>): readonly { readonly path: string; readonly selector: string }[] {
    if (kind === 'table') {
      const runId = String(spec['runId'] ?? '')
      const columns = Array.isArray(spec['columns']) ? spec['columns'] as readonly unknown[] : []
      const seen = new Set<string>()
      const result: { path: string; selector: string }[] = []
      for (const column of columns) {
        const metric = typeof column === 'object' && column !== null && !Array.isArray(column)
          ? (column as Record<string, unknown>)['metric']
          : undefined
        if (typeof metric !== 'string') continue
        const selector = '#' + metric
        if (seen.has(selector)) continue
        seen.add(selector)
        result.push({ path: 'experiments/manual/' + runId + '/metrics.json', selector })
      }
      return result
    }
    if (kind === 'plot') {
      const runId = String(spec['runId'] ?? '')
      const seriesName = String(spec['seriesName'] ?? '')
      return [{ path: 'experiments/manual/' + runId + '/metrics.json', selector: '#series:' + seriesName }]
    }
    return []
  }

  async generate(project: string, input: GenerateInput): Promise<Artifact> {
    if (typeof input.id !== 'string' || !ARTIFACT_ID_RE.test(input.id)) {
      throw new ServiceError('INVALID', 'id 必须匹配 ^[a-z][a-z0-9-]{1,40}$：' + JSON.stringify(input.id))
    }
    const kinds: readonly string[] = ['table', 'plot', 'pseudocode', 'formula', 'tikz']
    if (!kinds.includes(input.kind)) throw new ServiceError('INVALID', 'kind 必须是 ' + kinds.join('|'))
    const provenances: readonly string[] = ['measured', 'derived', 'literature', 'illustrative']
    if (!provenances.includes(input.provenance)) throw new ServiceError('INVALID', 'provenance 必须是 ' + provenances.join('|'))
    // 红线：示意素材默认拒绝（须逐素材显式 allowIllustrative）。
    if (input.provenance === 'illustrative' && input.allowIllustrative !== true) {
      throw new ServiceError('INVALID', '示意素材（illustrative）默认拒绝：正文数字必须可回指真实 metrics；确需示意请显式传 allowIllustrative=true（三处标注）')
    }
    const specErrors = validateSpec(input.kind, input.spec)
    if (specErrors.length > 0) throw new ServiceError('INVALID', 'spec 校验失败：' + specErrors.join('；'))
    await this.assertProjectExists(project)
    const spec = input.spec
    // inputs 由 spec 内 selector 解析：读当前文件记 sha256；缺文件 INVALID（绝不占位）。
    const selectorInputs = this.selectorInputsFor(input.kind, spec)
    const contents = new Map<string, string>()
    const inputs: ArtifactInput[] = []
    for (const item of selectorInputs) {
      let text = contents.get(item.path)
      if (text === undefined) {
        text = await this.readText(join(this.projectDir(project), item.path))
        if (text === undefined) {
          throw new ServiceError('INVALID', 'metrics 文件不存在：' + item.path + '——先 metrics.import 导入指标（无 metrics 不生成）')
        }
        contents.set(item.path, text)
      }
      inputs.push({ path: item.path, sha256: sha256Hex(text), selector: item.selector })
    }
    let metrics: MetricsFile | undefined
    if (input.kind === 'table' || input.kind === 'plot') {
      const firstPath = selectorInputs[0]!.path
      metrics = this.parseMetricsFile(contents.get(firstPath)!, firstPath)
    }
    const text = renderArtifact(input.id, input.kind, spec, metrics)
    const relPath = 'materials/' + KIND_DIR[input.kind] + '/' + input.id + '.tex'
    await this.writeText(join(this.projectDir(project), relPath), text)
    const manifest = await this.manifest(project)
    const existing = manifest.artifacts.find(artifact => artifact.id === input.id)
    const checkedAt = new Date().toISOString()
    const verification: Verification = input.provenance === 'illustrative'
      ? { status: 'illustrative', method: 'structural', checkedAt, detail: '示意素材（illustrative，已显式允许）——插入须水印/脚注/红标三处标注' }
      : input.kind === 'formula'
        ? { status: 'unverifiable', method: 'structural', checkedAt, detail: '公式门（sympy 等价检查）未接入——结构验证，论文引用须脚注「未验证」' }
        : input.kind === 'pseudocode'
          ? { status: 'unverifiable', method: 'structural', checkedAt, detail: '伪代码为 spec 确定性渲染（无可复算数据源）——结构验证' }
          : { status: 'verified', method: 'recompute', checkedAt, detail: '生成即复算：重渲染输出哈希与基线一致' }
    const entry: Artifact = {
      id: input.id,
      kind: input.kind,
      provenance: input.provenance,
      path: relPath,
      spec,
      generator: { builtin: BUILTIN_GENERATOR[input.kind], specSha256: sha256Hex(JSON.stringify(spec)) },
      inputs,
      output: { sha256: sha256Hex(text), bytes: Buffer.byteLength(text, 'utf8') },
      verification,
      insertedAt: existing?.insertedAt ?? [],
      illustrative: { allowed: input.provenance === 'illustrative' },
    }
    const artifacts = existing === undefined
      ? [...manifest.artifacts, entry]
      : manifest.artifacts.map(artifact => artifact.id === input.id ? entry : artifact)
    await this.writeManifest(project, { schemaVersion: 1, artifacts })
    return entry
  }

  /* ── 复算（verify = recompute） ── */

  private withVerification(entry: Artifact, status: VerificationStatus, method: VerificationMethod, checkedAt: string, detail: string): Artifact {
    return { ...entry, verification: { status, method, checkedAt, detail } }
  }

  /** 复算判定（goals §4.7 矩阵的 M6 形态）：产物/插入副本被改 → mismatch；
   * illustrative 保持 illustrative；formula/pseudocode 恒 unverifiable/structural；
   * 缺源 → unverifiable「缺源」；用**当前输入内容**重渲染比对 output.sha256。 */
  private async recompute(project: string, entry: Artifact): Promise<Artifact> {
    const checkedAt = new Date().toISOString()
    // ① 产物本体：缺失/被手改 → mismatch（不自动改基线）。
    const artifactText = await this.readText(join(this.projectDir(project), entry.path))
    if (artifactText === undefined) {
      return this.withVerification(entry, 'mismatch', 'recompute', checkedAt, '产物缺失：' + entry.path + '——重新 generate')
    }
    if (sha256Hex(artifactText) !== entry.output.sha256) {
      return this.withVerification(entry, 'mismatch', 'recompute', checkedAt, '产物被手改：' + entry.path + ' 与 output.sha256 不符——恢复文件或重新 generate')
    }
    // ② 插入副本漂移 → mismatch（A4：手改 paper/figs/* 必须被发现）。
    for (const insertion of entry.insertedAt) {
      const copy = await this.readText(join(this.projectDir(project), insertion.target))
      if (copy === undefined || sha256Hex(copy) !== insertion.targetSha256) {
        return this.withVerification(entry, 'mismatch', 'recompute', checkedAt, '插入副本被改/缺失：' + insertion.target + '——恢复副本或重新 insert')
      }
    }
    // ③ 状态语义：示意/结构方法不复算。
    if (entry.provenance === 'illustrative') {
      return this.withVerification(entry, 'illustrative', 'structural', checkedAt, '示意素材（illustrative）——不做复算；正文使用须三处标注')
    }
    if (entry.kind === 'formula' || entry.kind === 'pseudocode') {
      return this.withVerification(entry, 'unverifiable', 'structural', checkedAt, entry.kind === 'formula'
        ? '公式门（sympy 等价检查）未接入——结构验证，论文引用须脚注「未验证」'
        : '伪代码为 spec 确定性渲染（无可复算数据源）——结构验证')
    }
    // ④ 逐 input 读当前内容；缺 → unverifiable「缺源」。
    const contents = new Map<string, string>()
    for (const input of entry.inputs) {
      const text = await this.readText(join(this.projectDir(project), input.path))
      if (text === undefined) {
        return this.withVerification(entry, 'unverifiable', 'recompute', checkedAt, '缺源：' + input.path + ' 不存在——恢复文件或重新 generate')
      }
      contents.set(input.path, text)
    }
    // ⑤ 用当前输入内容重渲染 → 哈希比对。
    try {
      let metrics: MetricsFile | undefined
      if (entry.kind === 'table' || entry.kind === 'plot') {
        const firstPath = entry.inputs[0]?.path
        const stored = firstPath === undefined ? undefined : contents.get(firstPath)
        if (firstPath === undefined || stored === undefined) {
          throw new ServiceError('INVALID', '素材 ' + entry.id + ' 的 inputs 不完整——重新 generate')
        }
        metrics = this.parseMetricsFile(stored, firstPath)
      }
      const text = renderArtifact(entry.id, entry.kind, entry.spec, metrics)
      const sha = sha256Hex(text)
      if (sha === entry.output.sha256) {
        return this.withVerification(entry, 'verified', 'recompute', checkedAt, '重渲染输出哈希与基线一致')
      }
      return this.withVerification(entry, 'mismatch', 'recompute', checkedAt, '重渲染输出与基线不一致（现 ' + sha.slice(0, 12) + '… ≠ 基线 ' + entry.output.sha256.slice(0, 12) + '…）——输入被改动，插入被阻断')
    } catch (error) {
      return this.withVerification(entry, 'mismatch', 'recompute', checkedAt, '重渲染失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** verify = recompute：复算并把 verification 写回 manifest。 */
  async verify(project: string, id: string): Promise<Artifact> {
    const manifest = await this.manifest(project)
    const entry = manifest.artifacts.find(artifact => artifact.id === id)
    if (entry === undefined) throw new ServiceError('NOT_FOUND', 'manifest 里没有素材 ' + JSON.stringify(id))
    const next = await this.recompute(project, entry)
    if (next !== entry) {
      await this.writeManifest(project, { schemaVersion: 1, artifacts: manifest.artifacts.map(artifact => artifact.id === id ? next : artifact) })
    }
    return next
  }

  /* ── 插入正文（G-M1 溯源门） ── */

  async insert(project: string, id: string, sectionId: string): Promise<InsertOutcome> {
    const manifest = await this.manifest(project)
    const entry = manifest.artifacts.find(artifact => artifact.id === id)
    if (entry === undefined) throw new ServiceError('NOT_FOUND', 'manifest 里没有素材 ' + JSON.stringify(id))
    await this.assertProjectExists(project)
    // G-M1：inputs 全部可解析；状态 ∈ {verified, unverifiable} 或 illustrative+allowed。
    const missingSources: string[] = []
    for (const input of entry.inputs) {
      if (await this.readText(join(this.projectDir(project), input.path)) === undefined) missingSources.push(input.path)
    }
    if (missingSources.length > 0) {
      throw new ServiceError('GATE', 'G-M1 溯源门：素材 ' + id + ' 的输入源缺失：' + missingSources.join(', ') + '——先恢复源文件再 insert')
    }
    const statusOk = entry.verification.status === 'verified' || entry.verification.status === 'unverifiable'
    const illustrativeOk = entry.provenance === 'illustrative' && entry.illustrative.allowed === true
    if (!statusOk && !illustrativeOk) {
      throw new ServiceError('GATE', 'G-M1 溯源门：素材 ' + id + ' 当前状态 ' + entry.verification.status + '，禁止插入正文（' + entry.verification.detail + '）——先 verify 复绿')
    }
    // outline 必须存在且 sectionId 有效（不要求 confirmed——插入素材不等于动大纲）。
    const outline = await this.outlineOf(project)
    if (outline === undefined) throw new ServiceError('NOT_FOUND', '大纲不存在——先 srw_paper 骨架生成或 outline.save')
    const section = outline.sections.find(item => item.id === sectionId)
    if (section === undefined) throw new ServiceError('NOT_FOUND', '大纲没有节 ' + JSON.stringify(sectionId))
    if (section.file === undefined || !isSafeSectionFile(section.file)) {
      throw new ServiceError('INVALID', '节 ' + sectionId + ' 未绑定合法章节文件——重新 outline.save')
    }
    // 产物复制 → paper/figs/<id>.tex（受哈希保护的插入副本）。
    const tex = await this.readText(join(this.projectDir(project), entry.path))
    if (tex === undefined) throw new ServiceError('NOT_FOUND', '产物缺失：' + entry.path + '——重新 generate')
    const targetRel = 'paper/figs/' + id + '.tex'
    await this.writeText(join(this.projectDir(project), targetRel), tex)
    // 节文件末尾追加 \input{figs/<id>}（幂等去重；\label 由产物内部提供）。
    const sectionAbs = join(this.projectDir(project), 'paper', section.file)
    const current = await this.readText(sectionAbs)
    if (current === undefined) throw new ServiceError('NOT_FOUND', '节文件缺失：paper/' + section.file + '——先 section.write 落正文')
    const inputLine = '\\input{figs/' + id + '}'
    if (!current.split('\n').some(line => line.trim() === inputLine)) {
      await this.writeText(sectionAbs, current.trimEnd() + '\n' + inputLine + '\n')
    }
    const record: InsertionRecord = {
      sectionId,
      file: section.file,
      label: KIND_LABEL_PREFIX[entry.kind] + ':' + id,
      target: targetRel,
      targetSha256: sha256Hex(tex),
    }
    const nextEntry: Artifact = {
      ...entry,
      insertedAt: [...entry.insertedAt.filter(row => row.sectionId !== sectionId), record],
    }
    await this.writeManifest(project, { schemaVersion: 1, artifacts: manifest.artifacts.map(artifact => artifact.id === id ? nextEntry : artifact) })
    return { artifact: nextEntry, inserted: record }
  }

  /** 撤销插入：删 paper/figs/<id>.tex、从各节文件剔除 \input 行、清 insertedAt。 */
  async removeInserted(project: string, id: string): Promise<{ removed: readonly string[] }> {
    const manifest = await this.manifest(project)
    const entry = manifest.artifacts.find(artifact => artifact.id === id)
    if (entry === undefined) throw new ServiceError('NOT_FOUND', 'manifest 里没有素材 ' + JSON.stringify(id))
    await this.assertProjectExists(project)
    const removed: string[] = []
    const targetRel = 'paper/figs/' + id + '.tex'
    const targetAbs = join(this.projectDir(project), targetRel)
    if (await this.readText(targetAbs) !== undefined) {
      await this.guard(targetAbs)
      await rm(targetAbs, { force: true })
      removed.push(targetRel)
    }
    const files = [...new Set(entry.insertedAt.map(row => row.file))]
    for (const file of files) {
      const abs = join(this.projectDir(project), 'paper', file)
      const text = await this.readText(abs)
      if (text === undefined) continue
      const kept = text.split('\n').filter(line => line.trim() !== '\\input{figs/' + id + '}')
      const next = kept.join('\n')
      if (next !== text) {
        await this.writeText(abs, next)
        removed.push('paper/' + file)
      }
    }
    if (entry.insertedAt.length > 0) {
      await this.writeManifest(project, {
        schemaVersion: 1,
        artifacts: manifest.artifacts.map(artifact => artifact.id === id ? { ...artifact, insertedAt: [] } : artifact),
      })
    }
    return { removed }
  }

  /** 编译前门：逐 insertedAt 读 target 现 sha256 ≠ targetSha256 → GATE
   * ARTIFACT_DRIFT（可检测不能阻止直写文件——诚实声明边界）。
   * 无 manifest 直接返回（无素材项目零开销）。 */
  async checkInsertions(project: string): Promise<{ ok: true; checked: number }> {
    const raw = await this.readText(this.manifestPath(project))
    if (raw === undefined) return { ok: true, checked: 0 }
    const manifest = await this.manifest(project)
    let checked = 0
    for (const entry of manifest.artifacts) {
      for (const insertion of entry.insertedAt) {
        checked += 1
        const current = await this.readText(join(this.projectDir(project), insertion.target))
        if (current === undefined) {
          throw new ServiceError('GATE', 'ARTIFACT_DRIFT: 素材 ' + entry.id + ' 的插入副本 ' + insertion.target + ' 缺失（节 ' + insertion.sectionId + ' 的 \input 悬空）——重新 insert 或 remove')
        }
        const sha = sha256Hex(current)
        if (sha !== insertion.targetSha256) {
          throw new ServiceError('GATE', 'ARTIFACT_DRIFT: 素材 ' + entry.id + ' 的插入副本 ' + insertion.target + ' 已被手改（现 ' + sha.slice(0, 12) + '… ≠ 记录 ' + insertion.targetSha256.slice(0, 12) + '…）——恢复副本或重新 insert')
        }
      }
    }
    return { ok: true, checked }
  }

  /* ── metrics 导入（M7 未开工时的补数据通道） ── */

  async importMetrics(project: string, input: ImportMetricsInput): Promise<{ path: string; sha256: string; runId: string }> {
    if (typeof input.runId !== 'string' || !RUN_ID_RE.test(input.runId)) {
      throw new ServiceError('INVALID', 'runId 必须匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$：' + JSON.stringify(input.runId))
    }
    const errors = validateMetricsPayload(input.metrics)
    if (errors.length > 0) throw new ServiceError('INVALID', 'metrics 形状校验失败：' + errors.join('；'))
    await this.assertProjectExists(project)
    const payload = input.metrics as { values: Record<string, unknown>; series?: readonly SeriesDef[] }
    const text = metricsFileText(input.runId, payload)
    const relPath = 'experiments/manual/' + input.runId + '/metrics.json'
    await this.writeText(join(this.projectDir(project), relPath), text)
    const runMeta: RunMeta = { schemaVersion: 1, runId: input.runId, source: 'manual', importedAt: new Date().toISOString() }
    await this.writeText(join(this.projectDir(project), 'experiments/manual/' + input.runId + '/run.json'), JSON.stringify(runMeta, null, 2) + '\n')
    return { path: relPath, sha256: sha256Hex(text), runId: input.runId }
  }

  /** 扫 experiments/manual/<runId>/metrics.json（坏文件显式报错——论文数字不允许静默丢源）。 */
  private async listRuns(project: string): Promise<readonly { readonly runId: string; readonly path: string; readonly file: MetricsFile }[]> {
    const manualDir = join(this.projectDir(project), 'experiments', 'manual')
    await this.guard(manualDir)
    let entries: string[]
    try {
      entries = await readdir(manualDir)
    } catch {
      return []
    }
    const runs: { runId: string; path: string; file: MetricsFile }[] = []
    for (const entry of entries.sort()) {
      if (!RUN_ID_RE.test(entry)) continue
      const relPath = 'experiments/manual/' + entry + '/metrics.json'
      const text = await this.readText(join(this.projectDir(project), relPath))
      if (text === undefined) continue
      runs.push({ runId: entry, path: relPath, file: this.parseMetricsFile(text, relPath) })
    }
    return runs
  }

  /* ── 数字宏（正文写 \srw<Name>，数字必须可回指） ── */

  async numbersGenerate(project: string): Promise<{ texPath: string; jsonPath: string; macros: readonly NumberMacro[] }> {
    await this.assertProjectExists(project)
    const runs = await this.listRuns(project)
    const byName = new Map<string, NumberMacro>()
    for (const run of runs) {
      for (const metric of Object.keys(run.file.values).sort()) {
        // 指标名不合法（无法成宏）的直接跳过；合法名后者覆盖前者（runId 升序）。
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(metric)) continue
        const name = macroNameFor(metric)
        byName.set(name, { name, metric, path: run.path, value: run.file.values[metric]!.value })
      }
    }
    const macros = [...byName.values()]
    const texPath = 'paper/generated/srw-numbers.tex'
    const jsonPath = 'paper/generated/numbers.json'
    await this.writeText(join(this.projectDir(project), texPath), numbersTexText(macros))
    await this.writeText(join(this.projectDir(project), jsonPath), JSON.stringify({ macros }, null, 2) + '\n')
    return { texPath, jsonPath, macros }
  }

  /** 裸数字审计：outline 绑定节文件里扫 /\b\d+\.\d+\b/（排除注释行与
   * \newcommand 定义行），列「未溯源数字」（warn 面；上限 200）。 */
  async numbersAudit(project: string): Promise<{ count: number; truncated: boolean; findings: readonly BareNumberFinding[] }> {
    const outline = await this.outlineOf(project)
    const findings: BareNumberFinding[] = []
    if (outline === undefined) return { count: 0, truncated: false, findings }
    for (const section of outline.sections) {
      if (section.file === undefined || !isSafeSectionFile(section.file)) continue
      const text = await this.readText(join(this.projectDir(project), 'paper', section.file))
      if (text === undefined) continue
      for (const hit of scanBareNumbers(text)) {
        if (findings.length >= AUDIT_CAP) return { count: findings.length, truncated: true, findings }
        findings.push({ file: section.file, line: hit.line, text: hit.text })
      }
    }
    return { count: findings.length, truncated: false, findings }
  }
}
