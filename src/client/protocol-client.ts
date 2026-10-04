/** 客户端宿主上下文的最小类型面（自包含，无宿主模块导入——与 vibe 同纪律）。
 * 服务由 client inject 名单在运行时提供；未注入的访问会抛错
 * `cannot get property "X" without inject`（E2 实测），类型一律可选、
 * 使用处先判空。
 */

export interface SlotRegistration {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  /** 活函数：宿主按当前语言求值（语言切换后侧边栏标签即时跟随）。 */
  readonly label?: string | (() => string)
  readonly locale?: string
}

export interface SlotsService {
  inject?(slot: string, factory: () => () => void): void
  register(registration: SlotRegistration, component: unknown): () => void
}

export interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
}

export interface ConnectionService {
  readonly rpc?: {
    call?(channel: string, endpoint: string, payload?: unknown): Promise<unknown>
  }
}

export interface LayoutService {
  readonly panelInfo?: {
    getSnapshot?(): { readonly activePanelId?: string | null }
  }
}

export interface SessionsService {
  readonly list?: { getSnapshot?(): { current?: string } }
  open?(id: string): void
  retainAgentScope?(id: string): { release?(): void }
  scope?(id: string): (Record<string, unknown> & {
    conversation?: { input?: { for?(carrier: unknown): InputShell } }
  }) | undefined
}

export interface InputShell {
  setDraft?(text: string): void
  submit?(mode?: unknown): void
}

/** 右栏服务（ui-sidebar-right；0102 §9.1：主区被占时写路径抛
 * `no session surface is mounted`）。address 是资源地址字符串。 */
export interface SidebarRightService {
  openResource?(address: string, options?: Record<string, unknown>): void
  openResourceIn?(sessionId: string, address: string, options?: Record<string, unknown>): void
}

/** 文档预览注册表（ui-sidebar-documentpreview；容器只在右栏）。 */
export interface DocumentPreviewsService {
  register?(definition: {
    readonly id: string
    readonly extensions: readonly string[]
    readonly binaryExtensions?: readonly string[]
    readonly title: () => string
    readonly loading: 'text-pages' | 'bytes-complete' | 'renderer'
  }): () => void
}

/** 会话 UI 权威（ui-session）：当前会话唯一读数。 */
export interface UiSessionService {
  readonly adapter?: {
    readonly current?: { getSnapshot?(): { readonly key?: string } }
  }
}

/** 会话输入面（ui-conversation）：路径 A 的 `conversation.input.for(binding.ctx)`。 */
export interface ConversationService {
  readonly input?: { for?(carrier: unknown): InputShell }
}

/** 目录选择（ui-workspace）：native 对话框弹在宿主屏幕（本机可用），
 * browse 后端只在无头/SSH 启动时由 auto 挂载——两条路都走 pickDirectory。 */
export interface UiWorkspaceService {
  pickDirectory?(): Promise<string | null>
}

/** 引擎工作区快照（workspace-controller）：S1 口径核对数据源。 */
export interface WorkspacesService {
  readonly list?: {
    getSnapshot?(): {
      readonly items?: readonly {
        readonly workspaceId?: string
        readonly path?: string
        readonly title?: string
      }[]
      readonly state?: string
      readonly phase?: string
    }
  }
}

export interface ClientContext {
  readonly slots?: SlotsService
  readonly connection?: ConnectionService
  readonly locale?: LocaleService
  readonly sessions?: SessionsService
  readonly uiWorkspace?: UiWorkspaceService & Record<string, unknown>
  readonly workspaces?: WorkspacesService & Record<string, unknown>
  readonly remote?: Record<string, unknown>
  readonly 'remote.session'?: Record<string, unknown>
  readonly modelDirectories?: Record<string, unknown>
  readonly layout?: LayoutService
  /** ── E1 专用临时注入（2026-10-04；E1 收口后按结论保留或撤）── */
  readonly sidebarRight?: SidebarRightService
  readonly documentPreviews?: DocumentPreviewsService
  readonly uiSession?: UiSessionService
  readonly conversation?: ConversationService
  effect?(factory: () => unknown, label: string): unknown
}
