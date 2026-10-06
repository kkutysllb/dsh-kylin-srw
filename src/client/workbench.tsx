/** 工作台视图（0102 §9.2 视图 1 的 M1 子集）：项目头（总根选择 + 引擎
 * 工作区口径核对）+ 项目列表（新建/打开）+ 阶段流水线（只读）+ 诊断折叠卡。
 * 轮询只打 `overview`（5s，页面隐藏时暂停）；项目数据经 `root.get`。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientContext } from './protocol-client.ts'
import { DiagView } from './view.tsx'
import { parsePaper } from '../reading/render.ts'

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
  readonly watchSummary?: { readonly total: number; readonly enabled: number; readonly lastFresh?: number; readonly lastError?: string }
}

interface WatchSubLite {
  readonly id: string
  readonly project: string
  readonly source: string
  readonly query: string
  readonly everySeconds: number
  readonly enabled: boolean
  readonly boundSessionId?: string
  readonly scheduleId?: string
  readonly lastRunAt?: string
  readonly lastResult?: { readonly at: string; readonly kind: string; readonly fresh?: number; readonly error?: string }
}

interface ReadingStatusLite {
  readonly paperKey: string
  readonly extracted: boolean
  readonly pages: number
  readonly blocks: number
  readonly translated: number
  readonly verified: number
  readonly mismatch: number
  readonly orphan: number
  readonly missing: number
  readonly llmAvailable: boolean
}

interface ReadingViewBlock {
  readonly id: string
  readonly state: 'verified' | 'mismatch' | 'orphan'
  readonly sourceText: string
  readonly translation?: string
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

/** 库条目 key（如 arxiv:1706.03762）→ 合法 paperKey（PAPER_KEY_RE 口径）。 */
function paperKeyOfLite(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
  return slug === '' ? 'paper' : slug
}

/** 库里存的 pdf.file 是根相对（含项目前缀）；reading.extract 要项目相对。 */
function pdfPathOfEntry(file: string, project: string): string {
  return file.startsWith(`${project}/`) ? file.slice(project.length + 1) : file
}

