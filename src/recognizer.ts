// 触发源识别器(v2 状态机):把观测到的工具调用翻译成胶囊状态操作。
// 覆盖:#2 todo_write / #3 goal / #4 plan 批准 / #5 bash 后台 + job_kill / #6 schedule_*;
// #1 capsule_* 由自家工具的 execute 自管理,此处刻意忽略,防止双写。
// 纯函数:只做字段防御解析 + 调 store,自身无状态。
import type { CapsuleSchedule, CapsuleStore, CapsuleStep } from './state.ts'

const TODO_TASK_LABEL = '待办清单'

/** 宿主 id 观测不到时的本地兜底 id 序号(同毫秒创建多条不撞车) */
let localScheduleSeq = 0

/** 单条触发识别:pre-execute 阶段(参数可见) */
export function mapToolCall(
    store: CapsuleStore,
    sessionId: string,
    name: string,
    args: unknown,
    now: () => Date,
): void {
    const a = (args ?? {}) as Record<string, unknown>
    switch (name) {
        case 'todo_write': {
            // #2:整清单替换语义(官方描述:每次全量发送);status 映射进胶囊状态机
            const todos = Array.isArray(a.todos) ? (a.todos as unknown[]) : []
            if (todos.length === 0) return
            const blueprint: Array<{ label: string; status: CapsuleStep['status'] }> = []
            for (const raw of todos) {
                const item = (raw ?? {}) as Record<string, unknown>
                blueprint.push({
                    label: typeof item.content === 'string' ? item.content : '',
                    status:
                        item.status === 'completed'
                            ? 'done'
                            : item.status === 'in_progress'
                              ? 'active'
                              : 'pending',
                })
            }
            store.applyTaskBlueprint(sessionId, TODO_TASK_LABEL, blueprint)
            return
        }
        case 'create_goal':
        case 'update_goal': {
            // #3:目标标题即任务名
            const text =
                typeof a.goal === 'string' ? a.goal : typeof a.text === 'string' ? a.text : null
            if (text !== null && text.length > 0) store.setTask(sessionId, text)
            return
        }
        case 'bash': {
            // #5:后台启动(bash background:true)记为常驻条目;前台调用不触发
            if (a.background === true && typeof a.command === 'string') {
                const startedAt = now().toISOString()
                store.addJob(sessionId, {
                    id: `bash:${startedAt}`,
                    command: a.command,
                    startedAt,
                })
            }
            return
        }
        case 'job_kill': {
            // #5:job_kill 观测 → 标记对应后台条目终止(job_id 或命令片段匹配)
            if (typeof a.job_id === 'string') store.killJob(sessionId, a.job_id)
            return
        }
        case 'send_message': {
            // #7:向子代理发消息 → 记录/刷新子代理活跃条目
            if (typeof a.agent_id === 'string' && a.agent_id.length > 0) {
                store.touchSubagent(sessionId, a.agent_id)
            }
            return
        }
        case 'interrupt_agent': {
            // #7:interrupt_agent 观测 → 标记子代理中断
            if (typeof a.agent_id === 'string' && a.agent_id.length > 0) {
                store.interruptSubagent(sessionId, a.agent_id)
            }
            return
        }
        case 'schedule_create': {
            // #6:登记定时任务(prompt + at/everySeconds 推算下次执行)
            const prompt = typeof a.prompt === 'string' ? a.prompt : ''
            const id =
                typeof a.id === 'string'
                  ? a.id
                  : `sched:${now().toISOString()}:${(localScheduleSeq += 1)}`
            const entry: CapsuleSchedule = {
                id,
                prompt,
                nextRun: computeNextRun(a, now()),
                createdAt: now().toISOString(),
            }
            store.upsertSchedule(sessionId, entry)
            return
        }
        case 'schedule_delete': {
            // #6:移除(id 优先,回退 prompt 匹配)
            if (typeof a.id === 'string') {
                store.removeSchedule(sessionId, a.id)
            } else if (typeof a.prompt === 'string') {
                const state = store.get(sessionId)
                for (const entry of state.schedules) {
                    if (entry.prompt === a.prompt) store.removeSchedule(sessionId, entry.id)
                }
            }
            return
        }
        default:
            return // 其余工具不触发展示(纯闲聊 / 零散调用)
    }
}

/** 结果触发识别:tools/result 阶段(目前仅 #4 plan 批准) */
export function mapToolResult(
    store: CapsuleStore,
    sessionId: string,
    name: string,
    args: unknown,
    isError: boolean,
): void {
    if (name !== 'plan' || isError) return
    // #4:计划批准成功 → markdown 提取(# 标题为任务名;- / 1. 行为步骤,初始 pending)
    const a = (args ?? {}) as Record<string, unknown>
    const markdown = typeof a.plan === 'string' ? a.plan : ''
    if (markdown.length === 0) return
    const lines = markdown.split('\n').map((line) => line.trim())
    const headingLine = lines.find((line) => line.startsWith('#'))
    const task = headingLine !== undefined ? headingLine.replace(/^#+\s*/, '') : null
    const blueprint = lines
        .filter((line) => /^(-|\*|\d+[.)])\s+/.test(line))
        .map((line) => ({
            label: line.replace(/^(-|\*|\d+[.)])\s+/, ''),
            status: 'pending' as const,
        }))
    if (task === null && blueprint.length === 0) return
    store.applyTaskBlueprint(sessionId, task, blueprint)
}

/** schedule 下次执行时间推算:at/time 绝对时间优先;everySeconds 按创建时刻 + 间隔;every(cron/文案)v1 不解析 */
function computeNextRun(a: Record<string, unknown>, now: Date): string | null {
    const absolute = typeof a.at === 'string' ? a.at : typeof a.time === 'string' ? a.time : null
    if (absolute !== null) {
        const timestamp = Date.parse(absolute)
        if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
    }
    if (typeof a.everySeconds === 'number' && a.everySeconds > 0) {
        return new Date(now.getTime() + a.everySeconds * 1000).toISOString()
    }
    return null
}
