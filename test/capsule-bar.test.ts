// capsule-bar 单测:SOP 04 文档 16 用例。
// 模式:fake ctx(tools.register / on / events.on / logger 收集器)+ 时钟注入 + 事件直调。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, Config } from '../src/index.ts'
import { CapsuleStore, type CapsuleStep } from '../src/state.ts'
import { attachWatcher, resolveSessionId } from '../src/watcher.ts'

// ---------------------------------------------------------------------------
// 测试基建
// ---------------------------------------------------------------------------

/** 固定时钟:从 T0 起,可手动推进 */
class FakeClock {
    private current: number
    constructor(iso: string) {
        this.current = Date.parse(iso)
    }
    now = (): Date => new Date(this.current)
    advanceMs(ms: number): void {
        this.current += ms
    }
}

const T0 = '2026-09-15T00:00:00.000Z'

interface ListenerEntry {
    name: string
    listener: (...args: never[]) => unknown
}

/** fake ctx:仓库全插件标准模式 */
function createFakeCtx() {
    const registered: Array<{ name: string }> = []
    const domainEvents: ListenerEntry[] = [] // ctx.on(tools 域)
    const turnEvents: ListenerEntry[] = [] // ctx.events.on(turn 边界)
    const warnings: unknown[][] = []
    const ctx = {
        tools: { register: (tool: { name: string }) => void registered.push(tool) },
        on: (name: string, listener: (...args: never[]) => unknown) => {
            domainEvents.push({ name, listener })
            return ctx
        },
        events: {
            on: (name: string, listener: (...args: never[]) => unknown) => {
                turnEvents.push({ name, listener })
                return ctx
            },
        },
        logger: {
            warn: (...args: unknown[]) => void warnings.push(args),
        },
    }
    return { ctx, registered, domainEvents, turnEvents, warnings }
}

function listenerOf(list: ListenerEntry[], name: string): (...args: never[]) => unknown {
    const entry = list.find((candidate) => candidate.name === name)
    if (!entry) throw new Error(`listener 未注册: ${name}`)
    return entry.listener
}

/** exec 桩:pre-execute/观测链依赖 name 与 agent 链(SOP 04:传 { name, token }) */
function execStub(sessionId = 's1', name = 'bash'): { name: string; agent: { sessionId: string } } {
    return { name, agent: { sessionId } }
}

function makeStore(clock: FakeClock, maxSteps = 20): CapsuleStore {
    const dir = mkdtempSync(join(tmpdir(), 'capsule-bar-test-'))
    return new CapsuleStore(dir, clock.now, maxSteps)
}

let cleanup: string[] = []

beforeEach(() => {
    cleanup = []
})

afterEach(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
})

function tempStore(clock: FakeClock, maxSteps = 20): CapsuleStore {
    const store = makeStore(clock, maxSteps)
    cleanup.push(store.storePath)
    return store
}

// ---------------------------------------------------------------------------
// 用例 4-8:自动观测器
// ---------------------------------------------------------------------------

