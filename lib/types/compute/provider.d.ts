/** ComputeProvider 三级链（§4.1/§4.2）：MVP 实现 ① cm 复用与 ③ 直连；
 * ② tool 通道（ctx.tools.execute 'ssh_run'）只留接口注释不实现——F1（无显式
 * cwd 时首句被静默吞、exit 0）与 F2（stdout 256 KiB 静默截断）使它**禁用于
 * 日志/产物**，仅可承载短命令/哨兵，若将来实现必须先过本服务的 submit 门。
 *
 * 派发纪律（§4.5 架构级）：spawn('ssh', [本地 argv…, '--', 远端命令串])——本地不经
 * shell；远端命令串由 remoteLine 对每个元素做 POSIX 引号包裹后合成，
 * 绝不拼接 shell 字符串；唯一的「拼接」是 ssh 协议自身的 target 与 -o 选项
 * （它们是单个 argv 元素，由 ssh 自己解析，不经远端 shell 二次展开——远端
 * 命令在 '--' 之后）。用户值只进文件字节（put 先落远端盘再 bash 绝对路径执行）。
 * 永不读宿主凭据、永不密码回退；地址/用户名/端口只存在于 HostTarget（内存）。 */
/** 内存态主机目标：地址/端口/私钥路径/cm socket 绝不落盘（§4.4）。 */
export interface HostTarget {
    readonly ref: string;
    readonly transport: 'cm' | 'direct';
    readonly address: {
        readonly host: string;
        readonly user: string;
        readonly port?: number;
    };
    readonly cmSock?: string;
    readonly identityFile?: string;
}
export interface ExecOptions {
    /** 写远端文件时经 stdin 喂字节（put）。 */
    readonly input?: Uint8Array;
    readonly timeoutMs?: number;
    /** stdout 收集上限（字节）；超限停止收集并置 truncated（显式标记，不静默）。 */
    readonly maxBytes?: number;
}
export interface ExecOutcome {
    /** null = 进程被信号杀死/超时（transport 级异常由调用方区分）。 */
    readonly code: number | null;
    readonly stdout: Uint8Array;
    readonly stderr: string;
    readonly truncated: boolean;
}
/** §4.1 的可组合原语面（tail/put/get 由 exec 原语实现，便于 fake 注入）。 */
export interface ComputeProvider {
    readonly kind: 'cm' | 'direct';
    available(): Promise<{
        ok: boolean;
        detail: string;
    }>;
    exec(host: HostTarget, argv: readonly string[], options?: ExecOptions): Promise<ExecOutcome>;
    tailBytes(host: HostTarget, path: string, fromByte: number, maxBytes: number): Promise<{
        bytes: Uint8Array;
        nextByte: number;
        eof: boolean;
    }>;
    putBytes(host: HostTarget, remotePath: string, bytes: Uint8Array): Promise<{
        sha256: string;
    }>;
    getBytes(host: HostTarget, remotePath: string, maxBytes: number): Promise<{
        bytes: Uint8Array;
        truncated: boolean;
    }>;
}
export declare const PROBE_SENTINEL = "__SRW_OK__";
/** put 写文件的固定脚本：路径走 $1 位置参数，绝无用户值进命令字符串。 */
export declare const PUT_SCRIPT = "cat > \"$1\"";
export declare const DEFAULT_EXEC_MAX_BYTES: number;
/** ssh argv 构造（纯函数，测试面）：BatchMode 防交互挂死；ConnectTimeout 防
 * 不可达拖死 submit；'--' 之后是远端命令 argv。 */
/** 单元素远端安全引号包裹（POSIX 单引号无转义位，用 '\'' 三段式）。
 * ssh -- 后的多个元素会被远端登录 shell 重新按空格切词，argv 含空格/引号的
 * 元素（如 sh -c 脚本、带空格路径）必须整体再包一层，否则语义被改写
 * （真机踩中：sh -c 'printf %s "$HOME"' 变成无参 printf → usage）。 */
export declare function remoteQuote(part: string): string;
/** 远端命令行：把 argv 合成**单个**已引号包裹的命令串（交给 ssh -- 执行）。 */
export declare function remoteLine(argv: readonly string[]): string;
export declare function sshArgv(target: HostTarget, argv: readonly string[]): string[];
/** ② tool 通道接口位（MVP 不实现，见文件头 F1/F2 注释）：
 * execViaTool(ctx.tools.execute({ name: 'ssh_run', arguments: { hostId, command, cwd } }))
 * ——实现时必须：显式绝对 cwd + 首句哨兵 + 输出按渲染文本解析 + 禁用于 tail/put/get。 */
/** 真实 ssh 通道（① cm / ③ direct 同构，仅 argv 前缀不同）。 */
export declare class SshProvider implements ComputeProvider {
    readonly kind: 'cm' | 'direct';
    constructor(kind?: 'cm' | 'direct');
    available(): Promise<{
        ok: boolean;
        detail: string;
    }>;
    exec(host: HostTarget, argv: readonly string[], options?: ExecOptions): Promise<ExecOutcome>;
    tailBytes(host: HostTarget, path: string, fromByte: number, maxBytes: number): Promise<{
        bytes: Uint8Array;
        nextByte: number;
        eof: boolean;
    }>;
    putBytes(host: HostTarget, remotePath: string, bytes: Uint8Array): Promise<{
        sha256: string;
    }>;
    getBytes(host: HostTarget, remotePath: string, maxBytes: number): Promise<{
        bytes: Uint8Array;
        truncated: boolean;
    }>;
}
