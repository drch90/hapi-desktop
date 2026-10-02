import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  Square,
  RotateCcw,
  Pencil,
  Archive,
  ChevronDown,
  Bot,
  SlidersHorizontal,
  Trash2,
  ListTree,
  ArrowDownToLine,
  Paperclip,
  NotebookPen,
} from 'lucide-react'
import { SessionSchema, type Session } from '@hapi/protocol/schemas'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { ToolGroupCard } from '@/components/ToolCard/ToolGroupCard'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { buildVisibleChatBlocks, isToolGroupBlock, type ToolGroupBlock } from '@/chat/toolGroups'
import { RequestUserInputFooter } from '@/components/ToolCard/RequestUserInputFooter'
import { AskUserQuestionFooter } from '@/components/ToolCard/AskUserQuestionFooter'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { CodeBlock } from '@/components/CodeBlock'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useActiveSuggestions } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { applySuggestion } from '@/utils/applySuggestion'
import { findActiveWord } from '@/utils/findActiveWord'
import { buildSessionReferenceText, matchSessionsForMention } from '@/lib/sessionReference'
import { getSessionTitle } from '@/lib/sessionTitle'
import type { SessionSummary, Machine } from '@/types/api'
import { isQueuedForInvocation } from '@/lib/messages'
import {
  isSteeringSupportedForSession,
  getPermissionModeLabel,
  getCodexCollaborationModeLabel,
  type MessageDeliveryMode,
} from '@hapi/protocol'
import { formatSessionHeaderTimestamp } from '@/lib/sessionHeaderTimestamp'
import { getReasoningEffortForFlavor } from '@/lib/codexStatusLabels'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { getEventPresentation } from '@/chat/presentation'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { useQueueEdit, saveQueueEdit, queueEditEpoch } from '../lib/queueEdit'
import { api, createApi, errorKey, unwrap } from '../lib/api'
import { useAttachments } from '../lib/useAttachments'
import { AttachmentTray } from './AttachmentTray'
import { queries, refreshSessions, sessionKey, watchSession } from '../lib/sync'
import { loadDraft, saveDraft, type Draft } from '../lib/workspace'
import { checkDelivery, loadAttempt, storeAttempt, uncertainDelivery, type SendAttempt } from '../lib/outbox'
import { MarkdownRenderer, LinkContext } from './Markdown'
import { MessageActions } from './MessageActions'
import { ToolExecutionTimes } from './ToolExecutionTimes'
import { Scratchlist } from './Scratchlist'
import { ContextUsage } from './Usage'
import { QueuedMessages } from './QueuedMessages'
import { SessionConfiguration } from './SessionConfiguration'
import { GeneratedMediaCard } from './GeneratedMediaCard'
import { ConversationOutlinePanel } from '@/components/AssistantChat/HappyThread'
import { buildConversationOutline } from '@/chat/outline'
import { useTranscriptNavigation } from '../lib/useTranscriptNavigation'
import { formatFileReference } from '@/lib/file-composer'
import type { Settings } from '../../shared/bridge'
import { toIntlLocale } from '../../shared/i18n'

type ChatProps = {
  id: string
  scope: string
  connected: boolean
  sessions: SessionSummary[]
  machines: Machine[]
  attentionToken?: number
  enterBehavior: Settings['enterBehavior']
  codexExplorationCollapsed: boolean
  replaceSession: (from: string, to: string) => void
  sessionDeleted: (id: string) => void
  openSession: (id: string) => void
  openFile: (path: string) => void
  registerComposer: (id: string, insert: ((path: string) => void) | null) => void
}

