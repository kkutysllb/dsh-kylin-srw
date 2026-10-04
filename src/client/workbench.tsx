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

interface LitCandidateLite {
  readonly source: string
  readonly identity: { readonly title: string; readonly year: number; readonly doi?: string; readonly arxivId?: string }
  readonly authors: readonly string[]
  readonly venue: string
  readonly pdfUrl?: string
  readonly oaUrl?: string
}

interface LibEntryLite {
  readonly key: string
  readonly identity: { readonly title: string; readonly year: number }
  readonly status: string
  readonly seenIn: readonly string[]
  readonly pdf?: { readonly file: string }
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
  const [confirmingSlug, setConfirmingSlug] = useState<string | null>(null)
  const [litSource, setLitSource] = useState<'arxiv' | 'openalex' | 'crossref'>('arxiv')
  const [litQuery, setLitQuery] = useState('')
  const [litResults, setLitResults] = useState<readonly LitCandidateLite[]>([])
  const [libEntries, setLibEntries] = useState<readonly LibEntryLite[]>([])
  const [litBusy, setLitBusy] = useState(false)
  const [litNotice, setLitNotice] = useState<string | null>(null)
  const alive = useRef(true)
  const confirmTimer = useRef<number | undefined>(undefined)

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
    // 项目列表首载：overview 只有计数，列表需单独 root.get（此前只在
    // 增删后刷新——页面重载后列表空、计数非零的不一致已修）。
    void refreshProjects()
    timer = window.setInterval(() => { void poll() }, 5000)
    const onVisible = (): void => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ctx, refreshProjects])

  /* 引擎工作区口径（S1 判据数据源）：快照读取，不订阅（轮询时顺带刷新）。 */
  useEffect(() => {
    const snapshot = ctx.workspaces?.list?.getSnapshot?.()
    if (snapshot !== undefined) {
      setEngineWorkspaces((snapshot.items ?? [])
        .map(item => item.title ?? item.path ?? '')
        .filter(title => title !== ''))
    }
  }, [ctx, overview])

  const applyRoot = useCallback(async (picked: string): Promise<void> => {
    try {
      setError(null)
      setNotice(null)
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

  /** 选根：native 对话框弹在宿主屏幕（用户已实测可用）；browse 后端（无头/
   * SSH 启动）也走同一 pickDirectory，由宿主 auto 选择交互。8s 超时只是
   * 护栏：解除 busy 并提示对话框在宿主屏幕等待（自动化/远程场景的诚实文案）。 */
  const chooseRoot = useCallback(async (): Promise<void> => {
    const picker = ctx.uiWorkspace?.pickDirectory
    if (picker === undefined) {
      setError('uiWorkspace.pickDirectory 不可达（client 注入缺席）')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    let timedOut = false
    const timer = window.setTimeout(() => {
      timedOut = true
      setBusy(false)
      setNotice('目录框可能已弹出在宿主屏幕上等待选择；若未出现请重启宿主后再试。')
    }, 8000)
    try {
      const picked = await picker.call(ctx.uiWorkspace)
      if (timedOut) return // 迟到结果丢弃：提示已给出，避免双写
      if (picked === null || picked === '') {
        setNotice('已取消选择')
        return
      }
      await applyRoot(picked)
    } catch (cause) {
      if (!timedOut && alive.current) setError(String(cause))
    } finally {
      window.clearTimeout(timer)
      if (!timedOut && alive.current) setBusy(false)
    }
  }, [ctx, applyRoot])

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

  /** 删除（可用性修复②）：面板内两步确认——webview 里 window.confirm 不可靠
   * （可能被拦或恒 undefined），改「删除 → 确认删除？」按钮态，6s 不确认自动回退。 */
  const removeProject = useCallback(async (slug: string): Promise<void> => {
    if (confirmingSlug !== slug) {
      setConfirmingSlug(slug)
      if (confirmTimer.current !== undefined) window.clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => { setConfirmingSlug(null) }, 6000)
      return
    }
    if (confirmTimer.current !== undefined) window.clearTimeout(confirmTimer.current)
    setConfirmingSlug(null)
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
  }, [ctx, refreshProjects, confirmingSlug])

  /* ── 文献通路（M2）：检索 / 入库 / 取 PDF / 导出 BibTeX ── */
  const refreshLib = useCallback(async (slug: string): Promise<void> => {
    try {
      const value = await rpc<{ entries?: readonly LibEntryLite[] }>(ctx, 'literature.lib', { project: slug })
      if (alive.current) setLibEntries(value.entries ?? [])
    } catch (cause) {
      if (alive.current) setError(String(cause))
    }
  }, [ctx])

  const litSearch = useCallback(async (): Promise<void> => {
    const query = litQuery.trim()
    if (query === '') return
    try {
      setLitBusy(true)
      setLitNotice(null)
      setError(null)
      const value = await rpc<{ items?: readonly LitCandidateLite[] }>(ctx, 'literature.search', { source: litSource, query, limit: 15 })
      if (alive.current) {
        setLitResults(value.items ?? [])
        setLitNotice(`检索到 ${value.items?.length ?? 0} 条（${litSource}）`)
      }
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setLitBusy(false)
    }
  }, [ctx, litQuery, litSource])

  const litImport = useCallback(async (items: readonly LitCandidateLite[]): Promise<void> => {
    const slug = overview?.activeProject
    if (slug === undefined || slug === '') {
      setError('先打开一个项目再入库（项目卡「打开」）')
      return
    }
    try {
      setLitBusy(true)
      setError(null)
      const value = await rpc<{ added: number; duplicates: number; retracted: string[] }>(ctx, 'literature.import', { project: slug, items })
      if (alive.current) {
        setLitNotice(`入库完成：新增 ${value.added}，去重跳过 ${value.duplicates}${value.retracted.length > 0 ? `，撤稿标红 ${value.retracted.length}` : ''}`)
        await refreshLib(slug)
      }
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setLitBusy(false)
    }
  }, [ctx, overview, refreshLib])

  const litPdf = useCallback(async (key: string): Promise<void> => {
    const slug = overview?.activeProject
    if (slug === undefined || slug === '') return
    try {
      setLitBusy(true)
      setError(null)
      await rpc(ctx, 'literature.fetchPdf', { project: slug, key })
      if (alive.current) {
        setLitNotice('PDF 已落盘 literature/pdf/')
        await refreshLib(slug)
      }
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setLitBusy(false)
    }
  }, [ctx, overview, refreshLib])

  const litBibtex = useCallback(async (): Promise<void> => {
    const slug = overview?.activeProject
    if (slug === undefined || slug === '') return
    try {
      setLitBusy(true)
      setError(null)
      const value = await rpc<{ added: readonly string[]; skippedRetracted: string[] }>(ctx, 'literature.bibtex', { project: slug })
      if (alive.current) {
        setLitNotice(`refs.bib 已更新：新增 ${value.added.length} 条${value.skippedRetracted.length > 0 ? `，撤稿跳过 ${value.skippedRetracted.length}` : ''}`)
      }
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      if (alive.current) setLitBusy(false)
    }
  }, [ctx, overview])

  /* 活动项目变化 → 刷新文献库列表 */
  useEffect(() => {
    const slug = overview?.activeProject
    if (slug !== undefined && slug !== '') void refreshLib(slug)
  }, [overview?.activeProject, refreshLib])

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
                      <button
                        className={`srw-btn ${confirmingSlug === project.slug ? 'danger-confirm' : 'danger'}`}
                        disabled={busy}
                        onClick={() => { void removeProject(project.slug) }}
                      >
                        {confirmingSlug === project.slug ? '确认删除？（不可恢复）' : '删除'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className='srw-card'>
        <h2>文献（{overview?.activeProject === '' || overview?.activeProject === undefined ? '未选项目' : `项目 ${overview.activeProject}`}）</h2>
        <div className='srw-actions'>
          <select
            className='srw-input'
            value={litSource}
            onChange={event => { setLitSource(event.target.value as typeof litSource) }}
          >
            <option value='arxiv'>arXiv</option>
            <option value='openalex'>OpenAlex</option>
            <option value='crossref'>Crossref</option>
          </select>
          <input
            className='srw-input'
            placeholder='检索词（arXiv 可带 ti:/au:/all: 前缀）'
            value={litQuery}
            onChange={event => { setLitQuery(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter') { void litSearch() } }}
          />
          <button className='srw-btn primary' disabled={litBusy} onClick={() => { void litSearch() }}>检索</button>
          <button className='srw-btn' disabled={litBusy || libEntries.length === 0} onClick={() => { void litBibtex() }}>导出 BibTeX</button>
        </div>
        {litNotice !== null ? <p className='srw-detail'>{litNotice}</p> : null}
        {litResults.length > 0 ? (
          <ul className='srw-projects'>
            {litResults.map(item => {
              const key = `${item.source}:${item.identity.doi ?? item.identity.arxivId ?? item.identity.title}`
              return (
                <li key={key} className='srw-project'>
                  <div className='srw-project-main'>
                    <span className='srw-project-title'>{item.identity.title}</span>
                    <span className='srw-badge'>{item.identity.year}</span>
                    {item.pdfUrl !== undefined || item.oaUrl !== undefined ? <span className='srw-badge'>OA</span> : null}
                  </div>
                  <div className='srw-project-meta'>
                    <span>{item.authors.slice(0, 3).join(', ')}{item.authors.length > 3 ? ' 等' : ''}</span>
                    <span>·</span>
                    <span>{item.venue === '' ? item.source : item.venue}</span>
                  </div>
                  <div className='srw-actions'>
                    <button className='srw-btn' disabled={litBusy || overview?.activeProject === '' || overview?.activeProject === undefined} onClick={() => { void litImport([item]) }}>入库</button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
        {libEntries.length > 0 ? (
          <>
            <h2 style={{ marginTop: 10 }}>项目库（{libEntries.length}）</h2>
            <ul className='srw-projects'>
              {libEntries.map(entry => (
                <li key={entry.key} className='srw-project'>
                  <div className='srw-project-main'>
                    <span className='srw-project-title'>{entry.identity.title}</span>
                    <span className={`srw-badge ${entry.status === 'retracted' ? 'bad' : ''}`}>
                      {entry.status === 'unread' ? '未读' : entry.status === 'has-pdf' ? '有 PDF' : entry.status === 'retracted' ? '已撤稿' : entry.status}
                    </span>
                  </div>
                  <div className='srw-project-meta'>
                    <span>{entry.identity.year}</span>
                    <span>·</span>
                    <span>{entry.seenIn.join('+')}</span>
                  </div>
                  <div className='srw-actions'>
                    {entry.pdf === undefined ? (
                      <button className='srw-btn' disabled={litBusy} onClick={() => { void litPdf(entry.key) }}>取 PDF</button>
                    ) : (
                      <span className='srw-detail'>PDF 已在 literature/pdf/</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
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
