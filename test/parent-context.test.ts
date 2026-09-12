import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SubagentManager } from '../src/manager.js';
import { installSubagentTestEnv } from './helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();
import {
  assertParentContextFits,
  buildParentContextText,
  estimateParentTokens,
  resolveSubagentContextWindow,
} from '../src/parent-context.js';
import { buildPrompt } from '../src/runner/prompt.js';

function writeSession(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-parent-ctx-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return file;
}

describe('includeParentContext', () => {
  it('includes everything when never compacted', () => {
    const file = writeSession([
      { type: 'session', id: 's1' },
      { type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: 'hello' } },
      { type: 'message', id: 'm2', parentId: 'm1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] } },
    ]);
    const built = buildParentContextText(file);
    expect(built.hadCompaction).toBe(false);
    expect(built.text).toContain('hello');
    expect(built.text).toContain('hi there');
  });

  it('includes only the last compaction summary plus tail', () => {
    const file = writeSession([
      { type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: 'old work' } },
      { type: 'compaction', id: 'c1', parentId: 'm1', summary: 'first summary', firstKeptEntryId: 'm2', tokensBefore: 100 },
      { type: 'message', id: 'm2', parentId: 'c1', message: { role: 'user', content: 'middle work' } },
      { type: 'compaction', id: 'c2', parentId: 'm2', summary: 'second summary', firstKeptEntryId: 'm3', tokensBefore: 200 },
      { type: 'message', id: 'm3', parentId: 'c2', message: { role: 'user', content: 'new work' } },
    ]);
    const built = buildParentContextText(file);
    expect(built.hadCompaction).toBe(true);
    expect(built.text).toContain('second summary');
    expect(built.text).toContain('new work');
    expect(built.text).not.toContain('old work');
    expect(built.text).not.toContain('first summary');
    expect(built.text).not.toContain('middle work');
  });

  it('renders parent context ahead of orchestrator context and task', () => {
    const prompt = buildPrompt({ name: 'a' } as any, 'do it', 'orchestrator notes', [], 'parent history');
    const parentIndex = prompt.indexOf('## parent session context');
    const contextIndex = prompt.indexOf('## orchestrator context');
    const taskIndex = prompt.indexOf('## delegated task');
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(parentIndex).toBeLessThan(contextIndex);
    expect(contextIndex).toBeLessThan(taskIndex);
  });

  it('rejects immediately when the injected text obviously exceeds the model window', () => {
    const parentText = 'x'.repeat(40000);
    const ctx = { model: { provider: 'p', id: 'small', contextWindow: 8000 } };
    let caught: any;
    try {
      assertParentContextFits({
        parentText,
        systemPrompt: 'sys',
        task: 'task',
        ctx,
        profile: { agent: 'a', model: { value: { provider: 'p', id: 'small' }, source: 'profile', label: '' }, effort: { value: undefined, source: 'unresolved', label: '' } } as any,
        agentName: 'a',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught?.error_metadata?.category).toBe('context_overflow');
    expect(caught?.error_metadata?.details?.context_window).toBe('8000');
  });

  it('never rejects when the model window is unknown', () => {
    const parentText = 'x'.repeat(400000);
    const result = assertParentContextFits({ parentText, task: 't', ctx: {} });
    expect(result.contextWindow).toBeUndefined();
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('resolves context window from registry models', () => {
    const ctx = { modelRegistry: { find: () => ({ contextWindow: 64000 }) } };
    expect(resolveSubagentContextWindow(ctx, { model: { value: { provider: 'p', id: 'm' } } } as any)).toBe(64000);
    expect(estimateParentTokens('abcd')).toBe(1);
  });

  it('rejects the whole subagent_run before launching when parent context overflows', async () => {
    env.writeAgent('analyst');
    const file = writeSession([
      { type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: 'x'.repeat(40000) } },
    ]);
    let calls = 0;
    const manager = new SubagentManager(async () => { calls += 1; return { result: 'ok', fallback_used: false }; });
    const ctx = {
      cwd: env.tmp,
      sessionManager: { getSessionFile: () => file, getSessionId: () => 'parent-1' },
      model: { provider: 'p', id: 'small', contextWindow: 8000 },
    };
    await expect(manager.run({ agent: 'analyst', task: 'do it', includeParentContext: true }, ctx)).rejects.toThrow(/context overflow/);
    expect(calls).toBe(0);
  });

  it('passes injected parent context to the runner when it fits', async () => {
    env.writeAgent('analyst');
    const file = writeSession([
      { type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: 'remember the blue flag' } },
    ]);
    let seen: any;
    const manager = new SubagentManager(async (input: any) => {
      seen = input;
      return { result: 'ok', fallback_used: false };
    });
    const ctx = {
      cwd: env.tmp,
      sessionManager: { getSessionFile: () => file, getSessionId: () => 'parent-1' },
      model: { provider: 'p', id: 'big', contextWindow: 1000000 },
    };
    const result = await manager.run({ agent: 'analyst', task: 'do it', includeParentContext: true }, ctx);
    expect(result.task_ids).toHaveLength(1);
    expect(seen.parentContext).toContain('remember the blue flag');
  });
});
