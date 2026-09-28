import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { File, Folder, ArrowUp, RefreshCw, X, GitBranch, LockKeyhole } from 'lucide-react'
import { CodeBlock } from '@/components/CodeBlock'
import { buildGitStatusFiles } from '@/lib/gitParsers'
import { api, errorKey } from '../lib/api'

export function FilePanel({
  sessionId,
  requestedPath,
  close,
}: {
  sessionId: string
  requestedPath?: string
  close: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'Files' | 'Changes'>('Files')
  const [directory, setDirectory] = useState('.')
  const [selected, setSelected] = useState<{ path: string; staged?: boolean; diff?: boolean } | null>(null)
  useEffect(() => {
    if (requestedPath) {
      setTab('Files')
      setSelected({ path: requestedPath })
    }
  }, [requestedPath])
  const files = useQuery({
    queryKey: ['directory', sessionId, directory],
    queryFn: async () => {
      const result = await api.listSessionDirectory(sessionId, directory)
      if (!result.success) throw new Error('FILE_FAILED')
      return result.entries ?? []
    },
    enabled: tab === 'Files',
  })
  const git = useQuery({
    queryKey: ['git', sessionId],
    queryFn: async () => {
      const results = await Promise.all([
        api.getGitStatus(sessionId),
        api.getGitDiffNumstat(sessionId, false),
        api.getGitDiffNumstat(sessionId, true),
      ])
      if (results.some((result) => !result.success)) throw new Error('GIT_FAILED')
      return buildGitStatusFiles(results[0].stdout ?? '', results[1].stdout ?? '', results[2].stdout ?? '')
    },
    enabled: tab === 'Changes',
  })
  const content = useQuery({
    queryKey: ['file', sessionId, selected],
    enabled: Boolean(selected),
    queryFn: async () => {
      if (selected!.diff) {
        const result = await api.getGitDiffFile(sessionId, selected!.path, selected!.staged)
        if (!result.success) throw new Error('FILE_FAILED')
        return { text: result.stdout ?? '', binary: false }
      }
      const result = await api.readSessionFile(sessionId, selected!.path)
      if (!result.success || result.content === undefined) throw new Error('FILE_FAILED')
      const bytes = Uint8Array.from(atob(result.content), (char) => char.charCodeAt(0))
      const binary = bytes.slice(0, 8000).includes(0)
      return { text: binary ? '' : new TextDecoder().decode(bytes), binary }
    },
  })
  return (
    <aside className="file-panel">
      <header>
        <div className="file-tabs">
          {(['Files', 'Changes'] as const).map((value) => (
            <button
              key={value}
              className={tab === value ? 'selected' : ''}
              onClick={() => {
                setTab(value)
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
            void (tab === 'Files' ? files.refetch() : git.refetch())
            if (selected) void content.refetch()
          }}
        >
          <RefreshCw size={14} />
        </button>
        <button className="icon-button" aria-label={t('Close tab')} onClick={close}>
          <X size={15} />
        </button>
      </header>
      <div className="file-context">
        <LockKeyhole size={11} />
        {t('Read only')}
        {git.data?.branch && tab === 'Changes' && (
          <>
            <GitBranch size={11} />
            {git.data.branch}
          </>
        )}
      </div>
      <div className="file-list">
        {tab === 'Files' ? (
          <>
            <div className="directory-path">
              <button
                className="icon-button"
                aria-label={t('Parent folder')}
                onClick={() => setDirectory(directory === '.' ? '..' : `${directory}/..`)}
              >
                <ArrowUp size={13} />
              </button>
              <span title={directory}>{directory}</span>
            </div>
            {[...(files.data ?? [])]
              .sort(
                (a, b) =>
                  Number(b.type === 'directory') - Number(a.type === 'directory') ||
                  a.name.localeCompare(b.name),
              )
              .map((entry) => (
                <button
                  className={`file-row ${selected?.path === `${directory}/${entry.name}` ? 'selected' : ''}`}
                  key={entry.name}
                  onClick={() =>
                    entry.type === 'directory'
                      ? setDirectory(`${directory}/${entry.name}`)
                      : setSelected({ path: `${directory}/${entry.name}` })
                  }
                >
                  {entry.type === 'directory' ? <Folder size={14} /> : <File size={14} />}
                  <span>{entry.name}</span>
                </button>
              ))}
          </>
        ) : (
          <>
            {[
              ['Staged', git.data?.stagedFiles],
              ['Unstaged', git.data?.unstagedFiles],
            ].map(([label, entries]) => (
              <section key={String(label)}>
                <h3 className="eyebrow">{t(String(label))}</h3>
                {(entries as NonNullable<typeof git.data>['stagedFiles'] | undefined)?.map((entry) => (
                  <button
                    className={`file-row ${selected?.path === entry.fullPath && selected.staged === entry.isStaged ? 'selected' : ''}`}
                    key={entry.fullPath}
                    onClick={() =>
                      setSelected({
                        path: entry.fullPath,
                        staged: entry.isStaged,
                        diff: entry.status !== 'untracked',
                      })
                    }
                  >
                    <File size={14} />
                    <span title={entry.fullPath}>{entry.fullPath}</span>
                    <small className="diff-add">+{entry.linesAdded}</small>
                    <small className="diff-remove">−{entry.linesRemoved}</small>
                  </button>
                ))}
              </section>
            ))}
            {git.data && !git.data.stagedFiles.length && !git.data.unstagedFiles.length && (
              <p className="muted padded">{t('No changes')}</p>
            )}
          </>
        )}
        {(tab === 'Files' ? files.isPending : git.isPending) && (
          <p className="muted padded">{t('Loading…')}</p>
        )}
        {(tab === 'Files' ? files.isError : git.isError) && (
          <p className="error padded">{t('The request failed. Refresh and try again.')}</p>
        )}
      </div>
      <div className="file-preview">
        {selected ? (
          <>
            <h3 title={selected.path}>{selected.path}</h3>
            {content.isPending && <p className="muted">{t('Loading…')}</p>}
            {content.isError && <p className="error">{t(errorKey(content.error))}</p>}
            {content.data?.binary && <p className="muted">{t('Binary file cannot be previewed')}</p>}
            {content.data &&
              !content.data.binary &&
              (selected.diff ? (
                <pre className="unified-diff">
                  {content.data.text.split('\n').map((line, index) => (
                    <span
                      key={index}
                      className={
                        line.startsWith('+')
                          ? 'added'
                          : line.startsWith('-')
                            ? 'removed'
                            : line.startsWith('@@')
                              ? 'hunk'
                              : ''
                      }
                    >
                      {line || ' '}
                      <br />
                    </span>
                  ))}
                </pre>
              ) : (
                <CodeBlock
                  code={content.data.text}
                  language={selected.path.split('.').pop()}
                  scrollY
                  maxHeight={1000}
                />
              ))}
          </>
        ) : (
          <div className="empty-preview">
            <File size={25} strokeWidth={1} />
            <p>{t('Select a file to preview')}</p>
          </div>
        )}
      </div>
    </aside>
  )
}
