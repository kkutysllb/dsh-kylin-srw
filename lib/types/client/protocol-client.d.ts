/** 客户端宿主上下文的最小类型面（自包含，无宿主模块导入——与 vibe 同纪律）。
 * slots/connection/layout 等由 client inject 服务在运行时提供；未注入的
 * 服务在这里一律可选，诊断面对「缺席」如实呈现（这正是 E1 要的数据）。
 */
export interface SlotRegistration {
    readonly name: string;
    readonly id?: string;
    readonly key?: string;
    readonly order?: number;
    /** 活函数：宿主按当前语言求值（语言切换后侧边栏标签即时跟随）。 */
    readonly label?: string | (() => string);
    readonly locale?: string;
}
export interface SlotsService {
    inject?(slot: string, factory: () => () => void): void;
    register(registration: SlotRegistration, component: unknown): () => void;
}
export interface LocaleService {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void;
    bind(namespace: string): (key: string, params?: Record<string, unknown>) => string;
}
export interface ConnectionService {
    readonly rpc?: {
        call?(channel: string, endpoint: string, payload?: unknown): Promise<unknown>;
    };
}
export interface LayoutService {
    readonly panelInfo?: {
        getSnapshot?(): {
            readonly activePanelId?: string | null;
        };
    };
}
export interface SessionsService {
    readonly list?: {
        getSnapshot?(): {
            current?: string;
        };
    };
    open?(id: string): void;
    retainAgentScope?(id: string): {
        release?(): void;
    };
    scope?(id: string): (Record<string, unknown> & {
        conversation?: {
            input?: {
                for?(carrier: unknown): InputShell;
            };
        };
    }) | undefined;
}
export interface InputShell {
    setDraft?(text: string): void;
    submit?(mode?: unknown): void;
}
/** E1 候选面：M0 未进 inject 名单（缺名会激活失败——vibe 0.2.0 实测），
 * 诊断面软探测并如实报告「未注入」；E1 结论后才决定是否扩名单。 */
export interface E1CandidateFaces {
    readonly sidebarRight?: Record<string, unknown>;
    readonly documentPreviews?: Record<string, unknown>;
    readonly settings?: Record<string, unknown>;
    readonly uiSession?: Record<string, unknown> & {
        readonly adapter?: {
            readonly current?: {
                getSnapshot?(): {
                    readonly key?: string;
                };
            };
        };
    };
    readonly conversation?: Record<string, unknown>;
}
export interface ClientContext {
    readonly slots?: SlotsService;
    readonly connection?: ConnectionService;
    readonly locale?: LocaleService;
    readonly sessions?: SessionsService;
    readonly uiWorkspace?: Record<string, unknown>;
    readonly workspaces?: Record<string, unknown>;
    readonly remote?: Record<string, unknown>;
    readonly 'remote.session'?: Record<string, unknown>;
    readonly modelDirectories?: Record<string, unknown>;
    readonly layout?: LayoutService;
    effect?(factory: () => unknown, label: string): unknown;
}
