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

- 默认文字为深色 `#1F2340`（深色主题 `#E8E9F5`），字重 500、字号 13px、`letter-spacing: .02em`。
- hover 时 `-webkit-text-fill-color` 过渡到 `transparent`（.25s），露出底下被 `background-clip: text` 裁住的同色系渐变：
  「引用」`#4F46E5 → #7C3AED`，「复制引用」`#0891B2 → #4F46E5`。
- 图标改为内联 SVG，1.5px 描边、14px、与文字间距 6px；描边用 `linearGradient`，stop 颜色取 `var(--g1)` / `var(--g2)`，
  所以两枚图标的渐变可以不同（引用偏紫，复制偏青蓝），深色主题只换变量即可提亮。
- 工具条材质：`rgba(255,255,255,.78)` + `backdrop-filter: blur(20px) saturate(180%)`，圆角 16px、内边距 6px、按钮间距 6px；
  阴影 `0 0 0 1px / 0 2px 8px / 0 6px 44px / 0 22px 48px` 四层，外加 `inset 0 1px 0 rgba(255,255,255,.9)` 顶部内高光。
- 两个动作按 **Tabs sliding** 做：按钮本身透明，背后一块 `dsh-quote-pill` 承担 hover 面，
  鼠标在两个按钮之间移动时药丸**滑过去**——JS 只写 `offsetLeft/offsetTop/offsetWidth/offsetHeight`，
  CSS 负责 `250ms var(--qt-ease)` 的 tween（首帧和 resize 时用「关掉 transition → 写值 → 强制 reflow → 恢复」的方式吸附，不会从 0 滑入）。
  配方来自 `transitions-dev` 的 `free/tabs-sliding.md`（免费档），变量对齐它的 `--tabs-dur / --tabs-ease`。
- `::after` 叠一层 2% 透明度的 `feTurbulence` 噪点（120px 平铺）。
- 边框 1px `rgba(20,20,40,.08)`；`::before` 是**沿边框跑的彗星光带**（Border Beam）：
  一条 conic-gradient 从透明拖尾过渡到 `#4F46E5 → #C026D3 → #22D3EE`，末尾是接近白热的光头，
  `mask-composite` 裁到 1px 边框上，再用两层 `drop-shadow` 做辉光（对应 `strength`）。
  `@property --dsh-quote-a` 驱动 4.5s 一圈，hover 提速到 2.6s；`--beam-arc` 控制弧长
  （`data-beam="sm"` 38°、`line` 16°，默认 md 62°），对应库里的 `size` 属性。
  > `border-beam` 本体同样是 React 组件（peerDeps 只有 react/react-dom），这里按它的视觉规格原生复刻。

- 按钮 hover 有跟随鼠标的柔光：`radial-gradient(80px at var(--mx) var(--my), rgba(99,102,241,.14), transparent)`，
  `--mx/--my` 由 `mousemove` 写入；active 时 `scale(.97)`。
- 动效沿用 transitions.dev 公开的 motion scale：`--qt-micro 80 / quick 150 / fast 250 / medium 350 / slow 400ms`、`--qt-stagger 40ms`，统一缓动 `cubic-bezier(.22,1,.36,1)`。
  - 入场：`fast`（250ms）smooth-out，`translateY(6px) scale(.96)` → 归位，`transform-origin` 设在箭头锚点，从选区方向长出来；
  - 两个按钮各延迟 `stagger`（40ms）依次浮现；
  - hover 背景/阴影 160ms ease，文字渐显 `quick`（150ms），✓ 描绘 `slow`（400ms），收起 `quick`。
- 材质阴影里的环境层改用同站 `0 4px 42px rgba(20,20,40,.06)`，替换原来较硬的 `0 8px 16px`。
- 复制成功：图标换成 ✓（`pathLength=1` + `stroke-dashoffset` 300ms 描绘），文字变「已复制」`#059669`，1.5s 后淡出收起。
- 定位：默认在选区上方居中，带 12×8 的毛玻璃三角箭头指向选区；上方空间不足翻到下方，左右与上下都做视口钳制。
- 选区高亮 `rgba(129,140,248,.22)`；`::highlight` 目前只支持可继承的文字属性，`border-radius` 不生效，所以没走 Custom Highlight API。
- 深色主题：底 `rgba(28,28,38,.72)`，渐变提亮为 `#818CF8 / #A78BFA / #22D3EE`，阴影转黑 + 淡紫外，内高光降到 8%。
- `prefers-reduced-motion: reduce` 关闭高光绕边、弹簧入场和鼠标柔光（JS 也不再写 `--mx/--my`）。

## 字体

- 族栈拉丁优先，中文回退：
  `Inter, Geist, "HarmonyOS Sans SC", "MiSans", "PingFang SC", "Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei UI", system-ui, sans-serif`。
  本机装了 **Noto Sans SC** 与 **Microsoft YaHei UI**，Inter／Geist／HarmonyOS Sans／MiSans 都没有，所以实际先落到 Noto Sans SC。
- **不加载 web font**：应用本身不带字体资源，引 CDN 只会多一次 swap 闪烁；跨字体回退的抖动改用**固定最小宽度**兜底（引用 74px、复制引用 102px）。
- 13.5px / `line-height: 1`，主操作「引用」600、次操作「复制引用」500；`letter-spacing: .04em`（全中文文案）。
- `font-feature-settings: "tnum"`（只影响数字，当前文案无数字不影响外观）。
- 图标 15px、间距 7px、线宽 1.6px；文字 `padding-top: 1px` 做光学对齐。
- 常态 `#2B2F4A`（深色 `#E8E9F5`），hover 才过渡成渐变文字（`-webkit-text-fill-color` → transparent，.25s）。
- 开启 `-webkit-font-smoothing: antialiased`、`-moz-osx-font-smoothing: grayscale`、`text-rendering: optimizeLegibility`；浅色加 `text-shadow: 0 1px 0 rgba(255,255,255,.6)`，深色去掉。
- `user-select: none` + `white-space: nowrap`。


## 实现要点

- 输入框是 Lexical 的 `contenteditable`（`[data-lexical-editor="true"]`）。Lexical 在**获得焦点时**才采纳 DOM 选区，所以顺序必须是“先放光标、再 focus”，命令还要等两帧；`execCommand` 即使被 Lexical 丢弃也返回 true，因此用 `editor.textContent` 前后比对判断是否真的写入。
- `inject.js` 是经典脚本（IIFE），由宿主以 `{ kind: 'script' }` 行内注入，不经过模块加载器。


## 安装

```powershell
# 从 GitHub 安装（任意机器；把 desktop 换成你自己的 profile 名）
dsh plugin --profile desktop add -w github:Adingo001/dsh-quote-selection

# 本地开发：link 到你自己的克隆路径
dsh plugin --profile desktop add link:/path/to/dsh-quote-selection
```

`-w`（pnpm 的 `--workspace-root`）在 profile 目录这个 workspace 根上是显式声明，加上更稳；实测不带也能装。

安装后需要**重启 dsh**（注入表在宿主启动时一次性收集，桌面端只认启动时的快照）。

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
