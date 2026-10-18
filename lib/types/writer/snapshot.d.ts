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
/** 快照允许回滚的路径白名单：manifest 是磁盘上的普通 JSON，可能被手改/注入，
 * 只认这些形状，任何 ../、绝对路径、未知文件一律 FORBIDDEN（不是静默跳过）。 */
export declare function isSnapshotPathAllowed(path: string): boolean;
export interface RestoreSnapshotOptions {
    /** 宿主 containment 护栏（服务层传入）；直接调用 snapshot 模块的测试可省。 */
    readonly guard?: (rel: string) => Promise<void>;
}
/** 回滚：逐文件哈希比对 manifest；覆盖当前 paper/（state/* 写回项目 .srw/）。
 * 返回恢复的文件清单。 */
export declare function restoreSnapshot(paperDir: string, id: string, options?: RestoreSnapshotOptions): Promise<readonly string[]>;
