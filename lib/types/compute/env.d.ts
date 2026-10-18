/** 环境盘点与 GPU 选卡（§3 子能力 3/4）：全部命令为固定 argv（无用户值），
 * 解析器为纯函数（fixture 单测面）；二进制一律用探测到的绝对路径
 * （真机：nvidia-smi 仅 /usr/lib/wsl/lib/nvidia-smi、nvcc 不在 PATH）。 */
import type { ComputeProvider, HostTarget } from './provider.ts';
import type { EnvSnapshot, GpuInfo } from './types.ts';
/** nvidia-smi CSV（--format=csv,noheader）→ GPU 列表（纯函数）。 */
export declare function parseNvidiaSmiCsv(text: string): GpuInfo[];
/** uname -s -r -m → {os,kernel,arch}。 */
export declare function parseUname(text: string): {
    os: string;
    kernel: string;
    arch: string;
};
/** df -Pk → 磁盘（取最后一个挂载点行，1024-blocks 与 Available）。 */
export declare function parseDfPk(text: string): {
    path: string;
    totalKiB: number;
    availKiB: number;
} | null;
/** free -k → MemTotal（MiB）。 */
export declare function parseFreeK(text: string): number | null;
/** nvcc --version → '12.8'（release 行）。 */
export declare function parseNvccVersion(text: string): string | null;
/** python3 --version → '3.14.7'。 */
export declare function parsePythonVersion(text: string): string | null;
/** 工具在场检查（固定 sh -c 循环的输出：name=yes|no）。 */
export declare function parseToolCheck(text: string): Record<string, boolean>;
/** GPU 选卡：按 (used/total) 升序取 want 张，占用率阈值 0.8；全忙 → GATE
 * NO_FREE_GPU（不假跑，§8.1）。纯函数。 */
export declare function pickGpu(gpus: readonly GpuInfo[], options?: {
    want?: number;
    maxUsedRatio?: number;
}): number[];
/** 远端盘点：逐项探测（单项失败不影响整体，字段留 null）。返回快照（纯数据）。 */
export declare function inventoryEnv(provider: ComputeProvider, host: HostTarget, nowIso: string): Promise<EnvSnapshot>;
/** 探针哨兵（可达性 + 延迟；不承载任何业务命令）。 */
export declare function probeHost(provider: ComputeProvider, host: HostTarget, timeoutMs: number): Promise<{
    reachable: boolean;
    latencyMs: number | null;
    detail: string;
}>;
