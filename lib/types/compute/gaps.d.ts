/** 补数据缺口模型（§6.1/§6.4）：四路输入（spec+D 档阈值 / runs 完成度 /
 * metrics 缺失与失败 run / 未 verified 的 claim）→ P0/P1/P2 缺口 + queue
 * 排序（P0=阻断 claim > P1=D 档硬要求 > P2=成本/显著性；同级 estGpuHours
 * 升序填谷）。「补数据补完」= P0/P1 为空。 */
import type { ClaimRecord } from './claims.ts';
import type { ExperimentSpec } from './spec.ts';
import type { RunStatus } from './types.ts';
export type GapKind = 'missing-run' | 'missing-dataset' | 'missing-baseline' | 'missing-metric' | 'missing-stat' | 'failed-run' | 'stale-input' | 'unverifiable';
export interface GapItem {
    readonly id: string;
    readonly kind: GapKind;
    readonly detail: string;
    readonly blockingClaims: readonly string[];
    readonly priority: 'P0' | 'P1' | 'P2';
    readonly estGpuHours?: number;
    readonly suggestion: string;
}
export interface GapRunSummary {
    readonly runId: string;
    readonly status: RunStatus;
    readonly seed: number;
    readonly metricsNames: readonly string[];
    readonly inputs: ReadonlyArray<{
        readonly datasetId: string;
        readonly version: string;
    }>;
}
export interface GapInput {
    readonly spec: ExperimentSpec | null;
    readonly tier: 'D1' | 'D2' | 'D3';
    readonly runs: readonly GapRunSummary[];
    readonly claims: readonly ClaimRecord[];
    readonly registry: ReadonlyArray<{
        readonly id: string;
        readonly version: string;
    }>;
}
/** 排序（纯函数）：P0 → P1 → P2；同级 estGpuHours 升序（缺省排最后）、再按 id 稳定。 */
export declare function sortGapQueue(items: readonly GapItem[]): GapItem[];
/** 缺口生成（纯函数，测试面）。claim 引用按 expId+metric/runIds 匹配。 */
export declare function generateGaps(input: GapInput): GapItem[];
