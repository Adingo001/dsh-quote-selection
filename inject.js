/**
 * dsh-quote-selection — injected page script.
 *
 * Select text in the transcript and a small toolbar appears above the
 * selection:
 *
 *   [“ 引用]  [⧉ 复制引用]
 *
 * 「引用」 appends the selection to the composer as a Markdown blockquote;
 * 「复制引用」 puts the same blockquote on the clipboard. Ctrl/Cmd+L does the
 * same as 「引用」 while a selection is held.
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
 */
;(function () {
  'use strict'

  if (window.__dshQuoteSelectionInstalled) return
  window.__dshQuoteSelectionInstalled = true

  var ROOT_ID = 'dsh-quote-selection-root'
  var MAX_CHARS = 4000
  var FLOW_SLOT = 'conversation.chat.flow'
  var EDITOR_SELECTOR = '[data-lexical-editor="true"]'

  var INK = 'linear-gradient(100deg,#4F46E5,#7C3AED,#C026D3)'
  var INK_COPY = 'linear-gradient(100deg,#0891B2,#4F46E5)'
  var INK_COPIED = 'linear-gradient(100deg,#059669,#0D9488)'
  var INK_DARK = 'linear-gradient(100deg,#818CF8,#A78BFA,#E879F9)'
  var INK_DARK_COPY = 'linear-gradient(100deg,#22D3EE,#818CF8)'
  var INK_DARK_COPIED = 'linear-gradient(100deg,#34D399,#2DD4BF)'

  var CSS =
    '@property --dsh-quote-a{syntax:"<angle>";initial-value:0deg;inherits:false;}' +
    '#' + ROOT_ID + '{position:fixed;z-index:2147483000;display:none;pointer-events:none;}' +
    '#' + ROOT_ID + '[data-open="true"]{display:block;}' +
    // frosted bar: translucent white, blur, 12px radius, 4px padding
    '#' + ROOT_ID + '>div{position:relative;display:inline-flex;align-items:stretch;padding:4px;' +
    'border-radius:12px;border:1px solid rgba(20,20,40,.06);background:rgba(255,255,255,.72);' +
    '-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);' +
    'box-shadow:0 0 0 1px rgba(20,20,40,.06),0 2px 6px rgba(20,20,40,.05),0 12px 32px rgba(99,102,241,.14);' +
    'animation:dsh-quote-in 120ms ease-out both;}' +
    // 1px masked conic highlight, ~30% of the perimeter, one lap every 9s
    '#' + ROOT_ID + '>div::before{content:"";position:absolute;inset:-1px;border-radius:12px;padding:1px;' +
    'pointer-events:none;' +
    'background:conic-gradient(from var(--dsh-quote-a),transparent .00turn,#818CF8 .08turn,' +
    '#C084FC .16turn,transparent .24turn,transparent 1turn);' +
    '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
    'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
    '-webkit-mask-composite:xor;mask-composite:exclude;' +
    'animation:dsh-quote-sweep 9s linear infinite;}' +
    '#' + ROOT_ID + ' button{position:relative;margin:0;border:0;background:transparent;padding:0;' +
    'border-radius:8px;cursor:pointer;white-space:nowrap;transition:background-color .2s ease;}' +
    '#' + ROOT_ID + ' button:hover{background:rgba(99,102,241,.08);}' +
    '#' + ROOT_ID + ' button:active{background:rgba(99,102,241,.14);}' +
    '#' + ROOT_ID + ' button:focus-visible{outline:2px solid #818CF8;outline-offset:2px;}' +
    // gradient lives on the ink span so the button keeps a real background for hover
    '#' + ROOT_ID + ' .dsh-quote-ink{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;' +
    'font:500 13px/1.3 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;' +
    'letter-spacing:.01em;background-image:' + INK + ';' +
    '-webkit-background-clip:text;background-clip:text;' +
    '-webkit-text-fill-color:transparent;color:transparent;}' +
    '#' + ROOT_ID + ' button+button .dsh-quote-ink{background-image:' + INK_COPY + ';}' +
    // short hairline between the two actions
    '#' + ROOT_ID + ' button+button::before{content:"";position:absolute;left:-1px;top:50%;' +
    'transform:translateY(-50%);width:1px;height:14px;background:rgba(0,0,0,.08);}' +
    '#' + ROOT_ID + ' .dsh-quote-glyph{font-size:14px;line-height:1;}' +
    '#' + ROOT_ID + ' button.is-copied .dsh-quote-ink{background-image:' + INK_COPIED + ';}' +
    '@keyframes dsh-quote-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}' +
    '@keyframes dsh-quote-sweep{to{--dsh-quote-a:1turn;}}' +
    '::selection{background:rgba(129,140,248,.22);color:inherit;}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + '>div{background:rgba(24,24,32,.72);' +
    'border-color:rgba(255,255,255,.08);' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.4),0 2px 6px rgba(0,0,0,.35),0 12px 32px rgba(139,92,246,.18);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' .dsh-quote-ink{background-image:' + INK_DARK + ';}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button+button .dsh-quote-ink{background-image:' + INK_DARK_COPY + ';}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button+button::before{background:rgba(255,255,255,.10);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button:hover{background:rgba(129,140,248,.12);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button:active{background:rgba(129,140,248,.18);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button.is-copied .dsh-quote-ink{background-image:' + INK_DARK_COPIED + ';}' +
    '@media (prefers-reduced-motion: reduce){' +
    '#' + ROOT_ID + '>div{animation:none;}' +
    '#' + ROOT_ID + '>div::before{animation:none;}}'

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

  function install() {
    if (document.getElementById(ROOT_ID)) return
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', install, { once: true })
      return
    }

    var style = document.createElement('style')
    style.setAttribute('data-dsh-quote-selection', 'true')
    style.textContent = CSS

    var root = document.createElement('div')
    root.id = ROOT_ID
    root.dataset.open = 'false'

    var bar = document.createElement('div')

    function makeButton(glyphText, labelText, title) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.title = title
      btn.setAttribute('aria-label', title)
      var ink = document.createElement('span')
      ink.className = 'dsh-quote-ink'
      var glyph = document.createElement('span')
      glyph.className = 'dsh-quote-glyph'
      glyph.textContent = glyphText
      glyph.setAttribute('aria-hidden', 'true')
      var label = document.createElement('span')
      label.className = 'dsh-quote-label'
      label.textContent = labelText
      ink.appendChild(glyph)
      ink.appendChild(label)
      btn.appendChild(ink)
      return btn
    }

    var quoteBtn = makeButton('“', '引用', '引用所选内容到输入框（Ctrl+L）')
    var copyBtn = makeButton('⧉', '复制引用', '复制所选内容的引用到剪贴板')
    bar.appendChild(quoteBtn)
    bar.appendChild(copyBtn)
    root.appendChild(bar)
    document.head.appendChild(style)
    document.body.appendChild(root)

    var saved = ''
    var timer = 0
    var flashTimer = 0

    function hide() {
      root.dataset.open = 'false'
    }

    function showAt(rect) {
      root.dataset.open = 'true'
      var box = bar.getBoundingClientRect()
      var w = box.width || 150
      var h = box.height || 26
      var top = rect.top - h - 8
      if (top < 8) top = rect.bottom + 8
      var left = rect.left + rect.width / 2 - w / 2
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8))
      root.style.left = Math.round(left) + 'px'
      root.style.top = Math.round(top) + 'px'
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
      if (opts.copied) copyBtn.classList.add('is-copied')
      label.textContent = state
      flashTimer = window.setTimeout(
        function () {
          copyBtn.classList.remove('is-copied')
          label.textContent = '复制引用'
          // A successful copy dissolves the toolbar; a failure leaves it up.
          if (opts.hide) hide()
        },
        opts.copied ? 1500 : 1200,
      )
    }

    function copyQuote(text) {
      var payload = quotePayload(text)
      function done() {
        flashCopy('✓ 已复制', { copied: true, hide: true })
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

    // Keep the transcript selection alive while the toolbar is pressed.
    bar.addEventListener('mousedown', function (event) {
      event.preventDefault()
      event.stopPropagation()
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
