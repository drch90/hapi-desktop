import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAgentRecord } from '@/chat/normalizeAgent'
import { PermissionModeField } from '../src/renderer/components/agent-settings/PermissionModeField'
import {
  defaultLaunchSettings,
  launchParameters,
} from '../src/renderer/components/agent-settings/launchSettings'
import {
  loadPreferredLaunchSettings,
  rememberLaunchSettings,
} from '../src/renderer/lib/newSessionPreferences'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Antigravity native session compatibility', () => {
  it('offers review, Auto, Plan and Always Proceed independently of Grok eligibility', () => {
    const onChange = vi.fn()
    render(
      <PermissionModeField
        agent="agy"
        value="request-review"
        autoSupported={false}
        disabled={false}
        onChange={onChange}
      />,
    )
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('request-review')
    expect(Array.from(select.querySelectorAll('option'), (option) => option.value)).toEqual([
      'request-review',
      'auto',
      'plan',
      'always-proceed',
    ])
    expect(screen.getByRole('option', { name: 'Auto' })).toBeEnabled()
    expect(screen.queryByText('This Grok CLI does not support Auto permission mode.')).toBeNull()
    for (const value of ['auto', 'plan']) {
      fireEvent.change(select, { target: { value } })
      expect(onChange).toHaveBeenLastCalledWith(value)
    }
  })

  it('retains the Grok capability restriction', () => {
    const onChange = vi.fn()
    render(
      <PermissionModeField
        agent="grok"
        value="default"
        autoSupported={false}
        disabled={false}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('option', { name: 'Auto' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'auto' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each(['request-review', 'auto', 'plan', 'always-proceed'] as const)(
    'restores %s for the same account and runner and sends its native mode',
    (permission) => {
      const settings = {
        ...defaultLaunchSettings('agy'),
        model: 'gemini-4-argon',
        effort: 'high',
        permission,
      }
      rememberLaunchSettings('hub:alice', 'runner', 'agy', settings)
      const restored = loadPreferredLaunchSettings('hub:alice', 'runner', 'agy')
      expect(restored).toEqual(settings)
      expect(launchParameters('agy', restored, false)).toMatchObject({
        permissionMode: permission,
        model: 'gemini-4-argon',
        effort: 'high',
      })
      expect(loadPreferredLaunchSettings('hub:bob', 'runner', 'agy').permission).toBe('request-review')
      expect(loadPreferredLaunchSettings('hub:alice', 'other-runner', 'agy').permission).toBe(
        'request-review',
      )
    },
  )

  it.each([
    'Inside the task-123 log is the explanation I want to show.',
    'Native reply\n\n[Message] timestamp=123\nKeep the literal transcript example.',
  ])('preserves native streamed prose and model attribution: %s', (text) => {
    expect(
      normalizeAgentRecord('row-2', null, 2, {
        type: 'output',
        data: { type: 'agy_message', id: 'native-text-1', content: text, model: 'Gemini 3.8 Flash (High)' },
      }),
    ).toMatchObject({
      role: 'agent',
      model: 'Gemini 3.8 Flash (High)',
      content: [{ type: 'text', text, streamId: 'native-text-1' }],
    })
  })
})
