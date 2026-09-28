import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ChatToolCall } from '@/chat/types'
import { ToolExecutionTimes } from '../src/renderer/components/ToolExecutionTimes'
import { decodeExportPng, imageExportSchema } from '../src/main/image-export'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const base: ChatToolCall = {
  id: 't',
  name: 'Bash',
  state: 'pending',
  input: {},
  createdAt: 1000,
  startedAt: null,
  completedAt: null,
  execStartedAt: null,
  execCompletedAt: null,
  description: null,
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('tool execution timestamps', () => {
  it('always renders three fields and does not invent pending timestamps', () => {
    render(<ToolExecutionTimes tool={base} />)
    for (const key of ['Start time', 'End time', 'Elapsed']) expect(screen.getByText(key)).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
  it('uses paired execution-machine times for completed tools', () => {
    const { container } = render(
      <ToolExecutionTimes
        tool={{
          ...base,
          state: 'completed',
          startedAt: 10000,
          completedAt: 15000,
          execStartedAt: 20000,
          execCompletedAt: 21200,
        }}
      />,
    )
    expect([...container.querySelectorAll('time')].map((t) => t.dateTime)).toEqual([
      new Date(20000).toISOString(),
      new Date(21200).toISOString(),
    ])
    expect(screen.getByText('1.2s')).toBeTruthy()
  })
  it('updates a running duration and stops at the recorded end', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10000)
    const { rerender } = render(<ToolExecutionTimes tool={{ ...base, state: 'running', startedAt: 9000 }} />)
    expect(screen.getByText('Working…')).toBeTruthy()
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText('3.0s')).toBeTruthy()
    rerender(
      <ToolExecutionTimes tool={{ ...base, state: 'completed', startedAt: 9000, completedAt: 12500 }} />,
    )
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText('3.5s')).toBeTruthy()
  })
})

describe('local image export boundary', () => {
  it('rejects traversal filenames and oversized PNG dimensions', () => {
    expect(
      imageExportSchema.safeParse({ action: 'save', fileName: '../x.png', png: 'data:image/png;base64,eA==' })
        .success,
    ).toBe(false)
    const bytes = Buffer.alloc(33)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
    bytes.write('IHDR', 12)
    bytes.writeUInt32BE(24000, 16)
    bytes.writeUInt32BE(24000, 20)
    expect(() => decodeExportPng(`data:image/png;base64,${bytes.toString('base64')}`)).toThrow(
      'IMAGE_TOO_LARGE',
    )
    expect(() => decodeExportPng('data:image/png;base64,eA==')).toThrow('INVALID_IMAGE')
  })
})
