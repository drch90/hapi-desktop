import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultLaunchSettings } from '../src/renderer/components/agent-settings/launchSettings'
import {
  loadPreferredAgent,
  rememberPreferredAgent,
  loadPreferredLaunchSettings,
  rememberLaunchSettings,
} from '../src/renderer/lib/newSessionPreferences'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('new session preferences', () => {
  it('remembers the CLI per Hub and account while keeping the desktop default for new accounts', () => {
    localStorage.setItem('hapi:newSession:agent', 'claude')
    expect(loadPreferredAgent('hub:alice')).toBe('codex')
    rememberPreferredAgent('hub:alice', 'grok')
    rememberPreferredAgent('hub:bob', 'pi')
    expect(loadPreferredAgent('hub:alice')).toBe('grok')
    expect(loadPreferredAgent('hub:bob')).toBe('pi')
    expect(loadPreferredAgent('another-hub:alice')).toBe('codex')
    localStorage.setItem('desktop:new-session-agent:hub:alice', 'gemini')
    expect(loadPreferredAgent('hub:alice')).toBe('codex')
    localStorage.setItem('desktop:new-session-agent:hub:alice', 'removed-cli')
    expect(loadPreferredAgent('hub:alice')).toBe('codex')
  })

  it('isolates launch settings by Hub, account, machine and CLI, remembering the Web fields', () => {
    const selection = {
      ...defaultLaunchSettings('codex'),
      model: 'office-model',
      reasoning: 'high',
      permission: 'yolo' as const,
      mode: 'plan' as const,
      tier: 'fast' as const,
    }
    rememberLaunchSettings('hub:alice', 'runner', 'codex', selection)
    expect(loadPreferredLaunchSettings('hub:alice', 'runner', 'codex')).toEqual({
      ...selection,
      mode: 'default',
      tier: 'standard',
    })
    for (const [scope, machine] of [
      ['hub:bob', 'runner'],
      ['another-hub:alice', 'runner'],
      ['hub:alice', 'other-runner'],
    ]) {
      expect(loadPreferredLaunchSettings(scope, machine, 'codex')).toEqual(defaultLaunchSettings('codex'))
    }
    expect(loadPreferredLaunchSettings('hub:alice', 'runner', 'claude')).toEqual(
      defaultLaunchSettings('claude'),
    )
    localStorage.clear()
    expect(loadPreferredLaunchSettings('hub:alice', 'runner', 'codex')).toEqual(
      defaultLaunchSettings('codex'),
    )
  })

  it('rejects malformed data and foreign permission modes without losing valid fields', () => {
    const key = 'desktop:new-session-launch:v1:["hub:alice","runner","agy"]'
    for (const raw of ['{', 'null', '[]', 'false']) {
      localStorage.setItem(key, raw)
      expect(loadPreferredLaunchSettings('hub:alice', 'runner', 'agy')).toEqual(defaultLaunchSettings('agy'))
    }
    localStorage.setItem(
      key,
      JSON.stringify({ model: 'office-model', effort: 42, reasoning: {}, permission: 'yolo' }),
    )
    expect(loadPreferredLaunchSettings('hub:alice', 'runner', 'agy')).toEqual({
      ...defaultLaunchSettings('agy'),
      model: 'office-model',
    })
  })

  it('does not import unscoped Web launch settings or make storage failures break creation', () => {
    localStorage.setItem(
      'hapi:newSession:launchSettings:v1:runner:codex',
      JSON.stringify({ model: 'private-model', permissionMode: 'yolo' }),
    )
    expect(loadPreferredLaunchSettings('hub:alice', 'runner', 'codex')).toEqual(
      defaultLaunchSettings('codex'),
    )
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Full')
    })
    expect(loadPreferredAgent('hub:alice')).toBe('codex')
    expect(loadPreferredLaunchSettings('hub:alice', 'runner', 'codex')).toEqual(
      defaultLaunchSettings('codex'),
    )
    expect(() => rememberPreferredAgent('hub:alice', 'pi')).not.toThrow()
    expect(() =>
      rememberLaunchSettings('hub:alice', 'runner', 'codex', defaultLaunchSettings('codex')),
    ).not.toThrow()
  })
})
