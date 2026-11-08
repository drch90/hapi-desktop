import type { SlashCommand } from '@hapi/protocol/apiTypes'

export type CommandContext = {
  agent?: string | null
  commands: readonly Pick<SlashCommand, 'name'>[]
  supportsNativeClear: boolean
}

// Native agy accepts these aliases without listing them in its command menu.
const agyAliases = new Map([
  ['quota', 'usage'],
  ['new', 'clear'],
  ['permission', 'permissions'],
])

export function isNativeClearCommand(text: string): boolean {
  return /^\/(clear|new)\s*$/.test(text.trim())
}

export function isComposerCommand(text: string, context: CommandContext): boolean {
  // Shared conversations also handle /new locally, even when the CLI omits it
  // from its command catalog. The send path uses the same reset predicate.
  if (context.supportsNativeClear && isNativeClearCommand(text)) return true

  const name = /^\s*\/([a-z0-9:_-]+)(?=\s|$)/i.exec(text)?.[1]?.toLowerCase()
  if (!name) return false
  const canonicalName = context.agent === 'agy' ? (agyAliases.get(name) ?? name) : name

  // A slash may begin a path or ordinary text. Only an exact catalog match is
  // a command; fuzzy autocomplete suggestions do not change delivery behavior.
  return context.commands.some((command) => command.name.toLowerCase() === canonicalName)
}
