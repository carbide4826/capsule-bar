// v2 状态机测试:触发源识别(recognizer)+ 可见性策略(visibility)。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mapToolCall, mapToolResult } from '../src/recognizer.ts'
import { CapsuleStore } from '../src/state.ts'
import { shouldShow } from '../src/visibility.ts'

const T0 = '2026-09-15T00:00:00.000Z'
const clock = (): Date => new Date(Date.parse(T0))
const S = 's1'

let dir = ''
let store: CapsuleStore

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capsule-trigger-'))
    store = new CapsuleStore(dir, clock)
})

afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
})

describe('触发源识别(mapToolCall / mapToolResult)', () => {
    it('#2 todo_write:待办清单映射为 task/steps(status 落位)', () => {
        mapToolCall(store, S, 'todo_write', {
            todos: [
                { content: '备份', status: 'completed' },
                { content: '迁移', status: 'in_progress' },
                { content: '校验', status: 'pending' },
            ],
        }, clock)
        const state = store.get(S)
        expect(state.task).toBe('待办清单')
        expect(state.steps.map((step) => step.status)).toEqual(['done', 'active', 'pending'])
        expect(state.steps.map((step) => step.label)).toEqual(['备份', '迁移', '校验'])
    })

    it('#3 create_goal / update_goal:目标标题即任务名', () => {
        mapToolCall(store, S, 'create_goal', { goal: '完成数据迁移' }, clock)
        expect(store.get(S).task).toBe('完成数据迁移')
        mapToolCall(store, S, 'update_goal', { text: '迁移完成并验证' }, clock)
        expect(store.get(S).task).toBe('迁移完成并验证')
    })

    it('#4 plan 批准(tools/result 成功):# 标题为任务名,列表行为步骤', () => {
        mapToolResult(
            store,
            S,
            'plan',
            { plan: '# 数据迁移计划\n\n- 备份\n1. 迁移\n* 校验\n' },
            false,
        )
        const state = store.get(S)
        expect(state.task).toBe('数据迁移计划')
        expect(state.steps.map((step) => step.label)).toEqual(['备份', '迁移', '校验'])
        expect(state.steps.every((step) => step.status === 'pending')).toBe(true)
        // 失败(被打回)不写入
        mapToolResult(store, S, 'plan', { plan: '# 另一计划\n- x\n' }, true)
        expect(store.get(S).task).toBe('数据迁移计划')
    })

    it('#5 bash 后台启动 → jobs 条目;job_kill → 标记终止', () => {
        mapToolCall(store, S, 'bash', { command: 'pnpm dev', background: true }, clock)
        expect(store.get(S).jobs).toHaveLength(1)
        expect(store.get(S).jobs[0]?.command).toBe('pnpm dev')
        // 前台 bash 不触发
        mapToolCall(store, S, 'bash', { command: 'ls' }, clock)
        expect(store.get(S).jobs).toHaveLength(1)
        // kill(按 job_id)
        const jobId = store.get(S).jobs[0]!.id
        mapToolCall(store, S, 'job_kill', { job_id: jobId }, clock)
        expect(store.get(S).jobs[0]?.killedAt).toBeDefined()
    })

    it('#6 schedule_create → 条目与下次执行时间;schedule_delete → 移除', () => {
        mapToolCall(
            store,
            S,
            'schedule_create',
            { prompt: ' hourly 巡检', at: '2026-09-15T01:00:00.000Z' },
            clock,
        )
        let schedules = store.get(S).schedules
        expect(schedules).toHaveLength(1)
        expect(schedules[0]?.prompt).toContain('巡检')
        expect(schedules[0]?.nextRun).toBe('2026-09-15T01:00:00.000Z')
        // everySeconds:创建时刻 + 间隔
        mapToolCall(store, S, 'schedule_create', { prompt: '轮询', everySeconds: 60 }, clock)
        schedules = store.get(S).schedules
        expect(schedules).toHaveLength(2)
        expect(schedules[1]?.nextRun).toBe('2026-09-15T00:01:00.000Z')
        // 删除
        mapToolCall(store, S, 'schedule_delete', { id: schedules[0]?.id }, clock)
        expect(store.get(S).schedules).toHaveLength(1)
    })

    it('#7 send_message → 子代理活跃;interrupt_agent → 标记中断', () => {
        mapToolCall(store, S, 'send_message', { agent_id: 'agent-9', message: '开始巡检' }, clock)
        expect(store.get(S).subagents).toHaveLength(1)
        // 重复发消息不新增条目,且刷新为活跃
        mapToolCall(store, S, 'send_message', { agent_id: 'agent-9', message: '继续' }, clock)
        expect(store.get(S).subagents).toHaveLength(1)
        mapToolCall(store, S, 'interrupt_agent', { agent_id: 'agent-9' }, clock)
        expect(store.get(S).subagents[0]?.interruptedAt).toBeDefined()
        // 中断后再发消息 → 重新活跃
        mapToolCall(store, S, 'send_message', { agent_id: 'agent-9', message: '再来' }, clock)
        expect(store.get(S).subagents[0]?.interruptedAt).toBeUndefined()
    })

    it('#5 精确化:jobs 服务快照对账(新增/自然退出/合成占位被取代)', () => {
        // 参数占位条目先行
        mapToolCall(store, S, 'bash', { command: 'pnpm dev', background: true }, clock)
        expect(store.get(S).jobs[0]?.id).toContain('bash:')
        // 服务快照里有真实 job → 新增;占位条目不在清单 → 标记结束
        store.reconcileJobs(S, [
            { id: 'job-1', command: 'pnpm dev' },
            { id: 'job-2' }, // command 缺省 → 兜底文案
        ])
        let jobs = store.get(S).jobs
        expect(jobs).toHaveLength(3)
        expect(jobs.find((job) => job.id === 'job-1')?.command).toBe('pnpm dev')
        expect(jobs.find((job) => job.id === 'job-2')?.command).toBe('(后台任务)')
        expect(jobs.find((job) => job.id)?.killedAt).toBeDefined()
        // 再次对账幂等;job-1 从清单消失 → 自然退出检测
        store.reconcileJobs(S, [{ id: 'job-2' }])
        jobs = store.get(S).jobs
        expect(jobs.find((job) => job.id === 'job-1')?.killedAt).toBeDefined()
        expect(jobs.find((job) => job.id === 'job-2')?.killedAt).toBeUndefined()
        // 非法快照形状直接忽略
        store.reconcileJobs(S, 'not-an-array')
        store.reconcileJobs(S, [{ nope: true }, null])
        expect(store.get(S).jobs).toHaveLength(3)
    })

    it('capsule_* 与未识别工具不触发(防双写)', () => {
        mapToolCall(store, S, 'capsule_task', { task: 'x' }, clock)
        mapToolCall(store, S, 'bash', { command: 'ls' }, clock)
        mapToolCall(store, S, 'read', { path: '/a' }, clock)
        expect(store.get(S).task).toBeNull()
        expect(store.get(S).jobs).toHaveLength(0)
    })
})

