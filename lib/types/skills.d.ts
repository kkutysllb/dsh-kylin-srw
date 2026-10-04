/** 插件自带 runtime 技能注册（照 dsh-skills-stock registerSkills 形状，单技能
 * 精简版）：读包内 skills/manifest.json → 逐个读 SKILL.md、剥 frontmatter →
 * `ctx.skills.register()`（source: 'runtime'，rank 由宿主定，项目级同名技能
 * 可覆盖）。frontmatter 只作包内元数据留档——宿主拿到的是剥好的正文 + 结构化
 * 描述字段。 */
/** 宿主 skills 服务用到的最小结构面（ctx.skills）。 */
export interface SrwSkillsService {
    register(entry: {
        readonly name: string;
        readonly description: string;
        readonly whenToUse?: string;
        readonly source: string;
        readonly content: string;
        readonly resourceBase?: {
            readonly kind: 'directory';
            readonly path: string;
        };
        readonly metadata?: Readonly<Record<string, unknown>>;
    }): () => void;
}
/** 剥 YAML frontmatter（`---` 围栏）；无 frontmatter 原样返回。 */
export declare function stripFrontmatter(markdown: string): string;
/** 注册包内清单全部技能；返回组合 disposer。 */
export declare function registerBundledSkills(skills: SrwSkillsService, pluginRoot: string): () => void;
