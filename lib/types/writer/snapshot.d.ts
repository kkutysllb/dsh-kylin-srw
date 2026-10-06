/** 快照与回滚（Task 5.6）：编译**成功**后留档（main.tex + sections/ +
 * refs.bib + build PDF）；manifest 记 sha256——restore 回读比对，不一致
 * 报 CORRUPT（不许静默恢复脏数据）。 */
export interface SnapshotManifest {
    readonly schemaVersion: 1;
    readonly createdAt: string;
    readonly engine?: string;
    readonly compileMs?: number;
    readonly files: Readonly<Record<string, string>>;
}
export declare function createSnapshot(paperDir: string, options?: {
    engine?: string;
    compileMs?: number;
}): Promise<{
    id: string;
    files: number;
    bytes: number;
}>;
export interface SnapshotInfo {
    readonly id: string;
    readonly createdAt: string;
    readonly engine?: string;
    readonly files: number;
}
export declare function listSnapshots(paperDir: string): Promise<readonly SnapshotInfo[]>;
/** 回滚：逐文件哈希比对 manifest；覆盖当前 paper/。返回恢复的文件清单。 */
export declare function restoreSnapshot(paperDir: string, id: string): Promise<readonly string[]>;
