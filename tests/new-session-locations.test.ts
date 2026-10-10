import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadNewSessionLocations, rememberSessionLocation } from '../src/renderer/lib/newSessionLocations'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('new session location preferences', () => {
  it('keeps the last five unique successful directories in use order for each runner', () => {
    for (let i = 1; i <= 7; i++) rememberSessionLocation('hub:account', 'runner-a', `/projects/${i}`)
    rememberSessionLocation('hub:account', 'runner-a', ' /projects/4 ')
    rememberSessionLocation('hub:account', 'runner-b', 'C:\\Projects\\另一目录')
    expect(loadNewSessionLocations('hub:account')).toEqual({
      lastMachineId: 'runner-b',
      paths: {
        'runner-a': ['/projects/4', '/projects/7', '/projects/6', '/projects/5', '/projects/3'],
        'runner-b': ['C:\\Projects\\另一目录'],
      },
    })
    rememberSessionLocation('hub:account', 'runner-a', '/projects/4')
    expect(loadNewSessionLocations('hub:account').lastMachineId).toBe('runner-a')
  })

  it('isolates Hub and account preferences and never imports unscoped Web history', () => {
    localStorage.setItem('hapi:recentPaths', JSON.stringify({ runner: ['/other-account/private'] }))
    localStorage.setItem('hapi:lastMachineId', 'web-runner')
    rememberSessionLocation('https://one.example:alice', 'runner', '/alice')
    rememberSessionLocation('https://one.example:bob', 'runner', '/bob')
    rememberSessionLocation('https://two.example:alice', 'runner', '/other-hub')
    expect(loadNewSessionLocations('https://one.example:alice').paths.runner).toEqual(['/alice'])
    expect(loadNewSessionLocations('https://one.example:bob').paths.runner).toEqual(['/bob'])
    expect(loadNewSessionLocations('https://two.example:alice').paths.runner).toEqual(['/other-hub'])
    expect(loadNewSessionLocations('https://new.example:alice')).toEqual({ paths: {} })
    localStorage.clear()
    expect(loadNewSessionLocations('https://one.example:alice')).toEqual({ paths: {} })
  })

  it.each(['{', 'null', '[]', '{"paths":{"runner":42}}', '{"paths":{"runner":[null]}}'])(
    'recovers from invalid preferences (%s)',
    (stored) => {
      localStorage.setItem('desktop:new-session-locations:scope', stored)
      expect(loadNewSessionLocations('scope')).toEqual({ paths: {} })
      rememberSessionLocation('scope', 'runner', '/projects/current')
      expect(loadNewSessionLocations('scope').paths.runner).toEqual(['/projects/current'])
    },
  )

  it('tolerates unavailable storage without failing a successful launch', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full')
    })
    expect(loadNewSessionLocations('scope')).toEqual({ paths: {} })
    expect(() => rememberSessionLocation('scope', 'runner', '/project')).not.toThrow()
  })
})
