/**
 * dsh-quote-selection — injected page script.
 *
 * Select text in the transcript and a small floating toolbar appears:
 *
 *   [“ 引用] | [⧉ 复制引用]
 *
 * 引用 appends the selection to the composer as a Markdown blockquote;
 * 复制引用 puts the same blockquote on the clipboard. Ctrl/Cmd+L quotes.
 *
 * Loaded through the host's index-injection table (`kind: 'script'`), which the
 * desktop boot and the served index both apply before the app mounts. A classic
 * script, not a client-module bundle: `dsh.client` entries are only prefetched
 * unless something imports them, and nothing imports a standalone UI plugin.
 *
 * Insertion note: the composer is a Lexical contenteditable. Lexical adopts the
 * DOM selection when the editor receives focus, so the caret is placed *first*
 * and the editor focused second; the command runs two frames later. Success is
 * judged by comparing the editor text before and after, not by the return value
 * of `execCommand` (which reports true even when Lexical drops the edit), with
 * `beforeinput` and `paste` as fallbacks.
 *
 * Styling note: the gradient lives on the ink wrapper, never on the button, so
 * the button keeps a real background for hover. Text is solid until hover; the
 * hover gradient is revealed by transitioning `-webkit-text-fill-color` to
 * transparent over the clipped background.
 */
