// 真机演示 mock 数据(卡点 B2 定稿前的占位通道)。
// capsule-hud.ts 的 inject 从这里取数;A+C 真数据通道接入后删除本文件。
// 工厂函数形态:每次 inject 调用都以"当前时刻"为基准,页面刷新即重置呼吸计时。
import type { CapsuleHudProps } from './CapsuleHud.tsx'

export function demoCapsuleProps(): CapsuleHudProps {
    return {
        sessionId: 'demo-mock',
        task: '构建 CapsuleBar 插件',
        phase: 'tool',
        currentTool: 'Bash',
        startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
            { id: 1, label: '实现 v2 状态机', status: 'done' },
            { id: 2, label: '触发源识别器(7 类)', status: 'done' },
            { id: 3, label: '悬浮 HUD 客户端', status: 'active' },
            { id: 4, label: 'A+C 真数据通道', status: 'pending' },
            { id: 5, label: 'A1-A9 验收回填', status: 'pending' },
            { id: 6, label: '端口探测(已放弃)', status: 'failed' },
        ],
        schedules: [
            {
                id: 'sched-1',
                prompt: '提醒喝水',
                nextRun: new Date(Date.now() + 45_000).toISOString(),
            },
            {
                id: 'sched-2',
                prompt: '每日站会',
                nextRun: new Date(Date.now() + 15 * 60_000).toISOString(),
            },
            { id: 'sched-3', prompt: '每周回顾(间隔型,算不出下次)', nextRun: null },
        ],
        jobs: [
            {
                id: 'job-1',
                command: 'pnpm dev',
                startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            },
            {
                id: 'job-2',
                command: 'vitest run --watch',
                startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
            },
            {
                id: 'job-3',
                command: 'tsc --noEmit --watch',
                startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
                killedAt: new Date(Date.now() - 60_000).toISOString(),
            },
        ],
        subagents: [
            {
                id: 'agent-explorer-1',
                startedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
            },
            {
                // 最新入队的 live 条目:收起态应只显示这一条("子代理 agent-explorer-2")
                id: 'agent-explorer-2',
                startedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
            },
            {
                id: 'agent-finisher-1',
                startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
                interruptedAt: new Date(Date.now() - 120_000).toISOString(),
            },
        ],
    }
}
