// capsule-bar — 插件入口:4 个显式标注工具 + 自动观测器挂载。
// 双通道模型(SOP 02):task/steps 走显式工具;phase/currentTool/计数由 watcher 自动观测,模型无感。
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { CapsuleStore, type CapsuleState } from './state.ts'
import { attachWatcher, resolveSessionId, type JobsServiceLike } from './watcher.ts'

// 插件名:Cordis 注册名(loader 诊断与其他插件引用用)
export const name = 'capsule-bar'

// 要求就绪的服务(决定加载顺序)
export const inject = ['tools']

/** 插件配置 */
export interface Config {
    /** 状态文件存储根目录(必须绝对路径);默认系统临时目录下 dsh-capsule-bar */
    storePath: string
    /** 步骤上限,超出 capsule_step 报错 */
    maxSteps: number
    /** 活跃指针过期阈值(分钟),UI 据此隐藏陈旧胶囊 */
    staleMinutes: number
}

export const Config: z<Config> = z.object({
    storePath: z.string().default(join(tmpdir(), 'dsh-capsule-bar')),
    maxSteps: z.number().default(20),
    staleMinutes: z.number().default(30),
})

/** 步骤进度 done/total;无步骤返回 null */
function stepProgress(state: CapsuleState): { done: number; total: number } | null {
    if (state.steps.length === 0) return null
    return {
        done: state.steps.filter((step) => step.status === 'done').length,
        total: state.steps.length,
    }
}

/**
 * 卡片摘要:`任务名 2/5`。
 * 刻意不含 phase/currentTool:render/presentationMeta 会被持久化并回放,
 * 瞬态工具状态属于 UI 自算的 A 通道(SOP 05 卡点 B2),写进卡片会污染回放。
 */
function semanticSummary(state: CapsuleState): string {
    const parts: string[] = []
    if (state.task) parts.push(state.task)
    const progress = stepProgress(state)
    if (progress) parts.push(`${progress.done}/${progress.total}`)
    return parts.length > 0 ? parts.join(' · ') : '胶囊待命'
}

/** C 通道快照:execute 时会话刚被更新,活跃指针即当前会话(best-effort,SOP 05 B2 决策) */
function bestEffortSnapshot(store: CapsuleStore) {
    const pointer = store.activePointer()
    if (!pointer) return null
    // JSON 往返以满足 JsonValue(规范值接口无索引签名)
    return JSON.parse(JSON.stringify(store.get(pointer.sessionId)))
}

/** 从持久化 meta 里取摘要(presentResult 拿不到 exec,摘要由 presentationMeta 快照携带) */
function metaSummary(result: { isError: boolean; meta?: unknown; content: unknown }): string | undefined {
    if (result.isError) return undefined
    const meta = result.meta as { summary?: unknown } | undefined
    return typeof meta?.summary === 'string' ? meta.summary : undefined
}

/** 统一的工具卡片结果(presentResult 用官方 generic 卡,SOP 03 §1) */
function genericCard(title: string, summary: string) {
    return {
        card: 'generic' as const,
        title,
        content: [{ type: 'text' as const, text: summary }],
    }
}

