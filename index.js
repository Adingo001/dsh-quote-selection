/**
 * dsh-quote-selection — host half.
 *
 * The feature is a classic page script served from this package and loaded by a
 * tiny inline bootstrap:
 *
 *   1. register an exact route `/__quotesel/inject.js` that reads inject.js
 *      fresh on every request (no-store), so editing the script only needs a
 *      page reload;
 *   2. push one inline `script` row that appends `<script src="...?t=now">`.
 *
 * The inline row is what the desktop boot and the served index both apply, so
 * this bypasses the client-module graph entirely (which only prefetches
 * `dsh.client` bundles nothing imports).
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-quote-selection'

const ROUTE = '/__quotesel/inject.js'
const SCRIPT_PATH = fileURLToPath(new URL('./inject.js', import.meta.url))
const LOG_PATH = join(homedir(), '.dsh', 'quote-selection-host.log')

/** Inline bootstrap: load the real script with a cache-busting query. */
const LOADER =
  '(function(){try{var s=document.createElement("script");' +
  `s.src=${JSON.stringify(ROUTE)}+"?t="+Date.now();` +
  's.async=false;document.head.appendChild(s)}catch(e){}})()'

function log(line) {
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* diagnostics only */
  }
}

function serveScript(req, res) {
  try {
    const text = readFileSync(SCRIPT_PATH, 'utf8')
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    })
    res.end(text)
  } catch (error) {
    log(`serve failed: ${error instanceof Error ? error.message : String(error)}`)
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dsh-quote-selection: cannot read inject.js')
  }
}

function register(ctx) {
  log('webServer available')

  try {
    const route = { kind: 'exact', path: ROUTE, handler: serveScript }
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => ctx.webServer.register(route), 'dsh-quote-selection: script route')
    } else {
      ctx.webServer.register(route)
    }
    log(`route registered ${ROUTE}`)
  } catch (error) {
    log(`route failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  ctx.on('webserver/index-inject', rows => {
    try {
      // Inline the whole script: the desktop boot applies `script` rows by
      // setting textContent, and an inline body row is the path that already
      // runs. An external `script-src` load through the `dsh-app://` forward
      // did not execute in practice.
      const text = readFileSync(SCRIPT_PATH, 'utf8')
      rows.push({ kind: 'script', text, placement: 'body' })
      log(`inline row pushed (${text.length} bytes)`)
    } catch (error) {
      log(`inline row failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

export function apply(ctx) {
  log('apply() called')

  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], scoped => register(scoped))
      return
    }
  } catch (error) {
    log(`ctx.inject failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  register(ctx)
}
