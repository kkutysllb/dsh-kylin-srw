/** 实验作业规格（§5/§3 子能力 5/6）：schema + 校验 + D 档设计门
 * （复用 venue/depth.ts 的 DEPTH_PROFILES 阈值——第三落点，改动要回写表）。 */
export type DepthTierName = 'D1' | 'D2' | 'D3';
export declare const RUN_ID_RE: RegExp;
export declare const EXP_ID_RE: RegExp;
export interface ExperimentSpec {
    readonly schemaVersion: 1;
    readonly expId: string;
    readonly title?: string;
    readonly tier?: DepthTierName;
    /** 远端入口 argv（如 ['bash','job.sh']）——逐参数引用，绝不字符串插值。 */
    readonly entry: readonly string[];
    readonly gpus: number;
    readonly seeds: readonly number[];
    readonly datasets: readonly string[];
    readonly baselines: readonly string[];
    readonly metrics: readonly string[];
    readonly outputs: {
        readonly metrics: string;
        readonly artifacts?: readonly string[];
    };
    readonly env?: Readonly<Record<string, string>>;
    readonly maxHours: number;
    readonly maxLogBytes: number;
    /** D2/D3 档位声明（gate 消费；缺省 false）。 */
    readonly ablation?: boolean;
    readonly significance?: boolean;
    readonly costAnalysis?: boolean;
    confirmed?: boolean;
    confirmedAt?: string | null;
}
/** 校验（返回中文错误清单；空数组 = 合法）。字段面收窄：未知键直接丢弃
 * （normalize 时），防止脏数据进 run 溯源链。 */
export declare function validateExperimentSpec(value: unknown): string[];
/** 归一化（填默认值、丢未知键）；spec 已合法时使用。 */
export declare function normalizeSpec(value: unknown, expId: string): ExperimentSpec;
export interface SpecGate {
    readonly ok: boolean;
    readonly blockers: readonly string[];
    readonly warnings: readonly string[];
}
/** D 档设计门（落点③）：阻断 = 数据集/种子低于档位、D3 缺显著性声明；
 * 警告 = 基线/消融/成本低于档位。全部 D_TIER_GAP 前缀，ack 可越过
 * （§7.2 A2：需显式 ack，spec.revisions 留痕）。 */
export declare function gateSpec(spec: ExperimentSpec): SpecGate;
/** spec 相对路径白名单（上传文件用）：无 ..、无绝对路径、无反斜杠。 */
export declare function isSafeRemoteRelPath(path: string): boolean;
export declare function assertSpecOrThrow(spec: ExperimentSpec): void;