function buildTools(store: CapsuleStore): ToolDefinition[] {
    return [
        defineTool({
            name: 'capsule_task',
            description:
                '设置悬浮胶囊的当前任务名与步骤清单;task 传 null 表示清除任务(设置任务会重置步骤)。' +
                '任务开始时调用一次即可,后续进度无需汇报——胶囊会自动观测工具调用。',
            parameters: {
                task: {
                    oneOf: [{ type: 'string' }, { type: 'null' }],
                    description: '任务名;null 表示清除当前任务',
                },
                steps: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '步骤清单(可选),一次性录入,第一步自动激活',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        task: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: '当前任务名' },
                        steps: { type: 'integer', required: true, description: '步骤总数' },
                        summary: { type: 'string', required: true, description: '胶囊进度摘要' },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => [{ type: 'text', text: value.summary }],
                presentationMeta: () => bestEffortSnapshot(store),
            },
            isConcurrencySafe: () => false,
            execute: async (args, exec: ToolRunContext) => {
                const sessionId = resolveSessionId(exec)
                const state = store.setTask(sessionId, args.task ?? null)
                // 一次性录入步骤:全部 pending,第一步激活(推进语义统一交给 capsule_step_done)
                if (args.steps) {
                    for (const label of args.steps) store.addStep(sessionId, label)
                    if (args.steps.length > 0) store.setStepStatus(sessionId, 1, 'active')
                }
                const after = store.get(sessionId)
                return { task: after.task, steps: after.steps.length, summary: semanticSummary(after) }
            },
            presentResult: (_args, result) => {
                const summary = metaSummary(result)
                return summary ? genericCard('▣ 胶囊 · 任务设置', summary) : undefined
            },
        }),

        defineTool({
            name: 'capsule_step',
            description: '为当前任务追加一个步骤(自动激活);推进状态请用 capsule_step_done。',
            parameters: {
                label: { type: 'string', required: true, description: '步骤名,如"备份"' },
            },
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        stepId: { type: 'integer', required: true, description: '新步骤 id' },
                        total: { type: 'integer', required: true, description: '步骤总数' },
                        summary: { type: 'string', required: true, description: '胶囊进度摘要' },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => [{ type: 'text', text: value.summary }],
                presentationMeta: () => bestEffortSnapshot(store),
            },
            isConcurrencySafe: () => false,
            execute: async (args, exec: ToolRunContext) => {
                const sessionId = resolveSessionId(exec)
                const step = store.addStep(sessionId, args.label)
                store.setStepStatus(sessionId, step.id, 'active')
                const after = store.get(sessionId)
                return { stepId: step.id, total: after.steps.length, summary: semanticSummary(after) }
            },
            presentResult: (_args, result) => {
                const summary = metaSummary(result)
                return summary ? genericCard('▣ 胶囊 · 步骤追加', summary) : undefined
            },
        }),

        defineTool({
            name: 'capsule_step_done',
            description: '推进步骤状态:完成(done)或标记失败(failed);失败后可由 capsule_step 重开新步骤。',
            parameters: {
                stepId: { type: 'integer', required: true, description: '步骤 id' },
                result: {
                    type: 'string',
                    enum: ['done', 'failed'],
                    description: '步骤结果,缺省为 done',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        stepId: { type: 'integer', required: true, description: '步骤 id' },
                        status: {
                            type: 'string',
                            enum: ['pending', 'active', 'done', 'failed'],
                            required: true,
                            description: '推进后的步骤状态',
                        },
                        remaining: { type: 'integer', required: true, description: '未完成步骤数' },
                        summary: { type: 'string', required: true, description: '胶囊进度摘要' },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => [{ type: 'text', text: value.summary }],
                presentationMeta: () => bestEffortSnapshot(store),
            },
            isConcurrencySafe: () => false,
            execute: async (args, exec: ToolRunContext) => {
                const sessionId = resolveSessionId(exec)
                const step = store.setStepStatus(sessionId, args.stepId, args.result ?? 'done')
                const after = store.get(sessionId)
                const remaining = after.steps.filter((candidate) => candidate.status !== 'done').length
                return {
                    stepId: step.id,
                    status: step.status,
                    remaining,
                    summary: semanticSummary(after),
                }
            },
            presentResult: (_args, result) => {
                const summary = metaSummary(result)
                return summary ? genericCard('▣ 胶囊 · 步骤更新', summary) : undefined
            },
        }),

        defineTool({
            name: 'capsule_clear',
            description: '清空胶囊的任务与步骤(自动观测的运行状态保留)。',
            parameters: {},
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        cleared: { type: 'boolean', required: true, description: '是否已清空' },
                        summary: { type: 'string', required: true, description: '胶囊进度摘要' },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => [{ type: 'text', text: value.summary }],
                presentationMeta: () => bestEffortSnapshot(store),
            },
            isConcurrencySafe: () => false,
            execute: async (_args, exec: ToolRunContext) => {
                const sessionId = resolveSessionId(exec)
                const after = store.clearTask(sessionId)
                return { cleared: true, summary: semanticSummary(after) }
            },
            presentResult: (_args, result) => {
                const summary = metaSummary(result)
                return summary ? genericCard('▣ 胶囊 · 已清空', summary) : undefined
            },
        }),
    ]
}

/**
 * 插件入口。
 * @param ctx - Cordis 上下文
 * @param config - 已解析的插件配置
 */
export function apply(ctx: Context, config: Config): void {
    // SOP 错误契约:storePath 相对路径在 apply 抛明确错误
    if (!isAbsolute(config.storePath)) {
        throw new Error(`[capsule-bar] storePath 必须是绝对路径,当前为:${config.storePath}`)
    }
    const store = new CapsuleStore(config.storePath, () => new Date(), config.maxSteps)
    for (const tool of buildTools(store)) ctx.tools.register(tool)
    // #5 精确化:宿主 jobs 服务软依赖(在场才对账,不写进 inject 避免硬依赖阻断加载)
    const jobsService = (ctx as { jobs?: JobsServiceLike }).jobs
    const getJobs =
        jobsService !== undefined && typeof jobsService.list === 'function'
          ? (): unknown => {
                try {
                    return jobsService.list?.()
                } catch {
                    return null
                }
            }
          : undefined
    attachWatcher(ctx, store, () => new Date(), getJobs)
}
