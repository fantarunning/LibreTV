import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateMutations, pullCloud, pushCloud } from './cloud-store';
import type { CloudMutation } from './cloud-types';

const state = vi.hoisted(() => ({
  users: new Map<string, number>(), records: new Map<string, Record<string, unknown>>(),
  events: new Map<string, string>(), tail: Promise.resolve() as Promise<unknown>,
}));
vi.mock('./mysql', async () => {
  const actual = await vi.importActual<typeof import('./mysql')>('./mysql');
  const execute = async (sql: string, args: unknown[]) => {
    const [user, kind, key] = args;
    if (sql.startsWith('SELECT sync_version')) return [[{ sync_version: state.users.get(String(user)) || 0 }]];
    if (sql.startsWith('SELECT payload_hash')) return [[...(state.events.has(`${user}:${kind}`) ? [{ payload_hash: state.events.get(`${user}:${kind}`) }] : [])]];
    if (sql.startsWith('SELECT kind')) return [[...(state.records.has(`${user}:${kind}:${key}`) ? [state.records.get(`${user}:${kind}:${key}`)] : [])]];
    if (sql.includes('INSERT INTO ltv_sync_records')) {
      state.records.set(`${user}:${kind}:${key}`, { user_id: user, kind, doc_key: key, doc_value: args[3] === null ? null : JSON.parse(String(args[3])), version: args[4], updated_at: args[5] });
    } else if (sql.startsWith('INSERT INTO ltv_sync_events')) state.events.set(`${user}:${kind}`, String(key));
    else if (sql.startsWith('UPDATE ltv_users')) state.users.set(String(args[1]), Number(user));
    return [[]];
  };
  return { ...actual,
    withTransaction: async (fn: (connection: unknown) => Promise<unknown>) => {
      const run = state.tail.then(() => fn({ execute }));
      state.tail = run.catch(() => {});
      return run;
    },
    getMysqlPool: () => ({ query: async (_sql: string, args: unknown[]) => [[...state.records.values()]
      .filter(row => row.user_id === args[0] && Number(row.version) > Number(args[1]))
      .sort((a, b) => Number(a.version) - Number(b.version)).slice(0, Number(args[2]))] }),
  };
});

const mutation = (eventId: string, baseVersion = 0, value: unknown = { position: 120 }): CloudMutation => ({ eventId, kind: 'progress', key: 'show:1', value, baseVersion });
beforeEach(() => { state.users.clear(); state.records.clear(); state.events.clear(); state.tail = Promise.resolve(); });

describe('cloud synchronization conflict semantics', () => {
  it('returns server versions, accepts event retry once, and rejects an altered event payload', async () => {
    const input = mutation('event-0001');
    const first = await pushCloud('a', [input]);
    expect(first.records[0].version).toBe(1);
    expect((await pushCloud('a', [input])).accepted).toEqual(['event-0001']);
    expect(state.users.get('a')).toBe(1);
    await expect(pushCloud('a', [{ ...input, value: { position: 900 } }])).rejects.toMatchObject({ status: 409 });
  });
  it('rejects stale concurrent progress while allowing an intentional rewind with the current version', async () => {
    const [one, two] = await Promise.all([pushCloud('a', [mutation('event-0002')]), pushCloud('a', [mutation('event-0003')])]);
    expect(one.accepted.length + two.accepted.length).toBe(1);
    expect(two.conflicts[0]).toMatchObject({ version: 1, value: { position: 120 } });
    const rewind = await pushCloud('a', [mutation('event-0004', 1, { position: 10 })]);
    expect(rewind.records[0]).toMatchObject({ version: 2, value: { position: 10 } });
  });
  it('keeps tombstones and blocks an offline device from resurrecting deleted history', async () => {
    await pushCloud('a', [mutation('event-0005')]);
    await pushCloud('a', [mutation('event-0006', 1, null)]);
    const stale = await pushCloud('a', [mutation('event-0007', 1)]);
    expect(stale.conflicts[0]).toMatchObject({ value: null, version: 2 });
    expect((await pullCloud('a', 0)).records[0]).toMatchObject({ value: null, version: 2 });
  });
  it('isolates account cursors and paginates records without dropping the next record', async () => {
    await pushCloud('a', [mutation('event-0008'), { ...mutation('event-0009'), key: 'show:2' }]);
    await pushCloud('b', [mutation('event-0010', 0, { position: 999 })]);
    const first = await pullCloud('a', 0, 1);
    expect(first).toMatchObject({ cursor: 1, hasMore: true });
    const second = await pullCloud('a', first.cursor, 1);
    expect(second).toMatchObject({ cursor: 2, hasMore: false });
    expect((await pullCloud('b', 0)).records[0].value).toEqual({ position: 999 });
  });
});

describe('cloud input limits', () => {
  it('rejects account injection, unknown kinds, duplicate events and oversized values', () => {
    expect(() => validateMutations([{ ...mutation('event-0011'), userId: 'another-account' }])).toThrow(/账号/);
    expect(() => validateMutations([{ ...mutation('event-0011'), kind: 'admin' }])).toThrow(/类型/);
    expect(() => validateMutations([mutation('event-0011'), mutation('event-0011')])).toThrow(/重复/);
    expect(() => validateMutations([mutation('event-0011', 0, { a: 'a'.repeat(30000), b: 'b'.repeat(30000), c: 'c'.repeat(10000) })])).toThrow(/64 KiB/);
    expect(() => validateMutations([mutation('event-0011', -1)])).toThrow(/版本/);
  });
});
