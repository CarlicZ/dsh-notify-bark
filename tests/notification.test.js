import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
} from '../lib/settings-store.js'
import {
  contentFromSummary,
  fallbackContent,
  notificationTitle,
  summaryMaterial,
} from '../lib/notification.js'
import { charLength, clipChars, collapseWhitespace, truncateChars } from '../lib/text.js'

const SETTINGS = { ...DEFAULT_SETTINGS }

test('charLength counts grapheme clusters, not UTF-16 units', () => {
  assert.equal(charLength('中文abc'), 5)
  assert.equal(charLength('😀'), 1)
  assert.equal(charLength('👨‍👩‍👧‍👦'), 1)
  assert.equal(charLength(''), 0)
})

test('truncateChars and clipChars honour the grapheme budget', () => {
  assert.equal(truncateChars('abcdef', 3), 'abc')
  assert.equal(truncateChars('abcdef', 0), '')
  assert.equal(truncateChars('😀😀😀', 2), '😀😀')
  assert.equal(clipChars('abcdef', 3), 'ab…')
  assert.equal(clipChars('abcdef', 1), '…')
  assert.equal(clipChars('abc', 3), 'abc')
  assert.equal(charLength(clipChars('x'.repeat(100), 20)), 20)
})

test('collapseWhitespace flattens newlines and trims', () => {
  assert.equal(collapseWhitespace('  a\n\n b\tc  '), 'a b c')
})

test('notificationTitle uses the workspace name and the default 20-character budget', () => {
  assert.equal(notificationTitle('dsh-notify-bark', SETTINGS), 'dsh-notify-bark')
  const long = notificationTitle('a-very-long-workspace-name-for-a-project', SETTINGS)
  assert.equal(charLength(long), 20)
  assert.ok(long.endsWith('…'))
  assert.equal(notificationTitle('project', { ...SETTINGS, titleMaxChars: 3 }), 'pr…')
})

test('summaryMaterial stays structured and omits disabled assistant replies', () => {
  const intent = {
    flag: 'approval',
    headline: '🔐 等待你的授权',
    detail: '工具 bash 需要授权：命令需要授权',
    toolName: 'bash',
    toolArguments: '{"command":"rm -rf /tmp/x"}',
    reason: '命令需要授权',
    callId: 'c1',
  }
  const enabled = JSON.parse(summaryMaterial({
    intent,
    settings: { ...SETTINGS, includeAssistantText: true },
    assistantText: '我准备清理临时目录。',
    workspaceName: 'my-project',
  }))
  assert.equal(enabled.event, 'approval')
  assert.equal(enabled.workspace, 'my-project')
  assert.equal(enabled.tool, 'bash')
  assert.equal(enabled.toolArguments, '{"command":"rm -rf /tmp/x"}')
  assert.equal(enabled.reason, '命令需要授权')
  assert.equal(enabled.assistantReply, '我准备清理临时目录。')

  const disabled = JSON.parse(summaryMaterial({
    intent: { flag: 'completed', headline: '✅ 任务完成', detail: '' },
    settings: { ...SETTINGS, includeAssistantText: false },
    assistantText: '我准备清理临时目录。',
    workspaceName: 'my-project',
  }))
  assert.equal('assistantReply' in disabled, false)
})

test('fallbackContent fits the content budget and keeps the headline first', () => {
  const intent = { flag: 'completed', headline: '✅ 任务完成', detail: '修复了设置页的字数限制' }
  const body = fallbackContent(intent, { ...SETTINGS, contentMaxChars: 10 }, '')
  assert.equal(charLength(body), 10)
  assert.ok(body.startsWith('✅ 任务完成'))
  assert.ok(body.endsWith('…'))

  const withReply = fallbackContent(intent, { ...SETTINGS, contentMaxChars: 200 }, '已经推送成功')
  assert.ok(withReply.includes('已经推送成功'))
  const withoutReply = fallbackContent(intent, { ...SETTINGS, includeAssistantText: false, contentMaxChars: 200 }, '已经推送成功')
  assert.ok(!withoutReply.includes('已经推送成功'))
})

test('fallbackContent names the tool when the event has no detail', () => {
  const body = fallbackContent({ flag: 'approval', headline: '🔐 等待你的授权', detail: '', toolName: 'bash' }, SETTINGS, '')
  assert.ok(body.includes('bash'))
})

test('contentFromSummary prefers a non-empty summary and otherwise falls back', () => {
  const intent = { flag: 'completed', headline: '✅ 任务完成', detail: 'detail' }
  assert.equal(contentFromSummary('  已修复设置页字数  ', intent, SETTINGS, ''), '已修复设置页字数')
  assert.equal(contentFromSummary('', intent, SETTINGS, ''), '✅ 任务完成：detail')
  assert.equal(contentFromSummary(undefined, intent, SETTINGS, ''), '✅ 任务完成：detail')
  const clipped = contentFromSummary('这'.repeat(80), intent, SETTINGS, '')
  assert.equal(charLength(clipped), 50)
})