describe('可见性策略(shouldShow,v2)', () => {
    const base = {
        task: null,
        steps: [],
        schedules: [],
        jobs: [],
        subagents: [],
        flashOver: false,
        stale: false,
    }

    it('无任何触发源 → 不展示(纯闲聊)', () => {
        expect(shouldShow(base)).toBe(false)
    })

    it('触发源 #1-#4:任务或步骤存在 → 展示', () => {
        expect(shouldShow({ ...base, task: '迁移' })).toBe(true)
        expect(shouldShow({ ...base, steps: [{ status: 'pending' }] })).toBe(true)
    })

    it('触发源 #5:仅未终止后台任务 → 展示;全部终止 → 不展示', () => {
        expect(shouldShow({ ...base, jobs: [{ command: 'pnpm dev' }] })).toBe(true)
        expect(shouldShow({ ...base, jobs: [{ command: 'pnpm dev', killedAt: T0 }] })).toBe(false)
    })

    it('触发源 #6:仅定时任务 → 展示', () => {
        expect(shouldShow({ ...base, schedules: [{ nextRun: null }] })).toBe(true)
    })

    it('触发源 #7:仅活跃子代理 → 展示;全部中断 → 不展示', () => {
        expect(shouldShow({ ...base, subagents: [{ id: 'agent-1' }] })).toBe(true)
        expect(
            shouldShow({ ...base, subagents: [{ id: 'agent-1', interruptedAt: T0 }] }),
        ).toBe(false)
    })

    it('消失条件:H1 闪毕 / H2 过期 → 任一命中即隐藏(即使有任务)', () => {
        expect(shouldShow({ ...base, task: '迁移', flashOver: true })).toBe(false)
        expect(shouldShow({ ...base, task: '迁移', stale: true })).toBe(false)
    })
})