describe('自动观测器', () => {
    it('用例4: pre-execute → phase=tool / currentTool / 计数+1 / 指针刷新', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        const { ctx, domainEvents } = createFakeCtx()
        attachWatcher(ctx, store, clock.now)

        const pre = listenerOf(domainEvents, 'tools/pre-execute')
        return (pre(execStub(), async () => 'allow') as Promise<unknown>).then((allowed) => {
            expect(allowed).toBe('allow')
            const state = store.get('s1')
            expect(state.phase).toBe('tool')
            expect(state.currentTool).toBe('bash')
            expect(state.toolCallsThisTurn).toBe(1)
            const pointer = store.activePointer()
            expect(pointer?.sessionId).toBe('s1')
            expect(existsSync(join(store.storePath, 'current.json'))).toBe(true)
        })
    })

    it('用例5: result → done+1 / currentTool 清空 / phase 回 thinking', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        const { ctx, domainEvents } = createFakeCtx()
        attachWatcher(ctx, store, clock.now)

        const pre = listenerOf(domainEvents, 'tools/pre-execute')
        const result = listenerOf(domainEvents, 'tools/result')
        return (pre(execStub(), async () => 'allow') as Promise<unknown>)
            .then(() => (result(execStub(), { content: [], isError: false }) as unknown) as void)
            .then(() => {
                const state = store.get('s1')
                expect(state.toolCallsDone).toBe(1)
                expect(state.currentTool).toBeNull()
                expect(state.phase).toBe('thinking')
            })
    })

    it('用例6: turn/start → 计数归零 / phase=thinking / startedAt 为空时补记', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        const { ctx, turnEvents } = createFakeCtx()
        attachWatcher(ctx, store, clock.now)

        const turnStart = listenerOf(turnEvents, 'turn/start')
        turnStart({ sessionId: 's1' })
        const state = store.get('s1')
        expect(state.toolCallsThisTurn).toBe(0)
        expect(state.toolCallsDone).toBe(0)
        expect(state.phase).toBe('thinking')
        expect(state.startedAt).toBe(T0)

        // 已有 startedAt 时不覆盖
        clock.advanceMs(5_000)
        turnStart({ sessionId: 's1' })
        expect(store.get('s1').startedAt).toBe(T0)
    })

    it('用例7: turn/end → phase=idle / currentTool=null', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        const { ctx, domainEvents, turnEvents } = createFakeCtx()
        attachWatcher(ctx, store, clock.now)

        const pre = listenerOf(domainEvents, 'tools/pre-execute')
        const turnEnd = listenerOf(turnEvents, 'turn/end')
        return (pre(execStub(), async () => 'allow') as Promise<unknown>).then(() => {
            turnEnd({ sessionId: 's1' })
            const state = store.get('s1')
            expect(state.phase).toBe('idle')
            expect(state.currentTool).toBeNull()
        })
    })

    it('用例8: 观测器异常吞掉(warn 记录、next 照常返回)', async () => {
        const clock = new FakeClock(T0)
        const broken = {
            get: () => {
                throw new Error('boom')
            },
        } as unknown as CapsuleStore
        const { ctx, domainEvents, turnEvents, warnings } = createFakeCtx()
        attachWatcher(ctx, broken, clock.now)

        const pre = listenerOf(domainEvents, 'tools/pre-execute') as (
            exec: unknown,
            next: () => Promise<string>,
        ) => Promise<string>
        await expect(pre(execStub(), async () => 'allow')).resolves.toBe('allow')
        listenerOf(domainEvents, 'tools/result')(execStub(), { content: [] })
        listenerOf(turnEvents, 'turn/start')({})
        listenerOf(turnEvents, 'turn/end')({})
        expect(warnings.length).toBeGreaterThanOrEqual(4)
    })
})

// ---------------------------------------------------------------------------
// 用例 9-13:双通道、计时、指针、多会话、损坏回退
// ---------------------------------------------------------------------------

