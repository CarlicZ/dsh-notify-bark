import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  normalizeGroup,
  normalizeIcon,
  parseDotEnv,
  readWorkspaceBarkEnv,
  selectWorkspaceBarkEnv,
  workspaceDirectoryOf,
} from '../lib/workspace-env.js'

test('parseDotEnv handles comments, export, quotes, and trailing comments', () => {
  const values = parseDotEnv([
    '# workspace bark presentation',
    'export DSH_BARK_GROUP="My Group"',
    'DSH_BARK_ICON=https://example.com/icon.png # trailing note',
    "BARK_GROUP='Fallback Group'",
    'EMPTY=',
    'not a pair',
    '1BAD=x',
    'DSH_BARK_GROUP=overridden-later',
  ].join('\r\n'))
  assert.equal(values['DSH_BARK_GROUP'], 'overridden-later')
  assert.equal(values['DSH_BARK_ICON'], 'https://example.com/icon.png')
  assert.equal(values['BARK_GROUP'], 'Fallback Group')
  assert.equal(values['EMPTY'], '')
  assert.equal('not a pair' in values, false)
  assert.equal('1BAD' in values, false)
})

test('parseDotEnv resolves double-quoted escapes', () => {
  const values = parseDotEnv('A="line1\\nline2"')
  assert.equal(values['A'], 'line1\nline2')
})

test('selectWorkspaceBarkEnv prefers DSH_-prefixed keys and validates the icon', () => {
  const selected = selectWorkspaceBarkEnv({
    DSH_BARK_ICON: 'https://example.com/a.png',
    BARK_ICON: 'https://example.com/b.png',
    DSH_BARK_GROUP: 'Project A',
    BARK_GROUP: 'Fallback',
  })
  assert.equal(selected.icon, 'https://example.com/a.png')
  assert.equal(selected.group, 'Project A')

  const fallback = selectWorkspaceBarkEnv({
    BARK_ICON: 'https://example.com/b.png',
    BARK_GROUP: 'Fallback',
  })
  assert.equal(fallback.icon, 'https://example.com/b.png')
  assert.equal(fallback.group, 'Fallback')
})

test('icon overrides must be http(s) URLs', () => {
  assert.equal(normalizeIcon('https://example.com/i.png'), 'https://example.com/i.png')
  assert.equal(normalizeIcon('http://192.168.1.5/i.png'), 'http://192.168.1.5/i.png')
  assert.equal(normalizeIcon('ftp://example.com/i.png'), undefined)
  assert.equal(normalizeIcon('/local/icon.png'), undefined)
  assert.equal(normalizeIcon('   '), undefined)
  assert.equal(normalizeIcon(undefined), undefined)
})

test('group overrides are flattened and clipped', () => {
  assert.equal(normalizeGroup('  My\n Group  '), 'My Group')
  assert.equal(normalizeGroup('   '), undefined)
  assert.ok(normalizeGroup('G'.repeat(100)).length <= 64)
})

test('readWorkspaceBarkEnv reads the workspace .env and tolerates missing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-bark-env-'))
  try {
    await writeFile(join(directory, '.env'), 'DSH_BARK_ICON=https://example.com/p.png\nDSH_BARK_GROUP=Demo\n', 'utf8')
    const env = await readWorkspaceBarkEnv(directory)
    assert.equal(env.icon, 'https://example.com/p.png')
    assert.equal(env.group, 'Demo')
    assert.deepEqual(await readWorkspaceBarkEnv(join(directory, 'missing')), {})
    assert.deepEqual(await readWorkspaceBarkEnv(undefined), {})
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('workspaceDirectoryOf prefers the effective working directory and falls back to the header cwd', () => {
  const session = { id: 's1', header: { cwd: '/from/header' } }
  assert.equal(workspaceDirectoryOf({ get: () => ({ get: () => '/effective' }) }, session), '/effective')
  assert.equal(workspaceDirectoryOf({ get: () => undefined }, session), '/from/header')
  assert.equal(workspaceDirectoryOf({ get: () => ({ get: () => undefined }) }, session), '/from/header')
  assert.equal(workspaceDirectoryOf({ get: () => { throw new Error('gone') } }, session), '/from/header')
  assert.equal(workspaceDirectoryOf({ get: () => undefined }, { id: 's2', header: {} }), undefined)
})
