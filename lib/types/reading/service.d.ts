/** ReadingService（0205 Task 4.7 / R6）：精读域编排——extract（PDF→块表）
 * → translate（缓存命中优先，miss 走翻译链）→ render（paper.md）→ verify。
 * 磁盘域 `<root>/<project>/reading/<paperKey>/`；LLM 经 reflect 通道可选
 * （缺席 → 翻译降级 INVALID 提示，抽取/校验不受影响）。 */
import { type SrwFsLike } from '../host.ts';
import { type Glossary } from './glossary.ts';
import { type SourceMap } from './source-map.ts';
import { type LlmPort } from './translator.ts';
export type { LlmPort };
import { type VerifyReport } from './verify.ts';
export interface ReadingDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
    /** LLM 窄面（真实装配：ctx.reflect.get('llm')；缺席 = 翻译不可用）。 */
    readonly llm: () => LlmPort | undefined;
    readonly llmConfig: () => {
        provider: string;
        model: string;
    };
}
export interface ReadingStatus {
    readonly paperKey: string;
    readonly extracted: boolean;
    readonly pages: number;
    readonly blocks: number;
    readonly translated: number;
    readonly verified: number;
    readonly mismatch: number;
    readonly orphan: number;
    readonly missing: number;
    readonly llmAvailable: boolean;
}
export declare class ReadingService {
    private readonly deps;
    constructor(deps: ReadingDeps);
    private requireRoot;
    private dir;
    private guard;
    private readJson;
    private writeJson;
    private writeText;
    private mapPath;
    private paperPath;
    private cachePath;
    private glossaryPath;
    loadMap(project: string, paperKey: string): Promise<SourceMap | undefined>;
    loadGlossary(project: string, paperKey: string): Promise<Glossary>;
    /** 术语表写入 + 定向失效：srcText 含变更术语的块的缓存条目剔除。 */
    setGlossary(project: string, paperKey: string, entries: Record<string, string>): Promise<Glossary>;
    /** 抽取：读 PDF → 块表 →（已有 map 则迁移）→ 落 source_map.json。
     * pdfPath 是库内相对路径（如 literature/pdf/xxx.pdf）。 */
    extract(project: string, paperKey: string, pdfPath: string): Promise<{
        pages: number;
        blocks: number;
        migrated: number;
        orphan: number;
    }>;
    /** 翻译：缓存命中跳过；miss 走 llm（缺席报 INVALID）→ 术语强校验 →
     * 写缓存/更新 map 元数据 → 重渲染 paper.md → verify。 */
    translate(project: string, paperKey: string, options?: {
        keys?: readonly string[];
        force?: boolean;
    }): Promise<ReadingStatus>;
    private keyOf;
    private keyOfById;
    private rewriteMapTranslations;
    /** 渲染 paper.md（以 map+sources+缓存现值为准），渲染后 verify 状态写进锚。 */
    private renderPaper;
    /** paper.md 原文（视图渲染用）。 */
    content(project: string, paperKey: string): Promise<{
        markdown: string;
        verify: VerifyReport;
    }>;
    verify(project: string, paperKey: string): Promise<VerifyReport>;
    /** 结果 PDF 归档（readings/<YYYY-MM-DD>/<paperKey>.pdf）：从 paper.md
     * 渲染双语 PDF 落到项目工作区独立子目录。同日重导覆盖（可再生产物）。 */
    exportPdf(project: string, paperKey: string): Promise<{
        path: string;
        bytes: number;
        summary: {
            pages: number;
            blocks: number;
            translated: number;
            verified: number;
            mismatch: number;
            orphan: number;
            missing: number;
        };
    }>;
    status(project: string, paperKey: string): Promise<ReadingStatus>;
}
