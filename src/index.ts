/** Cordis Host plugin for the dual-channel Scientific Research Workbench
 * (科研工作台, M1).
 *
 * Owns (M1): patch-row config, capability probe service, the Web RPC channel
 * `/dsh-kylin-srw`, the srw_index storage domain, project CRUD (workspace
 * domain), the agent-scoped `srw_project` tool with ask-approval, and the
 * bundled `research-idea` runtime skill. M2+ grows the domain modules
 * (literature/watch/reading/writer/venue/materials/verify/compute) per 0102 §4.
 *
 * Deployment note (KCoder packaged harness): no `@deepseek-ai/*` runtime
 * imports — services arrive via the `inject` names, config arrives as the
 * plain patch-row object, and the service factory clamps it.
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerSrwRpc } from './rpc.ts'
import { SrwService, type SrwConfig } from './service.ts'
import { approvalDecision, callerFrom, srwProjectToolDef, srwLiteratureToolDef , srwWatchToolDef, srwReadToolDef } from './tools.ts'
import { registerBundledSkills } from './skills.ts'

export const name = 'dsh-kylin-srw'

/** M1 注入面（Task 1.0 验证矩阵定稿 + Task 1.7 四件）：存储四件套、RPC
 * 两件套、工具/技能/系统提示/根 Agent 注册表。**每个名字都必须是「目标宿主
 * 编排保证存在」的服务**：E3 实测 inject 一个 profile 未挂载的服务
 * （schedule in web profile）会让插件永久 pending；ctx.get 同样被栅栏拦。
 * Task 1.7 四名的静态证据：base 层 agent/tools/skill + web-app 层
 * system-prompt（桌面 profile 同构 base+web-app）；M3 接入 schedule 时
 * 必须带能力探测降级，且 schedule 名本身不进本名单。 */
export const inject = [
  'connection',
  'webServer',
  'storageDomain',
  'workspaceRegistry',
  'settings',
  'fs',
  'agents',
  'tools',
  'skills',
  'systemPrompt',
] as const

/** Plugin configuration (patch-row `config` values are read defensively). */
export interface Config {
  readonly rootDir?: string
  readonly offlineMode?: boolean
}

/** 能力通告（一段有界文本，只说工具表与描述说不出的工作流约束）。 */
const ANNOUNCEMENT = `本机已安装 dsh-kylin-srw 插件（科研工作台）：在科研总根下以「目录即真相源」的方式管理研究项目（slug 目录 + project.json + 文献/论文/实验骨架）。工具 srw_project 提供项目 list/create/open/remove（create/remove 需人工审批；总根未设置时先让用户在 Web 侧边栏「科研工作台」面板选择）。技能 research-idea 是选题工作流：用户讨论研究想法时按其选题卡骨架推进，成形后可建议登记为项目。工具 srw_literature 提供文献 search/import/pdf/bibtex（arXiv/OpenAlex/Crossref 三源，自动去重与撤稿标红；import/pdf 需人工审批）。工具 srw_watch 管理文献订阅：按检索词定期自动入库（list/create/remove/pause/resume/run；create/remove 需人工审批，run 幂等豁免；时钟注册在宿主「自动化任务」页，用户可改可删）。`

