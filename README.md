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

- 两个按钮都用完整色谱的渐变文字（`background-clip: text`），「引用」从红橙黄起，「复制引用」从青蓝紫起，两条渐变的色序不同。
- `background-size: 200% 100%` + `@keyframes dsh-quote-flow` 让颜色 3.5s 循环流动；hover 时加速到 1.5s 并加 `0 0 12px rgba(139,92,246,.25)` 光晕。
- 图标是文本字形（`“` / `⧉`），跟随同一个渐变，无需额外的 SVG 或 mask。
- 工具条：10px 圆角、白底、1px 渐变边框（`padding-box` / `border-box` 双层背景，兼容性好于 mask）、阴影 `0 6px 20px rgba(139,92,246,.2)`。
- 复制成功态用绿→青渐变（`#22C55E → #06B6D4`）。
- 深色主题下两套渐变换成提亮一档的色值，边框与底色同步调整。
- 选区高亮为 `rgba(139,92,246,.18)`。
- `prefers-reduced-motion: reduce` 时关闭流动动画。

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
