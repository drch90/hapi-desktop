import { describe, expect, it } from 'vitest';
import { MetadataSchema } from './schemas';

describe('MetadataSchema cursorSessionProtocol', () => {
    const base = {
        path: '/tmp',
        host: 'test'
    };

    it('accepts acp and stream-json protocol values', () => {
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'acp' }).success).toBe(true);
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'stream-json' }).success).toBe(true);
    });

    it('retains native identity history and externally attached Codex state without requiring them on older sessions', () => {
        expect(MetadataSchema.parse(base)).toEqual(base);
        const metadata = {
            ...base,
            claudeSessionId: 'current-native-id',
            claudeSessionIdHistory: ['earlier-native-id'],
            codexRuntime: {
                kind: 'attached',
                bindingId: '123e4567-e89b-42d3-a456-426614174000',
                state: 'history-changed',
            },
        };
        expect(MetadataSchema.parse(metadata)).toEqual(metadata);
        expect(MetadataSchema.safeParse({ ...metadata, codexRuntime: { ...metadata.codexRuntime, state: 'owned' } }).success).toBe(false);
    });

    it('rejects unknown protocol values', () => {
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'websocket' }).success).toBe(false);
    });

    it('persists Pi native history entry ids', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            conversationHistoryEntryIds: { 'local-user-id': 'pi-entry-id' },
        });
        expect(result.success).toBe(true);
        expect(result.data?.conversationHistoryEntryIds).toEqual({ 'local-user-id': 'pi-entry-id' });
    });

    it('accepts the Hub-owned automatic title attempt marker', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            titleSuggestionAutoAttemptedAt: 1234,
            titleSuggestionTurn: { first: true, completed: false },
        });

        expect(result.success).toBe(true);
        expect(result.data?.titleSuggestionAutoAttemptedAt).toBe(1234);
        expect(result.data?.titleSuggestionTurn).toEqual({ first: true, completed: false });
    });
});