/** Mount the SRW host service, its RPC channel, the agent tool, and skills. */
export async function apply(ctx: Context, rawConfig: Config): Promise<void> {
  await ctx.effect(async () => {
    const service: SrwService = await SrwService.open(ctx, rawConfig satisfies SrwConfig)
    // ADR-19：必须经 reflect.provide 暴露（直接赋值抛
    // "cannot set property without provide"）；返回的 disposer 随 fiber 卸载。
    ;(ctx as { reflect?: { provide(name: string, service: unknown): unknown } })
      .reflect?.provide('srw', service)

    const owned: Array<() => void> = []
    const agentTools = new Map<string, () => void>()

    // 能力通告（systemPrompt 服务缺席时跳过——服务经 inject 保证存在，
    // section 本身抛错则降级不阻断）。
    const systemPrompt = (ctx as unknown as { systemPrompt?: { section(options: { name: string; order: number; text: string }): () => void } }).systemPrompt
    if (systemPrompt?.section !== undefined) {
      try {
        owned.push(systemPrompt.section({ name: `plugin:${name}`, order: 207, text: ANNOUNCEMENT }))
      } catch (error) {
        ;(ctx as unknown as { logger?: { warn(message: string): void } }).logger?.warn?.(`dsh-kylin-srw: systemPrompt.section skipped: ${String(error)}`)
      }
    }

    // 技能注册（skills 服务经 inject 保证存在；读包内 skills/manifest.json）。
    const skills = (ctx as unknown as { skills?: Parameters<typeof registerBundledSkills>[0] }).skills
    if (skills?.register !== undefined) {
      // 插件根 = skills/manifest.json 所在的包目录：构建后本模块在
      // <root>/lib/，tsx 直跑在 <root>/src/；向上各候选取第一个命中。
      const importMeta = import.meta as { url?: string }
      const here = importMeta.url !== undefined ? new URL('.', importMeta.url).pathname : null
      const { existsSync } = await import('node:fs')
      const candidates = here === null
        ? [process.cwd()]
        : [here.replace(/\/lib\/$/, ''), here.replace(/\/src\/$/, ''), here]
      const pluginRoot = candidates.find(root => existsSync(`${root}/skills/manifest.json`))
      if (pluginRoot === undefined) {
        ;(ctx as unknown as { logger?: { warn(message: string): void } }).logger?.warn?.('dsh-kylin-srw: skills/manifest.json 未找到，技能注册跳过')
      } else {
        owned.push(registerBundledSkills(skills, pluginRoot))
      }
    }

    // 根 Agent 作用域挂载 srw_project（照 automation mountTools：agent fiber
    // 上注册，agent 卸载自动回收；非根 Agent 不挂）。
    const mountTools = (agent: unknown): void => {
      const scoped = agent as {
        id?: unknown
        session?: { id?: unknown }
        ctx?: { effect(factory: () => unknown, label: string): unknown; tools?: { register(def: unknown): unknown } }
      }
      const agentId = typeof scoped?.id === 'string' ? scoped.id : undefined
      if (agentId === undefined || scoped.ctx === undefined) return
      const agents = (ctx as unknown as { agents?: { roots(): readonly { id?: unknown }[] } }).agents
      if (agents?.roots === undefined) return
      if (!agents.roots().some(root => root.id === agentId)) return
      if (agentTools.has(agentId)) return
      const agentCtx = scoped.ctx
      const registered = agentCtx.effect(() => {
        const removers = [srwProjectToolDef(service), srwLiteratureToolDef(service), srwWatchToolDef(service), srwReadToolDef(service)].map(def => agentCtx.tools?.register(def))
        return () => {
          for (const remove of [...removers].reverse()) {
            if (typeof remove === 'function') void (remove as () => void)()
          }
        }
      }, 'dsh-kylin-srw: project tool')
      agentTools.set(agentId, registered as unknown as () => void)
    }
    const agents = (ctx as unknown as { agents?: { roots(): readonly { id?: unknown }[] } }).agents
    if (agents?.roots !== undefined) {
      for (const root of agents.roots()) mountTools(root)
      owned.push(ctx.on('agent/created', ({ agent }: { agent?: unknown }) => { mountTools(agent) }))
      owned.push(ctx.on('agent/disposed', ({ agent }: { agent?: unknown }) => {
        const agentId = (agent as { id?: string } | undefined)?.id
        if (typeof agentId === 'string') agentTools.delete(agentId)
      }))
      // 审批钩子：srw_project 的 create/remove 在放行前要求人工 ask。
      owned.push(ctx.on('tools/pre-execute', async (exec: unknown, next: () => Promise<{ kind: string }>) => {
        const downstream = await next()
        if (downstream.kind !== 'allow') return downstream
        const caller = callerFrom(exec)
        const mounted = caller.sessionId !== undefined && agentTools.has(caller.sessionId)
        const decision = approvalDecision(exec as { name: string; arguments?: unknown }, mounted)
        return decision ?? downstream
      }))
    }

    const removeRpc = registerSrwRpc(ctx, service)
    return async () => {
      for (const dispose of [...agentTools.values()].reverse()) {
        try { dispose() } catch { /* 回收失败不阻断卸载 */ }
      }
      agentTools.clear()
      for (const dispose of [...owned].reverse()) {
        try { dispose() } catch { /* 回收失败不阻断卸载 */ }
      }
      await removeRpc()
      await service.dispose()
    }
  }, 'dsh-kylin-srw: host')
}
