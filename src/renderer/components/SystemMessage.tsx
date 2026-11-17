import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserTextBlock } from '@/chat/types'
import { MarkdownRenderer } from './Markdown'
import { MessageActions } from './MessageActions'

/** Hub job notices share the user-message transport, but have a different author. */
export function SystemMessage({ block }: { block: UserTextBlock }) {
  const { t } = useTranslation()
  const source = useRef<HTMLElement>(null)
  const title = t('System message')
  return (
    <article ref={source} className="message system-message" aria-label={title}>
      <div className="system-message-label">{title}</div>
      <MarkdownRenderer content={block.text} userMessage />
      <div className="message-role" data-hapi-share-export-exclude="true">
        <time dateTime={new Date(block.createdAt).toISOString()}>
          {new Date(block.createdAt).toLocaleString()}
        </time>
        <MessageActions text={block.text} source={source} title={title} role="user" />
      </div>
    </article>
  )
}
