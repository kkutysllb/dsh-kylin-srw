/** 深度档位 D1/D2/D3（0102 §7.3 的产品模型表）：本产品自建，不绑定刊物。
 * 三个落点之一（此处给阈值；另两个落点在 outline 提示词与 compliance 检查项）。
 * 数值即 0102 §7.3 的表——改动要回写架构文档。 */
import type { DepthTier, StatementKind } from './types.ts';
export interface DepthProfile {
    readonly pages: {
        readonly min: number;
        readonly max: number;
    };
    readonly sections: {
        readonly min: number;
        readonly requireRelatedWork: boolean;
        readonly allowAppendix: boolean;
    };
    readonly experiments: {
        readonly datasets: number;
        readonly baselines: number;
        readonly seeds: number;
        readonly ablation: boolean;
        readonly significance: boolean;
        readonly costAnalysis: boolean;
    };
    readonly figures: {
        readonly min: number;
        readonly max: number;
    };
    readonly tables: {
        readonly min: number;
        readonly max: number;
    };
    readonly references: {
        readonly min: number;
        readonly max: number;
    };
    readonly statements: readonly StatementKind[];
    /** 复现材料清单（M6/M7 的证明链与实验要消费）。 */
    readonly repro: readonly string[];
}
export declare const DEPTH_PROFILES: Readonly<Record<DepthTier, DepthProfile>>;
/** 落点②：实验设计的最少检查项（M7 实验视图/spec 校验直接复用）。 */
export declare function experimentsChecklist(tier: DepthTier): readonly string[];
