// capsule-bar 状态机:会话胶囊状态的读写、指针维护与损坏回退。
// 纯数据层,不依赖 cordis;时钟注入保证测试确定性,elapsedMs 永不落盘(重启安全)。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 步骤(显式标注) */
export interface CapsuleStep {
    id: number // 任务内自增
    label: string // 如 "备份"
    status: 'pending' | 'active' | 'done' | 'failed'
    startedAt?: string
    endedAt?: string
}

/** 单会话胶囊状态(整文件读写) */
export interface CapsuleState {
    version: 1
    sessionId: string
    /** 当前任务名;null = 未设置(纯自动观测模式) */
    task: string | null
    steps: CapsuleStep[]
    /** 阶段:空闲 / 模型思考 / 工具执行 */
    phase: 'idle' | 'thinking' | 'tool'
    /** 当前正在执行的工具名(phase=tool 时非空) */
    currentTool: string | null
    /** 本轮(turn)工具调用计数 */
    toolCallsThisTurn: number
    /** 本轮已结束的工具调用数(成功+失败) */
    toolCallsDone: number
    /** 任务开始时间(第一个显式标注或本轮 turn/start) */
    startedAt: string | null
    updatedAt: string
    /** 定时任务条目(触发源 #6) */
    schedules: CapsuleSchedule[]
    /** 后台任务条目(触发源 #5) */
    jobs: CapsuleJob[]
    /** 子代理条目(触发源 #7) */
    subagents: CapsuleSubagent[]
}

/** 活跃指针:UI 轮询入口(哪个会话的胶囊该显示) */
export interface CapsulePointer {
    sessionId: string
    updatedAt: string
}

/** 定时任务条目(触发源 #6:schedule_create/schedule_delete 观测) */
export interface CapsuleSchedule {
    /** 宿主 schedule id(如 schedule-1);观测不到时本地生成 */
    id: string
    /** 到期提醒内容(schedule_create 的 prompt) */
    prompt: string
    /** 下次执行时间;间隔/cron 类算不出为 null(不参与 2 分钟呼吸提示) */
    nextRun: string | null
    createdAt: string
}

/** 后台任务条目(触发源 #5:bash 后台启动;job_kill 标记终止) */
export interface CapsuleJob {
    id: string
    command: string
    startedAt: string
    /** 终止时间;undefined = 运行中 */
    killedAt?: string
}

/** 子代理条目(触发源 #7:send_message 启动/通信;interrupt_agent 标记中断) */
export interface CapsuleSubagent {
    /** 子代理 agent_id */
    id: string
    startedAt: string
    /** 中断时间;undefined = 活跃 */
    interruptedAt?: string
}

/** 观测器允许写入的字段(绝不触碰 task/steps) */
export type ObservationPatch = Partial<Pick<
    CapsuleState,
    'phase' | 'currentTool' | 'toolCallsThisTurn' | 'toolCallsDone' | 'startedAt'
>>

const POINTER_FILE = 'current.json'

function defaultState(sessionId: string, now: () => Date): CapsuleState {
    return {
        version: 1,
        sessionId,
        task: null,
        steps: [],
        phase: 'idle',
        currentTool: null,
        toolCallsThisTurn: 0,
        toolCallsDone: 0,
        startedAt: null,
        updatedAt: now().toISOString(),
        schedules: [],
        jobs: [],
        subagents: [],
    }
}

/** 会话 id 转安全文件名(encodeURIComponent 防路径穿越) */
function sessionFileName(sessionId: string): string {
    return `${encodeURIComponent(sessionId)}.json`
}

export class CapsuleStore {
    readonly storePath: string
    private readonly now: () => Date
    /** 步骤上限(配置契约保留;当前无增量写入调用方,applyTaskBlueprint 整清单替换不校验) */
    readonly maxSteps: number

    // 显式赋值而非参数属性:--patch 直载走 Node strip-only 模式,不支持 constructor 参数属性
    constructor(storePath: string, now: () => Date = () => new Date(), maxSteps: number = 20) {
        this.storePath = storePath
        this.now = now
        this.maxSteps = maxSteps
        // 目录先行:损坏回退(.bak)与指针写入不依赖首次业务写入
        mkdirSync(join(this.storePath, 'sessions'), { recursive: true })
    }

