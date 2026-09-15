import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

// 工具名:模型用它调用本工具(下划线风格,问卷生成时替换)
export const toolName = 'example_tool'

// TODO: 工具入参(与下方 parameters schema 对应,模型按 schema 填参)
export interface ToolArgs {
    input: string
}

// TODO: 工具结果(与下方 output schema 对应)
export interface ToolResult {
    result: string
}

/** 工具核心逻辑:TODO 替换成你的业务 */
export async function execute(
    args: ToolArgs,
    _exec: ToolRunContext, // 工具运行上下文(取消信号、进度上报等),不用可忽略
): Promise<ToolResult> {
    return { result: args.input } // TODO
}

/** 注册工具:一般不用改,改上面的 execute 和 schema 即可 */
export function registerTool(ctx: Context): void {
    ctx.tools.register(
        defineTool({
            name: toolName,
            description: 'TODO: 描述你的工具,模型靠它决定何时调用', // TODO

            // 参数 schema:字段结构 = type / required / description
            parameters: {
                input: { type: 'string', required: true, description: 'TODO: 参数说明' },
            },

            // 结果 schema:对象必须显式 additionalProperties,字段加 required: true
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        result: { type: 'string', required: true, description: 'TODO: 结果说明' },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => [{ type: 'text', text: value.result }],
            },

            execute,
        }))
}
