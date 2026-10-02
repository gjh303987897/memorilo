# 配置模块使用文档

Sync Server 是独立的 Node 服务，不使用 Electron 配置热更新。它的启动期环境变量、单公网端口部署、备份恢复和维护约束见 [Sync Server operations](./sync-server-operations.md)。桌面端配置只保存服务器 URL、PeerId 和同步状态；配对后签发的 bearer credential 由 Electron main 进程通过操作系统 `safeStorage` 单独加密保存，不进入 renderer 可读取的配置快照。

配置模块由两层组成：

- `@memorilo/config`：通用配置定义、Effect Schema 校验、存储、订阅、热更新和 React 配置控件。
- `@memorilo/desktop-config`：Memorilo 桌面应用的配置原型，目前包含 General、Flashcards、Goals & Streaks、Editor、MCP 和 Sync Server 设置。

## 定义配置

使用 Effect Schema 描述完整配置，再用 `defineConfiguration` 添加默认值和页面字段。默认值会在定义阶段校验；字段路径必须能从默认配置中读取。

```ts
import * as Schema from 'effect/Schema'
import { defineConfiguration } from '@memorilo/config'

const AppConfigurationSchema = Schema.Struct({
  language: Schema.Literals(['system', 'en', 'zh-CN']),
  reduceMotion: Schema.Boolean,
})

export type AppConfiguration = typeof AppConfigurationSchema.Type

export const appConfigurationDefinition = defineConfiguration({
  id: 'example-app',
  schema: AppConfigurationSchema,
  defaults: {
    language: 'system',
    reduceMotion: false,
  },
  sections: [{
    id: 'general',
    label: 'General',
    fields: [
      {
        control: 'select',
        path: 'language',
        label: 'Language',
        options: [
          { value: 'system', label: 'System Default' },
          { value: 'en', label: 'English' },
          { value: 'zh-CN', label: '简体中文' },
        ],
      },
      {
        control: 'toggle',
        path: 'reduceMotion',
        label: 'Reduce motion',
      },
    ],
  }],
})
```

支持的控件是 `text`、`number`、`select` 和 `toggle`。`number` 可以额外指定 `min`、`max`、`step` 和 `unit`；`text` 可以指定 `placeholder`，敏感字段可设置 `sensitive`。`select` 的选项值必须唯一，并且必须包含默认值。

## 创建存储

存储适配器只需要实现 `read` 和 `write`，可选实现 `subscribe` 来触发外部变更刷新。

```ts
import { createConfigurationStore } from '@memorilo/config'

const adapter = {
  read: async () => loadConfigurationFromYourStorage(),
  write: async (configuration: unknown) => {
    await saveConfigurationToYourStorage(configuration)
  },
  subscribe: (listener: () => void) => subscribeToYourStorage(listener),
}

const store = await createConfigurationStore(
  appConfigurationDefinition,
  adapter,
  {
    onError: error => console.error('Configuration hot reload failed', error),
  },
)
```

读取到 `null` 时，模块使用定义中的默认值，并默认写回适配器。传入 `{ persistDefaults: false }` 可以关闭这次写回，例如浏览器预览或只读测试。

所有读取和写入都会经过 Effect Schema 解码。无效的已有配置或无效更新会抛出错误，不会静默回退到默认值。字段更新会串行化，因此同时调用多个 `setValue` 时，每次更新都基于上一次已经提交的快照。

## 读取、更新和订阅

```ts
const current = store.getSnapshot()

const unsubscribe = store.subscribe(() => {
  console.log('Configuration changed', store.getSnapshot())
})

await store.setValue('language', 'zh-CN')
await store.set({ language: 'en', reduceMotion: true })
await store.refresh()

unsubscribe()
await store.close()
```

`refresh()` 会从适配器重新读取并校验配置。适配器的 `subscribe` 通常用于文件监听、跨进程事件或其他外部存储通知；通知本身不携带配置值，存储模块会负责重新读取。

配置读取、写入和 watcher 刷新共享同一个 Effect operation supervisor，因此文件系统对本地写入产生的 echo 会排在对应写入之后，不会并行发布旧快照。operation lane 与 watcher 由同一个 Effect resource scope 在启动阶段依次获取；watcher acquisition 或建立后的追读失败时，scope 会逆序释放已经获取的资源，并在释放也失败时聚合启动与清理错误。追读覆盖首次读取与订阅建立之间的竞态窗口。`close()` 会先停止 watcher admission 和订阅，再等待所有已接收操作完成；已经被事件循环捕获但在关闭后才到达的 watcher 通知会被忽略。关闭失败只重试尚未释放的资源，并发关闭调用共享同一次 drain。

## JSON 文件适配器

Node 环境可以使用 `@memorilo/config/node` 提供的 JSON 文件适配器：

```ts
import { join } from 'node:path'
import { app } from 'electron'
import { createConfigurationStore } from '@memorilo/config'
import { createJsonFileConfigurationAdapter } from '@memorilo/config/node'

const store = await createConfigurationStore(
  appConfigurationDefinition,
  createJsonFileConfigurationAdapter(join(app.getPath('userData'), 'configuration.json')),
)
```

适配器会创建父目录，以临时文件加 `rename` 的方式原子写入，并监听配置文件所在目录的替换事件。`debounceMs` 可以调整外部文件变更的合并窗口，默认为 30ms。同一进程内指向同一规范化路径的适配器共享 Effect 文件事务 lane；字段更新的读取、修改和原子替换会整体串行，失败操作也会释放 lane，因此独立 store 不会因竞争 `rename` 而失败或互相覆盖不同字段。

