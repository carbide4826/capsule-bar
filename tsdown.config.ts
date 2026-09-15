import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { defineConfig, type UserConfig } from 'tsdown'

// host 出口:ESM(loader 按 exports 解析 dist/index.js)
// client 出口:注册式 CJS,产物必须套 window.__ModuleLoader__ 外壳(聚合加载器在
// 非 ESM 上下文执行 client.js);react 系 external 防双实例。
// CSS Modules 构建期内联进 bundle 并在运行时自动注入 <style>(社区标准管线,
// 移植自 dsh-genui 的 cssModulesPlugin),产物无独立 css 文件。
const PKG_NAME = 'capsule-bar'
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** CSS Modules 内联插件:x.module.css → 哈希类名映射 + 自动注入的 <style> 虚拟模块 */
function cssModulesPlugin(): NonNullable<UserConfig['plugins']>[number] {
    return {
        name: 'dsh-css-modules-inline',
        resolveId(source: string, importer: string | undefined) {
            if (!source.endsWith('.module.css')) return null
            const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
            const stableId = relative(PROJECT_ROOT, abs).replaceAll('\\', '/')
            return CSS_VIRTUAL_PREFIX + stableId + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
            if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
            const stableId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
            const fileId = resolvePath(PROJECT_ROOT, stableId)
            this.addWatchFile(fileId)
            const source = await readFile(fileId)
            const { code, exports: cssExports } = transform({
                filename: stableId,
                code: source,
                cssModules: { pattern: '[hash]_[local]' },
                minify: true,
            })
            // 类名映射按 UTF-16 定序输出,保证产物字节确定(不用 localeCompare,防系统 locale 漂移)
            const entries = Object.entries(cssExports ?? {})
                .map(([local, exp]) => [local, exp.name] as const)
                .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            const classMap = Object.fromEntries(entries)
            const tagId = `${PKG_NAME}/${basename(fileId)}`
            return [
                `const css = ${JSON.stringify(code.toString())};`,
                `const tagId = ${JSON.stringify(tagId)};`,
                `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
                `  const tag = document.createElement('style');`,
                `  tag.dataset.plugin = ${JSON.stringify(PKG_NAME)};`,
                '  tag.dataset.pluginCss = tagId;',
                '  tag.textContent = css;',
                '  document.head.appendChild(tag);',
                '}',
                `export default ${JSON.stringify(classMap)};`,
            ].join('\n')
        },
    }
}

export default defineConfig([
    {
        entry: { index: 'src/index.ts' },
        outDir: 'dist',
        format: 'esm',
        dts: false,
        outExtensions: () => ({ js: '.js' }), // 钉 .js:与 package.json exports 声明保持一致
    },
    {
        // client 出口:注册式 CJS(browser);react 系 external(宿主经 factory 的 require 供应)
        entry: { client: 'src/client/index.ts' },
        outDir: 'dist',
        format: 'cjs',
        platform: 'browser',
        dts: false,
        minify: true,
        outExtensions: () => ({ js: '.js' }),
        external: ['react', 'react-dom', 'react/jsx-runtime'],
        plugins: [cssModulesPlugin()],
        clean: false, // 双配置共享 dist/,第二段不得清掉 host 产物
        outputOptions: {
            entryFileNames: 'client.js',
            banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_NAME)}, factory: (require) => {`,
            intro: [
                'var module = { exports: {} };',
                'var exports = module.exports;',
                'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
            ].join('\n'),
            footer: 'return module.exports; } });',
        },
    },
])