    private sessionFile(sessionId: string): string {
        return join(this.storePath, 'sessions', sessionFileName(sessionId))
    }

    private pointerFile(): string {
        return join(this.storePath, POINTER_FILE)
    }

    /** 读取;损坏文件转 .bak 后重建默认状态 */
    private readState(sessionId: string): CapsuleState {
        const file = this.sessionFile(sessionId)
        let raw: string
        try {
            raw = readFileSync(file, 'utf8')
        } catch {
            return defaultState(sessionId, this.now)
        }
        try {
            return this.parseState(raw, sessionId)
        } catch {
            // 损坏回退:保留现场(.bak),重建默认状态
            try {
                renameSync(file, `${file}.bak`)
            } catch {
                // 回退失败也不阻塞读取
            }
            return defaultState(sessionId, this.now)
        }
    }

    private parseState(raw: string, sessionId: string): CapsuleState {
        const data = JSON.parse(raw) as Partial<CapsuleState>
        if (data.version !== 1 || typeof data !== 'object' || data === null) {
            throw new Error('unrecognized capsule state file')
        }
        return { ...defaultState(sessionId, this.now), ...data, sessionId } as CapsuleState
    }

    /** 整文件写回 + 刷新指针;elapsedMs 永不落盘 */
    private writeState(state: CapsuleState): CapsuleState {
        const next: CapsuleState = { ...state, updatedAt: this.now().toISOString() }
        mkdirSync(join(this.storePath, 'sessions'), { recursive: true })
        writeFileSync(this.sessionFile(next.sessionId), JSON.stringify(next, null, 2))
        const pointer: CapsulePointer = { sessionId: next.sessionId, updatedAt: next.updatedAt }
        writeFileSync(this.pointerFile(), JSON.stringify(pointer, null, 2))
        return next
    }

    /** 触发源 #3:设置任务名(重置 steps;task=null 清除) */
    setTask(sessionId: string, task: string | null): CapsuleState {
        const state = this.readState(sessionId)
        state.task = task
        state.steps = []
        // 任务开始时间:goal 观测首次兜底
        if (task !== null && !state.startedAt) state.startedAt = this.now().toISOString()
        return this.writeState(state)
    }

    /**
     * 触发源 #2/#4:外部权威清单(todo_write 待办 / plan 计划)整体写入任务与步骤。
     * 状态由来源直接给定(todo 的 status / 计划初始 pending),不经过 setStepStatus 流转表。
     */
    applyTaskBlueprint(
        sessionId: string,
        task: string | null,
        blueprint: Array<{ label: string; status: CapsuleStep['status'] }>,
    ): CapsuleState {
        const state = this.readState(sessionId)
        state.task = task
        state.steps = blueprint.map((item, index) => {
            const step: CapsuleStep = { id: index + 1, label: item.label, status: item.status }
            if (item.status === 'active') step.startedAt = this.now().toISOString()
            if (item.status === 'done') step.endedAt = this.now().toISOString()
            return step
        })
        if (task !== null && !state.startedAt) state.startedAt = this.now().toISOString()
        return this.writeState(state)
    }

    /** 触发源 #6:按 id 插入或更新定时任务条目 */
    upsertSchedule(sessionId: string, entry: CapsuleSchedule): void {
        const state = this.readState(sessionId)
        const index = state.schedules.findIndex((candidate) => candidate.id === entry.id)
        if (index >= 0) state.schedules[index] = entry
        else state.schedules.push(entry)
        this.writeState(state)
    }

    /** 触发源 #6:按 id 移除定时任务条目 */
    removeSchedule(sessionId: string, id: string): void {
        const state = this.readState(sessionId)
        state.schedules = state.schedules.filter((candidate) => candidate.id !== id)
        this.writeState(state)
    }

    /** 触发源 #5:记录后台任务(按 id 去重) */
    addJob(sessionId: string, job: CapsuleJob): void {
        const state = this.readState(sessionId)
        if (!state.jobs.some((candidate) => candidate.id === job.id)) state.jobs.push(job)
        this.writeState(state)
    }