## 生成 React 配置页面

`@memorilo/config/react` 的 `ConfigurationFields` 会根据配置原型生成表单控件，并使用 `store.setValue` 提交变更：

```tsx
import type { ConfigurationStore } from '@memorilo/config'
import { ConfigurationFields } from '@memorilo/config/react'

const section = appConfigurationDefinition.sections[0]
if (!section)
  throw new Error('Configuration requires a section')

export function ConfigurationPane({ store }: { store: ConfigurationStore<AppConfiguration> }) {
  return <ConfigurationFields fields={section.fields} store={store} />
}
```

控件会显示校验错误、在写入期间禁用当前控件，并通过 `useSyncExternalStore` 响应热更新。组件样式由调用方的 StyleX 构建配置负责提取。

Vite 使用 `@stylexjs/unplugin` 时，需要把配置包列入 `externalPackages`：

```ts
import stylex from '@stylexjs/unplugin/vite'

const stylexOptions: NonNullable<Parameters<typeof stylex>[0]> & {
  externalPackages: string[]
} = {
  cssInjectionTarget: fileName => fileName.includes('renderer-global'),
  externalPackages: ['@memorilo/config'],
  unstable_moduleResolution: { type: 'commonJS' },
  useCSSLayers: true,
}

stylex(stylexOptions)
```

`@stylexjs/unplugin` 0.19 支持 `externalPackages`，但当前类型声明没有包含它，因此示例显式补充了该属性。

多 HTML 入口必须共同导入同一个 StyleX 全局入口，并用上例的 `cssInjectionTarget` 指向它，确保 StyleX 汇总规则被两个入口引用。Memorilo 让所有入口导入 `renderer-global.stylex.ts`。

## Memorilo 桌面设置

桌面配置原型位于 [`apps/desktop/config/src/index.ts`](../apps/desktop/config/src/index.ts)。主进程会把 JSON 文件存储在 Electron `userData` 目录下，并通过 IPC 暴露：

- `window.desktop.getConfiguration()`
- `window.desktop.setConfiguration(configuration)`
- `window.desktop.subscribeConfiguration(listener)`

设置窗口是独立的、非模态、单实例 `BrowserWindow`，由 App 菜单的 `Settings…` 和 `CmdOrCtrl+,` 打开。设置页面入口是 `apps/desktop/renderer/settings.html`，没有 Electron 时会使用内存适配器，因此可以在浏览器中进行视觉调试和交互测试。

当前设置页面按 General、Calendar、Editor、Shortcuts、Reading、Learning、Media、MCP、Device 和 Sync 分类组织。配置原型还包含 Todo、Backup、Flashcards、Goals、图片、Reader 和快捷键等 section；这些 section 由页面按类别组合显示，不能再用少量旧分组概括完整设置面。

General 包含语言、星期起始日、减少动态效果和面板 tab 顺序；Todo 包含工作区开关、父任务自动完成、时间线和重复任务行为；Learning、Flashcards、Goals、Backup、Editor、Reader、图片、MCP 和 Sync Server 各自对应当前原型中的字段。主题选择单独由设置页面渲染。

Flashcards 与 Goals 设置不会生成持久化队列 snapshot。当前已展示的复习 Card 保持稳定，下一次选卡和下一次进度查询读取最新配置；MCP 与 Outline 设置则通过配置订阅更新对应运行时。

MCP HTTP 运行时仅监听 loopback 地址。启用 MCP 的初始配置属于桌面启动 acquisition：监听端口绑定或 protocol 启动失败会中止启动，并由启动 scope 逆序回滚已经获得的资源。配置热更新只在当前目标成功启动后才视为应用完成；当前目标失败会报告并拒绝该次更新，已被更新配置取代的 stale 启动失败则不会覆盖最新状态。

关闭服务或切换端口时会立即停止网络 admission 并释放监听端口，已接受 request 先获得有界的 graceful drain 时间；只有 request 未在期限内完成时才 interrupt active transport，随后继续等待 request 退出并关闭 protocol server。这样正常工具调用不会被过早取消，卡住的 transport 也不会与 shutdown 形成循环等待。并发关闭共享同一次 shutdown，单个清理失败不会跳过其余已拥有资源；监听启动失败也会回滚 request supervisor。

新增桌面设置时，需要同步修改：

1. `apps/desktop/config/src/index.ts` 中的 Effect Schema、默认值和字段原型。
2. 设置页面无需手写控件，`ConfigurationFields` 会从原型生成。
3. 如设置影响全局行为，在 `DesktopConfigurationEnvironment` 中消费配置并处理系统辅助功能偏好。
4. 浏览器设置测试 `apps/desktop/renderer/src/settings/settings.test.tsx`。

`migrateDesktopConfiguration` 为缺少 Flashcards、Goals、MCP 或 `outdentBehavior` 的较早配置文件补齐整组默认值，并规范 MCP 的端口、token 与 enabled 状态；迁移后的完整结果仍必须通过 Effect Schema，非法的现有字段不会静默回退。配置文件随后由 JSON adapter 原子写回。

## 测试命令

```bash
pnpm --filter @memorilo/config test
pnpm --filter @memorilo/desktop-renderer test
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

配置页面测试使用 Vitest Browser + Playwright 驱动 Playwright 自带的 Chromium，不依赖 Electron，也不要求系统安装 Google Chrome；Electron e2e 只用于验证主进程启动、IPC、打包和最终用户工作流。运行浏览器测试前请用 `pnpm exec playwright install chromium` 安装 Playwright 的 Chromium。
