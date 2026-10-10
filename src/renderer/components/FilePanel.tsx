import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, X, GitBranch, LockKeyhole } from 'lucide-react'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { FileActionMenu } from '@/components/FileActionMenu'
import { DirectorySortMenu, GitFileRow, SearchResultRow } from '@/routes/sessions/files'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSessionFileSearch } from '@/hooks/queries/useSessionFileSearch'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'
import { DEFAULT_DIRECTORY_SORT, sortFileSearchItems, type DirectorySort } from '@/lib/directory-sort'
import { resolveAbsoluteFilePath } from '@/lib/file-path'
import { formatGitStatusError, formatFileSearchError, getDetachedBranchLabel } from '@/lib/files-i18n'
import { api } from '../lib/api'
import { SaveFileButton } from './SaveFileButton'
import { FilePreview } from './FilePreview'

export type FileRequest = { sessionId: string; path: string; requestId: string }

export function FilePanel(props: {
  sessionId: string
  scope: string
  workspacePath?: string
  request?: FileRequest
  close: () => void
  onAddToComposer: (path: string) => void
  onOpenSession: (id: string) => void
}) {
  const { t } = useTranslation()
  const { t: web, locale } = useHapiTranslation()
  const client = useQueryClient()
  const settingsKey = `desktop:file-panel:${props.scope}`
  const [preferences, setPreferences] = useState<{ tab: 'Files' | 'Changes'; sort: DirectorySort }>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(settingsKey) ?? '')
      if (
        ['Files', 'Changes'].includes(value.tab) &&
        ['name', 'modified', 'size'].includes(value.sort?.field) &&
        ['asc', 'desc'].includes(value.sort?.direction)
      )
        return value
    } catch {
      /* Use the default for older workspaces. */
    }
    return { tab: 'Files', sort: DEFAULT_DIRECTORY_SORT }
  })
  const { tab, sort } = preferences
  const [selected, setSelected] = useState<{ path: string; staged?: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ path: string; point: { x: number; y: number } } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const listKey = `desktop:file-list:${props.scope}:${props.sessionId}:${tab}`
  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify(preferences))
  }, [settingsKey, preferences])
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (props.request) setSelected({ path: props.request.path })
  }, [props.request])
  useEffect(() => {
    if (list.current) list.current.scrollTop = Number(sessionStorage.getItem(listKey)) || 0
  }, [selected, listKey])
  const git = useGitStatusFiles(api, props.sessionId)
  const results = useSessionFileSearch(api, props.sessionId, query, { enabled: Boolean(query) })
  const sorted = useMemo(
    () => sortFileSearchItems(results.files, sort, locale),
    [results.files, sort, locale],
  )
  const searching = Boolean(search.trim())
  const rootLabel = props.workspacePath?.split('/').filter(Boolean).pop() || props.sessionId
  return (
    <aside className="file-panel" aria-label={t('Files')}>
      <header>
        <div className="file-tabs">
          {(['Files', 'Changes'] as const).map((value) => (
            <button
              key={value}
              className={tab === value ? 'selected' : ''}
              aria-pressed={tab === value}
              onClick={() => {
                setPreferences((valueBefore) => ({ ...valueBefore, tab: value }))
                setSelected(null)
              }}
            >
              {t(value)}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          aria-label={t('Refresh')}
          onClick={() => {
            if (searching) void results.refetch()
            else if (tab === 'Files')
              void client.invalidateQueries({ queryKey: ['session-directory', props.sessionId] })
            else void git.refetch()
            if (selected) {
              void client.invalidateQueries({ queryKey: ['desktop-file', props.sessionId, selected.path] })
              void client.invalidateQueries({
                queryKey: ['desktop-file-diff', props.sessionId, selected.path],
              })
            }
          }}
        >
          <RefreshCw size={14} />
        </button>
        <button className="icon-button" aria-label={t('Close tab')} onClick={props.close}>
          <X size={15} />
        </button>
      </header>
      {selected ? (
        <FilePreview
          key={`${selected.path}:${selected.staged}`}
          {...selected}
          sessionId={props.sessionId}
          scope={props.scope}
          onBack={() => setSelected(null)}
          onOpenFile={(path) => setSelected({ path })}
          onAddToComposer={props.onAddToComposer}
          onOpenSession={props.onOpenSession}
        />
      ) : (
        <>
          <div className="file-search">
            <input
              type="search"
              aria-label={t('Search files')}
              placeholder={t('Search files')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <DirectorySortMenu
              sort={sort}
              onChange={(value) => setPreferences((previous) => ({ ...previous, sort: value }))}
            />
          </div>
          <div className="file-context">
            <LockKeyhole size={11} />
            {t('Read only')}
            {tab === 'Changes' && git.status && (
              <>
                <GitBranch size={12} />
                <span>{getDetachedBranchLabel(git.status.branch, web)}</span>
              </>
            )}
          </div>
          {tab === 'Changes' && git.status && !searching && (
            <div className="file-summary">
              {web('files.branch.summary', {
                staged: git.status.totalStaged,
                unstaged: git.status.totalUnstaged,
              })}
            </div>
          )}
          <div
            className="file-list"
            ref={list}
            onScroll={() => {
              if (list.current) sessionStorage.setItem(listKey, String(list.current.scrollTop))
            }}
          >
            {searching ? (
              <>
                {search.trim() !== query || results.isLoading ? (
                  <p className="padded muted">{t('Loading…')}</p>
                ) : results.error ? (
                  <p className="padded error" role="alert">
                    {formatFileSearchError(results.error, web)}
                  </p>
                ) : sorted.length === 0 ? (
                  <p className="padded muted">{web('files.search.empty')}</p>
                ) : (
                  sorted.map((file) => (
                    <SearchResultRow
                      key={file.fullPath}
                      file={file}
                      showDivider
                      onOpen={() => setSelected({ path: file.fullPath })}
                      onOpenMenu={(point) => setMenu({ path: file.fullPath, point })}
                    />
                  ))
                )}
              </>
            ) : tab === 'Files' ? (
              <DirectoryTree
                api={api}
                sessionId={props.sessionId}
                storageKey={`${props.scope}:${props.sessionId}`}
                rootLabel={rootLabel}
                sort={sort}
                onOpenFile={(path) => setSelected({ path })}
                onRequestFileMenu={(path, point) => setMenu({ path, point })}
                onRequestDirectoryMenu={(path, point) => setMenu({ path, point })}
                renderDownload={(path, fileName) => (
                  <SaveFileButton
                    compact
                    source={{ kind: 'file', sessionId: props.sessionId, path }}
                    fileName={fileName}
                  />
                )}
              />
            ) : (
              <>
                {git.error && (
                  <p className="padded error" role="alert">
                    {formatGitStatusError(git.error, web)}
                  </p>
                )}
                {git.isLoading ? (
                  <p className="padded muted">{t('Loading…')}</p>
                ) : (
                  <>
                    {(
                      [
                        ['Staged', git.status?.stagedFiles],
                        ['Unstaged', git.status?.unstagedFiles],
                      ] as const
                    ).map(([label, files]) =>
                      files?.length ? (
                        <section key={label}>
                          <h3 className="eyebrow">
                            {t(label)} ({files.length})
                          </h3>
                          {files.map((file) => (
                            <div className="file-row" data-path={file.fullPath} key={file.fullPath}>
                              <GitFileRow
                                file={file}
                                showDivider
                                onOpen={() => setSelected({ path: file.fullPath, staged: file.isStaged })}
                                onOpenMenu={(point) => setMenu({ path: file.fullPath, point })}
                              />
                            </div>
                          ))}
                        </section>
                      ) : null,
                    )}
                    {git.status && !git.status.stagedFiles.length && !git.status.unstagedFiles.length && (
                      <p className="padded muted">{t('No changes')}</p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
      <FileActionMenu
        isOpen={menu !== null}
        onClose={() => setMenu(null)}
        relativePath={menu?.path || '.'}
        absolutePath={resolveAbsoluteFilePath(props.workspacePath, menu?.path ?? '')}
        anchorPoint={menu?.point ?? { x: 0, y: 0 }}
        onAddToComposer={() => {
          if (menu) props.onAddToComposer(menu.path || '.')
        }}
      />
    </aside>
  )
}