const READING_STATE_LABELS: Record<string, string> = {
  verified: '✓ 源段一致',
  mismatch: '⚠ 源文被改',
  orphan: '孤立块',
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
  const [watchSubs, setWatchSubs] = useState<readonly WatchSubLite[]>([])
  const [watchSource, setWatchSource] = useState<'arxiv' | 'openalex' | 'crossref'>('arxiv')
  const [watchQuery, setWatchQuery] = useState('')
  const [watchEvery, setWatchEvery] = useState(86_400)
  const [watchBusy, setWatchBusy] = useState(false)
  const [watchNotice, setWatchNotice] = useState<string | null>(null)
  const [confirmingWatchId, setConfirmingWatchId] = useState<string | null>(null)
  const [readingSelKey, setReadingSelKey] = useState('')
  const [readingKey, setReadingKey] = useState('')
  const [readingStatus, setReadingStatus] = useState<ReadingStatusLite | null>(null)
  const [readingView, setReadingView] = useState<readonly ReadingViewBlock[] | null>(null)
  const [readingBusy, setReadingBusy] = useState(false)
  const [readingNotice, setReadingNotice] = useState<string | null>(null)
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

  /* ── 订阅抓取（M3）：触发绑内置「自动化任务」，执行是 host 代码 ── */
  const refreshWatch = useCallback(async (): Promise<void> => {
    try {
      const subs = await rpc<readonly WatchSubLite[]>(ctx, 'watch.list')
      if (alive.current) setWatchSubs(subs)
    } catch { /* 无根等场景：卡片显示空表即可 */ }
  }, [ctx])

  const watchCreate = async (): Promise<void> => {
    const project = overview?.activeProject ?? ''
    if (project === '') { setWatchNotice('先创建/打开一个项目再订阅'); return }
    if (watchQuery.trim() === '') { setWatchNotice('检索词不能为空'); return }
    setWatchBusy(true)
    try {
      const result = await rpc<{ scheduled: boolean; hint?: string }>(ctx, 'watch.create', {
        project, source: watchSource, query: watchQuery, everySeconds: watchEvery,
      })
      setWatchQuery('')
      setWatchNotice(result.scheduled === true
        ? '已订阅：时钟任务已写入宿主「自动化任务」页（到期自动抓取入库）'
        : `已订阅但未排程：${result.hint ?? ''}`)
      await refreshWatch()
    } catch (cause) {
      setWatchNotice(`订阅失败：${String(cause)}`)
    } finally {
      if (alive.current) setWatchBusy(false)
    }
  }

  const watchAction = async (action: 'pause' | 'resume' | 'remove' | 'run', id: string): Promise<void> => {
    setWatchBusy(true)
    try {
      if (action === 'run') {
        const result = await rpc<{ fresh: number }>(ctx, 'watch.run', { id })
        setWatchNotice(`抓取完成：新增 ${result.fresh} 条`)
      } else if (action === 'remove') {
        await rpc(ctx, 'watch.remove', { id })
        setWatchNotice('订阅已删除（时钟任务同步移除）')
      } else {
        const result = await rpc<{ scheduled?: boolean; hint?: string; sub?: WatchSubLite }>(ctx, `watch.${action}`, { id })
        setWatchNotice(action === 'pause'
          ? '已暂停（时钟任务已移除，订阅保留）'
          : (result.scheduled === true ? '已恢复：时钟任务已重建' : `已恢复但未排程：${result.hint ?? ''}`))
      }
      await refreshWatch()
    } catch (cause) {
      setWatchNotice(`操作失败：${String(cause)}`)
    } finally {
      if (alive.current) setWatchBusy(false)
    }
  }

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
    void refreshWatch()
    timer = window.setInterval(() => { void poll() }, 5000)
    const onVisible = (): void => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ctx, refreshProjects, refreshWatch])

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
  }, [ctx, refreshProjects, refreshWatch])

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
      // literature.search 返回裸数组（候选列表）；此前误读 value.items 恒 undefined
      const items = await rpc<readonly LitCandidateLite[]>(ctx, 'literature.search', { source: litSource, query, limit: 15 })
      if (alive.current) {
        setLitResults(items)
        setLitNotice(`检索到 ${items.length} 条（${litSource}）`)
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

  /** 把自包含提示词发给当前会话的 Agent（引擎车道，litToAgent/精读翻译共用）。
   * 先 `ctx.layout.selectPanel(null)` 把主区交还会话页（宿主 input shell 需要
   * **活跃的会话控制器**——面板占主区时 setDraft/submit 实测读 undefined 控制器，
   * 切换给会话面挂载留 ~400ms），再走 E1 通路（retain→binding→input.for。
   * setDraft+submit）；两路都断降级剪贴板。返回 'sent' | 'clipboard'。 */
  const sendToCurrentAgent = useCallback(async (prompt: string): Promise<'sent' | 'clipboard'> => {
    const sessions = ctx.sessions
    if (sessions === undefined || ctx.conversation?.input?.for === undefined) {
      setError('会话输入通路不可达（sessions/conversation 未注入）')
      return 'clipboard'
    }
    // 会话 id 主源：uiSession.adapter.current.key（实测返回正确 id 字符串）；
    // sessions.list 的 current 形状不可靠（litToAgent 首版用它导致 retain 挂死）。
    let current: string | undefined
    try {
      const key = ctx.uiSession?.adapter?.current?.getSnapshot?.().key
      if (typeof key === 'string' && key !== '') current = key
    } catch { /* 探测失败走 fallback */ }
    if (current === undefined || current === '') {
      const snap = sessions.list?.getSnapshot?.() as { current?: unknown } | undefined
      if (typeof snap?.current === 'string' && snap.current !== '') current = snap.current
    }
    if (current === undefined || current === '') {
      setError('没有打开中的会话——先在左侧开一个会话（agent 任务需要会话承载）')
      return 'clipboard'
    }
    type AnyFn = (...args: unknown[]) => unknown
    const withTimeout = async <T,>(promise: Promise<T> | T, ms = 4000): Promise<T> =>
      await Promise.race([Promise.resolve(promise), new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error('timeout')) }, ms) })])
    const tryPath = async (usePathB: boolean): Promise<void> => {
      const anySessions = sessions as unknown as Record<string, unknown>
      let carrier: unknown
      if (!usePathB) {
        const ref = (anySessions['retain'] as AnyFn).call(sessions, current, { source: 'srw' }) as { ready?: Promise<unknown>; release?: () => void } | undefined
        if (ref?.ready !== undefined) await withTimeout(ref.ready)
        const bound = (anySessions['binding'] as AnyFn).call(sessions, current) as { ctx?: unknown } | undefined
        carrier = bound?.ctx
        ref?.release?.()
      } else {
        const ref = sessions.retainAgentScope?.call(sessions, current)
        const scope = sessions.scope?.call(sessions, current)
        carrier = scope
        ref?.release?.()
      }
      if (carrier === undefined) throw new Error(usePathB ? '两条通路都拿不到会话输入' : 'binding.ctx 为空')
      const inputFor = ctx.conversation?.input?.for
      if (inputFor === undefined) throw new Error('conversation.input.for 不可达')
      const shell = inputFor(carrier)
      if (shell?.setDraft === undefined || shell.submit === undefined) throw new Error('input shell 缺 setDraft/submit')
      shell.setDraft(prompt)
      shell.submit()
    }
    try {
      // 先交还主区再发送：会话页挂载后控制器才活跃（0205 附记实测教训）
      const layout = (ctx as unknown as { layout?: { selectPanel?: (id: string | null) => void } }).layout
      layout?.selectPanel?.(null)
      await new Promise(resolve => { setTimeout(resolve, 400) })
      try {
        await withTimeout(tryPath(false))
      } catch (pathAError) {
        await withTimeout(tryPath(true))
      }
      return 'sent'
    } catch {
      // 两路都断（极端：切换后仍未挂载）——提示词进剪贴板兜底
      try {
        await navigator.clipboard.writeText(prompt)
        return 'clipboard'
      } catch {
        return 'clipboard'
      }
    }
  }, [ctx])

  /** 断裂修复：把检索意图合成提示词，经 E1 验证的程序化通路
   * （retain→binding→conversation.input.for().setDraft+submit）直接发给
   * 当前会话的 Agent——submit() 立即发送并触发 agent 轮次（E1 实测）。 */
  const litToAgent = useCallback(async (): Promise<void> => {
    const query = litQuery.trim()
    if (query === '') {
      setError('先填检索词再转给 Agent')
      return
    }
    const slug = overview?.activeProject
    const projectClause = slug !== undefined && slug !== ''
      ? `入库到项目 ${slug}`
      : '入库前先用 srw_project 工具确认目标项目（list 后选最合适的，没有就提示我创建）'
    const prompt = [
      `请用 srw_literature 工具完成一次文献检索与入库（${litSource} 源）。`,
      `检索词：${query}。取前 5 条。`,
      `${projectClause}。`,
      '完成后简短汇报：新增几条、去重几条、有无撤稿标红。',
    ].join('')
    const outcome = await sendToCurrentAgent(prompt)
    if (!alive.current) return
    if (outcome === 'sent') {
      setLitNotice('已把检索任务转给当前会话的 Agent（消息已发送，切到会话页看进展）')
    } else {
      setLitNotice('提示词已复制到剪贴板——到会话输入框粘贴回车即可发起（Agent 已带 srw_literature 工具）')
    }
  }, [ctx, litQuery, litSource, overview, sendToCurrentAgent])

  /* ── 精读（M4）：抽取 → 逐块翻译（哈希缓存）→ 校验；双语块对照，灯钉块上 ── */
  const loadReadingContent = useCallback(async (project: string, paperKey: string): Promise<void> => {
    try {
      const value = await rpc<{
        markdown: string
        verify: {
          states: Readonly<Record<string, 'verified' | 'mismatch' | 'orphan'>>
        }
      }>(ctx, 'reading.content', { project, paperKey })
      if (!alive.current) return
      setReadingView(parsePaper(value.markdown).map(block => ({
        id: block.id,
        state: value.verify.states[block.id] ?? 'orphan',
        sourceText: block.sourceText,
        ...(block.translation !== undefined ? { translation: block.translation } : {}),
      })))
    } catch {
      if (alive.current) setReadingView(null)
    }
  }, [ctx])

  const loadReadingAll = useCallback(async (project: string, paperKey: string): Promise<void> => {
    try {
      const value = await rpc<ReadingStatusLite>(ctx, 'reading.status', { project, paperKey })
      if (!alive.current) return
      setReadingStatus(value)
      if (value.extracted) await loadReadingContent(project, paperKey)
      else if (alive.current) setReadingView(null)
    } catch {
      if (alive.current) { setReadingStatus(null); setReadingView(null) }
    }
  }, [ctx, loadReadingContent])

  /* 换项目或换论文 → 拉状态；已抽取则顺带展示已有双语内容 */
  useEffect(() => {
    const project = overview?.activeProject
    const paperKey = readingKey.trim()
    if (project === undefined || project === '' || paperKey === '') {
      setReadingStatus(null)
      setReadingView(null)
      return
    }
    void loadReadingAll(project, paperKey)
  }, [overview?.activeProject, readingKey, loadReadingAll])

  /** 翻译 = 引擎车道（用户指令：不许插件私有的后台执行）：组装自包含提示词
   * 发给当前会话的 Agent，由它调 srw_read 分批翻译（每批可见可汇报可中断），
   * 完成后自动归档当日 PDF。面板只发起，不自己扛长任务。 */
  const readingTranslateViaAgent = async (): Promise<void> => {
    const project = overview?.activeProject ?? ''
    const paperKey = readingKey.trim()
    if (project === '' || paperKey === '') { setReadingNotice('先打开项目并选择论文'); return }
    setReadingBusy(true)
    try {
      const prompt = [
        `请精读论文 ${paperKey}（项目 ${project}），全部用 srw_read 工具完成：`,
        `1) action=status 看总块数与待译清单 pendingIds；`,
        `2) 分批翻译：每批 ≤40 个 key（pendingIds 按页号 p<页>-b<序> 分组），`,
        `action=translate 传 keys，每批完成向用户报告一次进度（已译/总数）；`,
        `3) remaining=0 后 action=export 归档当日 PDF，汇报校验四态（✓/⚠/孤/丢）与归档路径。`,
        `缓存命中的块不会重复翻译；中断后重发同一指令会接着续译。`,
      ].join('\n')
      const outcome = await sendToCurrentAgent(prompt)
      if (!alive.current) return
      setReadingNotice(outcome === 'sent'
        ? '已发起：翻译由当前会话的 Agent 分批执行（已切到会话页），完成后自动归档 PDF'
        : '提示词已复制到剪贴板——到会话输入框粘贴回车即发起（Agent 已带 srw_read 工具）')
    } finally {
      if (alive.current) setReadingBusy(false)
    }
  }

  const readingAction = async (action: 'extract' | 'verify' | 'export'): Promise<void> => {
    const project = overview?.activeProject ?? ''
    const paperKey = readingKey.trim()
    if (project === '' || paperKey === '') { setReadingNotice('先打开项目并选择论文'); return }
    setReadingBusy(true)
    try {
      if (action === 'extract') {
        const file = pdfEntries.find(entry => paperKeyOfLite(entry.key) === paperKey)?.pdf?.file
        if (file === undefined) { setReadingNotice('该 paperKey 没有对应的 PDF 条目（从下拉选择会自动生成）'); return }
        const result = await rpc<{ pages: number; blocks: number; migrated: number; orphan: number }>(
          ctx, 'reading.extract', { project, paperKey, pdfPath: pdfPathOfEntry(file, project) },
        )
        setReadingNotice(`已抽取：${result.pages} 页 ${result.blocks} 块（迁移 ${result.migrated}，孤儿 ${result.orphan}）`)
      } else if (action === 'export') {
        const result = await rpc<{ path: string; bytes: number; summary: { verified: number; mismatch: number; orphan: number; missing: number } }>(
          ctx, 'reading.export', { project, paperKey },
        )
        setReadingNotice(
          `已归档：${result.path}（${Math.round(result.bytes / 1024)} KB · ✓ ${result.summary.verified} / ⚠ ${result.summary.mismatch} / 孤 ${result.summary.orphan} / 丢 ${result.summary.missing}）`,
        )
      } else {
        const result = await rpc<{ verified: readonly string[]; mismatch: readonly string[]; orphan: readonly string[]; missing: readonly string[] }>(
          ctx, 'reading.verify', { project, paperKey },
        )
        setReadingNotice(`校验：一致 ${result.verified.length}，源文被改 ${result.mismatch.length}，孤立 ${result.orphan.length}，丢失 ${result.missing.length}`)
      }
      await loadReadingAll(project, paperKey)
    } catch (cause) {
      setReadingNotice(`操作失败：${String(cause)}`)
    } finally {
      if (alive.current) setReadingBusy(false)
    }
  }

  /* 活动项目变化 → 刷新文献库列表 */
  useEffect(() => {
    const slug = overview?.activeProject
    if (slug !== undefined && slug !== '') void refreshLib(slug)
  }, [overview?.activeProject, refreshLib])

  const activeStage = overview?.activeStage
  const rootDir = overview?.rootDir ?? ''
  const pdfEntries = useMemo(() => libEntries.filter(entry => entry.pdf !== undefined), [libEntries])

  /* 首屏/换项目后自动带出第一条候选的 paperKey（否则三按钮全禁用，
   * 必须徒手碰一下下拉才有值——实测别扭）。只在 libEntries 变化时补一次，
   * 不干扰用户手动清空重输。 */
  const lastLibRef = useRef<readonly LibEntryLite[] | undefined>(undefined)
  useEffect(() => {
    if (lastLibRef.current === libEntries) return
    lastLibRef.current = libEntries
    const first = pdfEntries[0]
    if (first !== undefined && readingKey.trim() === '') {
      setReadingKey(paperKeyOfLite(first.key))
      setReadingSelKey(first.key)
    }
  }, [libEntries, pdfEntries, readingKey])

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
          <button className='srw-btn' disabled={litBusy || litQuery.trim() === ''} onClick={() => { void litToAgent() }}>转给 Agent</button>
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

      <div className='srw-card'>
        <h2>精读{readingStatus !== null ? `：${readingStatus.paperKey}` : ''}</h2>
        <p className='srw-detail'>PDF 抽块 → 逐块翻译（按哈希缓存）→ 双语对照。校验灯：✓ 源段一致 / ⚠ 源文被改 / 孤立 = 块不在 source_map。译文可随手改，源段动了就会亮 ⚠。</p>
        {readingNotice !== null ? <p className='srw-detail'>{readingNotice}</p> : null}
        {pdfEntries.length === 0 ? (
          <p className='srw-detail'>项目库里还没有带 PDF 的条目——先在上方文献卡「取 PDF」。</p>
        ) : (
          <div className='srw-actions'>
            <select
              className='srw-input'
              value={pdfEntries.some(entry => entry.key === readingSelKey) ? readingSelKey : (pdfEntries[0]?.key ?? '')}
              onChange={event => {
                const picked = event.target.value
                setReadingSelKey(picked)
                const entry = pdfEntries.find(item => item.key === picked)
                setReadingKey(entry === undefined ? '' : paperKeyOfLite(entry.key))
              }}
            >
              {pdfEntries.map(entry => (
                <option key={entry.key} value={entry.key}>
                  {entry.identity.title.slice(0, 40)}（{entry.key}）
                </option>
              ))}
            </select>
            <input
              className='srw-input'
              placeholder='paperKey'
              value={readingKey}
              onChange={event => { setReadingKey(event.target.value) }}
            />
            <button className='srw-btn primary' disabled={readingBusy || readingKey.trim() === ''} onClick={() => { void readingAction('extract') }}>抽取</button>
            <button
              className='srw-btn'
              disabled={readingBusy || readingKey.trim() === ''}
              title='发给当前会话的 Agent 分批执行（可见进度），完成后自动归档 PDF'
              onClick={() => { void readingTranslateViaAgent() }}
            >翻译</button>
            <button className='srw-btn' disabled={readingBusy || readingKey.trim() === ''} onClick={() => { void readingAction('verify') }}>校验</button>
            <button
              className='srw-btn'
              disabled={readingBusy || readingKey.trim() === ''}
              title='按日期归档双语结果 PDF 到项目 readings/ 目录'
              onClick={() => { void readingAction('export') }}
            >导出 PDF</button>
          </div>
        )}
        {readingStatus !== null ? (
          <p className='srw-project-meta'>
            <span>{readingStatus.pages} 页</span>
            <span>·</span>
            <span>块 {readingStatus.blocks}</span>
            <span>·</span>
            <span>已译 {readingStatus.translated}</span>
            <span>·</span>
            <span>✓ {readingStatus.verified} / ⚠ {readingStatus.mismatch} / 孤 {readingStatus.orphan} / 丢 {readingStatus.missing}</span>
            <span>·</span>
            <span>LLM {readingStatus.llmAvailable ? '可用' : '不可用（翻译需宿主默认模型）'}</span>
          </p>
        ) : null}
        {readingView !== null ? (
          <ul className='srw-list'>
            {readingView.map(block => (
              <li key={block.id} className='srw-item'>
                <div className='srw-project-main'>
                  <code>{block.id}</code>
                  <span className={`srw-badge ${block.state === 'verified' ? '' : 'bad'}`}>{READING_STATE_LABELS[block.state] ?? block.state}</span>
                </div>
                <p className='srw-detail' style={{ whiteSpace: 'pre-wrap' }}>{block.sourceText}</p>
                {block.translation !== undefined ? (
                  <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{block.translation}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className='srw-card'>
        <h2>订阅抓取{overview?.watchSummary !== undefined && overview.watchSummary.total > 0 ? `（启用 ${overview.watchSummary.enabled}/${overview.watchSummary.total}）` : ''}</h2>
        <p className='srw-detail'>到期由宿主「自动化任务」唤醒会话自动检索入库（幂等去重）；时钟任务可在宿主自动化页调整。</p>
        {watchNotice !== null ? <p className='srw-detail'>{watchNotice}</p> : null}
        <div className='srw-actions'>
          <select
            className='srw-input'
            value={watchSource}
            onChange={event => { setWatchSource(event.target.value as typeof watchSource) }}
          >
            <option value='arxiv'>arXiv</option>
            <option value='openalex'>OpenAlex</option>
            <option value='crossref'>Crossref</option>
          </select>
          <select
            className='srw-input'
            value={watchEvery}
            onChange={event => { setWatchEvery(Number(event.target.value)) }}
          >
            <option value={900}>每 15 分钟</option>
            <option value={3600}>每小时</option>
            <option value={86400}>每天</option>
            <option value={604800}>每周</option>
          </select>
          <input
            className='srw-input'
            placeholder='检索词（如 ti:"peer review"）'
            value={watchQuery}
            onChange={event => { setWatchQuery(event.target.value) }}
          />
          <button
            className='srw-btn'
            disabled={watchBusy || overview?.activeProject === '' || overview?.activeProject === undefined}
            onClick={() => { void watchCreate() }}
          >
            订阅当前项目
          </button>
        </div>
        {watchSubs.length > 0 ? (
          <ul className='srw-list'>
            {watchSubs.map(subItem => (
              <li key={subItem.id} className='srw-item'>
                <div>
                  <strong>{subItem.source}</strong> <code>{subItem.query}</code>
                  <span className='srw-detail'> → 项目 {subItem.project}</span>
                </div>
                <div className='srw-project-meta'>
                  <span>{subItem.enabled ? (subItem.scheduleId !== undefined ? '已排程' : '未排程') : '已暂停'}</span>
                  <span>·</span>
                  <span>
                    {subItem.lastResult === undefined
                      ? '尚未运行'
                      : subItem.lastResult.kind === 'ok'
                        ? `上次新增 ${subItem.lastResult.fresh ?? 0} 条`
                        : `上次错误：${subItem.lastResult.error ?? ''}`}
                  </span>
                </div>
                <div className='srw-actions'>
                  <button className='srw-btn' disabled={watchBusy} onClick={() => { void watchAction('run', subItem.id) }}>立即抓取</button>
                  {!subItem.enabled || subItem.scheduleId === undefined ? (
                    <button
                      className='srw-btn'
                      disabled={watchBusy}
                      title='向宿主「自动化任务」注册/重建时钟任务'
                      onClick={() => { void watchAction('resume', subItem.id) }}
                    >
                      {subItem.enabled ? '补排程' : '恢复'}
                    </button>
                  ) : (
                    <button className='srw-btn' disabled={watchBusy} onClick={() => { void watchAction('pause', subItem.id) }}>暂停</button>
                  )}
                  <button
                    className={`srw-btn ${confirmingWatchId === subItem.id ? 'danger-confirm' : 'danger'}`}
                    disabled={watchBusy}
                    onClick={() => {
                      if (confirmingWatchId === subItem.id) {
                        setConfirmingWatchId(null)
                        void watchAction('remove', subItem.id)
                      } else {
                        setConfirmingWatchId(subItem.id)
                      }
                    }}
                  >
                    {confirmingWatchId === subItem.id ? '确认删除？' : '删除'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className='srw-detail'>暂无订阅。检索词写法与「文献」卡一致（ti:/abs:/au: 前缀可选）；到点自动抓取进当前项目库。</p>
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
