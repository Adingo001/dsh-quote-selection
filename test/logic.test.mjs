/**
 * Logic tests for dsh-quote-selection.
 *
 * The page script is a classic IIFE with no module system, so the test extracts
 * the real function sources out of inject.js and exercises them directly — the
 * assertions run against shipped code, not a copy.
 *
 * Run: DeepSeek Harness.exe --expose-internals test/logic.test.mjs   (ELECTRON_RUN_AS_NODE=1)
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'inject.js'), 'utf8')

/** Extract one top-level `function name(...) { ... }` body by brace matching. */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`function ${name} not found in inject.js`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const MAX_CHARS = 4000
const FLOW_SLOT = 'conversation.chat.flow'
const EDITOR_SELECTOR = '[data-lexical-editor="true"]'

const quotePayload = new Function(
  'MAX_CHARS',
  `${extractFunction('quotePayload')}; return quotePayload`,
)(MAX_CHARS)

const transcriptOf = new Function(
  'FLOW_SLOT',
  'EDITOR_SELECTOR',
  `${extractFunction('transcriptOf')}; return transcriptOf`,
)(FLOW_SLOT, EDITOR_SELECTOR)

const inEditor = new Function(
  'EDITOR_SELECTOR',
  `${extractFunction('inEditor')}; return inEditor`,
)(EDITOR_SELECTOR)

let passed = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed += 1
    return
  }
  failures.push(`${name}\n  expected ${e}\n  actual   ${a}`)
}

function ok(name, condition) {
  check(name, Boolean(condition), true)
}

// ─── quotePayload ────────────────────────────────────────────────────────────
check('single line', quotePayload('hello'), '> hello\n\n')
check('two lines', quotePayload('a\nb'), '> a\n> b\n\n')
check('blank line keeps marker', quotePayload('a\n\nb'), '> a\n>\n> b\n\n')
check('crlf normalised', quotePayload('a\r\nb'), '> a\n> b\n\n')
check('chinese text', quotePayload('效果最好。'), '> 效果最好。\n\n')
ok('trailing blank line', quotePayload('x').endsWith('\n\n'))
ok('truncates at limit', quotePayload('a'.repeat(MAX_CHARS + 5)).length < MAX_CHARS + 40)
ok('truncation marks ellipsis', quotePayload('a'.repeat(MAX_CHARS + 5)).includes('…'))

// ─── selection gating (stub DOM: only `closest` matters) ─────────────────────
function node(type) {
  const el = {
    nodeType: 1,
    closest(selector) {
      return type && selector.includes(type) ? { type } : null
    },
  }
  return el
}

const flowNode = node('conversation.chat.flow')
const editorNode = node('data-lexical-editor')
const plainNode = { nodeType: 1, closest: () => null }
const textNodeInFlow = { nodeType: 3, parentElement: flowNode, closest: flowNode.closest }

ok('flow is a transcript', transcriptOf(flowNode) !== null)
ok('editor is not a transcript', transcriptOf(editorNode) === null)
check('plain node has no transcript', transcriptOf(plainNode), null)
ok('text node uses parent', transcriptOf(textNodeInFlow) !== null)
ok('editor excluded from quoting', inEditor(editorNode) === true)
ok('plain text is quotable', inEditor(plainNode) === false)
ok('text node parent decides', inEditor(textNodeInFlow) === false)
ok('null node is not quotable', transcriptOf(null) === null)
ok('null node not editable', inEditor(null) === true)

// ─── report ──────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  console.log(`PASS ${passed}/${passed}`)
  process.exit(0)
}
console.log(`FAIL ${failures.length} of ${passed + failures.length}`)
for (const failure of failures) console.log(`- ${failure}`)
process.exit(1)
