import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Config,
  CONTENT_MAX_CHARS_LIMIT,
  DEFAULT_SETTINGS,
  EVENT_META,
  TITLE_MAX_CHARS_LIMIT,
  TURN_END_EVENT_FLAG,
  clampCharLimit,
  maskBarkUrl,
  readBarkSettings,
  sanitizeBarkUrl,
} from '../lib/settings-store.js'

test('defaults ship with the documented event toggles and budgets', () => {
  assert.equal(DEFAULT_SETTINGS.enabled, true)
  assert.equal(DEFAULT_SETTINGS.events.completed, true)
  assert.equal(DEFAULT_SETTINGS.events.error, true)
  assert.equal(DEFAULT_SETTINGS.events.blocked, true)
  assert.equal(DEFAULT_SETTINGS.events.aborted, false)
  assert.equal(DEFAULT_SETTINGS.events.maxTokens, true)
  assert.equal(DEFAULT_SETTINGS.events.interrupted, true)
  assert.equal(DEFAULT_SETTINGS.events.question, true)
  assert.equal(DEFAULT_SETTINGS.events.approval, true)
  assert.equal(DEFAULT_SETTINGS.events.planReview, false)
  assert.equal(DEFAULT_SETTINGS.includeAssistantText, true)
  assert.equal(DEFAULT_SETTINGS.titleMaxChars, 20)
  assert.equal(DEFAULT_SETTINGS.contentMaxChars, 50)
  assert.equal(DEFAULT_SETTINGS.group, 'DeepSeek Harness')
})

test('turn/end reason kinds map onto the six official flags', () => {
  assert.equal(TURN_END_EVENT_FLAG['completed'], 'completed')
  assert.equal(TURN_END_EVENT_FLAG['error'], 'error')
  assert.equal(TURN_END_EVENT_FLAG['blocked'], 'blocked')
  assert.equal(TURN_END_EVENT_FLAG['aborted'], 'aborted')
  assert.equal(TURN_END_EVENT_FLAG['max-tokens'], 'maxTokens')
  assert.equal(TURN_END_EVENT_FLAG['interrupted'], 'interrupted')
  // Unknown (plugin-extension) kinds stay silent.
  assert.equal(TURN_END_EVENT_FLAG['mystery'], undefined)
  // DSH 0.2.1's fork-seed closer is not a live notification.
  assert.equal(TURN_END_EVENT_FLAG['forked'], undefined)
})

test('event levels follow the agreed mapping', () => {
  assert.equal(EVENT_META.completed.level, 'active')
  assert.equal(EVENT_META.question.level, 'timeSensitive')
  assert.equal(EVENT_META.approval.level, 'timeSensitive')
  assert.equal(EVENT_META.error.level, 'timeSensitive')
  assert.equal(EVENT_META.blocked.level, 'timeSensitive')
  assert.equal(EVENT_META.maxTokens.level, 'timeSensitive')
  assert.equal(EVENT_META.aborted.level, 'passive')
  assert.equal(EVENT_META.interrupted.level, 'timeSensitive')
  assert.equal(EVENT_META.planReview.level, 'timeSensitive')
})

test('sanitizeBarkUrl strips whitespace and trailing slashes', () => {
  assert.equal(sanitizeBarkUrl('  https://api.day.app/abc//  '), 'https://api.day.app/abc')
  assert.equal(sanitizeBarkUrl(''), '')
})

test('maskBarkUrl never reveals the device key', () => {
  const masked = maskBarkUrl('https://api.day.app/DEADBEEF3F82')
  assert.equal(masked.configured, true)
  assert.equal(masked.masked, '••••••••3F82')
  assert.ok(!masked.masked.includes('DEADBEEF'))
  assert.equal(maskBarkUrl('').configured, false)
})

test('Config marks the endpoint secret and every editable field volatile', () => {
  const json = Config.toJSON()
  const root = json.refs[json.uid]
  const metaOf = (field) => json.refs[root.dict[field]].meta
  assert.equal(metaOf('barkUrl').role, 'secret')
  assert.equal(metaOf('barkUrl').volatile, true)
  assert.equal(metaOf('enabled').volatile, true)
  assert.equal(metaOf('events').volatile, true)
  assert.equal(metaOf('titleMaxChars').volatile, true)
  assert.equal(metaOf('contentMaxChars').volatile, true)
  assert.equal(metaOf('group').volatile, true)
})

test('readBarkSettings unwraps volatile references and defaults missing event keys', () => {
  const events = { ...DEFAULT_SETTINGS.events, aborted: true }
  const live = {
    enabled: { get: () => true },
    barkUrl: { get: () => 'https://api.day.app/key' },
    events: { get: () => events },
    includeAssistantText: { get: () => false },
    titleMaxChars: { get: () => 12 },
    contentMaxChars: { get: () => 40 },
    group: { get: () => 'G' },
  }
  const read = readBarkSettings(live)
  assert.equal(read.enabled, true)
  assert.equal(read.barkUrl, 'https://api.day.app/key')
  assert.equal(read.events.aborted, true)
  assert.equal(read.includeAssistantText, false)
  assert.equal(read.titleMaxChars, 12)
  assert.equal(read.contentMaxChars, 40)
  assert.equal(read.group, 'G')
  assert.equal(readBarkSettings({ ...live, events: { get: () => ({ completed: false }) } }).events.error, true)
})

test('clampCharLimit keeps budgets inside their accepted range', () => {
  assert.equal(clampCharLimit(0, TITLE_MAX_CHARS_LIMIT), 1)
  assert.equal(clampCharLimit(-4, CONTENT_MAX_CHARS_LIMIT), 1)
  assert.equal(clampCharLimit(19.6, TITLE_MAX_CHARS_LIMIT), 20)
  assert.equal(clampCharLimit(9999, TITLE_MAX_CHARS_LIMIT), TITLE_MAX_CHARS_LIMIT)
  assert.equal(clampCharLimit(Number.NaN, CONTENT_MAX_CHARS_LIMIT), 1)
})

test('Config parse hands apply stable volatile references', () => {
  const parsed = Config({ barkUrl: 'https://api.day.app/abc', events: { aborted: true } })
  assert.equal(typeof parsed.enabled.get, 'function')
  assert.equal(typeof parsed.events.get, 'function')
  assert.equal(typeof parsed.barkUrl.get, 'function')
  assert.equal(typeof parsed.titleMaxChars.get, 'function')
  assert.equal(typeof parsed.contentMaxChars.get, 'function')
  assert.equal(parsed.barkUrl.get(), 'https://api.day.app/abc')
  assert.equal(parsed.events.get().aborted, true)
  const read = readBarkSettings(parsed)
  assert.equal(read.group, 'DeepSeek Harness')
  assert.equal(read.events.aborted, true)
  assert.equal(read.titleMaxChars, 20)
  assert.equal(read.contentMaxChars, 50)
})