    /** 触发源 #5:标记后台任务终止(job_kill 观测);保留条目做历史,可见性只数未终止的 */
    killJob(sessionId: string, jobId: string): void {
        const state = this.readState(sessionId)
        const job = state.jobs.find(
            (candidate) => candidate.id === jobId || candidate.command === jobId,
        )
        if (job !== undefined && job.killedAt === undefined) {
            job.killedAt = this.now().toISOString()
            this.writeState(state)
        }
    }

    /** 触发源 #7:记录子代理活动(按 agent_id 去重;重复 send_message 刷新活跃态) */
    touchSubagent(sessionId: string, agentId: string): void {
        const state = this.readState(sessionId)
        const existing = state.subagents.find((candidate) => candidate.id === agentId)
        if (existing !== undefined) {
            existing.interruptedAt = undefined
        } else {
            state.subagents.push({ id: agentId, startedAt: this.now().toISOString() })
        }
        this.writeState(state)
    }

    /** 触发源 #7:标记子代理中断(interrupt_agent 观测);可见性只数未中断的 */
    interruptSubagent(sessionId: string, agentId: string): void {
        const state = this.readState(sessionId)
        const entry = state.subagents.find((candidate) => candidate.id === agentId)
        if (entry !== undefined && entry.interruptedAt === undefined) {
            entry.interruptedAt = this.now().toISOString()
            this.writeState(state)
        }
    }

    /**
     * 触发源 #5 精确化:以 ctx.jobs 服务快照对账。
     * 快照中的 job → 按 id 插入/保持;快照外仍在"运行中"的条目 → 标记终止
     * (这就是后台进程自然退出——如服务崩溃——的检测通道)。
     * 参数形状防御解析:快照至少要有 string 类型的 id,command 可缺省。
     */
    reconcileJobs(sessionId: string, live: unknown): void {
        if (!Array.isArray(live)) return
        const snapshots = (live as unknown[]).filter(
            (item): item is Record<string, unknown> =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as Record<string, unknown>).id === 'string' &&
                ((item as Record<string, unknown>).id as string).length > 0,
        )
        const state = this.readState(sessionId)
        const nowIso = this.now().toISOString()
        for (const snapshot of snapshots) {
            const id = snapshot.id as string
            const existing = state.jobs.find((candidate) => candidate.id === id)
            if (existing === undefined) {
                const command =
                    typeof snapshot.command === 'string' && snapshot.command.length > 0
                        ? snapshot.command
                        : '(后台任务)'
                state.jobs.push({ id, command, startedAt: nowIso })
            }
        }
        const liveIds = new Set(snapshots.map((snapshot) => snapshot.id as string))
        for (const job of state.jobs) {
            // 合成的 bash 参数占位条目(不在服务清单里)被权威数据取代,同样视为结束
            if (job.killedAt === undefined && !liveIds.has(job.id)) job.killedAt = nowIso
        }
        this.writeState(state)
    }

    /** 自动:观测器写入(合并保存,不触碰 task/steps) */
    mergeObservation(sessionId: string, patch: ObservationPatch): void {
        const state = this.readState(sessionId)
        Object.assign(state, patch)
        this.writeState(state)
    }

    /** 读取(惰性创建默认状态);elapsedMs 由 startedAt 现算(重启安全),不落盘 */
    get(sessionId: string): CapsuleState & { elapsedMs: number | null } {        const state = this.readState(sessionId)
        const elapsedMs = state.startedAt
            ? Math.max(0, this.now().getTime() - Date.parse(state.startedAt))
            : null
        return { ...state, elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null }
    }

    /** 活跃指针:最近更新的 sessionId */
    activePointer(): CapsulePointer | null {
        try {
            const pointer = JSON.parse(readFileSync(this.pointerFile(), 'utf8')) as CapsulePointer
            if (typeof pointer?.sessionId !== 'string' || typeof pointer?.updatedAt !== 'string') {
                return null
            }
            return pointer
        } catch {
            return null
        }
    }

    /** 指针是否过期(超 staleMinutes) */
    isStale(pointer: CapsulePointer, staleMinutes: number): boolean {
        const age = this.now().getTime() - Date.parse(pointer.updatedAt)
        return !(Number.isFinite(age)) || age > staleMinutes * 60_000
    }
}
