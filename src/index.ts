// capsule-bar — 插件入口:自动观测器挂载(纯旁路观测驱动)。
// 方向修正(2026-09-15):移除 capsule_* 显式标注工具——胶囊不要求模型主动打标,
// 触发源全部来自宿主工具的旁路观测(todo_write/goal/plan/后台任务/定时任务/子代理)。
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CapsuleStore } from './state.ts'
import { attachWatcher, type JobsServiceLike } from './watcher.ts'

// 插件名:Cordis 注册名(loader 诊断与其他插件引用用)
export const name = 'capsule-bar'

// 要求就绪的服务(决定加载顺序)
export const inject = ['tools']

/** 插件配置 */
export interface Config {
    /** 状态文件存储根目录(必须绝对路径);默认系统临时目录下 dsh-capsule-bar */
    storePath: string
    /** 步骤上限,保留为配置契约(applyTaskBlueprint 整清单替换不受此限制) */
    maxSteps: number
    /** 活跃指针过期阈值(分钟),UI 据此隐藏陈旧胶囊 */
    staleMinutes: number
}

export const Config: z<Config> = z.object({
    storePath: z.string().default(join(tmpdir(), 'dsh-capsule-bar')),
    maxSteps: z.number().default(20),
    staleMinutes: z.number().default(30),
})

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
