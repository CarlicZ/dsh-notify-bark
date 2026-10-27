import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

const SETTINGS = {
  enabled: true,
  events: {
    completed: true, error: true, blocked: true, aborted: false,
    maxTokens: true, interrupted: true, question: true, approval: true, planReview: false,
  },
  includeAssistantText: true,
  titleMaxChars: 20,
  contentMaxChars: 50,
  group: 'DeepSeek Harness',
}

/** Minimal snapshot store with the shape the client store exposes. */
function createSnapshotStore(init) {
  let state = structuredClone(init)
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(mutator) {
      const draft = structuredClone(state)
      mutator(draft)
      state = draft
      for (const listener of [...listeners]) listener()
    },
    set(next) {
      state = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Load the shipped bundle and register its settings section through a fake client ctx. */
function mountSection() {
  const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
  let registration
  // eslint-disable-next-line no-new-func
  new Function('window', readFileSync(bundlePath, 'utf8'))({ __ModuleLoader__: { load: (value) => { registration = value } } })
  const require = (specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
    throw new Error('unexpected client require: ' + specifier)
  }
  const exports = registration.factory(require)

  const registered = []
  const namespace = {
    async get() {
      return { ok: true, value: { settings: SETTINGS, status: { configured: false, masked: '' } } }
    },
    async set() {
      return { ok: true, value: { saved: true } }
    },
    async test() {
      return { ok: true, value: { sent: true } }
    },
  }
  const remote = { async $mount() { return () => Promise.resolve() } }
  const scope = {
    get: (service) => (service === 'remote' ? remote : service === 'remote.barkNotify' ? namespace : undefined),
    locale: { bind: () => (key) => key },
    slots: {
      inject(_key, callback) { callback() },
      register(options, component) { registered.push({ options, component }) },
    },
    effect(callback) { callback() },
  }
  const ctx = {
    remote,
    effect(callback) { callback() },
    inject(_services, callback) { callback(scope) },
    locale: { register() {} },
  }
  exports.apply(ctx)
  return registered[0]
}

test('settings section renders the two character budgets and the .env hint', async () => {
  const entry = mountSection()
  assert.equal(entry.options.id, 'bark-notify')
  const injected = entry.options.inject()
  // The controller loads asynchronously from the fake namespace.
  await new Promise((resolve) => setTimeout(resolve, 20))

  const html = renderToStaticMarkup(React.createElement(entry.component, {
    ...injected,
    useSnapshot: (selector) => selector(injected.hooks.snapshot.getSnapshot()),
  }))

  assert.ok(html.includes('titleMaxChars'))
  assert.ok(html.includes('contentMaxChars'))
  assert.ok(html.includes('limitHint'))
  assert.ok(html.includes('envHint'))
  assert.ok(html.includes('value="20"'))
  assert.ok(html.includes('value="50"'))
  assert.ok(!html.includes('maxBodyChars'))
})
