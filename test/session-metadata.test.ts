import { describe, expect, it, vi } from 'vitest';
import { cleanSessionTitle, ensureSubagentSessionMarker, SUBAGENT_SESSION_MARKER_CUSTOM_TYPE } from '../src/session-metadata.js';

describe('sub-agent session metadata', () => {
  it('writes an idempotent persisted marker', () => {
    const appendCustomEntry = vi.fn();
    const entries: any[] = [];
    const sessionManager = {
      getEntries: () => entries,
      appendCustomEntry: (customType: string, data: unknown) => {
        appendCustomEntry(customType, data);
        entries.push({ type: 'custom', customType, data });
      },
    };

    ensureSubagentSessionMarker(sessionManager, {
      agent: 'analyst',
      taskId: 'task-1',
      parentSessionPath: '/sessions/parent.jsonl',
    });
    ensureSubagentSessionMarker(sessionManager, { agent: 'analyst', taskId: 'task-1' });

    expect(appendCustomEntry).toHaveBeenCalledOnce();
    expect(appendCustomEntry).toHaveBeenCalledWith(
      SUBAGENT_SESSION_MARKER_CUSTOM_TYPE,
      expect.objectContaining({
        version: 1,
        agent: 'analyst',
        taskId: 'task-1',
        parentSessionPath: '/sessions/parent.jsonl',
      }),
    );
  });
});

describe('cleanSessionTitle', () => {
  it('collapses whitespace and trims an orchestrator-supplied title', () => {
    expect(cleanSessionTitle('  Audit\nthe\tauth\n\nflow  ')).toBe('Audit the auth flow');
  });

  it('strips control and format characters', () => {
    expect(cleanSessionTitle('Review\u0000\u200b auth\uFEFF flows')).toBe('Review auth flows');
  });

  it('caps the title length so the session picker stays readable', () => {
    const longTitle = 'Fix '.repeat(60) + ' trailing phrase';
    const cleaned = cleanSessionTitle(longTitle)!;
    expect(cleaned.length).toBeLessThanOrEqual(100);
    expect(cleaned).toBe(longTitle.replace(/\s+/g, ' ').trim().slice(0, 100).trim());
  });

  it('returns undefined for missing, empty, or whitespace-only input', () => {
    expect(cleanSessionTitle(undefined)).toBeUndefined();
    expect(cleanSessionTitle('')).toBeUndefined();
    expect(cleanSessionTitle('   \n\t ')).toBeUndefined();
  });
});
