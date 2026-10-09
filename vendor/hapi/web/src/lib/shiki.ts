import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { HighlighterCore } from 'shiki/core'
import type { Root, RootContent } from 'hast'
import { useState, useEffect, type ReactNode } from 'react'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'

// Load a grammar only when it appears in a message/file. Some grammars embed
// many others (notably C++ and Ruby), so eagerly loading the whole catalog
// makes opening an otherwise plain-text conversation unnecessarily expensive.
const LANGS = {
    // Shell
    shellscript: () => import('@shikijs/langs/shellscript'),
    shellsession: () => import('@shikijs/langs/shellsession'),
    powershell: () => import('@shikijs/langs/powershell'),
    bat: () => import('@shikijs/langs/bat'),
    // Data formats
    json: () => import('@shikijs/langs/json'),
    jsonc: () => import('@shikijs/langs/jsonc'),
    json5: () => import('@shikijs/langs/json5'),
    yaml: () => import('@shikijs/langs/yaml'),
    toml: () => import('@shikijs/langs/toml'),
    xml: () => import('@shikijs/langs/xml'),
    ini: () => import('@shikijs/langs/ini'),
    dotenv: () => import('@shikijs/langs/dotenv'),
    // Markup
    markdown: () => import('@shikijs/langs/markdown'),
    html: () => import('@shikijs/langs/html'),
    css: () => import('@shikijs/langs/css'),
    scss: () => import('@shikijs/langs/scss'),
    latex: () => import('@shikijs/langs/latex'),
    mermaid: () => import('@shikijs/langs/mermaid'),
    // JavaScript ecosystem
    javascript: () => import('@shikijs/langs/javascript'),
    typescript: () => import('@shikijs/langs/typescript'),
    jsx: () => import('@shikijs/langs/jsx'),
    tsx: () => import('@shikijs/langs/tsx'),
    vue: () => import('@shikijs/langs/vue'),
    svelte: () => import('@shikijs/langs/svelte'),
    // Query languages
    sql: () => import('@shikijs/langs/sql'),
    graphql: () => import('@shikijs/langs/graphql'),
    // Systems languages
    c: () => import('@shikijs/langs/c'),
    cpp: () => import('@shikijs/langs/cpp'),
    rust: () => import('@shikijs/langs/rust'),
    go: () => import('@shikijs/langs/go'),
    // JVM
    java: () => import('@shikijs/langs/java'),
    kotlin: () => import('@shikijs/langs/kotlin'),
    // Scripting
    python: () => import('@shikijs/langs/python'),
    php: () => import('@shikijs/langs/php'),
    ruby: () => import('@shikijs/langs/ruby'),
    lua: () => import('@shikijs/langs/lua'),
    r: () => import('@shikijs/langs/r'),
    // Apple
    swift: () => import('@shikijs/langs/swift'),
    'objective-c': () => import('@shikijs/langs/objective-c'),
    // .NET
    csharp: () => import('@shikijs/langs/csharp'),
    // Flutter
    dart: () => import('@shikijs/langs/dart'),
    // DevOps
    dockerfile: () => import('@shikijs/langs/dockerfile'),
    make: () => import('@shikijs/langs/make'),
    cmake: () => import('@shikijs/langs/cmake'),
    nginx: () => import('@shikijs/langs/nginx'),
    // Misc
    diff: () => import('@shikijs/langs/diff'),
    http: () => import('@shikijs/langs/http'),
    proto: () => import('@shikijs/langs/proto'),
}

export const SHIKI_THEMES = {
    light: 'github-light',
    dark: 'github-dark',
} as const

