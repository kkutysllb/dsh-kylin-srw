/** workspace 领域模块（M1）：项目 CRUD，**目录即真相源**（0102 §6.2）——
 * 科研总根下一个 slug 目录 + `.srw/project.json` 即一个项目；没有数据库，
 * 没有 storage 域投影，list 是实扫。坏 project.json 的目录不是项目（跳过，
 * 不抛错）——用户手工目录不会被面板弄坏。 */
import { type ProjectMeta } from '../core/schema.ts';
export declare const PROJECT_SUBDIRS: readonly [".srw", "literature/pdf", "literature/notes", "literature/readings", "paper", "experiments", "materials"];
export declare class WorkspaceStore {
    private readonly rootAbs;
    constructor(rootAbs: () => string | undefined);
    private dir;
    /** 实扫总根：目录名合 slug 法 + project.json 可校验才算项目。 */
    list(): Promise<ProjectMeta[]>;
    create(input: {
        slug: string;
        title: string;
        field?: string;
    }): Promise<ProjectMeta>;
    open(slug: string): Promise<ProjectMeta>;
    /** 危险操作：二次确认由调用方负责（面板对话框 / 工具 pre-execute ask）。 */
    remove(slug: string): Promise<void>;
    rename(slug: string, title: string): Promise<ProjectMeta>;
    /** 目录级重命名（slug 变更）：项目元数据随目录移动，slug 字段同步改写。 */
    moveSlug(fromSlug: string, toSlug: string): Promise<ProjectMeta>;
}
