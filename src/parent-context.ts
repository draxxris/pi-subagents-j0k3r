import fs from 'node:fs';
import { SubagentStructuredError } from './error-metadata.js';
import type { EffectiveSubagentProfile } from './types.js';

/** Tokens reserved for the subagent's own response/tool overhead when preflighting. */
export const PARENT_CONTEXT_RESERVE_TOKENS = 16384;

/** Heuristic token estimate (chars/4). Best-effort: rejects obvious blowups, not exact. */
export function estimateParentTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function parentSessionPathFromContext(ctx: any): string | undefined {
  try {
    const direct = ctx?.sessionManager?.getSessionFile?.();
    if (typeof direct === 'string' && direct.length > 0) return direct;
  } catch {}
  return undefined;
}

function messageContentText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return typeof content === 'object' && content !== null ? JSON.stringify(content) : String(content ?? '');
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      if (typeof part === 'string' && part.trim()) parts.push(part);
      continue;
    }
    const type = (part as { type?: unknown }).type;
    if (type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      parts.push((part as { text: string }).text);
    } else if (type === 'thinking') {
      const thinking = (part as { thinking?: unknown; text?: unknown }).thinking ?? (part as { text?: unknown }).text;
      if (typeof thinking === 'string' && thinking.trim()) parts.push(`[thinking]\n${thinking}`);
    } else if (type === 'toolCall' || type === 'tool_call') {
      const name = String((part as { name?: unknown }).name ?? 'tool');
      const args = (part as { arguments?: unknown; args?: unknown; input?: unknown }).arguments
        ?? (part as { args?: unknown }).args
        ?? (part as { input?: unknown }).input
        ?? {};
      let argText = '';
      try {
        argText = JSON.stringify(args);
      } catch {
        argText = '[unserializable]';
      }
      if (argText.length > 2000) argText = `${argText.slice(0, 2000)}…`;
      parts.push(`[tool call: ${name} ${argText}]`);
    } else if (typeof (part as { text?: unknown }).text === 'string') {
      parts.push((part as { text: string }).text);
    } else if (typeof (part as { data?: unknown }).data === 'string') {
      parts.push((part as { data: string }).data);
    }
  }
  return parts.join('\n');
}

function formatEntry(entry: any): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  if (entry.type === 'compaction') {
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    if (!summary) return undefined;
    const tokens = entry.tokensBefore !== undefined ? ` (tokens before compaction: ${entry.tokensBefore})` : '';
    return `### compaction summary${tokens}\n${summary}`;
  }
  if (entry.type === 'message') {
    const message = entry.message;
    if (!message || typeof message !== 'object') return undefined;
    const role = typeof message.role === 'string' ? message.role : 'unknown';
    if (role === 'toolResult') {
      const text = messageContentText(message).trim();
      if (!text) return undefined;
      const toolName = typeof (message as { toolName?: unknown }).toolName === 'string'
        ? ` (${(message as { toolName: string }).toolName})`
        : '';
      return `**tool result${toolName}:**\n${text}`;
    }
    const text = messageContentText(message).trim();
    if (!text) return undefined;
    return `**${role}:**\n${text}`;
  }
  return undefined;
}

/**
 * Build the injectable parent-session text: the last compaction summary (when
 * present) plus every entry after it in file order. With no compaction yet,
 * every message entry. Assembled in code so the parent model spends no output
 * tokens on it — only `includeParentContext: true` (~1 token) is authored.
 */
export function buildParentContextText(sessionPath: string): { text: string; hadCompaction: boolean; keptEntries: number; totalEntries: number } {
  let raw: string;
  try {
    raw = fs.readFileSync(sessionPath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read parent session file for includeParentContext: ${sessionPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries: any[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Ignore malformed lines; never break delegation on one bad line.
    }
  }
  let lastCompactionIndex = -1;
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]?.type === 'compaction') lastCompactionIndex = index;
  }
  const relevant = lastCompactionIndex >= 0 ? entries.slice(lastCompactionIndex) : entries;
  const blocks: string[] = [];
  for (const entry of relevant) {
    const formatted = formatEntry(entry);
    if (formatted) blocks.push(formatted);
  }
  if (!blocks.length) {
    throw new Error(`Parent session has no injectable messages for includeParentContext: ${sessionPath}`);
  }
  const header = lastCompactionIndex >= 0
    ? '# parent session context (last compaction summary plus everything after it)'
    : '# parent session context (full history; no compaction yet)';
  return {
    text: `${header}\n\n${blocks.join('\n\n---\n\n')}`,
    hadCompaction: lastCompactionIndex >= 0,
    keptEntries: relevant.length,
    totalEntries: entries.length,
  };
}

/** Resolve the subagent model's context window from the live Pi context. Undefined when unknown. */
export function resolveSubagentContextWindow(ctx: any, profile?: EffectiveSubagentProfile): number | undefined {
  const ref = profile?.model.value;
  const candidates: unknown[] = [];
  if (ref?.provider && ref?.id) {
    try {
      candidates.push(ctx?.modelRuntime?.getModel?.(ref.provider, ref.id));
    } catch {}
    try {
      candidates.push(ctx?.modelRegistry?.find?.(ref.provider, ref.id));
    } catch {}
  }
  candidates.push(ctx?.model);
  for (const candidate of candidates) {
    const window = Number((candidate as { contextWindow?: unknown } | undefined)?.contextWindow);
    if (Number.isFinite(window) && window > 0) return window;
  }
  return undefined;
}

/**
 * Fail fast when the injected parent context obviously cannot fit the
 * subagent model's window. Heuristic (chars/4 + fixed reserve); unknown
 * windows never reject. Throws SubagentStructuredError(context_overflow).
 */
export function assertParentContextFits(input: {
  parentText: string;
  systemPrompt?: string;
  task: string;
  context?: string;
  ctx: any;
  profile?: EffectiveSubagentProfile;
  agentName?: string;
}): { estimatedTokens: number; contextWindow: number | undefined } {
  const { parentText, systemPrompt, task, context, ctx, profile, agentName } = input;
  const contextWindow = resolveSubagentContextWindow(ctx, profile);
  const estimatedTokens = estimateParentTokens(parentText)
    + estimateParentTokens(systemPrompt ?? '')
    + estimateParentTokens(task)
    + estimateParentTokens(context ?? '')
    + 1000;
  if (contextWindow !== undefined && estimatedTokens + PARENT_CONTEXT_RESERVE_TOKENS > contextWindow) {
    const who = agentName ? `subagent "${agentName}"` : 'subagent';
    throw new SubagentStructuredError({
      version: 1,
      category: 'context_overflow',
      message: `Parent context (~${estimatedTokens} estimated tokens + ${PARENT_CONTEXT_RESERVE_TOKENS} reserved) exceeds ${who} model window (${contextWindow}). Refine task/context or use a larger model.`,
      retryable: false,
      phase: 'manager',
      partial_result_available: false,
      details: {
        estimated_tokens: String(estimatedTokens),
        context_window: String(contextWindow),
        reserve_tokens: String(PARENT_CONTEXT_RESERVE_TOKENS),
      },
    } as any);
  }
  return { estimatedTokens, contextWindow };
}
