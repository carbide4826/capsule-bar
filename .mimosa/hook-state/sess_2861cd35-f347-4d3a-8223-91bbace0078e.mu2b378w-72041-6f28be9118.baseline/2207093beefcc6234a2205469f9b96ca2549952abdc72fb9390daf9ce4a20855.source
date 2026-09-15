// capsule-bar 自动观测器:挂宿主事件,把"正在做什么"(phase/currentTool/计数)写进状态机。
// 核心契约:观测器绝不影响主管道 —— 任何异常吞掉并 warn;pre-execute 是 waterfall,只观察、永远放行。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools' // 事件类型增强:tools/pre-execute、tools/result 的签名来源
import { mapToolCall, mapToolResult } from './recognizer.ts'
import type { CapsuleStore } from './state.ts'

/** ctx.jobs 服务最小结构(dsh-tool-jobs 提供;类型不在依赖内,防御式使用) */
export interface JobsServiceLike {
    list?: (agent?: unknown) => unknown
}

/**
 * 从工具执行上下文里防御式解析会话 id。
 * dsh-agent 不在依赖内,Agent 形状未知(SOP 卡点 B5),按常见字段链降级,失败回退 'default'。
 */
export function resolveSessionId(exec: { agent?: unknown } | null | undefined): string {
    const agent = exec?.agent as Record<string, unknown> | undefined
    if (agent && typeof agent === 'object') {
        const session = agent.session as Record<string, unknown> | undefined
        for (const candidate of [agent.sessionId, session?.id, agent.id]) {
            if (typeof candidate === 'string' && candidate.length > 0) return candidate
        }
    }
    return 'default'
}

/** 从 turn 事件 payload 里防御式解析会话 id(payload 形状未知) */
function resolveSessionIdFromPayload(payload: unknown): string {
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>
        const session = record.session as Record<string, unknown> | undefined
        for (const candidate of [record.sessionId, session?.id, record.id]) {
            if (typeof candidate === 'string' && candidate.length > 0) return candidate
        }
    }
    return 'default'
}

/**
 * 挂载自动观测器。注册即 effect(cordis 卸载时自动清理),无需手动 dispose。
 * @param ctx - Cordis 上下文
 * @param store - 胶囊状态机
 * @param now - 时钟注入(测试可替换)
 */
export function attachWatcher(
    ctx: Context,
    store: CapsuleStore,
    now: () => Date = () => new Date(),
    getJobs?: () => unknown,
): void {
    const warn = (where: string, error: unknown): void => {
        ctx.logger.warn('[capsule-bar] 观测器异常(已吞掉,不影响主管道) %s: %s', where, error)
    }

    // waterfall 权限门:只观察,永远放行;pre-execute 在每次工具调用必发(SOP S4 设计红利)
    ctx.on('tools/pre-execute', async (exec, next) => {
        try {
            const sessionId = resolveSessionId(exec)
            const state = store.get(sessionId)
            store.mergeObservation(sessionId, {
                phase: 'tool',
                currentTool: exec.name,
                toolCallsThisTurn: state.toolCallsThisTurn + 1,
            })
            // 触发源识别(v2 状态机 #2-#7):todo/goal/bash 后台/job_kill/schedule_*/子代理
            mapToolCall(store, sessionId, exec.name, exec.arguments, now)
        } catch (error) {
            warn('tools/pre-execute', error)
        }
        return next()
    })

    // emit 观察:工具跑完(成功或失败都送达);失败计数一并计入
    ctx.on('tools/result', (exec, result) => {
        try {
            const sessionId = resolveSessionId(exec)
            const state = store.get(sessionId)
            store.mergeObservation(sessionId, {
                toolCallsDone: state.toolCallsDone + 1,
                currentTool: null,
                phase: 'thinking',
            })
            // 结果触发(v2 #4):plan 批准成功 → 计划步骤写入胶囊
            const isError = (result as { isError?: unknown } | undefined)?.isError === true
            mapToolResult(store, sessionId, exec.name, exec.arguments, isError)
            // #5 精确化:宿主 jobs 服务在场时,以真实快照对账(含自然退出检测)
            if (getJobs !== undefined) store.reconcileJobs(sessionId, getJobs())
        } catch (error) {
            warn('tools/result', error)
        }
    })

    // turn 边界:dsh-agent 类型不在依赖内,走 ctx.events.on 宽松重载 + 防御解析(SOP 卡点 B5)
    ctx.events.on('turn/start', (payload?: unknown) => {
        try {
            const sessionId = resolveSessionIdFromPayload(payload)
            const state = store.get(sessionId)
            store.mergeObservation(sessionId, {
                toolCallsThisTurn: 0,
                toolCallsDone: 0,
                phase: 'thinking',
                // 本轮计时起点:只在为空时补记,不覆盖显式标注
                startedAt: state.startedAt ?? now().toISOString(),
            })
        } catch (error) {
            warn('turn/start', error)
        }
    })

    ctx.events.on('turn/end', (payload?: unknown) => {
        try {
            const sessionId = resolveSessionIdFromPayload(payload)
            store.mergeObservation(sessionId, { phase: 'idle', currentTool: null })
        } catch (error) {
            warn('turn/end', error)
        }
    })
}
