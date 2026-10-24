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

  var GRADIENT =
    'linear-gradient(90deg,#FF4D4F,#FF9F1C,#FACC15,#22C55E,#06B6D4,#3B82F6,#8B5CF6,#EC4899,#FF4D4F)'
  var GRADIENT_COPY =
    'linear-gradient(90deg,#06B6D4,#3B82F6,#8B5CF6,#EC4899,#FF4D4F,#FF9F1C,#FACC15,#22C55E,#06B6D4)'
  var GRADIENT_DARK =
    'linear-gradient(90deg,#FF7875,#FFC069,#FFE066,#5CE68A,#4DD6E8,#6BA6FF,#B197FF,#FF86C8,#FF7875)'
  var GRADIENT_DARK_COPY =
    'linear-gradient(90deg,#4DD6E8,#6BA6FF,#B197FF,#FF86C8,#FF7875,#FFC069,#FFE066,#5CE68A,#4DD6E8)'

  var CSS =
    '#' + ROOT_ID + '{position:fixed;z-index:2147483000;display:none;pointer-events:none;}' +
    '#' + ROOT_ID + '[data-open="true"]{display:block;}' +
    '#' + ROOT_ID + '>div{position:relative;isolation:isolate;pointer-events:auto;display:inline-flex;' +
    'align-items:stretch;border-radius:10px;padding:0;border:1px solid transparent;' +
    'background:linear-gradient(#fff,#fff) padding-box,' +
    'linear-gradient(135deg,#FF4D4F,#FACC15,#22C55E,#06B6D4,#8B5CF6,#EC4899) border-box;' +
    'box-shadow:0 6px 20px rgba(139,92,246,.2);}' +
    '#' + ROOT_ID + ' button{position:relative;margin:0;border:0;background-color:transparent;' +
    'font:600 13px/1.3 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;' +
    'letter-spacing:.01em;cursor:pointer;white-space:nowrap;user-select:none;' +
    'display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:9px;' +
    'background-image:' + GRADIENT + ';background-size:200% 100%;background-repeat:repeat;' +
    '-webkit-background-clip:text;background-clip:text;' +
    '-webkit-text-fill-color:transparent;color:transparent;' +
    'animation:dsh-quote-flow 3.5s linear infinite;transition:box-shadow .15s ease;}' +
    '#' + ROOT_ID + ' button+button{background-image:' + GRADIENT_COPY + ';' +
    'border-left:1px solid rgba(139,92,246,.14);}' +
    '#' + ROOT_ID + ' button:hover{animation-duration:1.5s;box-shadow:0 0 12px rgba(139,92,246,.25);}' +
    '#' + ROOT_ID + ' button:active{box-shadow:0 0 8px rgba(139,92,246,.35);}' +
    '#' + ROOT_ID + ' button:focus-visible{outline:2px solid #8B5CF6;outline-offset:-2px;}' +
    '#' + ROOT_ID + ' .dsh-quote-glyph{font-size:14px;line-height:1;}' +
    '#' + ROOT_ID + ' button.is-copied{background-image:linear-gradient(90deg,#22C55E,#06B6D4,#22C55E);' +
    'animation-duration:2s;}' +
    '@keyframes dsh-quote-flow{from{background-position:0% 0;}to{background-position:200% 0;}}' +
    '::selection{background:rgba(139,92,246,.18);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + '>div{box-shadow:0 6px 20px rgba(139,92,246,.28);' +
    'background:linear-gradient(#26282c,#26282c) padding-box,' +
    'linear-gradient(135deg,#FF7875,#FFE066,#5CE68A,#4DD6E8,#B197FF,#FF86C8) border-box;}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button{background-image:' + GRADIENT_DARK + ';}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button+button{background-image:' + GRADIENT_DARK_COPY + ';' +
    'border-left-color:rgba(255,255,255,.16);}' +
    'body[data-ds-dark-theme] #' + ROOT_ID + ' button.is-copied{background-image:linear-gradient(90deg,#5CE68A,#4DD6E8,#5CE68A);}' +
    '@media (prefers-reduced-motion: reduce){#' + ROOT_ID + ' button{animation:none;background-position:0% 0;}}'

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
      var glyph = document.createElement('span')
      glyph.className = 'dsh-quote-glyph'
      glyph.textContent = glyphText
      glyph.setAttribute('aria-hidden', 'true')
      var label = document.createElement('span')
      label.textContent = labelText
      btn.appendChild(glyph)
      btn.appendChild(label)
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
      var label = copyBtn.lastChild
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
