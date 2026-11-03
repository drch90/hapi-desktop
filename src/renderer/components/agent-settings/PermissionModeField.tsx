import { useTranslation } from 'react-i18next'
import { getPermissionModeOptionsForFlavor, type AgentFlavor, type PermissionMode } from '@hapi/protocol'
import { SelectControl } from '@/components/ui/select-control'

export function PermissionModeField(props: {
  agent: AgentFlavor
  value: PermissionMode
  disabled: boolean
  autoSupported?: boolean | null
  onChange: (value: PermissionMode) => void
}) {
  const { t } = useTranslation()
  const options = getPermissionModeOptionsForFlavor(props.agent)
  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <label className="text-xs font-medium text-[var(--app-hint)]">{t('Permission mode')}</label>
      {options.length ? (
        <>
          <SelectControl
            value={props.value}
            disabled={props.disabled}
            className="py-2 pl-3 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)]"
            onChange={(event) => {
              const option = options.find((option) => option.mode === event.target.value)
              if (option && !(option.mode === 'auto' && props.autoSupported === false))
                props.onChange(option.mode)
            }}
          >
            {options.map((option) => (
              <option
                key={option.mode}
                value={option.mode}
                disabled={option.mode === 'auto' && props.autoSupported === false}
              >
                {t(option.label)}
              </option>
            ))}
          </SelectControl>
          {props.autoSupported === false && (
            <p className="small muted">{t('This Grok CLI does not support Auto permission mode.')}</p>
          )}
        </>
      ) : (
        <p className="small muted" data-testid="permission-managed">
          {t('Permissions are managed by this CLI.')}
        </p>
      )}
    </div>
  )
}
