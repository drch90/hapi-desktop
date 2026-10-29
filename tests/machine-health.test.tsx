import { act, cleanup, fireEvent, render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Machine } from '@hapi/protocol'
import { I18nContext } from '@/lib/i18n-context'
import { en } from '@/lib/locales'
import { MachineHealth } from '../src/renderer/components/MachineHealth'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params?.[name] ?? name)),
  }),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const linux: Machine = {
  id: 'linux',
  namespace: 'test',
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  active: true,
  activeAt: 1,
  metadataVersion: 1,
  runnerState: null,
  runnerStateVersion: 0,
  metadata: { host: 'build-host', displayName: 'Build machine', platform: 'linux', happyCliVersion: '1' },
  health: {
    collectedAt: 1,
    cpuCount: 8,
    cpuPercent: 24,
    memoryPercent: 61,
    load1m: 2.4,
    uptimeSeconds: 90000,
  },
}
const windows: Machine = {
  ...linux,
  id: 'windows',
  metadata: { ...linux.metadata!, displayName: 'Windows machine', host: 'win-host', platform: 'win32' },
  health: { ...linux.health!, cpuPercent: 91, load1m: 999 },
}

function view(props: Partial<Parameters<typeof MachineHealth>[0]> = {}) {
  return (
    <I18nContext.Provider
      value={{
        locale: 'en',
        setLocale: () => {},
        t: (key) => (en as Record<string, string>)[key] ?? key,
      }}
    >
      <MachineHealth
        machines={[linux]}
        machineId=""
        selectedLabel=""
        connected
        loading={false}
        failed={false}
        {...props}
      />
    </I18nContext.Provider>
  )
}

