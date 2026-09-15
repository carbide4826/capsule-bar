// cb 可见性策略(v2 状态机的唯一裁决点)。
// 出现 = 任一触发源有活动条目;消失 = H1-H5。
// ⚠️ 消失条件后续要调:只改本文件,不动 watcher/UI。
import type { CapsuleStep } from './state.ts'

export interface VisibilityInput {
    task: string | null
    steps: Array<Pick<CapsuleStep, 'status'>>
    schedules: Array<{ nextRun: string | null }>
    jobs: Array<{ killedAt?: string }>
    subagents: Array<{ interruptedAt?: string }>
    /** H1:任务存在且全部步骤 done,且 3 秒绿闪已结束 */
    flashOver: boolean
    /** H2:指针超过 staleMinutes 未活动 */
    stale: boolean
}

export function shouldShow(input: VisibilityInput): boolean {
    if (input.flashOver) return false // H1
    if (input.stale) return false // H2
    const hasTask = input.task !== null || input.steps.length > 0 // #1/#2/#3/#4
    const hasSchedule = input.schedules.length > 0 // #6
    const hasLiveJob = input.jobs.some((job) => job.killedAt === undefined) // #5(只数未终止)
    const hasLiveSubagent = input.subagents.some(
        (subagent) => subagent.interruptedAt === undefined,
    ) // #7(只数未中断)
    return hasTask || hasSchedule || hasLiveJob || hasLiveSubagent
}
