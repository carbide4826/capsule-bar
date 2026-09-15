// 悬浮胶囊 HUD 组件(SOP 03 §2/§3):收起单行胶囊 + 展开步骤面板。
// 样式来自 capsule-hud.module.css(CSS Modules,构建期内联、运行时自动注入 <style>,
// 与 dsh-genui / dsh-web-ui 社区标准同款管线)。
// ⚠️ 待宿主验证(卡点 B1/B2):数据通道当前为 props 注入演示态,混合 A+C 定稿后替换 useCapsuleData。
import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import styles from './capsule-hud.module.css'
import { shouldShow } from '../../visibility.ts'

export interface CapsuleStepView {
    id: number
    label: string
    status: 'pending' | 'active' | 'done' | 'failed'
}

export interface CapsuleScheduleView {
    id: string
    prompt: string
    nextRun: string | null
}

export interface CapsuleJobView {
    id: string
    command: string
    /** 入队时间;收起态按此在 live 条目里取最新一条 */
    startedAt?: string
    killedAt?: string
}

export interface CapsuleSubagentView {
    id: string
    /** 入队时间;收起态按此在 live 条目里取最新一条 */
    startedAt?: string
    interruptedAt?: string
}

export interface CapsuleHudProps {
    sessionId?: string
    task?: string | null
    steps?: CapsuleStepView[]
    phase?: 'idle' | 'thinking' | 'tool'
    currentTool?: string | null
    startedAt?: string | null
    /** 状态最近更新时间(活跃指针);超过 staleMinutes 且空闲则整体淡出 */
    updatedAt?: string | null
    /** 指针过期阈值(分钟) */
    staleMinutes?: number
    /** 定时任务条目(触发源 #6) */
    schedules?: CapsuleScheduleView[]
    /** 后台任务条目(触发源 #5) */
    jobs?: CapsuleJobView[]
    /** 子代理条目(触发源 #7) */
    subagents?: CapsuleSubagentView[]
}

const STEP_ICON: Record<CapsuleStepView['status'], string> = {
    pending: '○',
    active: '▶',
    done: '✓',
    failed: '✗',
}

/** 对角线双箭头图标:inward=true 箭头相对(收起),false 箭尾相对(展开);currentColor 跟随文字色 */
function PairedArrows({ inward }: { inward: boolean }) {
    return (
        <svg className={styles.glyphSvg} viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none">
                {inward ? (
                    <>
                        {/* ↗ 向心:尾(3.2,10.8) 头(6.4,7.6) */}
                        <path d="M3.2 10.8 L6.4 7.6 M6.4 7.6 L6.4 10.4 M6.4 7.6 L3.6 7.6" />
                        {/* ↙ 向心:尾(10.8,3.2) 头(7.6,6.4) */}
                        <path d="M10.8 3.2 L7.6 6.4 M7.6 6.4 L7.6 3.6 M7.6 6.4 L10.4 6.4" />
                    </>
                ) : (
                    <>
                        {/* ↙ 离心:尾(6.4,7.6) 头(3.2,10.8) */}
                        <path d="M6.4 7.6 L3.2 10.8 M3.2 10.8 L3.2 8 M3.2 10.8 L6 10.8" />
                        {/* ↗ 离心:尾(7.6,6.4) 头(10.8,3.2) */}
                        <path d="M7.6 6.4 L10.8 3.2 M10.8 3.2 L10.8 6 M10.8 3.2 L8 3.2" />
                    </>
                )}
            </g>
        </svg>
    )
}

