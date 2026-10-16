import { useMemo, useState } from 'react'
import { paginateText } from '@/lib/text-rendering'
import { useTranslation } from '@/lib/use-translation'

export function useTextPage(text: string) {
    const pages = useMemo(() => paginateText(text), [text])
    // Keeping "last" as an intent lets a reader follow the end of live output.
    const [selection, setSelection] = useState<number | 'last'>(0)
    const index = selection === 'last' ? pages.length - 1 : Math.min(selection, pages.length - 1)
    const page = pages[index]
    return {
        text: text.slice(page.start, page.end),
        startLine: page.startLine,
        index,
        count: pages.length,
        setSelection,
    }
}

export function TextPager(props: {
    index: number
    count: number
    onChange?: (page: number | 'last') => void
}) {
    const { t } = useTranslation()
    if (props.count <= 1) return null
    const buttonClass = 'rounded border border-[var(--app-border)] px-2 py-1 disabled:opacity-40'
    return (
        <div data-text-pager className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-[var(--app-hint)]">
            <span>{t('text.preview.paged')}</span>
            <span role="status">{t('text.preview.section', { current: props.index + 1, total: props.count })}</span>
            {props.onChange && (
                <span className="flex gap-1" data-hapi-share-export-exclude="true">
                    {([
                        ['first', 0, props.index === 0],
                        ['previous', props.index - 1, props.index === 0],
                        ['next', props.index + 1, props.index === props.count - 1],
                        ['last', 'last', props.index === props.count - 1],
                    ] as const).map(([label, page, disabled]) => (
                        <button
                            key={label}
                            type="button"
                            className={buttonClass}
                            disabled={disabled}
                            onClick={(event) => {
                                event.stopPropagation()
                                props.onChange?.(page)
                            }}
                        >
                            {t(`text.preview.${label}`)}
                        </button>
                    ))}
                </span>
            )}
        </div>
    )
}