describe('desktop machine health', () => {
  it('shows details on hover, keeps them while crossing into the tooltip, and never pins on click', () => {
    vi.useFakeTimers()
    const page = render(view())
    const trigger = page.getByRole('group', { name: 'System health' })
    fireEvent.click(trigger)
    expect(page.queryByRole('tooltip', { name: 'System health' })).toBeNull()
    fireEvent.mouseEnter(trigger)
    const tooltip = page.getByRole('tooltip', { name: 'System health' })
    fireEvent.mouseLeave(trigger)
    act(() => vi.advanceTimersByTime(50))
    fireEvent.mouseEnter(tooltip)
    act(() => vi.advanceTimersByTime(200))
    expect(tooltip).toBeVisible()
    expect(page.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(page.queryByRole('button', { name: 'Refresh' })).toBeNull()
    fireEvent.mouseLeave(tooltip)
    act(() => vi.advanceTimersByTime(200))
    expect(page.queryByRole('tooltip', { name: 'System health' })).toBeNull()
    fireEvent.mouseEnter(trigger)
    fireEvent.click(trigger)
    fireEvent.mouseLeave(trigger)
    act(() => vi.advanceTimersByTime(200))
    expect(page.queryByRole('tooltip', { name: 'System health' })).toBeNull()
  })

  it('shows the single runner summary and shared capacity details with its display name and host', () => {
    const page = render(view())
    const trigger = page.getByRole('group', { name: 'System health' })
    expect(trigger).toHaveTextContent('Build machine')
    expect(trigger).toHaveTextContent('CPU 24% · RAM 61%')
    expect(trigger).toHaveAttribute('data-tone', 'ok')
    fireEvent.mouseEnter(trigger)
    const panel = page.getByRole('tooltip', { name: 'System health' })
    expect(panel).toHaveTextContent('build-host')
    expect(panel).toHaveTextContent('Healthy — room for more agents')
    expect(panel).toHaveTextContent('2.4/8')
    expect(panel).toHaveTextContent('1d 1h')
  })

  it('keeps machine readings separate and omits Unix load on Windows', () => {
    const page = render(view({ machines: [linux, windows] }))
    const trigger = page.getByRole('group', { name: 'System health' })
    expect(trigger).toHaveTextContent('Machines (2)')
    page.rerender(view({ machines: [linux, windows], machineId: 'windows' }))
    expect(trigger).toHaveTextContent('CPU 91%')
    expect(trigger).toHaveAttribute('data-tone', 'critical')
    fireEvent.mouseEnter(trigger)
    const panel = page.getByRole('tooltip', { name: 'System health' })
    expect(panel).toHaveTextContent('Windows machine')
    expect(panel).not.toHaveTextContent('Build machine')
    expect(panel).not.toHaveTextContent('Load (1m)')
    expect(panel).not.toHaveTextContent('999')
  })

  it('hides cached readings on disconnect, failed refresh and runner offline, then recovers', () => {
    const page = render(view())
    const trigger = page.getByRole('group', { name: 'System health' })
    fireEvent.mouseEnter(trigger)
    page.rerender(view({ connected: false }))
    expect(trigger).toHaveTextContent('disconnected')
    expect(trigger).toHaveAttribute('data-tone', 'unknown')
    expect(page.getByRole('tooltip', { name: 'System health' })).not.toHaveTextContent('24%')
    page.rerender(view({ failed: true }))
    expect(page.getByRole('tooltip', { name: 'System health' })).toHaveTextContent(
      'Unable to load machine health.',
    )
    page.rerender(view({ machines: [{ ...linux, active: false }] }))
    expect(page.getByRole('tooltip', { name: 'System health' })).toHaveTextContent('Offline')
    expect(page.getByRole('tooltip', { name: 'System health' })).not.toHaveTextContent('24%')
    page.rerender(view({ machines: [{ ...linux, health: { ...linux.health!, cpuPercent: 87 } }] }))
    expect(trigger).toHaveTextContent('CPU 87%')
    expect(trigger).toHaveAttribute('data-tone', 'warn')
    expect(page.getByRole('tooltip', { name: 'System health' })).toHaveTextContent('87%')
  })

  it.each([undefined, null, { collectedAt: 1 }])('does not invent readings when health is %j', (health) => {
    const page = render(view({ machines: [{ ...linux, health }] }))
    const trigger = page.getByRole('group', { name: 'System health' })
    expect(trigger).toHaveTextContent('Metrics unavailable')
    expect(trigger).toHaveAttribute('data-tone', 'unknown')
    fireEvent.mouseEnter(trigger)
    expect(page.getByRole('tooltip', { name: 'System health' })).toHaveTextContent('Metrics unavailable')
    expect(page.getByRole('tooltip', { name: 'System health' })).not.toHaveTextContent('%')
  })

  it('does not substitute another runner when the selected machine disappears', () => {
    const page = render(view({ machineId: 'missing', selectedLabel: 'Missing runner' }))
    const trigger = page.getByRole('group', { name: 'System health' })
    expect(trigger).toHaveTextContent('Missing runner')
    expect(trigger).not.toHaveTextContent('CPU')
    fireEvent.mouseEnter(trigger)
    expect(page.getByRole('tooltip', { name: 'System health' })).toHaveTextContent(
      'Machine unavailable. Select an online machine.',
    )
    expect(page.getByRole('tooltip', { name: 'System health' })).not.toHaveTextContent('Build machine')
    page.rerender(view({ machines: [], machineId: '' }))
    expect(page.getByRole('tooltip', { name: 'System health' })).toHaveTextContent('No online machines')
  })

  it('keeps uptime visible without claiming healthy capacity when usage readings are absent', () => {
    const page = render(view({ machines: [{ ...linux, health: { collectedAt: 1, uptimeSeconds: 3600 } }] }))
    const trigger = page.getByRole('group', { name: 'System health' })
    expect(trigger).toHaveAttribute('data-tone', 'unknown')
    fireEvent.mouseEnter(trigger)
    const panel = page.getByRole('tooltip', { name: 'System health' })
    expect(panel).toHaveTextContent('Metrics unavailable')
    expect(panel).toHaveTextContent('1h 0m')
    expect(panel).not.toHaveTextContent('Healthy')
  })
})
