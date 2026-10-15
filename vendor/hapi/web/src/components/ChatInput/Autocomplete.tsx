import { memo, useEffect, useRef } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'

interface AutocompleteProps {
    suggestions: readonly Suggestion[]
    selectedIndex: number
    onSelect: (index: number) => void
}

/**
 * Autocomplete suggestions list component
 */
export const Autocomplete = memo(function Autocomplete(props: AutocompleteProps) {
    const { suggestions, selectedIndex, onSelect } = props
    const listRef = useRef<HTMLDivElement>(null)
    const selectedKey = suggestions[selectedIndex]?.key

    useEffect(() => {
        if (selectedIndex < 0 || selectedIndex >= suggestions.length) return
        const listEl = listRef.current
        if (!listEl) return
        const selectedEl = listEl.querySelector<HTMLButtonElement>(
            `[data-suggestion-index="${selectedIndex}"]`
        )
        selectedEl?.scrollIntoView({ block: 'nearest' })
    // Catalog refreshes and newly added rows must not undo manual scrolling.
    // Follow the selection only when the logical selected item changes.
    }, [selectedKey])

    if (suggestions.length === 0) {
        return null
    }

    return (
        <div ref={listRef}>
            {suggestions.map((suggestion, index) => (
                <button
                    key={suggestion.key}
                    type="button"
                    data-suggestion-index={index}
                    className={`flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
                        index === selectedIndex
                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                            : 'text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                    }`}
                    onClick={() => onSelect(index)}
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur on textarea
                >
                    <span className="w-full font-medium">{suggestion.label}</span>
                    {suggestion.description && (
                        <span className={`w-full min-h-[2.25rem] text-xs leading-snug line-clamp-2 ${
                            index === selectedIndex
                                ? 'opacity-80'
                                : 'text-[var(--app-hint)]'
                        }`}>
                            {suggestion.description}
                        </span>
                    )}
                </button>
            ))}
        </div>
    )
})