// Alias common code fence language names to canonical names
export const langAlias: Record<string, string> = {
    sh: 'shellscript',
    bash: 'shellscript',
    zsh: 'shellscript',
    shell: 'shellscript',
    console: 'shellsession',
    'shell-session': 'shellsession',
    'bash-session': 'shellsession',
    ps: 'powershell',
    ps1: 'powershell',
    pwsh: 'powershell',
    psm1: 'powershell',
    psd1: 'powershell',
    batch: 'bat',
    cmd: 'bat',
    js: 'javascript',
    ts: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',
    mts: 'typescript',
    cts: 'typescript',
    yml: 'yaml',
    properties: 'ini',
    env: 'dotenv',
    md: 'markdown',
    tex: 'latex',
    mmd: 'mermaid',
    htm: 'html',
    pgsql: 'sql',
    mysql: 'sql',
    postgres: 'sql',
    gql: 'graphql',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    kt: 'kotlin',
    kts: 'kotlin',
    cs: 'csharp',
    'c#': 'csharp',
    'c++': 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    hh: 'cpp',
    h: 'c',
    objc: 'objective-c',
    m: 'objective-c',
    docker: 'dockerfile',
    makefile: 'make',
    mk: 'make',
    patch: 'diff',
    protobuf: 'proto',
}

// Singleton highlighter instance
let highlighterPromise: Promise<HighlighterCore> | null = null
const languagePromises = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
    if (!highlighterPromise) {
        highlighterPromise = createHighlighterCore({
            themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
            langs: [],
            engine: createJavaScriptRegexEngine({ forgiving: true }),
        }).catch((error) => {
            highlighterPromise = null
            throw error
        })
    }
    return highlighterPromise
}

export function resolveCodeLanguage(lang: string | undefined): string {
    if (!lang) return 'text'
    const lower = lang.trim().toLowerCase().replace(/^language-/, '')
    if (!lower || lower === 'text' || lower === 'plaintext' || lower === 'txt') return 'text'
    return Object.hasOwn(langAlias, lower) ? langAlias[lower] : lower
}

/** File previews use the same aliases as fences, including extensionless config files. */
export function resolveFileLanguage(path: string): string | undefined {
    const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
    if (/^(dockerfile|containerfile)(\.|$)/.test(name)) return 'dockerfile'
    if (/^(gnu)?makefile$/.test(name)) return 'make'
    if (name === 'cmakelists.txt') return 'cmake'
    if (name === 'nginx.conf') return 'nginx'
    if (name === '.env' || name.startsWith('.env.')) return 'dotenv'
    if (['.bashrc', '.zshrc', '.bash_profile', '.zprofile', '.profile'].includes(name)) return 'shellscript'
    if (/^(tsconfig|jsconfig)(\.[^.]+)*\.json$/.test(name)) return 'jsonc'
    const dot = name.lastIndexOf('.')
    if (dot < 0 || dot === name.length - 1) return undefined
    return resolveCodeLanguage(name.slice(dot + 1))
}

async function getLanguageHighlighter(lang: string): Promise<HighlighterCore | null> {
    if (!Object.hasOwn(LANGS, lang)) return null
    const highlighter = await getHighlighter()
    if (!highlighter.getLoadedLanguages().includes(lang)) {
        let pending = languagePromises.get(lang)
        if (!pending) {
            pending = (async () => {
                const grammar = await LANGS[lang as keyof typeof LANGS]()
                await highlighter.loadLanguage(grammar.default)
            })().finally(() => languagePromises.delete(lang))
            languagePromises.set(lang, pending)
        }
        await pending
    }
    return highlighter
}

/**
 * Normalize code the way the line renderer counts lines: a single trailing
 * newline is dropped so `"a\n"` is one line, not one line plus an empty
 * one. Shared by the highlighted and plain-text-fallback paths so both
 * produce the same number of lines.
 */
function stripTrailingNewline(code: string): string {
    return code.endsWith('\n') ? code.slice(0, -1) : code
}

/**
 * Split raw code into logical lines for the plain-text fallback (when
 * highlighting is unavailable). Mirrors the normalization applied before
 * highlighting so line numbers line up on both paths.
 */
export function splitCodeLines(code: string): string[] {
    return stripTrailingNewline(code).split('\n')
}

