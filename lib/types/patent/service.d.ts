/** PatentService（M9-lite 专利线编排）：档案（patent.json）+ 技术交底书
 * （disclosure.json）+ 公开事件流水（events.jsonl，append-only）+ 公开时序门。
 * 磁盘域 <root>/<project>/.srw/patent/<patentId>/，文件即真相源；全部读写过
 * assertInsideRoot 护栏（照 WriterService.guard 模式：fs 注入、护栏缺席
 * fail-closed）。LLM 起草不经本服务——agent 车道，工具只做 IO + 门。 */
import { type SrwFsLike } from '../host.ts';
import { type PublicationCheck } from './gate.ts';
import { type Disclosure, type PatentMeta, type PublicEvent } from './types.ts';
export interface PatentDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
}
export interface PatentCreateInput {
    readonly patentId: string;
    readonly title: string;
    readonly inventors?: readonly string[];
    readonly applicants?: readonly string[];
}
export declare class PatentService {
    private readonly deps;
    constructor(deps: PatentDeps);
    private requireRoot;
    private projectDir;
    private patentDir;
    /** 路径护栏（fail-closed）：fs.resolve/contains 缺席直接抛错，绝不静默放行。 */
    private guard;
    private patentJsonPath;
    private disclosurePath;
    private eventsPath;
    /** 读 JSON：护栏先行；不存在/解析失败返回 undefined（list 的坏文件跳过共用）。 */
    private readJson;
    private metaFromRaw;
    /** 面板列表：实扫 .srw/patent/ 下各 patent.json（目录即真相源）；坏文件跳过。 */
    list(project: string): Promise<PatentMeta[]>;
    get(project: string, patentId: string): Promise<PatentMeta>;
    /** 立项：建目录 + patent.json（status 'idea'）+ 空 events.jsonl。
     * 项目必须已存在；重复 patentId 报 CONFLICT（照 srw_project create 语义）。 */
    create(project: string, input: PatentCreateInput): Promise<PatentMeta>;
    /** 技术交底书：整体替换 + 校验；未保存过返回 undefined（工具层转 status:none）。 */
    disclosureGet(project: string, patentId: string): Promise<Disclosure | undefined>;
    disclosureSave(project: string, patentId: string, value: unknown): Promise<Disclosure>;
    /** 公开事件登记：append-only（appendFile 前先 guard + mkdir）。 */
    eventAdd(project: string, patentId: string, value: unknown): Promise<PublicEvent>;
    /** 公开时序门：patent + events → checkPublication（纯函数）。
     * publicationAt 缺省取当前时刻。 */
    publicationCheck(project: string, patentId: string, publicationAt?: string): Promise<{
        patent: PatentMeta;
        publicationAt: string;
        check: PublicationCheck;
    }>;
    /** 读事件流水：坏行跳过（append-only 流水的容错读法）。 */
    private readEvents;
}
