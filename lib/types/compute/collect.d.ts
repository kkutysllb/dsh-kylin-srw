/** 指标/产物归集（§3 子能力 11/12）：metrics.json 与 artifacts/* 回传 +
 * sha256 双向对账（远端 sha256sum vs 本地重算）；schema 坏 → schemaOk=false
 * （进 gap，不假成功）；文件被改 → ARTIFACT_CHANGED（不覆盖旧哈希）。 */
import type { ComputeProvider, HostTarget } from './provider.ts';
import { type MetricsFile } from './claims.ts';
export interface CollectedArtifact {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
}
export interface CollectOutcome {
    readonly metrics: {
        readonly path: string;
        readonly sha256: string;
        readonly schemaOk: boolean;
        readonly parsed: MetricsFile | null;
    } | null;
    readonly artifacts: readonly CollectedArtifact[];
    readonly errors: readonly string[];
}
export interface CollectRunInput {
    readonly provider: ComputeProvider;
    readonly host: HostTarget;
    readonly runDirAbs: string;
    readonly metricsRel: string;
    readonly localRunDir: string;
    readonly maxFileBytes?: number;
}
export declare function collectRun(input: CollectRunInput): Promise<CollectOutcome>;
