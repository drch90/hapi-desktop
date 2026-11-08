import { describe, expect, it } from 'vitest'
import { getBuiltinSlashCommands } from '@hapi/protocol/slashCommands'
import { isComposerCommand, isNativeClearCommand } from '../src/renderer/lib/composerCommands'

const context = {
  commands: [...getBuiltinSlashCommands('codex'), { name: 'project-check' }, { name: 'plugin:review' }],
  supportsNativeClear: false,
}

describe('composer command recognition', () => {
  it.each([
    '/root/项目/src/main.ts',
    ' \t/root/project\n  # keep indentation\n',
    '/tmp',
    '/compact/notes.md',
    '/model.json',
    '/project-check/output.txt',
    '// a code comment',
    '/^pattern$/',
    '/',
  ])('allows literal slash text to be inserted: %j', (text) => {
    expect(isComposerCommand(text, context)).toBe(false)
  })

  it.each(['/comp', '/compact-backup', '/unregistered continue', 'please run /compact'])(
    'does not use autocomplete matches as commands: %j',
    (text) => {
      expect(isComposerCommand(text, context)).toBe(false)
    },
  )

  it.each([
    '/compact',
    ' \t/compact\nkeep the task',
    '/MoDeL example',
    '/project-check src',
    '/plugin:review',
  ])('keeps recognized commands out of priority insertion: %j', (text) => {
    expect(isComposerCommand(text, context)).toBe(true)
  })

  it('uses the current session catalog instead of a global list', () => {
    expect(isComposerCommand('/project-check src', { commands: [], supportsNativeClear: false })).toBe(false)
    expect(isComposerCommand('/project-check src', context)).toBe(true)
  })

  it('preserves native clear and new handling without a discovered command catalog', () => {
    const shared = { commands: [], supportsNativeClear: true }
    expect(isComposerCommand(' /clear\n', shared)).toBe(true)
    expect(isComposerCommand(' /new\n', shared)).toBe(true)
    expect(isComposerCommand('/new', { ...shared, supportsNativeClear: false })).toBe(false)
    expect(isComposerCommand('/new/file.txt', shared)).toBe(false)
    expect(isComposerCommand('/new with arguments', shared)).toBe(false)
  })
})

describe('native conversation reset', () => {
  it.each(['/clear', ' \t/new\n'])('accepts the complete command %j', (text) => {
    expect(isNativeClearCommand(text)).toBe(true)
  })

  it.each(['/clear/notes', '/new file', 'please /clear', '/NEW'])('does not reset for %j', (text) => {
    expect(isNativeClearCommand(text)).toBe(false)
  })
})

describe('Antigravity command delivery', () => {
  const agy = { agent: 'agy', commands: getBuiltinSlashCommands('agy'), supportsNativeClear: false }

  it('offers native commands without inheriting Claude diagnostics', () => {
    const names = agy.commands.map((command) => command.name)
    expect(names).toEqual([
      'help',
      'usage',
      'context',
      'compact',
      'clear',
      'status',
      'model',
      'effort',
      'plan',
      'auto',
      'default',
      'permissions',
    ])
    expect(names).not.toContain('doctor')
    expect(names).not.toContain('cost')
  })

  it.each([
    '/usage',
    '/model default',
    '/effort high',
    '/auto',
    '/permissions plan',
    '/quota',
    '/new',
    '/PERMISSION auto',
  ])('keeps %s out of priority insertion', (text) => {
    expect(isComposerCommand(text, agy)).toBe(true)
  })

  it('keeps aliases scoped to Antigravity and preserves literal paths', () => {
    expect(isComposerCommand('/quota', context)).toBe(false)
    expect(isComposerCommand('/new', context)).toBe(false)
    for (const text of ['/usage/report.txt', '/new/task', '/quota.json', 'please run /usage']) {
      expect(isComposerCommand(text, agy)).toBe(false)
    }
  })
})
