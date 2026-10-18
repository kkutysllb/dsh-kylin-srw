/** 快照与回滚（Task 5.6）：编译**成功**后留档（main.tex + sections/ +
 * refs.bib + build PDF）；manifest 记 sha256——restore 回读比对，不一致
 * 报 CORRUPT（不许静默恢复脏数据）。 */
export type SnapshotKind = 'compile' | 'manual' | 'submission' | 'revision';
export interface SnapshotManifest {
    readonly schemaVersion: 1;
    readonly createdAt: string;
    readonly engine?: string;
    readonly compileMs?: number;
    /** 8.1 起可选：留档来源（默认 compile）。outlineHash/venueHash/pdfSha 不另设——
     * files 里 state/outline.json、state/venue.json、build/main.pdf 已带哈希，重复会漂移。 */
    readonly kind?: SnapshotKind;
    readonly label?: string;
    readonly note?: string;
    /** 项目级 materials/manifest.json 的 sha256（不入快照本体，只记哈希）；
     * restore 时与现状比对 → materialDrift 提示（不阻断）。 */
    readonly materialsHash?: string;
    readonly files: Readonly<Record<string, string>>;
}
export declare function createSnapshot(paperDir: string, options?: {
    engine?: string;
    compileMs?: number;
    kind?: SnapshotKind;
    note?: string;
}): Promise<{
    id: string;
    files: number;
    bytes: number;
}>;
export interface SnapshotInfo {
    readonly id: string;
    readonly createdAt: string;
    readonly engine?: string;
    readonly kind?: SnapshotKind;
    readonly label?: string;
    readonly note?: string;
    readonly materialsHash?: string;
    readonly files: number;
}
export declare function listSnapshots(paperDir: string): Promise<readonly SnapshotInfo[]>;
/** 打标签（8.1）：给既有快照写 label/note——manifest 是普通 JSON，直接改写后
 * 落回（不复制快照本体）。label 必填 ≤80 字符，note ≤500。 */
export declare function tagSnapshot(paperDir: string, id: string, tag: {
    readonly label: string;
    readonly note?: string;
}): Promise<SnapshotInfo>;
/** 快照允许回滚的路径白名单：manifest 是磁盘上的普通 JSON，可能被手改/注入，
 * 只认这些形状，任何 ../、绝对路径、未知文件一律 FORBIDDEN（不是静默跳过）。 */
export declare function isSnapshotPathAllowed(path: string): boolean;
export interface RestoreSnapshotOptions {
    /** 宿主 containment 护栏（服务层传入）；直接调用 snapshot 模块的测试可省。 */
    readonly guard?: (rel: string) => Promise<void>;
}
/** 回滚：逐文件哈希比对 manifest；覆盖当前 paper/（state/* 写回项目 .srw/）。
 * 返回恢复的文件清单；快照带 materialsHash 时附 materialDrift（现状 materials
 * manifest 与留档不一致/丢失 → true，仅提示不阻断——漂移可能是正常新素材）。 */
export declare function restoreSnapshot(paperDir: string, id: string, options?: RestoreSnapshotOptions): Promise<{
    restored: readonly string[];
    materialDrift?: boolean;
}>;
