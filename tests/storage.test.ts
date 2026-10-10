// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const vault = vi.hoisted(() => ({
  available: true,
  backend: 'gnome_libsecret',
  payload: '',
  encryptCalls: 0,
}))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => vault.available,
    getSelectedStorageBackend: () => vault.backend,
    encryptString: (text: string) => {
      vault.encryptCalls++
      vault.payload = text
      return Buffer.from('OS-ENCRYPTED-BLOB')
    },
    decryptString: (data: Buffer) => {
      if (data.toString() !== 'OS-ENCRYPTED-BLOB') throw new Error('Cannot decrypt')
      return vault.payload
    },
  },
}))
import { DesktopStorage } from '../src/main/storage'
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hapi-vault-test-'))
  vault.available = true
  vault.backend = 'gnome_libsecret'
  vault.payload = ''
  vault.encryptCalls = 0
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it('preserves older preferences and defaults Enter to newline, then persists the new choice', () => {
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({
      hubUrl: 'http://192.168.1.5:3006',
      locale: 'zh',
      theme: 'dark',
      groupSessionsByStatus: false,
      notifications: false,
      launchAtLogin: false,
    }),
  )
  const storage = new DesktopStorage(directory)
  expect(storage.settings).toMatchObject({
    enterBehavior: 'newline',
    fontSize: 'normal',
    collapseHistoryByDefault: true,
    codexExplorationCollapsed: true,
    theme: 'dark',
    notifications: false,
  })
  expect(storage.settings).not.toHaveProperty('groupSessionsByStatus')
  storage.saveSettings({
    ...storage.settings,
    enterBehavior: 'send',
    fontSize: 'extra-large',
    collapseHistoryByDefault: false,
    codexExplorationCollapsed: false,
  })
  expect(new DesktopStorage(directory).settings).toEqual({
    ...storage.settings,
    enterBehavior: 'send',
    fontSize: 'extra-large',
  })
})

describe('credential vault contract', () => {
  it('stores only safeStorage output, binds origin and removes credentials on logout', () => {
    const storage = new DesktopStorage(directory)
    storage.saveCredential('https://hub.example', 'synthetic-access-token')
    storage.saveSettings({ ...storage.settings, hubUrl: 'https://hub.example' })
    expect(vault.encryptCalls).toBe(1)
    expect(readFileSync(join(directory, 'credential.bin'), 'utf8')).toBe('OS-ENCRYPTED-BLOB')
    expect(readFileSync(join(directory, 'settings.json'), 'utf8')).not.toContain('synthetic-access-token')
    expect(new DesktopStorage(directory).readCredential()).toEqual({
      hubUrl: 'https://hub.example',
      accessToken: 'synthetic-access-token',
    })
    storage.clearCredential()
    expect(storage.readCredential()).toBeNull()
    expect(readdirSync(directory)).toEqual(['settings.json'])
  })
  it('never falls back to plaintext when the OS vault is unavailable', () => {
    const storage = new DesktopStorage(directory)
    vault.available = false
    expect(storage.canRemember).toBe(false)
    expect(() => storage.saveCredential('https://hub.example', 'secret')).toThrow(
      'SECURE_STORAGE_UNAVAILABLE',
    )
    expect(readdirSync(directory)).toEqual([])
    if (process.platform === 'linux') {
      vault.available = true
      vault.backend = 'basic_text'
      expect(storage.canRemember).toBe(false)
    }
  })
})
