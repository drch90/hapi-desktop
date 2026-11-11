import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { askUserQuestionDraftKey, clearAskUserQuestionDraft } from '@/lib/ask-user-question-drafts'

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ haptic: { notification: vi.fn(), selection: vi.fn() } })
}))
vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

import { AskUserQuestionFooter } from './AskUserQuestionFooter'

afterEach(() => {
    cleanup()
    for (const session of ['session-A', 'session-B']) {
        for (const tool of ['tool-1', 'tool-2']) clearAskUserQuestionDraft(askUserQuestionDraftKey(session, tool))
    }
    vi.restoreAllMocks()
})

function makeTool(id: string, allowFreeText?: boolean): ChatToolCall {
    return {
        id, name: 'AskUserQuestion', state: 'pending',
        input: { questions: [{ question: 'Pick one', options: [{ label: 'Alpha', description: null }, { label: 'Beta', description: null }], multiSelect: false, ...(allowFreeText === undefined ? {} : { allowFreeText }) }] },
        createdAt: 1, startedAt: null, completedAt: null, execStartedAt: null, execCompletedAt: null, description: null,
        permission: { id: 'permission-1', status: 'pending' }
    }
}

function renderFooter(
    sessionId: string,
    tool: ChatToolCall
) {
    const api = new ApiClient('')
    const approvePermission = vi.spyOn(api, 'approvePermission').mockResolvedValue(undefined)
    const denyPermission = vi.spyOn(api, 'denyPermission').mockResolvedValue(undefined)
    const props = { api, sessionId, tool, disabled: false, onDone: vi.fn() }
    return {
        ...render(<AskUserQuestionFooter {...props} />),
        props,
        approvePermission,
        denyPermission,
    }
}

// SessionChat.tsx keys the whole chat subtree by `session.id`, so switching
// sessions unmounts and remounts everything under it — this wrapper mirrors
// that exactly rather than just re-rendering with new props.
function SessionKeyedWrapper(props: { sessionId: string; tool: ChatToolCall }) {
    return (
        <div key={props.sessionId}>
            <AskUserQuestionFooter
                api={new ApiClient('')}
                sessionId={props.sessionId}
                tool={props.tool}
                disabled={false}
                onDone={vi.fn()}
            />
        </div>
    )
}