describe('状态机与存储', () => {
    it('用例9: 双通道互不覆盖(观测只改 phase/tool/计数;任务写入只改 task/steps)', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        const { ctx, domainEvents, turnEvents } = createFakeCtx()
        attachWatcher(ctx, store, clock.now)

        store.applyTaskBlueprint('s1', '任务A', [{ label: '步骤1', status: 'active' }])

        const pre = listenerOf(domainEvents, 'tools/pre-execute')
        const result = listenerOf(domainEvents, 'tools/result')
        const turnEnd = listenerOf(turnEvents, 'turn/end')
        return (pre(execStub(), async () => 'allow') as Promise<unknown>)
            .then(() => (result(execStub(), { content: [] }) as unknown) as void)
            .then(() => turnEnd({ sessionId: 's1' }))
            .then(() => {
                const state = store.get('s1')
                expect(state.task).toBe('任务A')
                expect(state.steps).toHaveLength(1)
                expect(state.steps[0]?.label).toBe('步骤1')
            })
            .then(() => {
                // 反向:任务写入不动观测字段
                store.mergeObservation('s1', { phase: 'tool', toolCallsThisTurn: 7 })
                store.setTask('s1', '任务B')
                const state = store.get('s1')
                expect(state.toolCallsThisTurn).toBe(7)
                expect(state.phase).toBe('tool')
                expect(state.task).toBe('任务B')
                expect(state.steps).toEqual([]) // 设置任务重置步骤
            })
    })

    it('用例10: elapsedMs 现算(换新实例模拟重启,随时钟增长)', () => {
        const clock = new FakeClock(T0)
        const dir = mkdtempSync(join(tmpdir(), 'capsule-bar-test-'))
        cleanup.push(dir)
        const writer = new CapsuleStore(dir, clock.now)
        writer.setTask('s1', '任务')
        writer.mergeObservation('s1', { startedAt: T0 })

        clock.advanceMs(5_000)
        const reader = new CapsuleStore(dir, clock.now)
        expect(reader.get('s1').elapsedMs).toBe(5_000)
        clock.advanceMs(2_000)
        expect(reader.get('s1').elapsedMs).toBe(7_000)
    })

    it('用例11: 活跃指针与过期(updatedAt 刷新;超 staleMinutes 判 stale)', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        store.setTask('s1', '任务')
        const pointer = store.activePointer()
        expect(pointer?.updatedAt).toBe(T0)
        expect(store.isStale(pointer!, 30)).toBe(false)

        clock.advanceMs(31 * 60_000)
        store.setTask('s1', '任务二') // 写入刷新 updatedAt
        const fresh = store.activePointer()
        expect(fresh?.updatedAt).toBe(clock.now().toISOString())
        expect(store.isStale(fresh!, 30)).toBe(false)

        clock.advanceMs(30 * 60_000 + 1)
        expect(store.isStale(fresh!, 30)).toBe(true)
    })

    it('用例12: 多会话隔离(状态互不污染;指针指向最近更新者)', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        store.setTask('s1', '会话一任务')
        store.setTask('s2', '会话二任务')
        expect(store.get('s1').task).toBe('会话一任务')
        expect(store.get('s2').task).toBe('会话二任务')
        expect(store.activePointer()?.sessionId).toBe('s2')
    })

    it('用例13: 损坏文件回退(默认状态 + .bak 生成)', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        const sessionFile = join(store.storePath, 'sessions', 's1.json')
        writeFileSync(sessionFile, '{ not valid json !!', 'utf8')

        const state = store.get('s1')
        expect(state.task).toBeNull()
        expect(state.version).toBe(1)
        expect(existsSync(`${sessionFile}.bak`)).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// 用例 14-16:插件装配与端到端
// ---------------------------------------------------------------------------

describe('插件装配', () => {
    it('用例14: storePath 相对路径 → apply 抛明确错误', () => {
        const { ctx } = createFakeCtx()
        expect(() => apply(ctx, { storePath: 'relative/path', maxSteps: 20, staleMinutes: 30 })).toThrow(
            /绝对路径/,
        )
    })

    it('用例15: 插件装配(不注册显式工具;观测器 4 个监听已挂载)', () => {
        const clock = new FakeClock(T0)
        const store = tempStore(clock)
        const { ctx, registered, domainEvents, turnEvents } = createFakeCtx()
        apply(ctx, { storePath: store.storePath, maxSteps: 20, staleMinutes: 30 })
        // 方向修正后不向模型暴露任何工具:胶囊完全由旁路观测驱动
        expect(registered).toEqual([])
        // 观测器已挂载:tools 域 2 个 + turn 边界 2 个
        expect(domainEvents.map((entry) => entry.name).sort()).toEqual(['tools/pre-execute', 'tools/result'])
        expect(turnEvents.map((entry) => entry.name).sort()).toEqual(['turn/end', 'turn/start'])
    })
})

// ---------------------------------------------------------------------------
// 补充:resolveSessionId 防御链 + Config schema 默认值
// ---------------------------------------------------------------------------

describe('防御解析与配置', () => {
    it('resolveSessionId:sessionId / session.id / id / default 降级链', () => {
        expect(resolveSessionId({ agent: { sessionId: 'a' } })).toBe('a')
        expect(resolveSessionId({ agent: { session: { id: 'b' } } })).toBe('b')
        expect(resolveSessionId({ agent: { id: 'c' } })).toBe('c')
        expect(resolveSessionId({ agent: {} })).toBe('default')
        expect(resolveSessionId({})).toBe('default')
        expect(resolveSessionId(undefined)).toBe('default')
    })

    it('Config schema:缺省时补默认值(maxSteps=20, staleMinutes=30)', () => {
        const resolved = Config({ storePath: '/tmp/capsule' }) as { storePath: string; maxSteps: number; staleMinutes: number }
        expect(resolved.storePath).toBe('/tmp/capsule')
        expect(resolved.maxSteps).toBe(20)
        expect(resolved.staleMinutes).toBe(30)
    })
})
