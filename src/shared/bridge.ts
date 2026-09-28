import type { SyncEvent } from '@hapi/protocol'

export type Locale = 'zh' | 'en' | 'zh-TW' | 'ja' | 'fr' | 'ru' | 'vi'
export type Settings = {
  hubUrl: string
  locale: Locale
  theme: 'system' | 'light' | 'dark'
  enterBehavior: 'newline' | 'send'
  fontSize: 'small' | 'normal' | 'large' | 'extra-large'
  groupSessionsByStatus: boolean
  collapseHistoryByDefault: boolean
  notifications: boolean
  launchAtLogin: boolean
}
export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'authentication-required'
export type ConnectionState = { status: ConnectionStatus; hubUrl: string; profile?: string; error?: string }
export type HubRequest = { path: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }
export type Result<T> =
  { ok: true; value: T } | { ok: false; error: { message: string; status?: number; code?: string } }
export type DesktopEvent =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'sync'; event: SyncEvent; replay: boolean }
  | { type: 'resync' }
  | { type: 'open-session'; sessionId: string }
  | { type: 'settings'; settings: Settings }
export type Bootstrap = {
  settings: Settings
  connection: ConnectionState
  canRemember: boolean
  version: string
  platform: string
}
export type DesktopBridge = {
  bootstrap: () => Promise<Result<Bootstrap>>
  connect: (input: { hubUrl: string; accessToken: string; remember: boolean }) => Promise<Result<void>>
  disconnect: () => Promise<Result<void>>
  request: (request: HubRequest) => Promise<Result<unknown>>
  updateSettings: (settings: Partial<Omit<Settings, 'hubUrl'>>) => Promise<Result<Settings>>
  setVisibleSessions: (sessionIds: string[]) => Promise<Result<void>>
  openExternal: (url: string) => Promise<Result<void>>
  exportImage: (input: { png: string; action: 'copy' | 'save'; fileName: string }) => Promise<Result<void>>
  onEvent: (listener: (event: DesktopEvent) => void) => () => void
}

declare global {
  interface Window {
    desktop: DesktopBridge
  }
}