describe('AskUserQuestionFooter draft persistence (hapi#1734)', () => {
    it('restores an in-progress answer after a session-switch remount', () => {
        const tool = makeTool('tool-1')
        const { rerender } = render(<SessionKeyedWrapper sessionId="session-A" tool={tool} />)

        fireEvent.click(screen.getByRole('radio', { name: /Alpha/ }))
        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true')

        rerender(<SessionKeyedWrapper sessionId="session-B" tool={tool} />) // switch away
        rerender(<SessionKeyedWrapper sessionId="session-A" tool={tool} />) // switch back

        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true')
    })

    it('still resets to blank when the same instance moves to a different tool call', () => {
        const { rerender } = renderFooter('session-A', makeTool('tool-1'))
        fireEvent.click(screen.getByRole('radio', { name: /Alpha/ }))
        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true')

        rerender(
            <AskUserQuestionFooter
                api={new ApiClient('')}
                sessionId="session-A"
                tool={makeTool('tool-2')}
                disabled={false}
                onDone={vi.fn()}
            />
        )

        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'false')
    })

    it('restores an in-progress answer after a session-switch remount under StrictMode', () => {
        // Dev-only StrictMode replays this effect as setup -> cleanup -> setup
        // right on mount, before the setState calls in setup have flowed
        // through a render. A naive cleanup would read pre-restore ref values
        // and, being blank, delete the draft its own setup just loaded —
        // caught by review on tiann/hapi#1853.
        const tool = makeTool('tool-1')
        const { rerender } = render(
            <StrictMode><SessionKeyedWrapper sessionId="session-A" tool={tool} /></StrictMode>
        )

        fireEvent.click(screen.getByRole('radio', { name: /Alpha/ }))
        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true')

        rerender(<StrictMode><SessionKeyedWrapper sessionId="session-B" tool={tool} /></StrictMode>) // switch away
        rerender(<StrictMode><SessionKeyedWrapper sessionId="session-A" tool={tool} /></StrictMode>) // switch back

        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true')
    })

    it('clears the stored draft once the answer is submitted', async () => {
        const tool = makeTool('tool-1')
        const { approvePermission, rerender } = renderFooter('session-A', tool)

        fireEvent.click(screen.getByRole('radio', { name: /Alpha/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        await vi.waitFor(() => expect(approvePermission).toHaveBeenCalled())

        // Re-mount the same session/tool pair as if the widget were shown again
        rerender(<SessionKeyedWrapper sessionId="session-A" tool={tool} />)
        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'false')
    })

    it('denies the question once on Skip and clears the draft', async () => {
        const tool = makeTool('tool-1')
        const { approvePermission, denyPermission, rerender } = renderFooter('session-A', tool)

        fireEvent.click(screen.getByRole('radio', { name: /Alpha/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.skip' }))
        await vi.waitFor(() => expect(denyPermission).toHaveBeenCalledTimes(1))
        expect(denyPermission).toHaveBeenCalledWith('session-A', 'permission-1')
        expect(approvePermission).not.toHaveBeenCalled()

        rerender(<SessionKeyedWrapper sessionId="session-A" tool={tool} />)
        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'false')
    })

    it('skips on Escape from inside the card', async () => {
        const { denyPermission } = renderFooter('session-A', makeTool('tool-1'))

        fireEvent.keyDown(screen.getByRole('radio', { name: /Alpha/ }), { key: 'Escape' })

        await vi.waitFor(() => expect(denyPermission).toHaveBeenCalledTimes(1))
    })

    it('only leaves the Other field on Escape, keeping the typed text', async () => {
        const { denyPermission } = renderFooter('session-A', makeTool('tool-1'))

        fireEvent.click(screen.getByRole('radio', { name: /tool\.other/ }))
        const field = screen.getByPlaceholderText('tool.askUserQuestion.otherPlaceholder')
        field.focus()
        fireEvent.change(field, { target: { value: 'my answer' } })
        fireEvent.keyDown(field, { key: 'Escape' })

        expect(denyPermission).not.toHaveBeenCalled()
        expect(field).toHaveValue('my answer')
        expect(document.activeElement).not.toBe(field)
    })

    it('hides Other when the question does not allow free text, and submits an option as accept', async () => {
        const { approvePermission } = renderFooter('session-A', makeTool('tool-1', false))

        expect(screen.queryByRole('radio', { name: /tool\.other/ })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: /Beta/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))

        await vi.waitFor(() => expect(approvePermission).toHaveBeenCalledWith('session-A', 'permission-1', { answers: { '0': ['Beta'] } }))
    })

    it('still shows Other when free text is allowed or the flag is absent', () => {
        const allowed = renderFooter('session-A', makeTool('tool-1', true))
        expect(screen.getByRole('radio', { name: /tool\.other/ })).toBeTruthy()
        allowed.unmount()

        renderFooter('session-B', makeTool('tool-2'))
        expect(screen.getByRole('radio', { name: /tool\.other/ })).toBeTruthy()
    })

    it('is not shown once the question is no longer pending', () => {
        const tool = makeTool('tool-1')
        const resolved: ChatToolCall = { ...tool, permission: { id: 'permission-1', status: 'denied' } }

        renderFooter('session-A', resolved)

        expect(screen.queryByRole('button', { name: 'tool.skip' })).toBeNull()
    })
})

describe('AskUserQuestionFooter response safety', () => {
    it.each(['answer', 'dismiss'] as const)('locks an accepted %s until the remote question resolves', async (kind) => {
        const { props, approvePermission, denyPermission, rerender } = renderFooter('session-A', makeTool('tool-1'))
        const response = Promise.withResolvers<void>()
        const action = kind === 'answer' ? approvePermission : denyPermission
        action.mockReturnValueOnce(response.promise)
        fireEvent.click(screen.getByRole('radio', { name: /Alpha/ }))
        fireEvent.click(screen.getByRole('button', { name: kind === 'answer' ? 'tool.submit' : 'tool.skip' }))
        fireEvent.keyDown(screen.getByRole('radio', { name: /Alpha/ }), { key: 'Escape' })
        expect(action).toHaveBeenCalledTimes(1)
        await act(async () => response.resolve())
        expect(screen.getByRole('status')).toHaveTextContent(kind === 'answer' ? 'tool.requestUserInput.waitingForConfirmation' : 'tool.requestUserInput.waitingForCancellation')
        expect(screen.getByRole('radio', { name: /Alpha/ })).toBeDisabled()
        rerender(<AskUserQuestionFooter {...props} tool={{ ...props.tool, input: structuredClone(props.tool.input) }} />)
        fireEvent.keyDown(screen.getByRole('radio', { name: /Alpha/ }), { key: 'Escape' })
        expect(action).toHaveBeenCalledTimes(1)
        expect(kind === 'answer' ? denyPermission : approvePermission).not.toHaveBeenCalled()
    })

    it('keeps choices on skip failure and ignores a late skip receipt after changing questions', async () => {
        const { props, denyPermission, rerender } = renderFooter('session-A', makeTool('tool-1'))
        denyPermission.mockRejectedValueOnce(new Error('Retry cancellation'))
        fireEvent.click(screen.getByRole('radio', { name: /Alpha/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.skip' }))
        await screen.findByText('Retry cancellation')
        expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByRole('button', { name: 'tool.skip' })).toBeEnabled()
        const response = Promise.withResolvers<void>()
        denyPermission.mockReturnValueOnce(response.promise)
        fireEvent.click(screen.getByRole('button', { name: 'tool.skip' }))
        rerender(<AskUserQuestionFooter {...props} sessionId="session-B" tool={makeTool('tool-2')} />)
        fireEvent.click(screen.getByRole('radio', { name: /Beta/ }))
        await act(async () => response.resolve())
        expect(props.onDone).not.toHaveBeenCalled()
        expect(screen.queryByRole('status')).toBeNull()
        expect(screen.getByRole('radio', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByRole('button', { name: 'tool.submit' })).toBeEnabled()
    })

    it('does not submit a cached free-text answer after the server restricts the question to options', async () => {
        const first = renderFooter('session-A', makeTool('tool-1'))
        fireEvent.click(screen.getByRole('radio', { name: /tool\.other/ }))
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'old free text' } })
        first.unmount()
        const { approvePermission } = renderFooter('session-A', makeTool('tool-1', false))
        expect(screen.queryByRole('textbox')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        expect(approvePermission).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('radio', { name: /Beta/ }))
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        await vi.waitFor(() => expect(approvePermission).toHaveBeenCalledWith('session-A', 'permission-1', { answers: { '0': ['Beta'] } }))
    })
})
