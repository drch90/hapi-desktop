import * as Popover from '@radix-ui/react-popover'
import { useEffect, useId, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@hapi/protocol'
import { MachineHealthTooltipBody } from '@/components/MachineHealthIndicator'
import { presentMachineHealth, type MachineHealthTone } from '@/lib/machineHealth'

export function MachineHealth({
  machines,
  machineId,
  selectedLabel,
  connected,
  loading,
  failed,
  compact = false,
}: {
  machines: Machine[]
  machineId: string
  selectedLabel: string
  connected: boolean
  loading: boolean
  failed: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const tooltipId = useId()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const keyboardFocus = useRef(false)
  const hovered = useRef(false)
  const show = () => {
    clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const leave = () => {
    clearTimeout(closeTimer.current)
    // Allow the pointer to cross the gap into the details without flickering.
    closeTimer.current = setTimeout(() => {
      if (!hovered.current && !keyboardFocus.current) setOpen(false)
    }, 150)
  }
  const hover = () => {
    hovered.current = true
    show()
  }
  const unhover = () => {
    hovered.current = false
    leave()
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const visibleMachines = machineId ? machines.filter((machine) => machine.id === machineId) : machines
  const entries = visibleMachines.map((machine) => {
    // Cached readings stop describing live capacity once the runner or Hub is unavailable.
    const presentation =
      connected && !failed && machine.active
        ? presentMachineHealth(machine.health, machine.metadata?.platform)
        : null
    // The desktop also opens details for runners with no CPU/RAM readings.
    // Uptime alone cannot establish whether that machine has spare capacity.
    if (presentation && !presentation.metrics.length && !presentation.loadDetail) {
      presentation.overallTone = 'unknown'
      presentation.status = 'unknown'
    }
    return {
      machine,
      label: machine.metadata?.displayName || machine.metadata?.host || machine.id,
      presentation,
    }
  })
  const single = entries.length === 1 ? entries[0] : null
  const unavailable = !connected
    ? t('disconnected')
    : loading
      ? t('Loading…')
      : failed
        ? t('Unable to load machine health.')
        : entries.length === 0
          ? t(machineId ? 'Machine unavailable. Select an online machine.' : 'No online machines')
          : null
  const summary =
    unavailable ??
    (single
      ? !single.machine.active
        ? t('Offline')
        : single.presentation?.metrics.length
          ? single.presentation.metrics.map((metric) => `${metric.shortLabel} ${metric.percent}%`).join(' · ')
          : t('Metrics unavailable')
      : t('Machines ({{count}})', { count: entries.length }))
  const tones = entries.map((entry) => entry.presentation?.overallTone ?? 'unknown')
  const tone: MachineHealthTone = unavailable
    ? 'unknown'
    : tones.includes('critical')
      ? 'critical'
      : tones.includes('warn')
        ? 'warn'
        : tones.includes('unknown')
          ? 'unknown'
          : 'ok'

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <span
          ref={anchor}
          role="group"
          tabIndex={0}
          className={`machine-health-trigger${compact ? ' compact' : ''}`}
          data-tone={tone}
          data-state={open ? 'open' : 'closed'}
          aria-label={t('System health')}
          aria-describedby={open ? tooltipId : undefined}
          onMouseEnter={hover}
          onMouseLeave={unhover}
          onFocus={(event) => {
            // Mouse clicks never pin the tooltip; keyboard focus can still read it.
            if (event.currentTarget.matches(':focus-visible')) {
              keyboardFocus.current = true
              show()
            }
          }}
          onBlur={() => {
            keyboardFocus.current = false
            leave()
          }}
        >
          <Activity size={16} className="machine-health-icon" aria-hidden="true" />
          {!compact && (
            <>
              <span className="machine-health-summary">
                <span className="machine-health-label">
                  {single?.label || selectedLabel || t('System health')}
                </span>
                <span className="machine-health-metrics">{summary}</span>
              </span>
            </>
          )}
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={tooltipId}
          role="tooltip"
          className="machine-health-tooltip"
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          aria-label={t('System health')}
          onMouseEnter={hover}
          onMouseLeave={unhover}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchor.current?.contains(event.target as Node)) event.preventDefault()
          }}
        >
          <div className="machine-health-details">
            {unavailable ? (
              <p className="muted">{unavailable}</p>
            ) : (
              entries.map(({ machine, label, presentation }) => (
                <section className="machine-health-machine" key={machine.id} data-machine-id={machine.id}>
                  <h3>{label}</h3>
                  {machine.metadata?.host && machine.metadata.host !== label && (
                    <p className="machine-health-host">{machine.metadata.host}</p>
                  )}
                  {presentation ? (
                    <div className="machine-health-readings">
                      <MachineHealthTooltipBody presentation={presentation} />
                    </div>
                  ) : (
                    <p className="muted">{t(machine.active ? 'Metrics unavailable' : 'Offline')}</p>
                  )}
                </section>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
