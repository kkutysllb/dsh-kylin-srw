/** hosts.json 只读解析（§4.4/B4 + 真机 P12）：home 候选 env(QILIN_HOME/DSH_HOME)
 * → ~/.kcoder → ~/.kcoder-dev → ~/.dsh；文件 = <home>/ssh-remote/hosts.json。
 * 纪律：只读、永不写回（宿主插件 reload 也只读）；不复制内容进项目目录；
 * auth:'key' 才可 ③ 直连，'password' 只能等 ① ControlMaster socket；
 * 对外视图只有 hostRef=sha256(hostId)[:8]+label，绝不落 id/host/user/port。 */
/** hosts.json 单条目（hosts.js 字段面的本地最小子集，不 import 第三方内部模块）。 */
export interface HostEntry {
    readonly id: string;
    readonly host: string;
    readonly user: string;
    readonly port?: number;
    readonly identityFile?: string;
    readonly auth: 'key' | 'password';
    readonly label?: string;
}
/** 单 home 解析结果（home 只在内存，用于拼 cm socket 路径）。 */
export interface HomeHosts {
    readonly home: string;
    readonly entries: readonly HostEntry[];
}
/** home 候选（env 优先，其后固定三候选；去重保序）。 */
export declare function homeCandidates(env: Record<string, string | undefined>): string[];
/** 解析 hosts.json 文本：容忍 {hosts:[…]} 与裸数组两种形态；非法条目静默过滤
 * （缺 id/host/user 的坏行不炸盘点）。auth 推导：显式 auth 优先；否则有
 * identityFile 即 'key'，否则 'password'。 */
export declare function parseHostsFile(text: string): HostEntry[];
/** 读单个 home 的 hosts.json：缺文件/坏 JSON → []（盘点不炸）。 */
export declare function readHostsFromHome(home: string): Promise<HostEntry[]>;
/** 全候选盘点：跨 home 按 hostRef 去重（先到先得，P12 双 home 场景取有活 socket 侧的
 * 优先级由候选顺序决定）；返回带 home 上下文的条目（home 不出本模块）。 */
export declare function discoverHosts(env: Record<string, string | undefined>): Promise<HomeHosts[]>;
export interface ResolvedHost {
    readonly entry: HostEntry;
    readonly home: string;
    readonly ref: string;
    /** 对外 label：显式 label 或 'host-<ref 后 6 位>'；绝不用 id（P1 实测 id 含 IP）。 */
    readonly label: string;
}
export declare function resolveHostRef(homes: readonly HomeHosts[], ref: string): ResolvedHost | undefined;
/** ① ControlMaster socket 路径（存在即复用——真机 P9 实测零凭据可用）。 */
export declare function cmSockFor(home: string, entry: HostEntry): string;
/** 通道判定：有活 socket → 'cm'；否则 auth:'key' 且私钥在 → 'direct'；
 * password 且无 socket → 不可用（NO_PROVIDER，绝不尝试密码回退/读凭据）。 */
export declare function pickTransport(resolved: ResolvedHost): {
    transport: 'cm' | 'direct';
    cmSock?: string;
};