export function Chat({
  id,
  scope,
  connected,
  sessions,
  machines,
  attentionToken,
  enterBehavior,
  codexExplorationCollapsed,
  replaceSession,
  sessionDeleted,
  openSession,
  openFile,
  registerComposer,
}: ChatProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || 'en')
  const query = useQuery({
    queryKey: sessionKey(id),
    queryFn: async () => SessionSchema.parse((await api.getSession(id)).session),
  })
  const session = query.data
  const scopedApi = useMemo(() => createApi(scope), [scope])
  const attachments = useAttachments(scope, id, Boolean(session?.active && connected))
  const fileInput = useRef<HTMLInputElement>(null)
  const messages = useMessages(api, id)
  const [draft, setDraft] = useState(() => loadDraft(scope, id))
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [dismissedCommandQuery, setDismissedCommandQuery] = useState<string | null>(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [composerFocused, setComposerFocused] = useState(false)
  const [dismissedMention, setDismissedMention] = useState<string | null>(null)
  const mention =
    composerFocused && !commandMenuOpen ? findActiveWord(draft.text, selection, ['@']) : undefined
  const mentionKey = `${draft.text}:${selection.start}:${selection.end}`
  const mentionQuery = mention && mentionKey !== dismissedMention ? mention.activeWord : null
  const slashCommands = useSlashCommands(api, id, session?.metadata?.flavor ?? 'codex')
  const commandQuery = commandMenuOpen
    ? '/'
    : /^\/[^\s]*$/.test(draft.text) && draft.text !== dismissedCommandQuery
      ? draft.text
      : null
  const suggestionQuery = commandQuery ?? mentionQuery
  const getSuggestions = useCallback(
    async (query: string) => {
      if (!query.startsWith('@')) return slashCommands.getSuggestions(query)
      const machineLabel = (id: string | null) => {
        const machine = machines.find((item) => item.id === id)
        return machine?.metadata?.displayName || machine?.metadata?.host || id?.slice(0, 8) || ''
      }
      return matchSessionsForMention(sessions, query.slice(1), {
        excludeId: id,
        limit: 20,
        resolveMachineLabel: machineLabel,
      }).map((row) => ({
        key: `session:${row.id}`,
        text: buildSessionReferenceText(getSessionTitle(row), row.id, '/'),
        label: `@${getSessionTitle(row) || row.id.slice(0, 8)}`,
        description: [row.id, machineLabel(row.metadata?.machineId ?? null), row.metadata?.path]
          .filter(Boolean)
          .join(' · '),
      }))
    },
    [id, sessions, machines, slashCommands.getSuggestions],
  )
  const [suggestions, selectedCommand, previousCommand, nextCommand, clearCommands] = useActiveSuggestions(
    suggestionQuery,
    getSuggestions,
  )
  const queueEdit = useQueueEdit(scope, id)
  const [editWorking, setEditWorking] = useState(false)
  const [attempt, setAttempt] = useState(() => loadAttempt(scope, id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rename, setRename] = useState(false)
  const [archive, setArchive] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [configuration, setConfiguration] = useState(false)
  const [questionsExpanded, setQuestionsExpanded] = useState(true)
  const [dismissedPlan, setDismissedPlan] = useState('')
  const [scratchlistOpen, setScratchlistOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const outlineButton = useRef<HTMLButtonElement>(null)
  const outlineContainer = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const latestDraft = useRef(draft)
  const migrated = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    registerComposer(id, (path) => {
      const previous = latestDraft.current.text.trimEnd()
      const text = previous ? `${previous}\n${formatFileReference(path)}` : formatFileReference(path)
      const next = { ...latestDraft.current, text }
      latestDraft.current = next
      setDraft(next)
      saveDraft(scope, id, next)
      setQuestionsExpanded(false)
      requestAnimationFrame(() => composer.current?.focus())
    })
    return () => registerComposer(id, null)
  }, [id, scope, registerComposer])
  useEffect(() => {
    alive.current = true
    const unwatch = watchSession(id)
    const unsubscribe = window.desktop.onEvent((event) => {
      if (event.type === 'sync' && event.event.type === 'session-removed' && event.event.sessionId === id)
        migrated.current = true
    })
    return () => {
      unsubscribe()
      alive.current = false
      unwatch()
      if (!migrated.current) saveDraft(scope, id, latestDraft.current)
    }
  }, [id, scope])
  useEffect(() => {
    const timer = setTimeout(() => saveDraft(scope, id, latestDraft.current), 200)
    return () => clearTimeout(timer)
  }, [draft, id, scope])
  const reduced = useMemo(
    () =>
      reduceChatBlocks(
        messages.messages
          .filter((message) => !isQueuedForInvocation(message))
          .map(normalizeDecryptedMessage)
          .filter((item) => item !== null),
        session?.agentState,
      ),
    [messages.messages, session?.agentState],
  )
  const blocks = reduced.blocks
  const pending = useMemo(
    () =>
      reduceChatBlocks([], session?.agentState).blocks.filter(
        (block): block is ToolCallBlock => block.kind === 'tool-call' && block.tool.state === 'pending',
      ),
    [session?.agentState],
  )
  const outlineItems = useMemo(() => buildConversationOutline(blocks), [blocks])
  const previousGroups = useRef<ToolGroupBlock[]>([])
  const visibleBlocks = useMemo(
    () =>
      buildVisibleChatBlocks(blocks, {
        hasMoreMessages: messages.hasMore,
        previousGroups: previousGroups.current,
        codexExplorationCollapsed,
      }),
    [blocks, messages.hasMore, codexExplorationCollapsed],
  )
  useEffect(() => {
    previousGroups.current = visibleBlocks.filter(isToolGroupBlock)
  }, [visibleBlocks])
  const navigation = useTranscriptNavigation({
    sessionId: id,
    initialScrollTop: draft.scrollTop,
    blocks: visibleBlocks,
    messages,
    onPosition: (scrollTop) => {
      latestDraft.current = { ...latestDraft.current, scrollTop }
    },
  })
  useEffect(() => {
    if (outlineOpen)
      outlineContainer.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
  }, [outlineOpen])
  useEffect(() => {
    if (!attentionToken || !session) return
    setQuestionsExpanded(true)
    const frame = requestAnimationFrame(() => {
      const area = document.querySelector<HTMLElement>(
        `[data-testid="chat-${CSS.escape(id)}"] .approval-area`,
      )
      if (area?.childElementCount) {
        area.focus()
        area.scrollIntoView({ block: 'nearest' })
      } else composer.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [attentionToken, Boolean(session), id])
  const pendingIds = new Set(pending.map((block) => block.tool.id))
  const hasQuestions = pending.some(
    (block) => isRequestUserInputToolName(block.tool.name) || isAskUserQuestionToolName(block.tool.name),
  )
  const controlledByUser =
    session?.agentState?.controlledByUser === true && !session.metadata?.capabilities?.concurrentClients
  const canSteer = Boolean(
    session?.active &&
    isSteeringSupportedForSession(session.metadata) &&
    (session.metadata?.flavor === 'pi' ? session.thinking : session.agentState?.steeringActive === true) &&
    !controlledByUser,
  )

  function updateDraft(update: Partial<Draft>) {
    const value = { ...latestDraft.current, ...update }
    latestDraft.current = value
    setDraft(value)
  }
  function selectCommand(index: number) {
    const suggestion = suggestions[index]
    if (!suggestion) return
    const text = latestDraft.current.text
    const isMention = suggestionQuery?.startsWith('@')
    if (isMention && (!composer.current || !findActiveWord(text, selection, ['@']))) return
    const prefix = /^\/\S*/.exec(text)?.[0]
    const result = applySuggestion(
      text,
      isMention ? selection : { start: prefix?.length ?? 0, end: prefix?.length ?? 0 },
      suggestion.text,
      isMention ? ['@'] : ['/'],
    )
    updateDraft({ text: result.text })
    saveDraft(scope, id, latestDraft.current)
    setCommandMenuOpen(false)
    setSelection({ start: result.cursorPosition, end: result.cursorPosition })
    clearCommands()
    requestAnimationFrame(() => {
      composer.current?.focus()
      composer.current?.setSelectionRange(result.cursorPosition, result.cursorPosition)
    })
  }
  async function refresh() {
    await Promise.all([query.refetch(), messages.refetch()])
    refreshSessions()
  }
  async function action(work: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
    } catch (error) {
      setError(errorKey(error))
      throw error
    } finally {
      setBusy(false)
    }
  }
  async function send(retry = false, deliveryMode: MessageDeliveryMode = 'queue') {
    if (
      busy ||
      (deliveryMode === 'steer' && !canSteer) ||
      !session ||
      !connected ||
      (!latestDraft.current.text.trim() && !attachments.items.length && !attempt?.attachments?.length) ||
      attachments.loading ||
      (session.active && !attachments.ready && !retry) ||
      (attempt && (!retry || attempt.status !== 'absent'))
    )
      return
    setBusy(true)
    setError('')
    let target = id
    let outgoing: SendAttempt | null = null
    try {
      if (!session.active) {
        target = await scopedApi.resumeSession(id)
        if (typeof target !== 'string' || !target || target.length > 256) throw new Error('INVALID_RESPONSE')
      }
      // Shared Codex threads use HAPI's native clear endpoint, which creates
      // and returns the new conversation. Other CLI commands stay verbatim.
      if (
        session.metadata?.capabilities?.concurrentClients &&
        !attachments.items.length &&
        /^\/(clear|new)\s*$/.test(latestDraft.current.text.trim())
      ) {
        const commandText = latestDraft.current.text
        const result = await scopedApi.clearConversation(target)
        if (typeof result.sessionId !== 'string' || !result.sessionId || result.sessionId.length > 256)
          throw new Error('INVALID_RESPONSE')
        target = result.sessionId
        if (latestDraft.current.text === commandText)
          updateDraft({ text: '', scrollTop: -1, scheduledAt: null })
        return
      }
      const uploaded = await attachments.prepare(target)
      if (retry && target !== id && uploaded.length !== (attempt?.attachments?.length ?? 0))
        throw new Error('UPLOAD_FAILED')
      outgoing =
        retry && attempt
          ? {
              ...attempt,
              status: 'unconfirmed',
              attachments:
                target !== id
                  ? uploaded
                  : attempt.attachments?.map(
                      (item) => uploaded.find((candidate) => candidate.id === item.id) ?? item,
                    ),
            }
          : {
              localId: crypto.randomUUID(),
              text: latestDraft.current.text.trim(),
              createdAt: Date.now(),
              status: 'unconfirmed',
              ...(uploaded.length ? { attachments: uploaded } : {}),
              deliveryMode,
              ...(latestDraft.current.scheduledAt && latestDraft.current.scheduledAt > Date.now()
                ? { scheduledAt: latestDraft.current.scheduledAt }
                : {}),
            }
      // Persist before the network request; a crash or window reload cannot
      // turn an uncertain send into a fresh attempt with another localId.
      storeAttempt(scope, id, outgoing)
      setAttempt(outgoing)
      await scopedApi.sendMessage(
        target,
        outgoing.text,
        outgoing.localId,
        outgoing.attachments,
        outgoing.scheduledAt,
        outgoing.deliveryMode ?? deliveryMode,
      )
      storeAttempt(scope, id, null)
      setAttempt(null)
      attachments.clearSent(outgoing.attachments?.map((item) => item.id) ?? [])
      if (latestDraft.current.text.trim() === outgoing.text)
        updateDraft({ text: '', scrollTop: -1, scheduledAt: null })
      navigation.followLatest()
      if (target === id) await messages.refetch()
    } catch (error) {
      setError(errorKey(error))
      if (outgoing && !uncertainDelivery(error)) {
        storeAttempt(scope, id, null)
        setAttempt(null)
      }
    } finally {
      // Resume can create a new session. Move tab, draft and uncertain send
      // together after the attempt has settled, even if delivery failed.
      if (!attachments.isCurrent()) return
      saveDraft(scope, id, latestDraft.current)
      try {
        if (target !== id) {
          await attachments.transfer(target)
          migrated.current = true
          replaceSession(id, target)
        }
      } catch (error) {
        if (alive.current) setError(errorKey(error))
      } finally {
        attachments.release()
        if (alive.current) setBusy(false)
      }
    }
  }
  async function inspectAttempt() {
    if (!attempt || busy || attachments.loading) return
    setBusy(true)
    setError('')
    try {
      const status = await checkDelivery(scopedApi, id, attempt)
      if (status === 'accepted') {
        attachments.clearSent(attempt.attachments?.map((item) => item.id) ?? [])
        if (latestDraft.current.text.trim() === attempt.text) updateDraft({ text: '' })
        setAttempt(null)
        storeAttempt(scope, id, null)
      } else {
        const next = { ...attempt, status }
        setAttempt(next)
        storeAttempt(scope, id, next)
      }
      await messages.refetch()
    } catch (error) {
      setError(errorKey(error))
    } finally {
      setBusy(false)
    }
  }
  async function restoreQueueEdit() {
    if (!queueEdit || busy || editWorking || attempt || attachments.loading || !connected) return
    const generation = queueEditEpoch()
    setEditWorking(true)
    setError('')
    try {
      if (queueEdit.state === 'checking') {
        const state = await scopedApi.getQueuedState(id, [queueEdit.localId])
        if (generation !== queueEditEpoch()) return
        if (state.invokedLocalMessages.some((message) => message.localId === queueEdit.localId)) {
          saveQueueEdit(scope, id, null)
          throw new Error('QUEUE_ALREADY_INVOKED')
        }
        if (
          state.queuedLocalIds.includes(queueEdit.localId) ||
          state.indeterminateLocalIds?.includes(queueEdit.localId)
        ) {
          saveQueueEdit(scope, id, null)
          throw new Error('QUEUE_STILL_PENDING')
        }
        saveQueueEdit(scope, id, { ...queueEdit, state: 'ready' })
        return
      }
      if (attachments.error) throw new Error('ATTACHMENTS_NOT_READY')
      const files: File[] = []
      for (const attachment of queueEdit.attachments) {
        const file = await unwrap(
          window.desktop.readFile({ kind: 'file', sessionId: id, path: attachment.path, scope }),
        )
        files.push(new File([file.bytes as BlobPart], attachment.filename, { type: attachment.mimeType }))
      }
      if (!alive.current || generation !== queueEditEpoch()) return
      await attachments.add(files)
      const existing = latestDraft.current.text
      updateDraft({
        text:
          !existing || existing === queueEdit.draftText ? queueEdit.text : `${existing}\n${queueEdit.text}`,
        scheduledAt:
          queueEdit.scheduledAt && queueEdit.scheduledAt > Date.now() ? queueEdit.scheduledAt : null,
      })
      saveDraft(scope, id, latestDraft.current)
      saveQueueEdit(scope, id, null)
      composer.current?.focus()
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error && error.message === 'QUEUE_ALREADY_INVOKED'
            ? 'This message was already received by the agent.'
            : error instanceof Error && error.message === 'QUEUE_STILL_PENDING'
              ? 'This message is still queued. Try editing it again.'
              : errorKey(error),
        )
    } finally {
      if (alive.current) setEditWorking(false)
    }
  }
  const autoRestoredEdit = useRef<string | null>(null)
  useEffect(() => {
    if (
      queueEdit?.state !== 'ready' ||
      autoRestoredEdit.current === queueEdit.messageId ||
      attachments.loading ||
      !connected ||
      busy ||
      attempt ||
      editWorking
    )
      return
    autoRestoredEdit.current = queueEdit.messageId
    if (latestDraft.current.text === queueEdit.draftText) void restoreQueueEdit()
  }, [queueEdit, attachments.loading, connected, busy, attempt, editWorking])
  const links = useMemo(() => ({ openSession, openFile }), [openSession, openFile])
  async function attachFiles(files: File[]) {
    if (!files.length || busy || !connected || attempt || !session || attachments.loading) return
    await attachments.add(files)
    if (!session.active) {
      await action(async () => {
        const target = await scopedApi.resumeSession(id)
        if (target !== id) {
          await attachments.transfer(target)
          saveDraft(scope, id, latestDraft.current)
          migrated.current = true
          replaceSession(id, target)
        }
      }).catch(() => {})
    }
  }
  const title =
    session?.metadata?.name ||
    session?.metadata?.summary?.text ||
    session?.metadata?.path.split('/').pop() ||
    id.slice(0, 8)
  if (query.isError && !session)
    return (
      <div className="empty-pane">
        <p className="error">{t(errorKey(query.error))}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t('Refresh')}
        </Button>
      </div>
    )
  return (
    <LinkContext.Provider value={links}>
      <div
        className={`chat ${hasQuestions && questionsExpanded ? 'questions-expanded' : ''}`}
        data-testid={`chat-${id}`}
      >
        <header className="chat-header">
          <div className="agent-avatar">
            <Bot size={18} />
          </div>
          <div className="chat-heading">
            <h1>{title}</h1>
            <span>
              {session?.metadata?.flavor || 'Agent'} <span>·</span>{' '}
              {session?.model || session?.metadata?.path || t('Loading…')}
            </span>
          </div>
          <div className="chat-actions">
            <Button
              ref={outlineButton}
              variant="outline"
              size="sm"
              className="outline-toggle"
              aria-label={t('Conversation outline')}
              title={t('Conversation outline')}
              aria-expanded={outlineOpen}
              aria-controls={`outline-${id}`}
              onClick={() => {
                if (!outlineOpen) setQuestionsExpanded(false)
                setOutlineOpen((value) => !value)
              }}
            >
              <ListTree size={16} aria-hidden="true" />
            </Button>
            <button
              className="icon-button"
              aria-label={t('Session settings')}
              title={t('Session settings')}
              disabled={!session}
              onClick={() => setConfiguration(true)}
            >
              <SlidersHorizontal size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={t('Refresh')}
              title={t('Refresh')}
              onClick={() => void refresh()}
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={t('Rename')}
              title={t('Rename')}
              disabled={!connected}
              onClick={() => setRename(true)}
            >
              <Pencil size={14} />
            </button>
            {session && !session.active ? (
              <button
                className="icon-button"
                aria-label={t('Delete session')}
                title={t('Delete session')}
                disabled={!connected || busy}
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={14} />
              </button>
            ) : (
              <button
                className="icon-button"
                aria-label={t('Archive')}
                title={t('Archive')}
                disabled={!connected}
                onClick={() => setArchive(true)}
              >
                <Archive size={14} />
              </button>
            )}
          </div>
          {session && (
            <div className="session-metadata">
              <button
                className="session-mode-summary"
                onClick={() => setConfiguration(true)}
                title={t('Session settings')}
              >
                {session.metadata?.flavor === 'codex' && (
                  <span>
                    {t('Mode')}: {t(getCodexCollaborationModeLabel(session.collaborationMode ?? 'default'))}
                  </span>
                )}
                <span>
                  {t('Permission mode')}:{' '}
                  {session.permissionMode ? t(getPermissionModeLabel(session.permissionMode)) : '—'}
                </span>
                {session.metadata?.flavor !== 'hermes' && (
                  <span>
                    {t('Reasoning effort')}:{' '}
                    {(session.metadata?.flavor === 'claude'
                      ? session.effort
                      : getReasoningEffortForFlavor(
                          session.metadata?.flavor,
                          session.modelReasoningEffort,
                          session.effort,
                        )) || t('Default')}
                  </span>
                )}
              </button>
              <div className="session-timestamps">
                {(['createdAt', 'updatedAt'] as const).map((field) => {
                  const formatted = formatSessionHeaderTimestamp(session[field], locale)
                  return (
                    <span key={field}>
                      {t(field === 'createdAt' ? 'Created at' : 'Updated at')}:{' '}
                      <time
                        data-testid={field}
                        dateTime={formatted ? new Date(session[field]).toISOString() : undefined}
                        title={formatted ? new Date(session[field]).toLocaleString(locale) : undefined}
                      >
                        {formatted || '—'}
                      </time>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </header>
        {session && configuration && (
          <SessionConfiguration
            session={session}
            connected={connected}
            onClose={() => setConfiguration(false)}
            refresh={() => query.refetch({ throwOnError: true })}
          />
        )}
        {hasQuestions && (
          <div className="question-toolbar">
            <Button
              size="sm"
              variant="outline"
              aria-expanded={questionsExpanded}
              onClick={() => setQuestionsExpanded((value) => !value)}
            >
              {t(questionsExpanded ? 'Collapse questions' : 'Expand questions')}
            </Button>
          </div>
        )}
        <div className="transcript-area">
          <div className="transcript" ref={navigation.viewport} onScroll={navigation.onScroll}>
            <div ref={navigation.content}>
              {messages.hasMore && (
                <Button
                  className="load-history"
                  size="sm"
                  variant="outline"
                  disabled={messages.isLoadingMore || messages.isSyncingTail}
                  onClick={() => void navigation.loadEarlier()}
                >
                  {t(messages.isLoadingMore ? 'Loading…' : 'Load earlier messages')}
                </Button>
              )}
              {messages.warning && (
                <p role="alert" className="error">
                  {t('The request failed. Refresh and try again.')}
                </p>
              )}
              {messages.isSyncingTail && blocks.length === 0 && <p className="muted">{t('Loading…')}</p>}
              <HappyChatProvider
                value={{
                  api,
                  sessionId: id,
                  metadata: session?.metadata ?? null,
                  terminalToolDisplayMode: 'detailed',
                  showSessionSummaryInChat: false,
                  disabled: !connected || busy,
                  onRefresh: () => void refresh(),
                  hasMoreMessages: messages.hasMore,
                  isSyncingTail: messages.isSyncingTail,
                  isLoadingMoreMessages: messages.isLoadingMore,
                  loadOlderMessagesPreservingScroll: navigation.loadEarlier,
                }}
              >
                <div className="happy-thread-messages">
                  {visibleBlocks
                    .filter((block) => block.kind !== 'tool-call' || !pendingIds.has(block.tool.id))
                    .map((block) => (
                      <div
                        key={block.id}
                        id={navigation.anchorId(`${block.kind}:${block.id}`)}
                        className={`message-anchor ${navigation.located === `${block.kind}:${block.id}` ? 'is-located' : ''}`}
                        tabIndex={-1}
                      >
                        {isToolGroupBlock(block) ? (
                          <div className="message-tool-group" data-presentation={block.presentationMode}>
                            <ToolGroupCard block={block} metadata={session?.metadata ?? null} />
                          </div>
                        ) : (
                          <MessageBlock
                            block={block}
                            session={session}
                            disabled={!connected || busy}
                            done={() => void refresh()}
                            expanded={draft.expanded.includes(block.id)}
                            toggle={() =>
                              updateDraft({
                                expanded: draft.expanded.includes(block.id)
                                  ? draft.expanded.filter((id) => id !== block.id)
                                  : [...draft.expanded, block.id],
                              })
                            }
                          />
                        )}
                      </div>
                    ))}
                </div>
              </HappyChatProvider>
              {session?.thinking && (
                <div className="thinking-indicator">
                  <span />
                  <span />
                  <span />
                  {t('Thinking')}
                </div>
              )}
            </div>
          </div>
          {navigation.showLatest && (
            <Button
              className="jump-to-latest"
              variant="outline"
              size="sm"
              disabled={messages.isSyncingTail}
              onClick={() => {
                setOutlineOpen(false)
                navigation.followLatest()
                void messages.refetch()
              }}
            >
              <ArrowDownToLine size={14} aria-hidden="true" />
              {t('Back to latest messages')}
            </Button>
          )}
          {outlineOpen && (
            <div
              id={`outline-${id}`}
              ref={outlineContainer}
              className="outline-container"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setOutlineOpen(false)
                  outlineButton.current?.focus()
                }
              }}
            >
              <ConversationOutlinePanel
                items={outlineItems}
                hasMoreMessages={messages.hasMore}
                isLoadingMoreMessages={messages.isLoadingMore || messages.isSyncingTail}
                onLoadMore={() => {
                  // Keep focus inside the panel when the loading button becomes disabled.
                  outlineContainer.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
                  void navigation.loadEarlier()
                }}
                onSelect={(item) => {
                  if (navigation.jumpToMessage(item.targetMessageId)) setOutlineOpen(false)
                }}
                onClose={() => {
                  setOutlineOpen(false)
                  outlineButton.current?.focus()
                }}
              />
            </div>
          )}
        </div>
        <div className="approval-area" tabIndex={-1} aria-label={t('Pending')}>
          {pending.map((block) => {
            const QuestionFooter = isRequestUserInputToolName(block.tool.name)
              ? RequestUserInputFooter
              : isAskUserQuestionToolName(block.tool.name)
                ? AskUserQuestionFooter
                : null
            return (
              <div key={block.id} className={QuestionFooter ? 'pending-question' : undefined}>
                {QuestionFooter ? (
                  <QuestionFooter
                    api={api}
                    sessionId={id}
                    tool={block.tool}
                    disabled={!connected || busy}
                    onDone={() => void refresh()}
                    scrollable={questionsExpanded}
                  />
                ) : (
                  <ToolCard
                    api={api}
                    sessionId={id}
                    metadata={session?.metadata ?? null}
                    terminalToolDisplayMode="compact"
                    disabled={!connected || busy}
                    onDone={() => void refresh()}
                    block={block}
                  />
                )}
                <ToolExecutionTimes tool={block.tool} />
              </div>
            )
          })}
        </div>
        {session?.agentState?.codexPlanProposalId &&
          dismissedPlan !== session.agentState.codexPlanProposalId && (
            <div className="plan-actions">
              <Button
                size="sm"
                disabled={!connected || busy}
                onClick={() =>
                  void action(() =>
                    api.implementCodexPlan(id, session.agentState!.codexPlanProposalId!),
                  ).catch(() => {})
                }
              >
                {t('Implement plan')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDismissedPlan(session.agentState!.codexPlanProposalId!)
                  composer.current?.focus()
                }}
              >
                {t('Continue planning')}
              </Button>
            </div>
          )}
        {scratchlistOpen && (
          <Scratchlist
            scope={scope}
            sessionId={id}
            connected={connected}
            active={Boolean(session?.active && !controlledByUser)}
            onCompose={async (text, files) => {
              if (busy || attempt || attachments.loading || attachments.error)
                throw new Error('COMPOSER_BUSY')
              await attachments.add(files)
              updateDraft({ text: latestDraft.current.text ? `${latestDraft.current.text}\n${text}` : text })
              saveDraft(scope, id, latestDraft.current)
              setScratchlistOpen(false)
              requestAnimationFrame(() => composer.current?.focus())
            }}
          />
        )}
        {queueEdit && (
          <div className="queue-edit-recovery" role="status">
            <p>
              {t(
                queueEdit.state === 'checking'
                  ? 'Check cancellation before restoring this message.'
                  : 'Queued message cancelled. Restore it to edit and send again.',
              )}
            </p>
            <p className="queue-text">{queueEdit.text}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={editWorking || busy || Boolean(attempt) || !connected || attachments.loading}
              onClick={() => void restoreQueueEdit()}
            >
              {t(queueEdit.state === 'checking' ? 'Check status' : 'Restore to composer')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={editWorking}
              onClick={() => saveQueueEdit(scope, id, null)}
            >
              {t('Cancel')}
            </Button>
          </div>
        )}
        <QueuedMessages
          scope={scope}
          draftText={draft.text}
          editPending={Boolean(queueEdit)}
          sessionId={id}
          messages={messages.messages}
          canSteer={canSteer}
          disabled={!connected || busy || editWorking || Boolean(attempt)}
        />
        <div className="composer-wrap">
          {(error || attempt) && (
            <div className="send-alert" role="status">
              <span>{t(error || 'Delivery is unconfirmed. Check before sending again.')}</span>
              {attempt && (
                <div className="inline-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !connected || attachments.loading}
                    onClick={() => void inspectAttempt()}
                  >
                    {t('Check delivery')}
                  </Button>
                  {attempt.status === 'absent' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !connected}
                      onClick={() => void send(true)}
                    >
                      {t('Retry sending')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          <form
            className="composer"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) event.preventDefault()
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return
              event.preventDefault()
              void attachFiles(Array.from(event.dataTransfer.files))
            }}
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <input
              ref={fileInput}
              type="file"
              disabled={!connected || busy || Boolean(attempt) || !session || attachments.loading}
              multiple
              hidden
              aria-label={t('Upload files')}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                void attachFiles(files)
              }}
            />
            {attachments.items.length > 0 && (
              <AttachmentTray
                items={attachments.items}
                disabled={busy || Boolean(attempt) || !connected}
                remove={attachments.remove}
                retry={attachments.retry}
                move={attachments.move}
              />
            )}
            {attachments.error && (
              <p className="error" role="alert">
                {t(attachments.error)}
              </p>
            )}
            {suggestions.length > 0 && !attempt && (
              <div
                className="command-menu"
                role="region"
                aria-label={t(suggestionQuery?.startsWith('@') ? 'Session references' : 'Native commands')}
              >
                <Autocomplete
                  suggestions={suggestions}
                  selectedIndex={selectedCommand}
                  onSelect={selectCommand}
                />
              </div>
            )}
            <textarea
              ref={composer}
              aria-label={t('Send a message…')}
              placeholder={t('Send a message…')}
              value={draft.text}
              readOnly={Boolean(attempt)}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onSelect={(event) =>
                setSelection({
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                })
              }
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter((file) =>
                  file.type.startsWith('image/'),
                )
                if (!files.length) return
                event.preventDefault()
                void attachFiles(files)
              }}
              onChange={(e) => {
                updateDraft({ text: e.target.value })
                setSelection({ start: e.target.selectionStart, end: e.target.selectionEnd })
                setDismissedMention(null)
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
                if (suggestions.length > 0 && !attempt) {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    if (e.key === 'ArrowUp') previousCommand()
                    else nextCommand()
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setDismissedCommandQuery(draft.text)
                    setDismissedMention(mentionKey)
                    setCommandMenuOpen(false)
                    clearCommands()
                    return
                  }
                  if (
                    (e.key === 'Tab' || e.key === 'Enter') &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.shiftKey &&
                    !e.altKey &&
                    !e.repeat
                  ) {
                    e.preventDefault()
                    selectCommand(selectedCommand < 0 ? 0 : selectedCommand)
                    return
                  }
                }
                if (e.key !== 'Enter') return
                if (e.repeat) {
                  e.preventDefault()
                  return
                }
                if (!e.shiftKey && !e.altKey && (e.ctrlKey || e.metaKey || enterBehavior === 'send')) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            {draft.scheduledAt && (
              <div className="small muted">
                {t('Scheduled for {{time}}', { time: new Date(draft.scheduledAt).toLocaleString() })}
                <button type="button" onClick={() => updateDraft({ scheduledAt: null })}>
                  {t('Clear schedule')}
                </button>
              </div>
            )}
            <div className="composer-context">
              <ContextUsage
                size={reduced.latestUsage?.contextSize}
                window={reduced.latestUsage?.contextWindow}
                cacheRead={reduced.latestUsage?.cacheRead}
                model={reduced.latestUsage?.model ?? session?.model}
                flavor={session?.metadata?.flavor}
              />
              <button
                type="button"
                className={`icon-button ${scratchlistOpen ? 'selected' : ''}`}
                aria-label={t('Scratchlist')}
                title={t('Scratchlist')}
                aria-expanded={scratchlistOpen}
                onClick={() => setScratchlistOpen(!scratchlistOpen)}
              >
                <NotebookPen size={17} />
              </button>
            </div>
            <div className="composer-toolbar">
              <span className="small muted">
                {session?.metadata?.flavor || 'Agent'} <span>·</span>{' '}
                {t(
                  enterBehavior === 'send'
                    ? 'Enter sends · Shift+Enter adds a line'
                    : 'Enter adds a line · Ctrl+Enter sends',
                )}
              </span>
              <div className="inline-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={t('Upload files')}
                  title={t('Upload files')}
                  disabled={!connected || busy || Boolean(attempt) || !session || attachments.loading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip size={14} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(attempt)}
                  onClick={() => {
                    setCommandMenuOpen((value) => !value)
                    composer.current?.focus()
                  }}
                >
                  {t('Native commands')}
                </Button>
                {canSteer && !draft.text.trimStart().startsWith('/') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      !connected ||
                      busy ||
                      (!draft.text.trim() && !attachments.items.length) ||
                      !attachments.ready ||
                      Boolean(attempt)
                    }
                    onClick={() => void send(false, 'steer')}
                  >
                    {t('Insert into current turn')}
                  </Button>
                )}
                {session?.active && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!connected || busy}
                    onClick={() => void action(() => api.abortSession(id)).catch(() => {})}
                  >
                    <Square size={12} />
                    {t('Stop')}
                  </Button>
                )}
                {session && !session.active && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!connected || busy || Boolean(attempt)}
                    onClick={() =>
                      void action(async () => {
                        const to = await scopedApi.resumeSession(id)
                        if (to !== id) await attachments.transfer(to)
                        saveDraft(scope, id, latestDraft.current)
                        if (to !== id) migrated.current = true
                        replaceSession(id, to)
                      }).catch(() => {})
                    }
                  >
                    {t('Resume')}
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !connected ||
                    busy ||
                    (!draft.text.trim() && !attachments.items.length) ||
                    Boolean(attempt) ||
                    !session ||
                    attachments.loading ||
                    (session.active && !attachments.ready)
                  }
                >
                  <ArrowUp size={15} />
                  {t('Send')}
                </Button>
              </div>
            </div>
          </form>
        </div>
        <RenameSessionDialog
          isOpen={rename}
          onClose={() => setRename(false)}
          currentName={title}
          isPending={busy}
          onRename={(name) => action(() => api.renameSession(id, name))}
        />
        <ConfirmDialog
          isOpen={archive}
          onClose={() => setArchive(false)}
          title={t('Archive this session?')}
          description={t('This stops the active session and keeps its history.')}
          confirmLabel={t('Archive')}
          confirmingLabel={t('Working…')}
          isPending={busy}
          onConfirm={() => action(() => api.archiveSession(id))}
        />
        <ConfirmDialog
          isOpen={deleting}
          onClose={() => {
            if (!busy) setDeleting(false)
          }}
          title={t('Delete this session?')}
          description={t(
            'Permanently delete “{{name}}” and its messages, scratchlist and attachments? This cannot be undone.',
            { name: title },
          )}
          confirmLabel={t('Delete session')}
          confirmingLabel={t('Working…')}
          isPending={busy || !connected || !session || session.active}
          destructive
          onConfirm={async () => {
            if (busy || !connected || !session || session.active) return
            setBusy(true)
            try {
              await api.deleteSession(id)
              migrated.current = true
              sessionDeleted(id)
            } catch (cause) {
              throw new Error(t(errorKey(cause)))
            } finally {
              setBusy(false)
            }
          }}
        />
      </div>
    </LinkContext.Provider>
  )
}

