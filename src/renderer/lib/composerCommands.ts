import type { SlashCommand } from '@hapi/protocol/apiTypes'

type CommandContext = {
  commands: readonly Pick<SlashCommand, 'name'>[]
  supportsNativeClear: boolean
}

export function isNativeClearCommand(text: string): boolean {
  return /^\/(clear|new)\s*$/.test(text.trim())
}

export function isComposerCommand(text: string, context: CommandContext): boolean {
  // Shared conversations also handle /new locally, even when the CLI omits it
  // from its command catalog. The send path uses the same reset predicate.
  if (context.supportsNativeClear && isNativeClearCommand(text)) return true

  const name = /^\s*\/([a-z0-9:_-]+)(?=\s|$)/i.exec(text)?.[1]?.toLowerCase()
  if (!name) return false

  // A slash may begin a path or ordinary text. Only an exact catalog match is
  // a command; fuzzy autocomplete suggestions do not change delivery behavior.
  return context.commands.some((command) => command.name.toLowerCase() === name)
}
