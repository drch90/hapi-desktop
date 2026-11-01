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
