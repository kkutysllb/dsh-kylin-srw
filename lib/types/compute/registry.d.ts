/** 数据集注册表（§5.5）：data/registry.json（文件即真相源）+ 只增不改的
 * upsert 语义（同 id+version 替换、跨版本并存）。hashPolicy:'none' 允许跑，
 * 但引用它的 claim 只能 unverifiable（不假 verified）——判定在 gaps/claims。 */
import { type SrwFsLike } from '../host.ts';
export declare const DATASET_ID_RE: RegExp;
export interface DatasetRecord {
    readonly id: string;
    readonly version: string;
    readonly title: string;
    readonly kind?: string;
    readonly source?: {
        readonly type: 'download' | 'provided' | 'generated';
        readonly url?: string;
        readonly retrievedAt?: string;
        readonly citation?: string;
    };
    readonly locator?: {
        readonly kind: 'remote' | 'local';
        readonly hostRef?: string;
        readonly path?: string;
    };
    readonly hashPolicy: 'tree' | 'file' | 'none';
    readonly license?: string;
    readonly redistributable?: boolean;
    readonly splits?: Readonly<Record<string, number>>;
    readonly provenance?: {
        readonly by: 'user' | 'download' | 'script';
        readonly scriptSha256?: string | null;
    };
    readonly registeredAt: string;
}
export interface RegistryFile {
    readonly schemaVersion: 1;
    readonly datasets: DatasetRecord[];
}
/** 校验（中文错误清单；空数组 = 合法）。 */
export declare function validateDatasetRecord(value: unknown): string[];
export interface RegistryDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
}
export declare class RegistryStore {
    private readonly deps;
    constructor(deps: RegistryDeps);
    private requireRoot;
    private filePath;
    private guard;
    /** 读注册表（缺文件 → 空表；坏 JSON → INVALID，绝不静默重建）。 */
    load(project: string): Promise<RegistryFile>;
    save(project: string, file: RegistryFile): Promise<void>;
    list(project: string): Promise<readonly DatasetRecord[]>;
    /** 取指定数据集（version 缺省取 registeredAt 最新的）。 */
    get(project: string, id: string, version?: string): Promise<DatasetRecord | undefined>;
    /** upsert：同 id+version 替换，跨版本并存；数据只增不删。 */
    register(project: string, input: unknown, nowIso: string): Promise<DatasetRecord>;
}
