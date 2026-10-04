/** 工作台视图（0102 §9.2 视图 1 的 M1 子集）：项目头（总根选择 + 引擎
 * 工作区口径核对）+ 项目列表（新建/打开）+ 阶段流水线（只读）+ 诊断折叠卡。
 * 轮询只打 `overview`（5s，页面隐藏时暂停）；项目数据经 `root.get`。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientContext } from './protocol-client.ts'
import { DiagView } from './view.tsx'

const RPC_CHANNEL = '/dsh-kylin-srw'

const STAGES = ['idea', 'literature', 'reading', 'writing', 'experiments', 'submission'] as const

const STAGE_LABELS: Record<string, string> = {
  idea: '选题',
  literature: '文献',
  reading: '精读',
  writing: '写作',
  experiments: '实验',
  submission: '投稿',
}

interface ProjectMetaLite {
  readonly slug: string
  readonly title: string
  readonly stage: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly field?: string
}

interface OverviewLite {
  readonly rootDir: string
  readonly projectCount: number
  readonly activeProject: string
  readonly activeStage?: string
  readonly capsOk: number
  readonly capsTotal: number
  readonly version: string
  readonly offlineMode: boolean
}

async function rpc<T>(ctx: ClientContext, endpoint: string, payload?: unknown): Promise<T> {
  const rpcFace = ctx.connection?.rpc
  const call = rpcFace?.call
  if (call === undefined) throw new Error('connection.rpc.call 不可用')
  const raw = await call.call(rpcFace, RPC_CHANNEL, endpoint, payload)
  const envelope = raw as { ok?: boolean; value?: T; error?: { code: string; message: string } }
  if (envelope !== null && typeof envelope === 'object' && envelope.ok === true) return envelope.value as T
  const message = envelope !== null && typeof envelope === 'object' && envelope.error !== undefined
    ? `${envelope.error.code}: ${envelope.error.message}`
    : String(raw)
  throw new Error(message)
}

function fmtTime(iso: string): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return iso
  const delta = Date.now() - at
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return new Date(at).toLocaleDateString()
}

export function WorkbenchView({ ctx }: { readonly ctx: ClientContext }): React.ReactElement {
  const [overview, setOverview] = useState<OverviewLite | null>(null)
  const [projects, setProjects] = useState<readonly ProjectMetaLite[]>([])
  const [engineWorkspaces, setEngineWorkspaces] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [diagOpen, setDiagOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formSlug, setFormSlug] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      const value = await rpc<{ projects?: readonly ProjectMetaLite[] }>(ctx, 'root.get')
      if (alive.current) setProjects(value.projects ?? [])
    } catch (cause) {
      if (alive.current) setError(String(cause))
    }
  }, [ctx])

  /* 5s 轮询 overview；页面隐藏时暂停（0102 §9.2 面板纪律）。 */
  useEffect(() => {
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return
      try {
        const value = await rpc<OverviewLite>(ctx, 'overview')
        if (alive.current) {
          setOverview(value)
          setError(null)
        }
      } catch (cause) {
        if (alive.current) setError(String(cause))
      }
    }
    void poll()
    timer = window.setInterval(() => { void poll() }, 5000)
    const onVisible = (): void => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ctx])

  /* 引擎工作区口径（S1 判据数据源）：快照读取，不订阅（轮询时顺带刷新）。 */
  useEffect(() => {
    const snapshot = ctx.workspaces?.list?.getSnapshot?.()
    if (snapshot !== undefined) {
      setEngineWorkspaces((snapshot.items ?? [])
        .map(item => item.title ?? item.path ?? '')
        .filter(title => title !== ''))
    }
  }, [ctx, overview])

  const chooseRoot = useCallback(async (): Promise<void> => {
    const picker = ctx.uiWorkspace?.pickDirectory
    if (picker === undefined) {
      setError('uiWorkspace.pickDirectory 不可达（client 注入缺席）')
      return
    }
    try {
      setBusy(true)
      setError(null)
      setNotice(null)
      const picked = await picker.call(ctx.uiWorkspace)
      if (picked === null || picked === '') {
        setNotice('已取消选择')
        return
      }
      await rpc(ctx, 'root.set', { path: picked })
      const value = await rpc<OverviewLite>(ctx, 'overview')
      if (alive.current) {
        setOverview(value)
        setNotice(`科研总根已设置：${picked}`)
      }
      await refreshProjects()
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [ctx, refreshProjects])

  const createProject = useCallback(async (): Promise<void> => {
    const slug = formSlug.trim()
    const title = formTitle.trim()
    if (slug === '' || title === '') {
      setError('slug 与 title 都必填')
      return
    }
    try {
      setBusy(true)
      setError(null)
      await rpc(ctx, 'project.create', { slug, title })
      setFormOpen(false)
      setFormSlug('')
      setFormTitle('')
      await refreshProjects()
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [ctx, formSlug, formTitle, refreshProjects])

  const openProject = useCallback(async (slug: string): Promise<void> => {
    try {
      setBusy(true)
      setError(null)
      await rpc(ctx, 'project.open', { slug })
      const value = await rpc<OverviewLite>(ctx, 'overview')
      if (alive.current) setOverview(value)
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [ctx])

  const removeProject = useCallback(async (slug: string): Promise<void> => {
    // M1 基础版：confirm 对话框二次确认（宿主内建 confirm 不可用时拒绝动作）
    try {
      if (window.confirm !== undefined && !window.confirm(`删除项目「${slug}」？目录及其全部内容将一并删除。`)) return
    } catch { return }
    try {
      setBusy(true)
      setError(null)
      await rpc(ctx, 'project.remove', { slug })
      await refreshProjects()
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [ctx, refreshProjects])

  const activeStage = overview?.activeStage
  const rootDir = overview?.rootDir ?? ''

  return (
    <div className='srw-panel'>
      <h1 className='srw-h1'>科研工作台</h1>
      <p className='srw-sub'>
        {overview === null
          ? '加载中…'
          : `v${overview.version} · 项目 ${overview.projectCount} · 活动项目 ${overview.activeProject === '' ? '（未选）' : overview.activeProject} · 能力 ${overview.capsOk}/${overview.capsTotal} · 离线 ${overview.offlineMode ? '开' : '关'}`}
      </p>
      {error !== null ? <p className='srw-error'>{error}</p> : null}
      {notice !== null ? <p className='srw-detail'>{notice}</p> : null}

      <div className='srw-card'>
        <h2>科研总根</h2>
        <p className='srw-detail'>{rootDir === '' ? '未设置——选择一个目录作为全部科研项目的总根' : rootDir}</p>
        <div className='srw-actions'>
          <button className='srw-btn primary' disabled={busy} onClick={() => { void chooseRoot() }}>
            {rootDir === '' ? '选择科研总根' : '更换科研总根'}
          </button>
        </div>
        {engineWorkspaces.length > 0 ? (
          <p className='srw-detail'>引擎工作区：{engineWorkspaces.join('、')}（口径核对：上方总根应与某一工作区目录一致）</p>
        ) : null}
      </div>

      <div className='srw-card'>
        <h2>项目</h2>
        {rootDir === '' ? (
          <p className='srw-detail'>先设置科研总根，再创建项目。</p>
        ) : (
          <>
            <div className='srw-actions'>
              <button className='srw-btn' disabled={busy} onClick={() => { setFormOpen(open => !open) }}>
                {formOpen ? '收起表单' : '新建项目'}
              </button>
            </div>
            {formOpen ? (
              <div className='srw-actions srw-form'>
                <input
                  className='srw-input'
                  placeholder='slug（小写字母数字连字符）'
                  value={formSlug}
                  onChange={event => { setFormSlug(event.target.value) }}
                />
                <input
                  className='srw-input'
                  placeholder='标题（≤200 字）'
                  value={formTitle}
                  onChange={event => { setFormTitle(event.target.value) }}
                />
                <button className='srw-btn primary' disabled={busy} onClick={() => { void createProject() }}>创建</button>
              </div>
            ) : null}
            {projects.length === 0 ? (
              <p className='srw-detail'>还没有项目。</p>
            ) : (
              <ul className='srw-projects'>
                {projects.map(project => (
                  <li key={project.slug} className={`srw-project ${project.slug === overview?.activeProject ? 'active' : ''}`}>
                    <div className='srw-project-main'>
                      <span className='srw-project-title'>{project.title}</span>
                      <span className='srw-badge'>{STAGE_LABELS[project.stage] ?? project.stage}</span>
                    </div>
                    <div className='srw-project-meta'>
                      <span>{project.slug}</span>
                      <span>·</span>
                      <span>{fmtTime(project.updatedAt)}</span>
                    </div>
                    <div className='srw-actions'>
                      {project.slug === overview?.activeProject ? (
                        <span className='srw-detail'>当前项目</span>
                      ) : (
                        <button className='srw-btn' disabled={busy} onClick={() => { void openProject(project.slug) }}>打开</button>
                      )}
                      <button className='srw-btn danger' disabled={busy} onClick={() => { void removeProject(project.slug) }}>删除</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {activeStage !== undefined ? (
        <div className='srw-card'>
          <h2>阶段流水线（{STAGE_LABELS[activeStage] ?? activeStage}）</h2>
          <div className='srw-pipeline'>
            {STAGES.map(stage => (
              <span key={stage} className={`srw-stage ${stage === activeStage ? 'current' : ''}`}>
                {STAGE_LABELS[stage] ?? stage}
              </span>
            ))}
          </div>
          <p className='srw-detail'>M1 阶段为只读展示；阶段推进随 M2+ 领域模块解锁。</p>
        </div>
      ) : null}

      <div className='srw-card'>
        <h2>
          <button className='srw-btn link' onClick={() => { setDiagOpen(open => !open) }}>
            {diagOpen ? '▾' : '▸'} 诊断（能力探测 / E1 探测 / contains 实测）
          </button>
        </h2>
        {diagOpen ? <DiagView ctx={ctx} /> : null}
      </div>
    </div>
  )
}
