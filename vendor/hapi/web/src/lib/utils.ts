import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs))
}

/**
 * Decode base64 string to UTF-8 text
 */
export function decodeBase64(value: string): { text: string; ok: boolean } {
    try {
        const binaryString = atob(value)
        // Uint8Array.from(string, callback) builds a per-character iterable
        // and creates severe allocation pressure for multi-megabyte files.
        const bytes = new Uint8Array(binaryString.length)
        for (let index = 0; index < binaryString.length; index++) bytes[index] = binaryString.charCodeAt(index)
        const text = new TextDecoder('utf-8').decode(bytes)
        return { text, ok: true }
    } catch {
        return { text: '', ok: false }
    }
}

/**
 * Encode UTF-8 text to base64 string
 */
export function encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value)
    const binaryString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
    return btoa(binaryString)
}

