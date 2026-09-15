// client 侧聚合入口:每界面位一行调用,实现见 ./surfaces/(注册层 .ts + 组件层 .tsx)。
// renderer/client 是 ctx.slots 的类型来源(官方同款集中引入,一次即可)。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context } from '@deepseek-ai/cordis'
import { registerCapsuleHud } from './surfaces/capsule-hud.ts'

// client 侧服务:槽位注册必需(slots)
export const inject = ['slots']

/**
 * 注册全部已选界面位。
 * @param ctx - client 根上下文
 */
export function apply(ctx: Context): void {
    registerCapsuleHud(ctx) // 界面位:输入区 dock(内部渲染 fixed 悬浮胶囊)
}