/**
 * Split an inline shiki hast tree into per-logical-line child arrays.
 *
 * With `structure: 'inline'`, shiki emits a flat list of token `<span>`s
 * with `<br>` elements marking line breaks (verified against the bundled
 * shiki version). Grouping on those `<br>` boundaries yields one child
 * array per source line, so each line can be rendered in its own grid row
 * with an aligned line number — even when the line wraps.
 *
 * The number of returned groups always equals `splitCodeLines(code).length`:
 * N lines have N-1 `<br>`s between them, so N-1 splits produce N groups
 * (including interior empty lines).
 */
export function splitHastLines(hast: Root): RootContent[][] {
    const lines: RootContent[][] = []
    let current: RootContent[] = []
    for (const child of hast.children) {
        if (child.type === 'element' && child.tagName === 'br') {
            lines.push(current)
            current = []
        } else {
            current.push(child)
        }
    }
    lines.push(current)
    return lines
}

function highlightToLineNodes(highlighter: HighlighterCore, code: string, lang: string): ReactNode[] {
    const hast = highlighter.codeToHast(stripTrailingNewline(code), {
        lang,
        themes: SHIKI_THEMES,
        defaultColor: false,
        structure: 'inline',
    })

    return splitHastLines(hast as Root).map((children) => {
        const lineRoot: Root = { type: 'root', children }
        return toJsxRuntime(lineRoot, { jsx, jsxs, Fragment }) as ReactNode
    })
}

/**
 * Custom hook for syntax highlighting with our minimal Shiki bundle.
 * Returns a single ReactNode of the highlighted code (inline structure),
 * or null while pending / for unsupported languages (plain-text fallback).
 */
function useHighlightedCode<T>(
    code: string,
    language: string | undefined,
    render: (highlighter: HighlighterCore, code: string, lang: string) => T,
): T | null {
    const [result, setResult] = useState<{ code: string; lang: string; value: T | null } | null>(null)
    const lang = resolveCodeLanguage(language)

    useEffect(() => {
        if (!Object.hasOwn(LANGS, lang)) return
        let cancelled = false

        async function highlight() {
            try {
                const highlighter = await getLanguageHighlighter(lang)
                if (cancelled) return
                const value = highlighter ? render(highlighter, code, lang) : null
                setResult({ code, lang, value })
            } catch {
                // Missing chunks or a grammar failure must never hide the code
                // or surface an unhandled rejection during a streaming reply.
                if (!cancelled) setResult({ code, lang, value: null })
            }
        }

        // Debounce highlighting — 150ms reduces CPU pressure on Windows during
        // streaming where code blocks update rapidly (see #310)
        const timer = setTimeout(highlight, 150)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [code, lang, render])

    // Show the latest source immediately while the debounce/import is pending.
    // Otherwise streaming or reusing a block briefly displays the previous code.
    return result?.code === code && result.lang === lang ? result.value : null
}

function highlightToNode(highlighter: HighlighterCore, code: string, lang: string): ReactNode {
    const hast = highlighter.codeToHast(code, {
        lang,
        themes: SHIKI_THEMES,
        defaultColor: false,
        structure: 'inline',
    })
    return toJsxRuntime(hast, { jsx, jsxs, Fragment })
}

export function useShikiHighlighter(
    code: string,
    language: string | undefined
): ReactNode | null {
    return useHighlightedCode(code, language, highlightToNode)
}

/**
 * Like {@link useShikiHighlighter} but returns the highlighted code split
 * into one ReactNode per logical line, so callers can render each line in
 * its own row with an aligned line number that survives wrapping. Returns
 * null while pending / for unsupported languages (the caller falls back to
 * splitting the raw `code` on newlines).
 */
export function useShikiHighlightedLines(
    code: string,
    language: string | undefined
): ReactNode[] | null {
    return useHighlightedCode(code, language, highlightToLineNodes)
}