;(function () {
  'use strict'

  if (window.__dshQuoteSelectionInstalled) return
  window.__dshQuoteSelectionInstalled = true

  var ROOT_ID = 'dsh-quote-selection-root'
  var MAX_CHARS = 4000
  var FLOW_SLOT = 'conversation.chat.flow'
  var EDITOR_SELECTOR = '[data-lexical-editor="true"]'
  var SVG_NS = 'http://www.w3.org/2000/svg'

  // 2% grain: feTurbulence tile, painted by the bar's ::after.
  var NOISE =
    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'120\'%3E' +
    '%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'3\'/%3E%3C/filter%3E' +
    '%3Crect width=\'120\' height=\'120\' filter=\'url(%23n)\'/%3E%3C/svg%3E")'

  var CSS =
    '@property --dsh-quote-a{syntax:"<angle>";initial-value:0deg;inherits:false;}' +
    // Motion tokens taken from the transitions.dev public scale: micro 80,
    // quick 150, fast 250, medium 350, slow 400, stagger 40; one smooth-out
    // curve for every open/close and position change.
    '#' + ROOT_ID + '{--qt-micro:80ms;--qt-quick:150ms;--qt-fast:250ms;--qt-medium:350ms;--qt-slow:400ms;' +
    '--qt-stagger:40ms;--qt-ease:cubic-bezier(.22,1,.36,1);' +
    'position:fixed;z-index:2147483000;display:none;pointer-events:none;}' +
    '#' + ROOT_ID + '[data-open="true"]{display:block;}' +

    // ── frosted bar ─────────────────────────────────────────────────────────
    '#' + ROOT_ID + '>div{position:relative;display:inline-flex;align-items:stretch;padding:6px;gap:6px;' +
    'pointer-events:auto;' +
    'border-radius:16px;border:1px solid rgba(20,20,40,.07);background:rgba(255,255,255,.78);' +
    '-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);' +
    'box-shadow:0 0 0 1px rgba(20,20,40,.05),0 2px 8px rgba(20,20,40,.05),0 6px 44px rgba(20,20,40,.07),' +
    '0 22px 48px rgba(99,102,241,.16),inset 0 1px 0 rgba(255,255,255,.9);' +
    'animation:dsh-quote-in var(--qt-fast) var(--qt-ease) both;}' +

    // ── border beam ─────────────────────────────────────────────────────────
    // One comet riding the 1px border: a long fading tail into a hot white
    // head, masked to the ring and bloomed with layered drop-shadows. Sizes
    // follow the library's `size` prop through --beam-arc (md 62deg, sm 38deg,
    // line 16deg); colour follows --beam-* so variants stay one declaration.
    '#' + ROOT_ID + '>div::before{content:"";position:absolute;inset:-1px;border-radius:16px;padding:1px;' +
    'pointer-events:none;' +
    '--beam-arc:62deg;' +
    'background:conic-gradient(from var(--dsh-quote-a),' +
    'transparent 0deg,' +
    'transparent calc(360deg - var(--beam-arc)),' +
    'rgba(79,70,229,.15) calc(360deg - var(--beam-arc) * .72),' +
    'rgba(79,70,229,.85) calc(360deg - var(--beam-arc) * .42),' +
    '#C026D3 calc(360deg - var(--beam-arc) * .2),' +
    '#22D3EE calc(360deg - var(--beam-arc) * .07),' +
    'rgba(255,255,255,.95) 360deg);' +
    '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
    'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
    '-webkit-mask-composite:xor;mask-composite:exclude;' +
    'filter:drop-shadow(0 0 3px rgba(192,38,211,.45)) drop-shadow(0 0 9px rgba(79,70,229,.35));' +
    'animation:dsh-quote-beam 4.5s linear infinite;}' +
    '#' + ROOT_ID + '>div[data-beam="sm"]::before{--beam-arc:38deg;}' +
    '#' + ROOT_ID + '>div[data-beam="line"]::before{--beam-arc:16deg;}' +
    '#' + ROOT_ID + '>div:hover::before{animation-duration:2.6s;}' +
    // 40ms item stagger on open, matching the scale's stagger token.
    '#' + ROOT_ID + '>div.is-sweeping .dsh-quote-ink{animation:dsh-quote-item var(--qt-fast) var(--qt-ease) both;}' +
    '#' + ROOT_ID + '>div.is-sweeping button+button .dsh-quote-ink{animation-delay:var(--qt-stagger);}' +

    // grain
    '#' + ROOT_ID + '>div::after{content:"";position:absolute;inset:0;border-radius:16px;' +
    'pointer-events:none;opacity:.02;background-image:' + NOISE + ';background-size:120px 120px;}' +

    // ── buttons ─────────────────────────────────────────────────────────────
    // The actions are tabs, not chips: a pill behind them carries the hover
    // surface and slides between the two, so the buttons themselves stay
    // transparent and only their ink changes colour.
    '#' + ROOT_ID + ' button{position:relative;margin:0;border:0;padding:0;z-index:1;' +
    'border-radius:12px;cursor:pointer;white-space:nowrap;background:transparent;' +
    '--g1:#4F46E5;--g2:#7C3AED;' +
    'transition:transform 120ms ease;}' +
    '#' + ROOT_ID + ' button+button{--g1:#0891B2;--g2:#4F46E5;}' +
    '#' + ROOT_ID + ' button:active{transform:scale(.97);}' +
    '#' + ROOT_ID + ' button:focus-visible{outline:2px solid #818CF8;outline-offset:2px;}' +

    // ── sliding pill (Tabs sliding) ─────────────────────────────────────────
    // width/height/transform are written by JS from the hovered tab's
    // offset* box; CSS owns the 250ms smooth-out tween, as in the recipe.
    '#' + ROOT_ID + ' .dsh-quote-pill{position:absolute;left:0;top:0;width:0;height:0;' +
    'border-radius:12px;z-index:0;pointer-events:none;opacity:0;' +
    'background:rgba(255,255,255,.9);' +
    'box-shadow:inset 0 0 0 1px rgba(20,20,40,.06),0 1px 2px rgba(20,20,40,.06),' +
    '0 6px 16px rgba(99,102,241,.12);' +
    'transition:transform var(--qt-fast) var(--qt-ease),width var(--qt-fast) var(--qt-ease),' +
    'height var(--qt-fast) var(--qt-ease),opacity var(--qt-micro) linear;}' +

    // cursor-following glow, behind the ink
    '#' + ROOT_ID + ' button::after{content:"";position:absolute;inset:0;border-radius:12px;z-index:0;' +
    'pointer-events:none;opacity:0;transition:opacity .2s ease;' +
    'background:radial-gradient(80px at var(--mx,50%) var(--my,50%),rgba(99,102,241,.14),transparent 70%);}' +
    '#' + ROOT_ID + ' button:hover::after{opacity:1;}' +

    // 1px × 14px divider between the actions
    // The chips already separate themselves with a gap and their own hairline
    // ring, so the old 1px divider is gone.

    // ── ink: solid text until hover, then the clipped gradient shows through ─
    // Latin-first stack so digits and Latin run on Inter/Geist when present and
    // Chinese falls through to the first installed CJK face. No web font is
    // loaded: the app ships none, and a CDN face would only add a swap flash.
    '#' + ROOT_ID + ' .dsh-quote-ink{position:relative;z-index:1;display:inline-flex;align-items:center;' +
    'justify-content:center;gap:7px;padding:8px 14px;white-space:nowrap;user-select:none;' +
    'font-family:Inter,Geist,"HarmonyOS Sans SC","MiSans","PingFang SC","Source Han Sans SC",' +
    '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif;' +
    'font-size:13.5px;font-weight:500;line-height:1;letter-spacing:.04em;' +
    'font-feature-settings:"tnum";' +
    '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;' +
    'color:#2B2F4A;-webkit-text-fill-color:#2B2F4A;' +
    'text-shadow:0 1px 0 rgba(255,255,255,.6);' +
    'background-image:linear-gradient(100deg,var(--g1),var(--g2));' +
    '-webkit-background-clip:text;background-clip:text;' +
    'transition:-webkit-text-fill-color var(--qt-quick) var(--qt-ease),' +
    'color var(--qt-quick) var(--qt-ease);}' +
    // Primary action is heavier; fixed minimums keep the bar from resizing when
    // the font stack resolves to a different face.
    '#' + ROOT_ID + ' button:first-child .dsh-quote-ink{font-weight:600;min-width:74px;}' +
    '#' + ROOT_ID + ' button+button .dsh-quote-ink{font-weight:500;min-width:102px;}' +
    '#' + ROOT_ID + ' .dsh-quote-label{padding-top:1px;}' +
    '#' + ROOT_ID + ' button:hover .dsh-quote-ink{color:transparent;-webkit-text-fill-color:transparent;}' +
    '#' + ROOT_ID + ' button.is-copied .dsh-quote-ink{background-image:none;' +
    'color:#059669;-webkit-text-fill-color:#059669;}' +
    '#' + ROOT_ID + ' button.is-copied:hover .dsh-quote-ink{color:#059669;-webkit-text-fill-color:#059669;}' +

    // ── icons ───────────────────────────────────────────────────────────────
    '#' + ROOT_ID + ' .dsh-quote-icon{width:15px;height:15px;flex:none;overflow:visible;}' +
    '#' + ROOT_ID + ' .dsh-quote-icon path,#' + ROOT_ID + ' .dsh-quote-icon rect{' +
    'fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}' +
    '#' + ROOT_ID + ' .dsh-quote-icon.is-check{display:none;}' +
    '#' + ROOT_ID + ' .is-copied .dsh-quote-icon.is-check{display:inline;}' +
    '#' + ROOT_ID + ' .is-copied .dsh-quote-icon.is-copy{display:none;}' +
    '#' + ROOT_ID + ' .dsh-quote-icon.is-check path{stroke-dasharray:1;stroke-dashoffset:1;' +
    'transition:stroke-dashoffset var(--qt-slow) var(--qt-ease);}' +
    '#' + ROOT_ID + ' .is-copied .dsh-quote-icon.is-check path{stroke-dashoffset:0;}' +

    // ── caret ───────────────────────────────────────────────────────────────
    '#' + ROOT_ID + ' .dsh-quote-caret{position:absolute;width:12px;height:8px;left:0;bottom:-7px;' +
    'pointer-events:none;background:rgba(255,255,255,.72);' +
    '-webkit-backdrop-filter:blur(18px) saturate(170%);backdrop-filter:blur(18px) saturate(170%);' +
    'clip-path:polygon(0 0,100% 0,50% 100%);filter:drop-shadow(0 -1px 0 rgba(20,20,40,.08));}' +
    '#' + ROOT_ID + '[data-side="below"] .dsh-quote-caret{bottom:auto;top:-7px;' +
    'clip-path:polygon(50% 0,100% 100%,0 100%);filter:drop-shadow(0 1px 0 rgba(20,20,40,.08));}' +

    // ── motion ──────────────────────────────────────────────────────────────
    '@keyframes dsh-quote-in{from{opacity:0;transform:translateY(6px) scale(.96);}' +
    'to{opacity:1;transform:translateY(0) scale(1);}}' +
    '@keyframes dsh-quote-item{from{opacity:0;transform:translateY(2px);}to{opacity:1;transform:none;}}' +
    '@keyframes dsh-quote-beam{from{--dsh-quote-a:0deg;}to{--dsh-quote-a:360deg;}}' +
    '#' + ROOT_ID + '.is-closing>div{opacity:0;transition:opacity var(--qt-quick) var(--qt-ease);}' +

    // ── selection ───────────────────────────────────────────────────────────
    '::selection{background:rgba(129,140,248,.22);color:inherit;}' +

    // ── dark theme ──────────────────────────────────────────────────────────
    'body[data-ds-dark-theme] #' + ROOT_ID + '>div{background:rgba(28,28,38,.72);' +
    'border-color:rgba(255,255,255,.10);' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.5),0 2px 4px rgba(0,0,0,.4),0 8px 16px rgba(0,0,0,.35),' +
    '0 20px 40px rgba(139,92,246,.18),inset 0 1px 0 rgba(255,255,255,.08);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' .dsh-quote-ink{color:#E8E9F5;-webkit-text-fill-color:#E8E9F5;' +
    'text-shadow:none;}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button{--g1:#818CF8;--g2:#A78BFA;}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' .dsh-quote-pill{background:rgba(255,255,255,.10);' +
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 1px 2px rgba(0,0,0,.4),' +
    '0 6px 16px rgba(139,92,246,.18);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button+button{--g1:#22D3EE;--g2:#818CF8;}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button.is-copied{--g1:#34D399;--g2:#2DD4BF;}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button.is-copied .dsh-quote-ink,' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button.is-copied:hover .dsh-quote-ink{' +
    'color:#34D399;-webkit-text-fill-color:#34D399;}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' .dsh-quote-caret{background:rgba(28,28,38,.72);' +
    'filter:drop-shadow(0 -1px 0 rgba(255,255,255,.10));}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + '[data-side="below"] .dsh-quote-caret{' +
    'filter:drop-shadow(0 1px 0 rgba(255,255,255,.10));}' +

    // ── reduced motion ──────────────────────────────────────────────────────
    '@media (prefers-reduced-motion: reduce){' +
    '#' + ROOT_ID + '>div{animation:none;}' +
    '#' + ROOT_ID + '>div::before,#' + ROOT_ID + '>div:hover::before{animation:none;}' +
    '#' + ROOT_ID + '>div.is-sweeping .dsh-quote-ink{animation:none;}' +
    '#' + ROOT_ID + ' button::after{display:none;}' +
    '#' + ROOT_ID + ' .dsh-quote-pill{transition:none;}' +
    '#' + ROOT_ID + ' button:active{transform:none;}}'

  /** Nearest transcript element for a node, or null outside the transcript. */
  function transcriptOf(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement
    if (!el || typeof el.closest !== 'function') return null
    if (el.closest(EDITOR_SELECTOR)) return null
    if (el.closest('input, textarea, select, button, a')) return null
    return el.closest('[data-slot="' + FLOW_SLOT + '"]') || el.closest('[data-chat-flow-kind]') || null
  }

  /** True when the node lives in an editable control we must leave alone. */
  function inEditor(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement
    if (!el || typeof el.closest !== 'function') return true
    return !!el.closest(EDITOR_SELECTOR + ', input, textarea, select')
  }

  /** The composer editor element: the last visible Lexical root. */
  function composerEditor() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(EDITOR_SELECTOR))
    var visible = nodes.filter(function (el) {
      return el.getClientRects().length > 0
    })
    return visible.length ? visible[visible.length - 1] : null
  }

  /** Markdown blockquote payload for a selection, clipped to MAX_CHARS. */
  function quotePayload(text) {
    var clipped = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '…' : text
    var body = clipped
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(function (line) {
        return line.length ? '> ' + line : '>'
      })
      .join('\n')
    return body + '\n\n'
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name)
    if (attrs) {
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) el.setAttribute(key, attrs[key])
      }
    }
    return el
  }

  /** One stroke-gradient icon: quote marks, copy sheets, or the check mark. */
  function makeIcon(kind, gradientId) {
    var svg = svgEl('svg', {
      class: 'dsh-quote-icon ' + (kind === 'check' ? 'is-check' : 'is-copy'),
      viewBox: '0 0 16 16',
      width: '14',
      height: '14',
      fill: 'none',
      'aria-hidden': 'true',
    })
    var defs = svgEl('defs')
    var grad = svgEl('linearGradient', {
      id: gradientId,
      x1: '0',
      y1: '0',
      x2: '16',
      y2: '16',
      gradientUnits: 'userSpaceOnUse',
    })
    grad.appendChild(svgEl('stop', { offset: '0', 'stop-color': 'var(--g1)' }))
    grad.appendChild(svgEl('stop', { offset: '1', 'stop-color': 'var(--g2)' }))
    defs.appendChild(grad)
    svg.appendChild(defs)

    var stroke = 'url(#' + gradientId + ')'
    if (kind === 'quote') {
      svg.appendChild(svgEl('path', { d: 'M5.2 5.1h2.3v2.3c0 1.7-1 2.9-2.3 3.3', stroke: stroke }))
      svg.appendChild(svgEl('path', { d: 'M9.6 5.1h2.3v2.3c0 1.7-1 2.9-2.3 3.3', stroke: stroke }))
    } else if (kind === 'copy') {
      svg.appendChild(svgEl('rect', { x: '5.6', y: '5.6', width: '7.2', height: '7.2', rx: '2', stroke: stroke }))
      svg.appendChild(svgEl('path', { d: 'M10.6 3.4H4.9A1.3 1.3 0 0 0 3.6 4.7v5.7', stroke: stroke }))
    } else {
      svg.appendChild(
        svgEl('path', {
          d: 'M3.6 8.4l2.9 2.9 5.9-5.9',
          stroke: stroke,
          pathLength: '1',
        }),
      )
    }
    return svg
  }

  function install() {
    if (document.getElementById(ROOT_ID)) return
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', install, { once: true })
      return
    }

    var reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    var style = document.createElement('style')
    style.setAttribute('data-dsh-quote-selection', 'true')
    style.textContent = CSS

    var root = document.createElement('div')
    root.id = ROOT_ID
    root.dataset.open = 'false'
    root.dataset.side = 'above'

    var bar = document.createElement('div')

    function makeButton(kind, labelText, title) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.title = title
      btn.setAttribute('aria-label', title)
      var ink = document.createElement('span')
      ink.className = 'dsh-quote-ink'
      ink.appendChild(makeIcon(kind, 'dsh-quote-grad-' + kind))
      if (kind === 'copy') ink.appendChild(makeIcon('check', 'dsh-quote-grad-check'))
      var label = document.createElement('span')
      label.className = 'dsh-quote-label'
      label.textContent = labelText
      ink.appendChild(label)
      btn.appendChild(ink)
      return btn
    }

    var quoteBtn = makeButton('quote', '引用', '引用所选内容到输入框（Ctrl+L）')
    var copyBtn = makeButton('copy', '复制引用', '复制所选内容的引用到剪贴板')
    var caret = document.createElement('span')
    caret.className = 'dsh-quote-caret'

    var pill = document.createElement('span')
    pill.className = 'dsh-quote-pill'
    pill.setAttribute('aria-hidden', 'true')

    bar.appendChild(pill)
    bar.appendChild(quoteBtn)
    bar.appendChild(copyBtn)
    bar.appendChild(caret)
    root.appendChild(bar)
    document.head.appendChild(style)
    document.body.appendChild(root)

    var saved = ''
    var timer = 0
    var flashTimer = 0
    var closeTimer = 0
    var sweepTimer = 0

    function hide() {
      root.dataset.open = 'false'
      root.classList.remove('is-closing')
      bar.classList.remove('is-sweeping')
    }

    function showAt(rect) {
      root.dataset.open = 'true'
      var box = bar.getBoundingClientRect()
      var w = box.width || 150
      var h = box.height || 34
      var gap = 10
      // Flip below when there is no room above, then clamp to the viewport.
      var above = rect.top - h - gap >= 8
      root.dataset.side = above ? 'above' : 'below'
      var top = above ? rect.top - h - gap : rect.bottom + gap
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8))
      var left = rect.left + rect.width / 2 - w / 2
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      root.style.left = Math.round(left) + 'px'
      root.style.top = Math.round(top) + 'px'

      var anchorX = rect.left + rect.width / 2 - left
      anchorX = Math.max(14, Math.min(anchorX, w - 14))
      caret.style.left = Math.round(anchorX - 6) + 'px'
      // Grow out of the caret, not out of the bar's centre.
      bar.style.transformOrigin = Math.round(anchorX) + 'px ' + (above ? '100%' : '0%')

      // One lap of the border highlight for the first two seconds.
      bar.classList.remove('is-sweeping')
      void bar.offsetWidth
      bar.classList.add('is-sweeping')
      window.clearTimeout(sweepTimer)
      sweepTimer = window.setTimeout(function () {
        bar.classList.remove('is-sweeping')
      }, 2000)

      // Seed the pill under the first action without tweening, then keep it
      // invisible until the pointer actually enters a tab.
      pillTo(quoteBtn, false)
      pill.style.opacity = '0'
    }

    /**
     * Slide the tabs pill onto a button. Follows the transitions.dev recipe:
     * JS writes the measured box, CSS owns the 250ms smooth-out tween; an
     * unanimated call suspends the transition, writes, and forces a reflow.
     */
    function pillTo(btn, animate) {
      if (!btn) {
        pill.style.opacity = '0'
        return
      }
      if (!animate) {
        var suspended = pill.style.transition
        pill.style.transition = 'none'
        pill.style.transform = 'translate(' + btn.offsetLeft + 'px,' + btn.offsetTop + 'px)'
        pill.style.width = btn.offsetWidth + 'px'
        pill.style.height = btn.offsetHeight + 'px'
        void pill.offsetWidth
        pill.style.transition = suspended
      } else {
        pill.style.transform = 'translate(' + btn.offsetLeft + 'px,' + btn.offsetTop + 'px)'
        pill.style.width = btn.offsetWidth + 'px'
        pill.style.height = btn.offsetHeight + 'px'
      }
      pill.style.opacity = '1'
    }

    function refresh() {
      var sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide()
      var range = sel.getRangeAt(0)
      var allowed =
        transcriptOf(range.commonAncestorContainer) !== null ||
        !inEditor(range.commonAncestorContainer)
      if (!allowed) return hide()
      var text = sel.toString().replace(/\u00a0/g, ' ').trim()
      if (!text) return hide()
      var rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return hide()
      saved = text
      showAt(rect)
    }

    /** Put the caret at the end of the editor's last text node. */
    function placeCaretAtEnd(editor) {
      var range = document.createRange()
      var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null)
      var last = null
      var node = walker.nextNode()
      while (node) {
        if (node.nodeValue && node.nodeValue.length) last = node
        node = walker.nextNode()
      }
      if (last) {
        range.setStart(last, last.nodeValue.length)
        range.collapse(true)
      } else {
        range.selectNodeContents(editor)
        range.collapse(false)
      }
      var sel = window.getSelection()
      if (!sel) return
      sel.removeAllRanges()
      sel.addRange(range)
      try {
        document.dispatchEvent(new Event('selectionchange'))
      } catch (error) {
        /* ignore */
      }
    }

    function insertQuote(text) {
      var editor = composerEditor()
      if (!editor) return
      var payload = quotePayload(text)
      var baseline = editor.textContent || ''

      function finish() {
        try {
          var live = window.getSelection()
          if (live) live.removeAllRanges()
        } catch (error) {
          /* ignore */
        }
        saved = ''
        hide()
      }

      function attempt(step) {
        // Caret first, focus second: Lexical adopts the DOM range when the
        // editor gains focus. Focusing first leaves it with no selection and
        // the later command is silently dropped.
        placeCaretAtEnd(editor)
        try {
          editor.focus()
        } catch (error) {
          /* ignore */
        }
        try {
          document.dispatchEvent(new Event('selectionchange'))
        } catch (error) {
          /* ignore */
        }

        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            placeCaretAtEnd(editor)
            try {
              if (step === 'exec') {
                document.execCommand('insertText', false, payload)
              } else if (step === 'beforeinput') {
                editor.dispatchEvent(
                  new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: payload,
                  }),
                )
              } else {
                var data = new DataTransfer()
                data.setData('text/plain', payload)
                editor.dispatchEvent(
                  new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: data,
                  }),
                )
              }
            } catch (error) {
              /* the verification below decides what happened */
            }

            window.requestAnimationFrame(function () {
              if ((editor.textContent || '') !== baseline) return finish()
              if (step === 'exec') return attempt('beforeinput')
              if (step === 'beforeinput') return attempt('paste')
              finish()
            })
          })
        })
      }

      attempt('exec')
    }

    function flashCopy(state, opts) {
      opts = opts || {}
      var label = copyBtn.querySelector('.dsh-quote-label')
      window.clearTimeout(flashTimer)
      window.clearTimeout(closeTimer)
      if (opts.copied) copyBtn.classList.add('is-copied')
      label.textContent = state

      flashTimer = window.setTimeout(
        function () {
          if (opts.hide) {
            // Fade the bar out, then take it off screen.
            root.classList.add('is-closing')
            closeTimer = window.setTimeout(function () {
              copyBtn.classList.remove('is-copied')
              label.textContent = '复制引用'
              hide()
            }, 200)
            return
          }
          copyBtn.classList.remove('is-copied')
          label.textContent = '复制引用'
        },
        opts.copied ? 1500 : 1200,
      )
    }

    function copyQuote(text) {
      var payload = quotePayload(text)
      function done() {
        flashCopy('已复制', { copied: true, hide: true })
      }
      function fallback() {
        try {
          var area = document.createElement('textarea')
          area.value = payload
          area.setAttribute('readonly', '')
          area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          area.remove()
          done()
        } catch (error) {
          flashCopy('复制失败')
        }
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(payload).then(done, fallback)
          return
        }
      } catch (error) {
        /* fall through */
      }
      fallback()
    }

    function onMouseUp() {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 0)
    }
    function onSelectionChange() {
      var sel = window.getSelection()
      if (!sel || sel.isCollapsed) hide()
    }
    function onDocMouseDown(event) {
      if (!root.contains(event.target)) hide()
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') return hide()
      var mod = event.ctrlKey || event.metaKey
      if (mod && !event.altKey && !event.shiftKey && (event.key === 'l' || event.key === 'L')) {
        if (!saved) return
        event.preventDefault()
        event.stopPropagation()
        insertQuote(saved)
      }
    }
    function onViewportChange() {
      hide()
    }
    function onMouseMove(event) {
      if (reduceMotion) return
      var target = event.target
      var btn = target && typeof target.closest === 'function' ? target.closest('button') : null
      if (!btn || !bar.contains(btn)) return
      var rect = btn.getBoundingClientRect()
      btn.style.setProperty('--mx', Math.round(event.clientX - rect.left) + 'px')
      btn.style.setProperty('--my', Math.round(event.clientY - rect.top) + 'px')
    }

    // Keep the transcript selection alive while the toolbar is pressed.
    bar.addEventListener('mousedown', function (event) {
      event.preventDefault()
      event.stopPropagation()
    })
    bar.addEventListener('mousemove', onMouseMove)
    bar.addEventListener('mouseover', function (event) {
      var target = event.target
      var btn = target && typeof target.closest === 'function' ? target.closest('button') : null
      if (btn && bar.contains(btn)) pillTo(btn, true)
    })
    bar.addEventListener('mouseleave', function () {
      pillTo(null, false)
    })
    quoteBtn.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (saved) insertQuote(saved)
    })
    copyBtn.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (saved) copyQuote(saved)
    })

    document.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)

    // Boot self-test: one key the host can read back, so a broken build shows
    // up without DevTools. Never throws, never blocks the UI.
    try {
      localStorage.setItem(
        'dsh-quote-selection:selftest',
        JSON.stringify({
          at: new Date().toISOString(),
          toolbar: !!document.getElementById(ROOT_ID),
          buttons: document.querySelectorAll('#' + ROOT_ID + ' button').length,
          icons: document.querySelectorAll('#' + ROOT_ID + ' svg').length,
          caret: !!document.querySelector('#' + ROOT_ID + ' .dsh-quote-caret'),
          pill: !!document.querySelector('#' + ROOT_ID + ' .dsh-quote-pill'),
          // Regression guard: the root disables pointer events, so the bar must
          // opt back in or nothing in it can be clicked.
          clickable: (function () {
            var el = document.querySelector('#' + ROOT_ID + '>div')
            return el ? getComputedStyle(el).pointerEvents : 'missing'
          })(),
          style: !!document.querySelector('style[data-dsh-quote-selection]'),
          flow: !!document.querySelector('[data-slot="' + FLOW_SLOT + '"]'),
          editors: document.querySelectorAll(EDITOR_SELECTOR).length,
          payload: quotePayload('a\nb'),
        }),
      )
    } catch (error) {
      /* private mode */
    }
  }

  install()
})()
