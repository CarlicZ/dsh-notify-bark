import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSummary,
  summarizeContent,
  summarySystemPrompt,
} from '../lib/summarize.js'

/** Minimal Host-context stub exposing only the two services under test. */
function fakeContext({ llm, defaults } = {}) {
  return {
    get: (key) => (key === 'llm' ? llm : key === 'agentDefaultModel' ? defaults : undefined),
  }
}

/** Default-model stub: one flash-like route. */
function defaults(selection = { provider: 'deepseek-official', model: 'deepseek-flash' }) {
  return { currentSelection: () => selection }
}

/** LLM stub that records its inputs and streams one scripted answer. */
function llmStub({ text = '已完成任务', finish = { kind: 'stop' }, capture } = {}) {
  return {
    async prepareCall(config, _signal, configure) {
      const model = { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }
      const controls = configure === undefined ? {} : configure({}, model)
      capture?.push({ prepare: config, controls })
      return {
        config: { ...config, ...controls },
        stream(options) {
          capture?.push({ options })
          return (async function* stream() {
            yield { type: 'text-delta', index: 0, text }
            yield { type: 'finish', reason: finish }
          })()
        },
      }
    },
  }
}

test('normalizeSummary strips labels, fences, quotes, and newlines', () => {
  assert.equal(normalizeSummary('正文：已修复设置页。\n第二行', 50), '已修复设置页。')
  assert.equal(normalizeSummary('```text\n✅ 任务完成\n```', 50), '✅ 任务完成')
  assert.equal(normalizeSummary('“完成”', 50), '完成')
  assert.equal(normalizeSummary('   ', 50), '')
  assert.equal(normalizeSummary('超过预算的一段话', 4), '超过预…')
})

test('summarySystemPrompt carries the character budget', () => {
  assert.ok(summarySystemPrompt(50).includes('不超过 50 个字符'))
  assert.ok(summarySystemPrompt(20).includes('不超过 20 个字符'))
})

test('summarizeContent uses the current default model with the lowest reasoning effort', async () => {
  const capture = []
  const ctx = fakeContext({ llm: llmStub({ text: '✅ 已修复设置页字数', capture }), defaults: defaults() })
  const summary = await summarizeContent(ctx, { material: '{"event":"completed"}', limit: 50 })
  assert.equal(summary, '✅ 已修复设置页字数')

  const prepare = capture.find((entry) => entry.prepare !== undefined)
  assert.equal(prepare.prepare.provider, 'deepseek-official')
  assert.equal(prepare.prepare.model, 'deepseek-flash')
  assert.equal(prepare.prepare.temperature, 0.3)
  assert.equal(prepare.controls.reasoningEffort, 'low')

  const options = capture.find((entry) => entry.options !== undefined).options
  assert.equal(options.system, summarySystemPrompt(50))
  assert.equal(options.messages[0].role, 'user')
  assert.equal(options.messages[0].content[0].text, '{"event":"completed"}')
  assert.equal(options.provider, 'deepseek-official')
  assert.equal(options.model, 'deepseek-flash')
  assert.equal(options.reasoningEffort, 'low')
  // `prepared.stream()` rejects a dispatch whose controls differ from the
  // prepared config, so every control must be identical in both objects.
  assert.equal(options.temperature, prepare.prepare.temperature)
  assert.equal(options.maxTokens, prepare.prepare.maxTokens)
})

test('summarizeContent clips the answer to the requested budget', async () => {
  const ctx = fakeContext({ llm: llmStub({ text: '这是一段很长的总结内容' }), defaults: defaults() })
  const summary = await summarizeContent(ctx, { material: '{}', limit: 5 })
  assert.equal([...summary].length, 5)
})

test('summarizeContent returns undefined on an error finish, an empty answer, or missing services', async () => {
  const errored = fakeContext({
    llm: llmStub({ finish: { kind: 'error', failure: { message: 'boom', code: 'X' } } }),
    defaults: defaults(),
  })
  assert.equal(await summarizeContent(errored, { material: '{}', limit: 50 }), undefined)

  const empty = fakeContext({ llm: llmStub({ text: '   ' }), defaults: defaults() })
  assert.equal(await summarizeContent(empty, { material: '{}', limit: 50 }), undefined)

  assert.equal(await summarizeContent(fakeContext({}), { material: '{}', limit: 50 }), undefined)
  assert.equal(
    await summarizeContent(fakeContext({ llm: llmStub(), defaults: defaults({ provider: '', model: '' }) }), { material: '{}', limit: 50 }),
    undefined,
  )
})

test('summarizeContent refuses to start when the caller is already aborted', async () => {
  let called = false
  const llm = { prepareCall() { called = true; throw new Error('should not run') } }
  const controller = new AbortController()
  controller.abort()
  const summary = await summarizeContent(fakeContext({ llm, defaults: defaults() }), { material: '{}', limit: 50 }, controller.signal)
  assert.equal(summary, undefined)
  assert.equal(called, false)
})

test('summarizeContent falls back silently when preparation throws', async () => {
  const llm = { prepareCall() { throw new Error('no route') } }
  assert.equal(await summarizeContent(fakeContext({ llm, defaults: defaults() }), { material: '{}', limit: 50 }), undefined)
})