function MessageBlock({
  block,
  session,
  disabled,
  done,
  expanded,
  toggle,
}: {
  block: ChatBlock
  session?: Session
  disabled: boolean
  done: () => void
  expanded: boolean
  toggle: () => void
}) {
  const { t } = useTranslation()
  const source = useRef<HTMLElement>(null)
  const { t: web } = useHapiTranslation()
  if (block.kind === 'tool-call') {
    const presentation = getToolPresentation(
      {
        toolName: block.tool.name,
        input: block.tool.input,
        result: block.tool.result,
        childrenCount: block.children.length,
        description: block.tool.nativeTitle ?? block.tool.description,
        metadata: session?.metadata ?? null,
      },
      web,
    )
    // HAPI renders plans and checklists inline; the desktop tool disclosure
    // otherwise hides the proposal even while its implementation actions are visible.
    const isPlan = [
      'ExitPlanMode',
      'exit_plan_mode',
      'update_plan',
      'TodoWrite',
      'CursorCreatePlan',
    ].includes(block.tool.name)
    return (
      <div className="message-tool">
        {!isPlan && (
          <>
            <button className="disclosure" onClick={toggle} aria-expanded={expanded}>
              {presentation.icon}
              <span className="tool-operation" title={block.tool.name}>
                <span>{presentation.title}</span>
                {presentation.subtitle && <small>{presentation.subtitle}</small>}
              </span>
              <span className="muted">
                {t(
                  block.tool.state === 'running'
                    ? 'Working…'
                    : block.tool.state === 'completed'
                      ? 'Task completed'
                      : block.tool.state === 'error'
                        ? 'Task failed'
                        : 'Pending',
                )}
              </span>
              <ChevronDown size={13} className={expanded ? 'rotated' : ''} />
            </button>
            <ToolExecutionTimes tool={block.tool} />
          </>
        )}
        {(isPlan || expanded) && session && (
          <ToolCard
            api={api}
            sessionId={session.id}
            metadata={session.metadata}
            terminalToolDisplayMode="detailed"
            disabled={disabled}
            onDone={done}
            block={block}
          />
        )}
      </div>
    )
  }
  if (block.kind === 'agent-reasoning')
    return (
      <div className="reasoning">
        <button className="disclosure" onClick={toggle}>
          <ChevronDown size={13} className={expanded ? 'rotated' : ''} />
          {t('Thinking')}
        </button>
        {expanded && <MarkdownRenderer content={block.text} />}
      </div>
    )
  if (block.kind === 'user-text' || block.kind === 'agent-text')
    return (
      <article
        ref={source}
        className={`message ${block.kind === 'user-text' ? 'user-message' : 'agent-message'}`}
      >
        <div className="message-role">
          {t(block.kind === 'user-text' ? 'You' : 'Agent')}
          <time
            dateTime={new Date(block.createdAt).toISOString()}
            title={new Date(block.createdAt).toLocaleString()}
          >
            {new Date(block.createdAt).toLocaleString(undefined, {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            })}
          </time>
          <MessageActions
            text={block.text}
            source={source}
            title={session?.metadata?.name || t('Session')}
            role={block.kind === 'user-text' ? 'user' : 'assistant'}
          />
        </div>
        <MarkdownRenderer content={block.text} />
        {block.kind === 'user-text' && block.attachments && (
          <MessageAttachments attachments={block.attachments} />
        )}
      </article>
    )
  if (block.kind === 'cli-output')
    return (
      <div className="message">
        <CodeBlock code={block.text} language="text" scrollY />
      </div>
    )
  if (block.kind === 'agent-event') {
    const event = block.event
    const commandFeedback = [
      'compact',
      'microcompact',
      'compact-summary',
      'thread-goal-updated',
      'thread-goal-cleared',
      'permission-mode-changed',
    ].includes(event.type)
    const text =
      'message' in event && typeof event.message === 'string'
        ? event.message
        : commandFeedback
          ? getEventPresentation(event).text
          : null
    if (!text) return null
    return (
      <div className={`event-message ${block.event.type === 'error' ? 'error' : ''}`}>
        <MarkdownRenderer content={text} />
        {event.type === 'compact-summary' && typeof event.summary === 'string' && (
          <MarkdownRenderer content={event.summary} />
        )}
      </div>
    )
  }
  if (block.kind === 'codex-review')
    return (
      <details className="message">
        <summary>{t('Review plan')}</summary>
        <CodeBlock code={JSON.stringify(block.review, null, 2)} language="json" scrollY />
      </details>
    )
  if (block.kind === 'generated-image' && session)
    return <GeneratedMediaCard key={`${session.id}:${block.imageId}`} sessionId={session.id} block={block} />
  return null
}
