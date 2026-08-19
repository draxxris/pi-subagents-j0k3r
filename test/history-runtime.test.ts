import { describe, expect, it } from 'vitest';
import { resolveSqliteDatabaseConstructor } from '../src/history.js';

class NodeDatabase {}
class BunDatabase {}

describe('SQLite runtime selection', () => {
  it('uses node:sqlite when DatabaseSync is available', () => {
    const calls: string[] = [];
    const Database = resolveSqliteDatabaseConstructor((specifier) => {
      calls.push(specifier);
      return specifier === 'node:sqlite' ? { DatabaseSync: NodeDatabase } : { Database: BunDatabase };
    });

    expect(Database).toBe(NodeDatabase);
    expect(calls).toEqual(['node:sqlite']);
  });

  it('falls back to bun:sqlite when node:sqlite is unavailable', () => {
    const calls: string[] = [];
    const Database = resolveSqliteDatabaseConstructor((specifier) => {
      calls.push(specifier);
      if (specifier === 'node:sqlite') throw new Error('No such built-in module');
      return { Database: BunDatabase };
    });

    expect(Database).toBe(BunDatabase);
    expect(calls).toEqual(['node:sqlite', 'bun:sqlite']);
  });

  it('reports both supported runtime names when neither module is available', () => {
    expect(() => resolveSqliteDatabaseConstructor(() => {
      throw new Error('module unavailable');
    })).toThrow('node:sqlite and bun:sqlite');
  });
});