/** 用时:每秒重算(startedAt 现算,不累积) */
function useElapsed(startedAt: string | null): string | null {
    const [, tick] = useState(0)
    useEffect(() => {
        if (startedAt === null) return
        const timer = window.setInterval(() => tick((value) => value + 1), 1_000)
        return () => window.clearInterval(timer)
    }, [startedAt])
    if (startedAt === null) return null
    const start = Date.parse(startedAt)
    if (!Number.isFinite(start)) return null
    const totalSeconds = Math.max(0, Math.floor((Date.now() - start) / 1_000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/** 入队时间解析;缺失/非法按最早处理(保证条目仍参与"最新一条"竞争) */
function startedAtMs(value: string | undefined): number {
    if (value === undefined) return 0
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : 0
}

/**
 * 闹钟图标(定时任务):dsh 官方 IconAlarmClockOutline16 同源路径
 * (@deepseek-ai/dsh-client-ui-schedule 包同款;该图标库 dsh-client-ui-primitives
 * 未作为依赖安装,故复制路径实现,升级 dsh 版本时需比对一次)。
 */
function ClockIcon() {
    return (
        <svg className={styles.glyphSvg} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 2.5 1.75 4" />
                <path d="M12.5 2.5 14.25 4" />
                <circle cx="8" cy="8.5" r="4.75" />
                <path d="M8 5.75V8.5L10 9.75" />
                <path d="m4.75 12.25-1 1.5" />
                <path d="m11.25 12.25 1 1.5" />
            </g>
        </svg>
    )
}

/**
 * 对话列钳制定位:锚点留在宿主 dock 槽位内,从锚点向上找"最小的足够大的祖先区域"
 * 即对话列(宿主类名经 CSS Modules 哈希,无法按名匹配,只能几何启发,待宿主核实);
 * 悬浮层(Portal 到 body)的右上角钳制在该区域内部,保证永不越出对话区域。
 */
function useConversationClampedPos(anchorRef: RefObject<HTMLDivElement | null>): {
    top: number
    right: number
} | null {
    const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
    useEffect(() => {
        const anchor = anchorRef.current
        if (anchor === null) return
        let container: HTMLElement | null = anchor.parentElement
        let target: HTMLElement = document.body
        while (container !== null) {
            const rect = container.getBoundingClientRect()
            if (rect.width >= 400 && rect.height >= 300) {
                target = container // 自内向外第一个满足的 = 最贴身的对话列
                break
            }
            container = container.parentElement
        }
        let last = ''
        const update = (): void => {
            const rect = target.getBoundingClientRect()
            const key = `${Math.round(rect.top)},${Math.round(rect.right)}`
            if (key !== last) {
                last = key
                setPos({
                    top: rect.top + 16,
                    right: Math.max(16, window.innerWidth - rect.right + 16),
                })
            }
        }
        update()
        const timer = window.setInterval(update, 250)
        window.addEventListener('resize', update)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener('resize', update)
        }
    }, [anchorRef])
    return pos
}

export const CapsuleHud = memo(function CapsuleHud(props: CapsuleHudProps) {
    const task = props.task ?? null
    const steps = props.steps ?? []
    const phase = props.phase ?? 'idle'
    const staleMinutes = props.staleMinutes ?? 30
    const schedules = props.schedules ?? []
    const jobs = props.jobs ?? []
    const subagents = props.subagents ?? []
    const elapsed = useElapsed(props.startedAt ?? null)

    const [expanded, setExpanded] = useState(false)
    const [flashing, setFlashing] = useState(false)
    const flashTimer = useRef<number | null>(null)
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const clampedPos = useConversationClampedPos(anchorRef)

    // done-flash:任务存在且全部步骤 done → 绿闪 3s,结束后由可见性策略隐藏(H1)
    const allDone = task !== null && steps.length > 0 && steps.every((step) => step.status === 'done')
    useEffect(() => {
        if (!allDone) return
        setFlashing(true)
        flashTimer.current = window.setTimeout(() => setFlashing(false), 3_000)
        return () => {
            if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
        }
    }, [allDone])

    // 指针过期(H2):updatedAt 超过 staleMinutes
    const updatedAt = props.updatedAt ?? null
    const stale =
        updatedAt !== null &&
        Number.isFinite(Date.parse(updatedAt)) &&
        Date.now() - Date.parse(updatedAt) > staleMinutes * 60_000

    // 可见性统一走策略函数(src/visibility.ts,后续调整只改那一处)
    const visible = shouldShow({
        task,
        steps,
        schedules,
        jobs,
        subagents,
        flashOver: allDone && !flashing,
        stale,
    })

    // 呼吸态(触发源 #6):任一定时任务距下次执行 ≤ 2 分钟
    const nowMs = Date.now()
    const dueSchedules = schedules.filter((entry) => {
        if (entry.nextRun === null) return false
        const runAt = Date.parse(entry.nextRun)
        return Number.isFinite(runAt) && runAt - nowMs <= 120_000 && runAt > nowMs - 30_000
    })
    const breathing = dueSchedules.length > 0
    const liveJobs = jobs.filter((job) => job.killedAt === undefined)
    const liveSubagents = subagents.filter((subagent) => subagent.interruptedAt === undefined)

    // 收起态动态区:live 条目(后台任务 + 子代理)按入队时间排序,只展示最新的一条
    type RunningEntry = { startedAt: number; text: string; title: string }
    const running: RunningEntry[] = [
        ...liveJobs.map(
            (job): RunningEntry => ({
                startedAt: startedAtMs(job.startedAt),
                text: `后台 ${job.command.length > 24 ? `${job.command.slice(0, 24)}…` : job.command}`,
                title: job.command,
            }),
        ),
        ...liveSubagents.map(
            (subagent): RunningEntry => ({
                startedAt: startedAtMs(subagent.startedAt),
                text: `子代理 ${subagent.id}`,
                title: subagent.id,
            }),
        ),
    ].sort((a, b) => a.startedAt - b.startedAt)
    const latestRunning = running[running.length - 1]

    const doneCount = steps.filter((step) => step.status === 'done').length
    const dotClass = breathing
        ? styles.dotBreathing
        : phase === 'thinking'
          ? styles.dotThinking
          : phase === 'tool'
            ? styles.dotTool
            : undefined

    // Portal 挂到 body:宿主 dock 槽位容器可能创建层叠上下文(transform/z-index 等),
    // 困住 fixed 层导致 z-index 失效、被右侧面板等宿主浮层遮盖;挂到 body 后与全局浮层同场竞争。
    // 锚点零尺寸留在槽位里,供对话列边界推导;悬浮层坐标钳制在对话列内(不越出对话区域)。
    if (typeof document === 'undefined') return null

    return (
        <>
            <div ref={anchorRef} style={{ height: 0 }} aria-hidden="true" />
            {createPortal(
                <div
                    className={styles.layer}
                    style={clampedPos === null ? undefined : { top: clampedPos.top, right: clampedPos.right }}
                >
            {expanded ? (
                /* 展开态:面板替换胶囊,右上角收起按钮回简略框 */
                <div className={styles.panel}>
                    <div className={styles.panelHeader}>
                        <div className={styles.headerInfo}>
                            <div>{task ?? '未设置任务'}</div>
                            {steps.length > 0 && (
                                <div className={styles.progress}>
                                    <i
                                        className={styles.progressInner}
                                        style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
                                    />
                                </div>
                            )}
                            {elapsed !== null && <div className={styles.dim}>用时 {elapsed}</div>}
                        </div>
                        <button
                            className={styles.collapseBtn}
                            type="button"
                            title="收起"
                            aria-label="收起为简略胶囊"
                            onClick={() => setExpanded(false)}
                        >
                            <PairedArrows inward />
                        </button>
                    </div>
                    <div className={styles.sections}>
                        <div className={styles.section}>
                            {steps.length === 0 && (
                                <div className={[styles.step, styles.dim].join(' ')}>
                                    暂无步骤(模型调用 capsule_task/capsule_step 标注)
                                </div>
                            )}
                            {steps.map((step) => (
                                <div
                                    key={step.id}
                                    className={[
                                        styles.step,
                                        step.status === 'active' ? styles.stepActive : undefined,
                                        step.status === 'done' ? styles.stepDone : undefined,
                                        step.status === 'failed' ? styles.stepFailed : undefined,
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <span>{STEP_ICON[step.status]}</span>
                                    <span>{step.label}</span>
                                </div>
                            ))}
                        </div>
                        {schedules.length > 0 && (
                            <div className={styles.section}>
                                <div className={styles.sectionTitle}>定时任务</div>
                                {schedules.map((entry) => (
                                    <div key={entry.id} className={styles.step} title={entry.nextRun ?? ''}>
                                        <span className={styles.dim}><ClockIcon /></span>
                                        <span>
                                            {entry.prompt}
                                            {entry.nextRun !== null && (
                                                <span className={styles.dim}>
                                                    {' '}
                                                    · {new Date(entry.nextRun).toLocaleTimeString()}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {liveJobs.length > 0 && (
                            <div className={styles.section}>
                                <div className={styles.sectionTitle}>后台任务</div>
                                {liveJobs.map((job) => (
                                    <div key={job.id} className={styles.step} title={job.command}>
                                        <span className={styles.dim}>●</span>
                                        <span>后台 {job.command}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {liveSubagents.length > 0 && (
                            <div className={styles.section}>
                                <div className={styles.sectionTitle}>子代理</div>
                                {liveSubagents.map((subagent) => (
                                    <div key={subagent.id} className={styles.step}>
                                        <span className={styles.dim}>◈</span>
                                        <span>子代理 {subagent.id}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className={styles.panelFooter}>
                        <span className={styles.dim}>{(props.sessionId ?? '').slice(0, 12) || '—'}</span>
                        <button
                            className={styles.clearBtn}
                            type="button"
                            title="清除任务(清理类交互通道待接入,骨架占位)"
                        >
                            清除
                        </button>
                    </div>
                </div>
            ) : (
                /* 收起态:单行简略胶囊,点击展开为面板 */
                <div
                    className={[styles.pill, visible ? undefined : styles.pillHidden, flashing ? styles.pillFlash : undefined, breathing ? styles.pillBreathing : undefined]
                        .filter(Boolean)
                        .join(' ')}
                    role="button"
                    onClick={() => setExpanded(true)}
                >
                    <span className={[styles.dot, dotClass].filter(Boolean).join(' ')} />
                    {task !== null && (
                        <span className={styles.task} title={task}>
                            {task}
                        </span>
                    )}
                    {steps.length > 0 && (
                        <span>
                            {doneCount}/{steps.length}
                        </span>
                    )}
                    {latestRunning !== undefined && (
                        <span className={styles.task} title={latestRunning.title}>
                            {latestRunning.text}
                        </span>
                    )}
                    <span className={styles.dim} title="展开">
                        <PairedArrows inward={false} />
                    </span>
                </div>
            )}
                </div>,
                document.body,
            )}
        </>
    )
})
