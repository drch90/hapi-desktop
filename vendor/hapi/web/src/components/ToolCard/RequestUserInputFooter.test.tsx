import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: {
            notification: vi.fn(),
            selection: vi.fn()
        }
    })
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key === 'tool.requestUserInput.otherLabel' ? '以上都不是' : key })
}))

import { RequestUserInputFooter } from './RequestUserInputFooter'

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

const choice = { id: 'choice', question: 'Choose', isOther: true, options: [{ label: 'Alpha' }, { label: 'Beta' }] }

function renderFooter(input: unknown = { questions: [choice] }) {
    const api = new ApiClient('fixture-token')
    const approvePermission = vi.spyOn(api, 'approvePermission').mockResolvedValue(undefined)
    const props = {
        api,
        sessionId: 'session-1', tool: makeTool(input), disabled: false, onDone: vi.fn()
    }
    return { ...render(<RequestUserInputFooter {...props} />), props, approvePermission }
}

function makeTool(input: unknown): ChatToolCall {
    return {
        id: 'request-1',
        name: 'request_user_input',
        state: 'pending',
        input,
        createdAt: 1,
        startedAt: null,
        completedAt: null,
        execStartedAt: null,
        execCompletedAt: null,
        description: null,
        permission: {
            id: 'permission-1',
            status: 'pending'
        }
    }
}

describe('RequestUserInputFooter', () => {
    it('keeps a submitted answer locked while native confirmation is delayed', async () => {
        const response = Promise.withResolvers<void>()
        const { props, approvePermission, rerender } = renderFooter()
        approvePermission.mockReturnValueOnce(response.promise)
        fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        const submitting = screen.getByRole('button', { name: 'tool.submitting' })
        expect(submitting).toBeDisabled()
        expect(submitting).toHaveAttribute('aria-busy', 'true')
        fireEvent.click(submitting)
        expect(approvePermission).toHaveBeenCalledTimes(1)
        await act(async () => response.resolve())
        await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1))
        expect(screen.getByRole('status')).toHaveTextContent('tool.requestUserInput.waitingForConfirmation')
        const submitted = screen.getByRole('button', { name: 'tool.requestUserInput.submitted' })
        expect(submitted).toBeDisabled()
        fireEvent.click(submitted)
        rerender(<RequestUserInputFooter {...props} tool={{ ...props.tool, input: structuredClone(props.tool.input) }} />)
        expect(screen.getByRole('button', { name: 'tool.requestUserInput.submitted' })).toBeDisabled()
        expect(approvePermission).toHaveBeenCalledTimes(1)
        rerender(<RequestUserInputFooter {...props} tool={{ ...props.tool, permission: { id: 'permission-1', status: 'resolved' } }} />)
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('ignores the old request acknowledgement after switching to another question', async () => {
        const response = Promise.withResolvers<void>()
        const { props, approvePermission, rerender } = renderFooter()
        approvePermission.mockReturnValueOnce(response.promise)
        fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        rerender(<RequestUserInputFooter {...props} sessionId="session-2" tool={{
            ...props.tool,
            id: 'request-2',
            permission: { id: 'permission-2', status: 'pending' }
        }} />)
        fireEvent.click(screen.getByRole('button', { name: /Beta/ }))
        await act(async () => response.resolve())
        expect(props.onDone).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'tool.submit' })).toBeEnabled()
        expect(screen.getByRole('button', { name: /Beta/ })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it.each(['', ' \n ', '  自定义\n说明  '])('focuses notes without submitting and posts canonical values (%j)', async (note) => {
        const { approvePermission } = renderFooter()
        fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
        fireEvent.click(screen.getByRole('button', { name: /以上都不是/ }))
        expect(screen.getByRole('textbox')).toHaveFocus()
        expect(screen.getByRole('button', { name: /Alpha/ })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('button', { name: /以上都不是/ })).toHaveAttribute('aria-pressed', 'true')
        expect(approvePermission).not.toHaveBeenCalled()
        fireEvent.change(screen.getByRole('textbox'), { target: { value: note } })
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        await waitFor(() => expect(approvePermission).toHaveBeenCalledWith('session-1', 'permission-1', {
            answers: { choice: { answers: ['None of the above', ...(note.trim() ? [`user_note: ${note.trim()}`] : [])] } }
        }))
    })

    it('retains notes across choices, questions, and SSE rerenders without auto-advancing', async () => {
        const { props, rerender, approvePermission } = renderFooter({ questions: [choice, { ...choice, id: 'second', question: 'Second' }] })
        fireEvent.click(screen.getByRole('button', { name: /以上都不是/ }))
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep this note' } })
        fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
        expect(screen.getByRole('button', { name: /以上都不是/ })).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByRole('textbox')).toHaveValue('keep this note')
        fireEvent.click(screen.getByRole('button', { name: /以上都不是/ }))
        expect(screen.getByText('Choose')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'tool.next' }))
        expect(screen.getByRole('textbox')).toHaveValue('')
        fireEvent.click(screen.getByRole('button', { name: /Beta/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.prev' }))
        rerender(<RequestUserInputFooter {...props} tool={{ ...props.tool, input: structuredClone(props.tool.input) }} />)
        expect(screen.getByRole('textbox')).toHaveValue('keep this note')
        expect(screen.getByRole('button', { name: /以上都不是/ })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'tool.next' }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        await waitFor(() => expect(approvePermission).toHaveBeenCalledWith('session-1', 'permission-1', {
            answers: { choice: { answers: ['None of the above', 'user_note: keep this note'] }, second: { answers: ['Beta'] } }
        }))
    })

    it('does not interpret a note alone as None of the above', () => {
        const { approvePermission } = renderFooter()
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'custom' } })
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        expect(approvePermission).not.toHaveBeenCalled()
        expect(screen.getByText('tool.selectOption')).toBeInTheDocument()
    })

    it.each([false, undefined])('does not add other to Pi or MCP choices (%s)', (isOther) => {
        renderFooter({ questions: [{ ...choice, isOther }] })
        expect(screen.queryByRole('button', { name: /以上都不是/ })).not.toBeInTheDocument()
    })

    it('retains the answer on failure and removes controls when resolved elsewhere', async () => {
        const { props, rerender, approvePermission } = renderFooter()
        approvePermission.mockRejectedValueOnce(new Error('try again'))
        fireEvent.click(screen.getByRole('button', { name: /以上都不是/ }))
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft' } })
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        await screen.findByText('try again')
        expect(screen.getByRole('textbox')).toHaveValue('draft')
        expect(screen.getByRole('button', { name: /以上都不是/ })).toHaveAttribute('aria-pressed', 'true')
        rerender(<RequestUserInputFooter {...props} tool={{ ...props.tool, permission: { id: 'permission-1', status: 'resolved' } }} />)
        expect(screen.queryByRole('button', { name: 'tool.submit' })).not.toBeInTheDocument()
        expect(approvePermission).toHaveBeenCalledTimes(1)
    })

    it('uses a Pi extension pure-text placeholder and prefill when initializing the request', () => {
        render(
            <RequestUserInputFooter
                api={{} as ApiClient}
                sessionId="session-1"
                tool={makeTool({
                    questions: [{
                        id: 'comment',
                        question: 'Comment',
                        options: [],
                        placeholder: 'Describe the change',
                        prefill: 'Initial draft'
                    }]
                })}
                disabled={false}
                onDone={vi.fn()}
            />
        )

        const textarea = screen.getByRole('textbox')
        expect(textarea).toHaveAttribute('placeholder', 'Describe the change')
        expect(textarea).toHaveValue('Initial draft')
    })
})
