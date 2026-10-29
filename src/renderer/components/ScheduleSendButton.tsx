import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { ScheduleTimePicker, type PendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'

export function ScheduleSendButton({
  pendingSchedule,
  onChange,
  disabled,
  hasAttachments,
}: {
  pendingSchedule: PendingSchedule | null
  onChange: (schedule: PendingSchedule | null) => void
  disabled: boolean
  hasAttachments: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const blocked = disabled || hasAttachments

  useEffect(() => {
    if (blocked) setOpen(false)
  }, [blocked])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => panel.current?.querySelector('button')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      anchor.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`icon-button composer-schedule-button ${pendingSchedule ? 'selected' : ''}`}
        aria-label={t('Schedule send')}
        title={t(hasAttachments ? 'Scheduled messages cannot include attachments.' : 'Schedule send')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={pendingSchedule !== null}
        disabled={blocked}
        onClick={() => {
          if (pendingSchedule) onChange(null)
          else setOpen((value) => !value)
        }}
      >
        <Clock size={17} aria-hidden="true" />
      </button>
      {open &&
        !blocked &&
        createPortal(
          <div ref={panel}>
            <ScheduleTimePicker
              anchorRef={anchor}
              pendingSchedule={pendingSchedule}
              onSchedule={onChange}
              onClose={close}
            />
          </div>,
          document.body,
        )}
    </>
  )
}
