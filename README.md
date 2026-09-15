# capsule-bar

Example DSH plugin exposing a tool (scaffolded by dshp)

> 由 [dshp](https://github.com/carbide4826/dsh-plugin-cli) 生成 · 目标 DSH 0.1.5-rc.2

## 开发

```sh
pnpm install          # 安装依赖
pnpm build            # 构建
pnpm typecheck        # 类型检查
```

## 本地调试(直载源码,无需构建)

在**本项目根目录**执行(`--patch` 参数按当前目录解析):

```sh
dsh web --patch ./dev.patch.yml
```

> `dsh` 命令来自 harness 主包 `@deepseek-ai/dsh`。没装的话:全局 `npm i -g @deepseek-ai/dsh@0.1.5-rc.2`(主包的 `latest` 同样是过期占位,**别裸装**),或本项目内 `pnpm add -D @deepseek-ai/dsh@0.1.5-rc.2` 后改用 `pnpm dsh web --patch ./dev.patch.yml`。
> 装完后 pnpm 会拦截依赖的构建脚本(供应链保护):按官方 harness 的裁决,放行 `node-pty` / `koffi` / `@deepseek-ai/dsh-subprocess-local`(`pnpm approve-builds` 勾选,或手写 `pnpm.onlyBuiltDependencies`),`@google/genai` / `protobufjs` 的脚本是 no-op,不用批。

## 验证插件已加载

```sh
# 不启动,检查组合树里有本插件行:
pnpm dsh web --patch ./dev.patch.yml --dump-config | grep -A 4 capsule-bar
```

启动后打印 Web 地址(默认 http://127.0.0.1:3080)即代表 apply 已执行;功能级验证:工具在对话里让模型调用(需已配置模型),界面位打开 Web UI 对应位置查看。

> 对话需要模型可用:启动前 `export DEEPSEEK_API_KEY=...`(llm-deepseek 默认从该环境变量读 key,缺失时加载正常、仅对话请求报 MISSING_CREDENTIAL)。

## 安装到 profile

```sh
pnpm build                          # 先构建:安装的是 dist/ 的编译产物(.js),loader 按 exports 解析
dsh plugin --profile <name> add ./  # 在本项目父目录执行(相对路径锚定调用目录)
```

> 开发期用 `--patch` 直载 .ts 源码;`plugin add` 装的是构建产物,两条轨道互不影响。
> ⚠️ **UI 界面位的调试必须走 `build + plugin add` 轨道**:`--patch` 直载只加载 host 半边,浏览器侧的槽位注册不会发生(宿主按 npm 包身份聚合各包的 client 出口,file:// 直载没有包身份)。

## ⚠️ 防坑清单(每条都核对过官方源码或经实测,动手改代码前请过一眼)

1. **dist-tag 钉扎**:本项目已把 `@deepseek-ai/dsh-*` 精确钉在 0.1.5-rc.2——npm 上这些包的 `latest` 标签是过期占位(真实版本线在 `next`),手动 `npm i @deepseek-ai/dsh-*` 会把版本拉歪。所有 dsh 包保持同一条 rc 线:官方全家整体发布,混用不同 rc 会让 pnpm 装出两份模块副本。
2. **cordis 是 peer,不是依赖**:`@deepseek-ai/cordis` 固定在 peerDependencies,运行时由 dsh 宿主提供同一实例。类型用 `import type`;`Service` 这类基类必须值导入(`extends Service` 用,官方插件同款)——但别把它挪进 dependencies 自己装一份。
3. **注册即 effect**:框架的注册面(`ctx.tools.register()` / `ctx.on()` / `ctx.slots.inject()`)都在插件卸载时自动清理;自己的资源(timer、连接、子进程)要包 `ctx.effect(() => { ...; return cleanup })`。
4. **加载顺序只认 `inject`**:`inject: ['tools']` 表示等 tools 服务就绪后再加载本插件;文件顺序、注册先后都不影响加载。
5. **工具的三个类型硬约束**:`execute` 必须 async(返回 Promise);第二参数是 `ToolRunContext`(运行上下文);对象型 output schema 必须显式 `additionalProperties: false` 且字段标 `required: true`,否则 render 的 value 类型不完整。生成代码已按此写,改动时保持。
6. **patch 按 id 整行替换**:`cordis.patch.yml` / `dev.patch.yml` 中同 id 的行后写者赢,`config` 是整行替换、不合并——要改配置就写全量,没有增量补丁。
7. **配置即接口**:凡是两个部署可能想设不同值的参数,放进 `Config`(Schemastery)并同步 patch 行的 `config`;不要硬编码。
8. **client 表面是双文件分层**:`src/client/surfaces/` 下,kebab-case 文件是**注册层**(向槽位接线,不含 JSX),PascalCase 文件才是你的 React 组件——改 UI 通常只动组件层;槽名 / `id` / `order` / 注入数据在注册层调。这是脚手架的自创约定(官方/社区多为平铺),认准分层即可。
9. **相对导入一律写全 `.ts` 后缀**:dev 直载走 Node 原生类型剥离,导入后缀要与文件字面一致——注册层逻辑文件用 `.ts`,React 组件用 `.tsx`(生成代码已按此写,新建文件时保持)。
10. **祖先 `pnpm-workspace.yaml` 劫持 install**:上级任意目录存在该文件时,`pnpm install` 会被提升到那个 workspace 根执行,本项目的 `node_modules` 不会被创建(typecheck 报一堆 Cannot find module)。在本项目内用 `pnpm install --ignore-workspace` 独立安装即可。
11. **client 出口是注册式模块,不是 ESM**:宿主把各包 client.js 拼进同一聚合脚本执行(非 ESM 上下文),产物必须是 `window.__ModuleLoader__.load({id, factory})` 外壳——生成配置已用 CJS + banner/footer 实现,别改成纯 ESM;`react`/`react-dom`/`react/jsx-runtime` 必须 external(宿主经 factory 的 require 供应,打进 bundle 会双实例)。
12. **槽位注册选项按槽型分形**:keyed 槽 = `{key, priority?}`,list 槽 = `{id, order?, label?, priority?}`,single 槽 = `{priority?}`——没有统一形状,注册项一律没有 `inject` 字段(面数据走组件的 owner props)。`priority` 是 shadowing rank(升序,最低者渲染,same key+same priority 会 throw):要接管官方已注册的 single 槽(如会话头,官方在 0),用更低值。`conversation.chat.node` 的 key 在 rc.2 类型里是官方节点枚举,自定义节点 key 类型未开放(生成代码用 `as never` 断言,类型放开后移除)。

## 代码结构

```
src/index.ts        插件入口(name/inject/apply)
```
src/tool.ts          工具实现(defineTool + schema)
