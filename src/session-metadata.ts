export const SUBAGENT_SESSION_MARKER_CUSTOM_TYPE = 'pi-subagents-j0k3r:subagent-session';

const MAX_SUBAGENT_SESSION_TITLE_LENGTH = 100;

/**
 * Normalize an orchestrator-supplied nested session title: strip control and
 * format characters, collapse whitespace, and cap the length so the session
 * picker stays readable. Returns undefined when nothing meaningful remains.
 */
export function cleanSessionTitle(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined;
  const cleaned = text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > MAX_SUBAGENT_SESSION_TITLE_LENGTH
    ? cleaned.slice(0, MAX_SUBAGENT_SESSION_TITLE_LENGTH).trim()
    : cleaned;
}

export type SubagentSessionMarker = {
  version: 1;
  agent: string;
  taskId?: string;
  parentSessionPath?: string;
};

/**
 * Mark a persisted Pi session as owned by j0k3r. Custom entries are ignored by
 * Pi's conversation context, but are retained in the JSONL file so another
 * runtime can identify sub-agent sessions later.
 */
export function ensureSubagentSessionMarker(sessionManager: any, marker: Omit<SubagentSessionMarker, 'version'>): void {
  if (typeof sessionManager?.appendCustomEntry !== 'function') return;

  try {
    const entries = typeof sessionManager.getEntries === 'function' ? sessionManager.getEntries() : [];
    if (Array.isArray(entries) && entries.some((entry: any) => (
      entry?.type === 'custom' && entry.customType === SUBAGENT_SESSION_MARKER_CUSTOM_TYPE
    ))) return;
  } catch {
    // The marker append below is still useful when an SDK does not expose its
    // entries through the structural session-manager interface.
  }

  sessionManager.appendCustomEntry(SUBAGENT_SESSION_MARKER_CUSTOM_TYPE, {
    version: 1,
    ...marker,
  } satisfies SubagentSessionMarker);
}
