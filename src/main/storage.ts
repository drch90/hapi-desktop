import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { Settings } from '../shared/bridge'
import { settingsUpdateSchema, normalizeHubUrl } from '../shared/policy'

export const defaultSettings: Settings = {
  hubUrl: '',
  locale: 'zh',
  theme: 'system',
  enterBehavior: 'newline',
  fontSize: 'normal',
  collapseHistoryByDefault: true,
  codexExplorationCollapsed: true,
  notifications: true,
  launchAtLogin: false,
}

export class DesktopStorage {
  settings: Settings = { ...defaultSettings }
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    try {
      const raw = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'))
      // Status sections are always shown now. Ignore the retired switch while
      // migrating older files so the remaining preferences are still retained.
      const { hubUrl, groupSessionsByStatus: _legacyGrouping, ...preferences } = raw
      this.settings = {
        ...defaultSettings,
        ...settingsUpdateSchema.parse(preferences),
        hubUrl: hubUrl ? normalizeHubUrl(hubUrl) : '',
      }
    } catch {
      /* First run or invalid configuration uses safe defaults. */
    }
  }

  get canRemember() {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    )
  }

  saveSettings(settings: Settings) {
    const path = join(this.directory, 'settings.json')
    writeFileSync(`${path}.tmp`, JSON.stringify(settings, null, 2), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
    this.settings = settings
  }

  readCredential(): { hubUrl: string; accessToken: string } | null {
    if (!this.canRemember) return null
    try {
      const data = JSON.parse(safeStorage.decryptString(readFileSync(join(this.directory, 'credential.bin'))))
      if (typeof data.accessToken !== 'string' || !data.accessToken) return null
      return { hubUrl: normalizeHubUrl(data.hubUrl), accessToken: data.accessToken }
    } catch {
      return null
    }
  }

  saveCredential(hubUrl: string, accessToken: string) {
    if (!this.canRemember) throw new Error('SECURE_STORAGE_UNAVAILABLE')
    const path = join(this.directory, 'credential.bin')
    writeFileSync(`${path}.tmp`, safeStorage.encryptString(JSON.stringify({ hubUrl, accessToken })), {
      mode: 0o600,
    })
    renameSync(`${path}.tmp`, path)
  }

  clearCredential() {
    const path = join(this.directory, 'credential.bin')
    if (existsSync(path)) rmSync(path)
  }
}
