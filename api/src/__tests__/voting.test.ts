import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { gamesTable, playersTable, votesTable } from '../shared/storage.js';
import { AuthError } from '../shared/auth.js';

vi.mock('../shared/storage.js', () => ({
  gamesTable: { getEntity: vi.fn(), updateEntity: vi.fn() },
  playersTable: { getEntity: vi.fn(), updateEntity: vi.fn(), listEntities: vi.fn() },
  votesTable: {
    getEntity: vi.fn(),
    createEntity: vi.fn(),
    updateEntity: vi.fn(),
  },
}));

vi.mock('../shared/auth.js', () => ({
  requireGameKeeper: vi.fn().mockResolvedValue({ userId: 'gk1' }),
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
  validateGroupLetter: vi.fn((raw: string) => {
    if (!raw) return null;
    const letter = raw.toUpperCase();
    return /^[A-Z]$/.test(letter) ? letter : null;
  }),
  parseVotedGroups: vi.fn((game: any) => JSON.parse(game.votedGroups || '[]')),
  getGameEntity: vi.fn(),
  getGroupStatements: vi.fn(),
  getGroupVotes: vi.fn(),
}));

import { getGameEntity, getGroupStatements, getGroupVotes } from '../shared/helpers.js';
import { requireGameKeeper } from '../shared/auth.js';

const mockGetGame = vi.mocked(getGameEntity);
const mockGetGroupStatements = vi.mocked(getGroupStatements);
const mockGetGroupVotes = vi.mocked(getGroupVotes);
const mockGamesUpdate = vi.mocked(gamesTable.updateEntity);
const mockPlayersGet = vi.mocked(playersTable.getEntity);
const mockPlayersUpdate = vi.mocked(playersTable.updateEntity);
const mockPlayersList = vi.mocked(playersTable.listEntities);
const mockVotesGet = vi.mocked(votesTable.getEntity);
const mockVotesCreate = vi.mocked(votesTable.createEntity);
const mockVotesUpdate = vi.mocked(votesTable.updateEntity);
const mockRequireGK = vi.mocked(requireGameKeeper);

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

await import('../functions/voting.js');

function mockAsyncIterable<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { yield* items; } };
}

function makeRequest(params: Record<string, string>, body?: unknown, query?: Record<string, string>): HttpRequest {
  return {
    params,
    json: () => Promise.resolve(body),
    query: new Map(Object.entries(query || {})),
  } as unknown as HttpRequest;
}

const mockContext = { error: vi.fn() } as unknown as InvocationContext;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireGK.mockResolvedValue({ userId: 'gk1' } as any);
});

describe('castVote', () => {
  const handler = () => handlers.castVote;

  it('records a valid vote', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);
    mockPlayersGet.mockResolvedValue({ rowKey: 'p1', groupLetter: 'B' } as any);
    mockVotesGet.mockRejectedValue({ statusCode: 404 });

    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'A', chosenStatement: 2 }), mockContext);
    expect(res.status).toBe(201);
    expect(mockVotesCreate).toHaveBeenCalledWith(expect.objectContaining({
      partitionKey: 'ABCD',
      rowKey: 'p1_A',
      playerId: 'p1',
      groupLetter: 'A',
      chosenStatement: 2,
    }));
  });

  it('rejects voting on own group', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);
    mockPlayersGet.mockResolvedValue({ rowKey: 'p1', groupLetter: 'A' } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'A', chosenStatement: 1 }), mockContext);
    expect(res.status).toBe(403);
  });

  it('rejects duplicate vote', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);
    mockPlayersGet.mockResolvedValue({ rowKey: 'p1', groupLetter: 'B' } as any);
    mockVotesGet.mockResolvedValue({} as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'A', chosenStatement: 1 }), mockContext);
    expect(res.status).toBe(409);
  });

  it('allows late arrivals to vote on any group', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);
    // Late arrival: no groupLetter
    mockPlayersGet.mockResolvedValue({ rowKey: 'p1', groupLetter: undefined, lateArrival: true } as any);
    mockVotesGet.mockRejectedValue({ statusCode: 404 });

    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'A', chosenStatement: 2 }), mockContext);
    expect(res.status).toBe(201);
  });

  it('rejects vote when not in voting phase', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'statements', currentVotingGroup: 'A', votedGroups: '[]' } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'A', chosenStatement: 1 }), mockContext);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error).toContain('not in voting phase');
  });

  it('rejects vote for wrong group', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'B', chosenStatement: 1 }), mockContext);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error).toContain('not currently being voted on');
  });

  it('rejects invalid statement number', async () => {
    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'A', chosenStatement: 4 }), mockContext);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error).toContain('chosenStatement');
  });

  it('rejects vote after voting closed', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '["A"]' } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD' }, { playerId: 'p1', groupLetter: 'A', chosenStatement: 1 }), mockContext);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error).toContain('already closed');
  });
});

