# dsh-quote-selection

选中对话里的文字，浮出一个小工具条：**「“ 引用」** 和 **「⧉ 复制引用」**。
「引用」把选中内容以 Markdown 引用块（`> ...`）追加到输入框；「复制引用」把同样的引用块放进剪贴板。`Ctrl/Cmd + L` 等价于点「引用」。

## 为什么不用 `dsh.client` 客户端插件

DSH 0.2.x 的桌面端只对 `dsh.client` 声明做**预取**（`prefetchImmediateTier`），真正执行要等别的模块 `import` 它。一个只挂 UI、没有调用方的插件永远不会被 materialize，代码就永远不跑。所以本插件改走**宿主索引注入**：

```
index.js  →  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'script', text, placement: 'body' }))
          →  宿主 collectIndexInjections() 收集（启动时）
          →  桌面端通过 boot IPC 拿到 rows 并逐个执行；Web 端直接渲染进 index.html
```

这条路径在 React 挂载之前就跑，和客户端模块图无关。

## 行为

- 选区在对话正文（`data-slot="conversation.chat.flow"` 或 `data-chat-flow-kind`）或在其他非输入区域时浮出工具条；选在输入框、按钮、链接里不出现。
- 工具条定位在选区上方居中；上方空间不够时落到选区下方。
- 「引用」：先放光标 → 再聚焦 → 等两帧 → `execCommand`，用内容变化判断成败，失败降级 `beforeinput` → `paste`。
- 「复制引用」：优先 `navigator.clipboard.writeText`，失败回退隐藏 textarea + `execCommand('copy')`；成功后按钮变「✓ 已复制」并在 1.5 秒后收起工具条。
- `Ctrl/Cmd + L`：有选区时直接插入引用（`preventDefault`，不触发浏览器默认行为）。
- 超过 4000 字符会截断并加省略号。
- 按 Esc、点击别处、滚动页面都会收起工具条。

## 样式

克制版配色，只有两组相邻色相，没有彩虹色：

- 「引用」文字渐变 `#4F46E5 → #7C3AED → #C026D3`（靛蓝→紫→洋红）；
  「复制引用」`#0891B2 → #4F46E5`（青→靛蓝）。均为 `linear-gradient(100deg,…)` + `background-clip: text`，字重 500、字号 13px。
- 渐变挂在 `.dsh-quote-ink` 内层上，按钮本身保留真实背景，hover 才能正常铺色（`rgba(99,102,241,.08)`，active 更深，过渡 .2s）。
- 图标是文本字形（`“` / `⧉`），与文字共享同一条渐变。
- 工具条：`rgba(255,255,255,.72)` + `backdrop-filter: blur(16px) saturate(160%)`，圆角 12px、内边距 4px，
  阴影三层 `0 0 0 1px rgba(20,20,40,.06), 0 2px 6px rgba(20,20,40,.05), 0 12px 32px rgba(99,102,241,.14)`。
- 边框 1px 中性描边；`::before` 用 `conic-gradient`（透明 → `#818CF8` → `#C084FC` → 透明）+ `mask-composite` 裁成 1px 细高光，`@property --dsh-quote-a` 驱动角度，9s 绕一圈，只占约 30% 周长。
- 两个按钮之间是 14px 高的 `rgba(0,0,0,.08)` 短竖线。
- 出现动画：120ms 淡入 + 上移 4px。
- 复制成功：`✓ 已复制`，渐变 `#059669 → #0D9488`，1.5s 后工具条消失。
- 深色主题：底色 `rgba(24,24,32,.72)`，渐变换成 `#818CF8 / #A78BFA / #E879F9 / #22D3EE`，阴影转纯黑 + 淡紫外发光。
- 选区高亮 `rgba(129,140,248,.22)`。
- `prefers-reduced-motion: reduce` 时关闭高光绕边与出现动画。

## 实现要点

- 输入框是 Lexical 的 `contenteditable`（`[data-lexical-editor="true"]`）。Lexical 在**获得焦点时**才采纳 DOM 选区，所以顺序必须是“先放光标、再 focus”，命令还要等两帧；`execCommand` 即使被 Lexical 丢弃也返回 true，因此用 `editor.textContent` 前后比对判断是否真的写入。
- `inject.js` 是经典脚本（IIFE），由宿主以 `{ kind: 'script' }` 行内注入，不经过模块加载器。


## 安装

```powershell
dsh plugin --profile desktop add link:C:/Users/32926/Documents/deepseek-harness/default-workspace/dsh-quote-selection
```

重启桌面客户端后生效（注入表在宿主启动时收集）。

## 诊断

默认不写任何诊断标记。需要排查时再临时加，主要入口：

- 宿主启动日志：`$DSH_HOME/quote-selection-host.log`（`apply() called` / `route registered` / `inline row pushed`）。
- 页面侧的调试标记已被移除；需要时在 `inject.js` 里加 `localStorage.setItem` 即可。

## 测试

```powershell
# 逻辑测试（真实源码，不是副本）：引用块格式、截断、选区门禁
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\ai\DeepSeek Harness.exe' --expose-internals test\logic.test.mjs
```

浏览器侧自检：每次页面加载会往 localStorage 写 `dsh-quote-selection:selftest`，
内容包括 `toolbar`（工具条存在）、`buttons`（按钮数，应为 2）、`style`（样式注入）、
`flow`（会话流容器）、`editors`（可见 Lexical 编辑器数）、`payload`（引用块样例）。

## 已知行为

- 引用总是追加到输入框**末尾**（不是当前光标处），插入后焦点给回输入框。
- 选区在输入框、按钮、链接里不会触发；其余位置的选区都会触发（比 Antigravity 的范围宽一点）。
- 超过 4000 字符截断并加省略号。

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-quote-selection
```
