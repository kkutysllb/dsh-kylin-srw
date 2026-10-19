/** 零依赖行 diff（8.2）：响应信证据门（RESPONSE_UNBACKED）与投稿 diff 的地基。
 * 纯函数。算法用 LCS 动态规划（Uint8Array 方向矩阵）而非 Myers O(ND)——
 * Myers 在「右移越出 a 末尾」时有 x=N+1 溢出陷阱（回溯会索引越界），
 * LCS 简单正确有界：方向矩阵 1 byte/格，>8M 格（约 2800×2800 行）退化为
 * 「整文件替换」单个 hunk 并在 stats.replaced 标注。只处理文本；
 * PDF/二进制由 service.paperDiff 比哈希（status binary）。 */
export interface DiffLine {
    readonly op: ' ' | '-' | '+';
    readonly text: string;
}
export interface DiffHunk {
    /** a/b 侧起始行号（1-based；纯增时 aStart 指向插入点，aCount=0）。 */
    readonly aStart: number;
    readonly aCount: number;
    readonly bStart: number;
    readonly bCount: number;
    readonly lines: readonly DiffLine[];
}
export interface PaperDiffFile {
    readonly path: string;
    readonly status: 'modified' | 'added' | 'removed' | 'binary';
    readonly hunks: readonly DiffHunk[];
}
export interface PaperDiff {
    readonly schemaVersion: 1;
    readonly from: string;
    readonly to: string;
    readonly createdAt: string;
    readonly files: readonly PaperDiffFile[];
    readonly stats: {
        readonly added: number;
        readonly removed: number;
        readonly modified: number;
        readonly binary: number;
    };
}
/** 行 diff → hunk 列表：被上下文（未变行）隔开的变更各自成 hunk。 */
export declare function diffLines(aText: string, bText: string): readonly DiffHunk[];
