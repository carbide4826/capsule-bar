// 悬浮胶囊 HUD:list 槽位挂 conversation.input.dock(官方 GoalBar 同款挂点,常驻可见),
// 组件内部再渲染 fixed 悬浮层(SOP 03 §2;槽位词汇表内无"全局悬浮"位,卡点 B1 的折中实现,
// 待宿主核实后如有专属槽位再迁移)。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CapsuleHud } from './CapsuleHud.tsx'
import { demoCapsuleProps } from './demo-mock.ts'

/**
 * 注册悬浮胶囊 HUD。
 * @param ctx - client 根上下文
 */
export function registerCapsuleHud(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
            {
                name: 'conversation.input.dock',
                id: 'capsule-bar', // 同槽去重标识
                order: 100,
                // TODO(卡点 B2 定稿:混合 A+C):面数据接宿主会话事件流自算(A 通道:
                // tool 调用/结果/turn 边界)+ presentationMeta 持久化快照(C 通道);
                // 当前骨架回传静态演示态,字段契约见 CapsuleHudProps。
                inject: () => demoCapsuleProps(),
            },
            CapsuleHud,
        ))
}
