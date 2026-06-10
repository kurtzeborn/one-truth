import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { gamesTable, playersTable } from '../shared/storage.js';
import { AuthError } from '../shared/auth.js';

vi.mock('../shared/storage.js', () => ({
  gamesTable: { getEntity: vi.fn(), createEntity: vi.fn(), deleteEntity: vi.fn(), listEntities: vi.fn() },
  playersTable: { getEntity: vi.fn(), createEntity: vi.fn(), listEntities: vi.fn() },
  statementsTable: { listEntities: vi.fn() },
  votesTable: { listEntities: vi.fn() },
}));

vi.mock('../shared/auth.js', () => ({
  requireGameKeeper: vi.fn().mockResolvedValue({ userId: 'gk1', userDetails: 'keeper@test.com' }),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../shared/helpers.js', () => ({
  validateGameId: vi.fn((id: string) => {
    if (!id || !/^[A-Z0-9]{4}$/.test(id.toUpperCase())) return null;
    return id.toUpperCase();
  }),
  getGameEntity: vi.fn(),
}));

import { requireGameKeeper } from '../shared/auth.js';

const mockRequireGK = vi.mocked(requireGameKeeper);
const mockGamesListEntities = vi.mocked(gamesTable.listEntities);
const mockPlayersListEntities = vi.mocked(playersTable.listEntities);

// Capture handlers
const handlers: Record<string, any> = {};
vi.mock('@azure/functions', async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    app: {
      ...orig.app,
      http: (name: string, opts: any) => {
        handlers[name] = opts.handler;
      },
    },
  };
});

await import('../functions/games.js');

function makeRequest(params: Record<string, string> = {}, body?: unknown): HttpRequest {
  return {
    params,
    json: () => Promise.resolve(body),
    headers: { get: vi.fn().mockReturnValue(null) },
    query: new Map(),
  } as unknown as HttpRequest;
}

const mockContext = { error: vi.fn(), log: vi.fn() } as unknown as InvocationContext;

// Helper to create an async iterable from an array
function asyncIterableFrom<T>(items: T[]): AsyncIterableIterator<T> {
  let index = 0;
  return {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      if (index < items.length) {
        return { value: items[index++], done: false };
      }
      return { value: undefined as any, done: true };
    },
  };
}

describe('listGames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireGK.mockResolvedValue({ userId: 'gk1', userDetails: 'keeper@test.com', identityProvider: 'aad', userRoles: ['authenticated'] });
  });

  it('returns empty array when no games exist', async () => {
    mockGamesListEntities.mockReturnValue(asyncIterableFrom([]) as any);

    const response = await handlers.listGames(makeRequest(), mockContext);
    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual([]);
  });

  it('returns games with player counts sorted newest first', async () => {
    const games = [
      { rowKey: 'AAAA', createdBy: 'keeper@test.com', createdAt: new Date('2026-06-01'), status: 'lobby', groupSize: 0, votedGroups: '[]' },
      { rowKey: 'BBBB', createdBy: 'keeper@test.com', createdAt: new Date('2026-06-10'), status: 'voting', groupSize: 4, votedGroups: '["A"]' },
    ];
    mockGamesListEntities.mockReturnValue(asyncIterableFrom(games) as any);
    mockPlayersListEntities
      .mockReturnValueOnce(asyncIterableFrom([{ rowKey: 'p1' }, { rowKey: 'p2' }]) as any)   // AAAA: 2 players
      .mockReturnValueOnce(asyncIterableFrom([{ rowKey: 'p3' }, { rowKey: 'p4' }, { rowKey: 'p5' }]) as any); // BBBB: 3 players

    const response = await handlers.listGames(makeRequest(), mockContext);
    expect(response.status).toBe(200);
    expect(response.jsonBody).toHaveLength(2);
    // Newest first
    expect(response.jsonBody[0].id).toBe('BBBB');
    expect(response.jsonBody[0].playerCount).toBe(3);
    expect(response.jsonBody[0].status).toBe('voting');
    expect(response.jsonBody[1].id).toBe('AAAA');
    expect(response.jsonBody[1].playerCount).toBe(2);
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireGK.mockRejectedValue(new AuthError('Not authenticated', 401));

    const response = await handlers.listGames(makeRequest(), mockContext);
    expect(response.status).toBe(401);
  });

  it('returns 403 when not a game keeper', async () => {
    mockRequireGK.mockRejectedValue(new AuthError('Not a game keeper', 403));

    const response = await handlers.listGames(makeRequest(), mockContext);
    expect(response.status).toBe(403);
  });
});
