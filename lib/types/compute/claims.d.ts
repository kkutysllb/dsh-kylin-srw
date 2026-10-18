/** 论文数字逐点对账（§5.6）：claims.json 是「正文每个数字必须指回真实
 * metrics.json 条目」红线唯一的机器可校验落点。check 为纯函数：
 * verified（重算一致）/ mismatch（不一致，阻断插入）/ unverifiable
 * （证据缺——缺 metrics/指标/成功 run；hashPolicy:none 也在 gaps 侧标
 * unverifiable，不假 verified）。 */
import { type SrwFsLike } from '../host.ts';
export interface MetricsFile {
    readonly schemaVersion: number;
    readonly runId: string;
    readonly expId?: string;
    readonly status?: 'complete' | 'partial' | 'failed';
    readonly metrics: ReadonlyArray<{
        readonly name: string;
        readonly split?: string;
        readonly value: number;
    }>;
}
/** metrics.json 最小 schema（§5.4 收窄面）：metrics[].name+value 必须在。 */
export declare function validateMetricsFile(value: unknown): string[];
export interface ClaimSource {
    readonly expId: string;
    readonly runIds: readonly string[];
    readonly metric: string;
    readonly split?: string;
    readonly reducer: 'mean' | 'median' | 'last';
}
export interface ClaimVerification {
    readonly status: 'verified' | 'mismatch' | 'unverifiable';
    readonly computed: number | null;
    readonly reason: string | null;
    readonly checkedAt: string;
    readonly metricsSha256: readonly string[];
}
export interface ClaimRecord {
    readonly id: string;
    readonly kind: 'number' | 'table-cell';
    readonly paper?: {
        readonly file?: string;
        readonly line?: number;
        readonly label?: string;
        readonly cell?: string;
    };
    readonly source: ClaimSource;
    readonly value: number;
    readonly digits: number;
    readonly tolerance?: number;
    verification?: ClaimVerification | null;
}
export declare const CLAIM_ID_RE: RegExp;
export declare function validateClaimRecord(value: unknown): string[];
export declare function reduceValues(values: readonly number[], reducer: 'mean' | 'median' | 'last'): number;
/** 每个 runId → { sha256, file }：file=null = 缺失/损坏/失败 run（→ unverifiable）。 */
export type MetricsByRun = ReadonlyMap<string, {
    readonly sha256: string;
    readonly file: MetricsFile | null;
}>;
/** 对账纯函数（测试面）：verified 当 |声称值-重算值| ≤ 容差（缺省 0.5*10^-digits）。 */
export declare function checkClaim(claim: ClaimRecord, metricsByRun: MetricsByRun, checkedAt: string): ClaimVerification;
export interface ClaimsDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
}
export declare class ClaimsStore {
    private readonly deps;
    constructor(deps: ClaimsDeps);
    private requireRoot;
    private filePath;
    private guard;
    load(project: string): Promise<ClaimRecord[]>;
    save(project: string, claims: readonly ClaimRecord[]): Promise<void>;
    /** upsert：同 id 替换（verification 一并替换），其余保留。 */
    upsert(project: string, claim: ClaimRecord): Promise<void>;
}