describe('openVoting', () => {
  const handler = () => handlers.openVoting;

  it('opens voting for a group', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', votedGroups: '[]', currentVotingGroup: undefined } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'A' }), mockContext);
    expect(res.status).toBe(200);
    expect(mockGamesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      currentVotingGroup: 'A',
    }), 'Merge');
  });

  it('rejects already voted group', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', votedGroups: '["A"]', currentVotingGroup: undefined } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'A' }), mockContext);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error).toContain('already been voted on');
  });

  it('rejects when another group is still voting', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', votedGroups: '[]', currentVotingGroup: 'A' } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'B' }), mockContext);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error).toContain('Close voting');
  });

  it('rejects when not in voting phase', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'lobby', votedGroups: '[]' } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'A' }), mockContext);
    expect(res.status).toBe(400);
  });
});

describe('closeVoting', () => {
  const handler = () => handlers.closeVoting;

  it('scores votes and closes voting', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);

    // Statement 2 is the lie
    mockGetGroupStatements.mockResolvedValue([
      { statementNumber: 1, text: 'S1', isLie: false },
      { statementNumber: 2, text: 'S2', isLie: true },
      { statementNumber: 3, text: 'S3', isLie: false },
    ] as any);

    // Two correct votes: p1 voted first, p2 voted later; p3 voted wrong
    mockGetGroupVotes.mockResolvedValue([
      { rowKey: 'p1_A', playerId: 'p1', groupLetter: 'A', chosenStatement: 2, votedAt: new Date('2026-01-01T00:00:01Z') },
      { rowKey: 'p2_A', playerId: 'p2', groupLetter: 'A', chosenStatement: 2, votedAt: new Date('2026-01-01T00:00:05Z') },
      { rowKey: 'p3_A', playerId: 'p3', groupLetter: 'A', chosenStatement: 1, votedAt: new Date('2026-01-01T00:00:00Z') },
    ] as any);

    mockPlayersList.mockReturnValue(mockAsyncIterable([
      { rowKey: 'p1', displayName: 'Alice', score: 0, speedBonuses: 0 },
      { rowKey: 'p2', displayName: 'Bob', score: 0, speedBonuses: 0 },
      { rowKey: 'p3', displayName: 'Charlie', score: 0, speedBonuses: 0 },
    ]) as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'A' }), mockContext);
    expect(res.status).toBe(200);
    expect(res.jsonBody.lieStatementNumber).toBe(2);
    expect(res.jsonBody.totalVotes).toBe(3);
    expect(res.jsonBody.correctVotes).toBe(2);
    expect(res.jsonBody.breakdown).toEqual({ statement1: 1, statement2: 2, statement3: 0 });
    expect(res.jsonBody.fastestVoter).toBe('Alice');

    // Fastest correct voter (p1) gets 5 points (3 + 2 bonus)
    expect(mockVotesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p1_A',
      isCorrect: true,
      pointsAwarded: 5,
    }), 'Merge');

    // Second correct voter (p2) gets 3 points
    expect(mockVotesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p2_A',
      isCorrect: true,
      pointsAwarded: 3,
    }), 'Merge');

    // Wrong voter gets 0 points
    expect(mockVotesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p3_A',
      isCorrect: false,
      pointsAwarded: 0,
    }), 'Merge');

    // Player p1 score updated with 5 pts + speedBonuses incremented
    expect(mockPlayersUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p1',
      score: 5,
      speedBonuses: 1,
    }), 'Merge');

    // Player p2 score updated with 3 pts (no speed bonus)
    expect(mockPlayersUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p2',
      score: 3,
    }), 'Merge');

    // Game updated with voted groups
    expect(mockGamesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      votedGroups: '["A"]',
    }), 'Merge');
  });

  it('rejects closing wrong group', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'B' }), mockContext);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error).toContain('not currently being voted on');
  });

  it('handles no correct votes (no speed bonus)', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);
    mockGetGroupStatements.mockResolvedValue([
      { statementNumber: 1, text: 'S1', isLie: false },
      { statementNumber: 2, text: 'S2', isLie: true },
      { statementNumber: 3, text: 'S3', isLie: false },
    ] as any);
    mockGetGroupVotes.mockResolvedValue([
      { rowKey: 'p1_A', playerId: 'p1', groupLetter: 'A', chosenStatement: 1, votedAt: new Date('2026-01-01T00:00:01Z') },
    ] as any);

    mockPlayersList.mockReturnValue(mockAsyncIterable([
      { rowKey: 'p1', displayName: 'Alice', score: 0, speedBonuses: 0 },
    ]) as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'A' }), mockContext);
    expect(res.status).toBe(200);
    expect(res.jsonBody.correctVotes).toBe(0);
    expect(res.jsonBody.fastestVoter).toBeNull();
    expect(mockPlayersUpdate).not.toHaveBeenCalled();
  });

  it('awards late arrivals 2 points instead of 3', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);
    mockGetGroupStatements.mockResolvedValue([
      { statementNumber: 1, text: 'S1', isLie: false },
      { statementNumber: 2, text: 'S2', isLie: true },
      { statementNumber: 3, text: 'S3', isLie: false },
    ] as any);

    // Regular player p1 (correct, fastest), late arrival p2 (correct)
    mockGetGroupVotes.mockResolvedValue([
      { rowKey: 'p1_A', playerId: 'p1', groupLetter: 'A', chosenStatement: 2, votedAt: new Date('2026-01-01T00:00:01Z') },
      { rowKey: 'p2_A', playerId: 'p2', groupLetter: 'A', chosenStatement: 2, votedAt: new Date('2026-01-01T00:00:05Z') },
    ] as any);

    mockPlayersList.mockReturnValue(mockAsyncIterable([
      { rowKey: 'p1', displayName: 'Alice', score: 0, speedBonuses: 0 },
      { rowKey: 'p2', displayName: 'Bob', score: 0, speedBonuses: 0, lateArrival: true },
    ]) as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'A' }), mockContext);
    expect(res.status).toBe(200);

    // Regular player p1: fastest correct = 3 + 2 = 5 pts
    expect(mockVotesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p1_A', pointsAwarded: 5,
    }), 'Merge');

    // Late arrival p2: correct = 2 pts (not 3)
    expect(mockVotesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p2_A', pointsAwarded: 2,
    }), 'Merge');

    expect(mockPlayersUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p2', score: 2,
    }), 'Merge');
  });

  it('awards late arrival 4 points for fastest correct (2 + 2 bonus)', async () => {
    mockGetGame.mockResolvedValue({ rowKey: 'ABCD', status: 'voting', currentVotingGroup: 'A', votedGroups: '[]' } as any);
    mockGetGroupStatements.mockResolvedValue([
      { statementNumber: 1, text: 'S1', isLie: false },
      { statementNumber: 2, text: 'S2', isLie: true },
      { statementNumber: 3, text: 'S3', isLie: false },
    ] as any);

    // Late arrival p1 is the only (and fastest) correct voter
    mockGetGroupVotes.mockResolvedValue([
      { rowKey: 'p1_A', playerId: 'p1', groupLetter: 'A', chosenStatement: 2, votedAt: new Date('2026-01-01T00:00:01Z') },
    ] as any);

    mockPlayersList.mockReturnValue(mockAsyncIterable([
      { rowKey: 'p1', displayName: 'Alice', score: 0, speedBonuses: 0, lateArrival: true },
    ]) as any);

    const res = await handler()(makeRequest({ gameId: 'ABCD', letter: 'A' }), mockContext);
    expect(res.status).toBe(200);

    // Late arrival fastest: 2 + 2 = 4 pts
    expect(mockVotesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      rowKey: 'p1_A', pointsAwarded: 4,
    }), 'Merge');
  });
});
