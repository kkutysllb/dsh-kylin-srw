/** 提交与派发原语（§4.5 派发纪律）：脚本先落远端盘（provider.put）再
 * bash 绝对路径执行；setsid nohup 脱离会话 + run.pid + 哨兵；exit.code/done
 * 是作业契约终态标记（真机 V12 已实测该套契约）。entry/env 用户值只进
 * job.sh 文件内容（单引号转义），绝不做命令字符串插值——argv 数组纪律由
 * provider 层保证，本模块只生成「文件字节」。 */
/** launch 成功哨兵（F1 教训：无哨兵时首句被吞、exit 0 假成功）。 */
export declare const LAUNCH_OK_SENTINEL = "__SRW_LAUNCH_OK__";
/** shell 单引号转义（唯一允许的用户值进脚本方式，§8.2）。 */
export declare function shellSingleQuote(value: string): string;
/** 波浪号路径展开（远端绝对路径拼装用；home 只在内存）。 */
export declare function expandTilde(path: string, home: string): string;
/** 远端 runDir（可落盘的波浪号形式，§5.2）。 */
export declare function remoteRunDirTilde(projectRef: string, runId: string): string;
export interface JobScriptInput {
    readonly runDirAbs: string;
    readonly entry: readonly string[];
    readonly seed: number;
    readonly cudaVisibleDevices: string;
    readonly env?: Readonly<Record<string, string>>;
}
/** srw-wrapper.sh：用户入口 + 契约终态。无论 entry 退出码如何，exit.code/done 必写。
 * 文件名固定 srw-wrapper.sh（不叫 job.sh）：用户上传的 entry 脚本常名 job.sh，
 * 同名会把用户文件覆盖成「自递归包装器」（真机踩中：SHLVL 爆表 exit 254）。 */
export declare function buildJobScript(input: JobScriptInput): string;
/** launch.sh：setsid 会话首进程 = 进程组（kill -TERM -<pid> 可整组取消），
 * 写 run.pid，回显哨兵。 */
export declare function buildLaunchScript(runDirAbs: string): string;
