import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { gamesTable, playersTable, votesTable } from '../shared/storage.js';
import { requireGameKeeper, AuthError } from '../shared/auth.js';
import { PlayerEntity, VoteEntity } from '../shared/types.js';
import { validateGameId, validateGroupLetter, getGameEntity, parseVotedGroups, getGroupStatements, getGroupVotes } from '../shared/helpers.js';

// POST /api/games/:id/voting/open/:letter
app.http('openVoting', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'games/{gameId}/voting/open/{letter}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      await requireGameKeeper(request);
      const gameId = validateGameId(request.params.gameId);
      const letter = validateGroupLetter(request.params.letter);

      if (!gameId) return { status: 400, jsonBody: { error: 'Invalid game ID' } };
      if (!letter) return { status: 400, jsonBody: { error: 'Invalid group letter' } };

      const game = await getGameEntity(gameId);
      if (!game) return { status: 404, jsonBody: { error: 'Game not found' } };
      if (game.status !== 'voting') {
        return { status: 400, jsonBody: { error: 'Game is not in voting phase' } };
      }

      const votedGroups = parseVotedGroups(game);
      if (votedGroups.includes(letter)) {
        return { status: 400, jsonBody: { error: `Group ${letter} has already been voted on` } };
      }

      // Can't open a new group while voting is still open for another
      if (game.currentVotingGroup && !votedGroups.includes(game.currentVotingGroup)) {
        return { status: 400, jsonBody: { error: 'Close voting for the current group first' } };
      }

      await gamesTable.updateEntity({
        partitionKey: 'game',
        rowKey: gameId,
        currentVotingGroup: letter,
      }, 'Merge');

      return {
        status: 200,
        jsonBody: { currentVotingGroup: letter, votedGroups },
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return { status: error.statusCode, jsonBody: { error: error.message } };
      }
      context.error('Failed to open voting:', error);
      return { status: 500, jsonBody: { error: 'Failed to open voting' } };
    }
  },
});

// POST /api/games/:id/voting/close/:letter
app.http('closeVoting', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'games/{gameId}/voting/close/{letter}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      await requireGameKeeper(request);
      const gameId = validateGameId(request.params.gameId);
      const letter = validateGroupLetter(request.params.letter);

      if (!gameId) return { status: 400, jsonBody: { error: 'Invalid game ID' } };
      if (!letter) return { status: 400, jsonBody: { error: 'Invalid group letter' } };

      const game = await getGameEntity(gameId);
      if (!game) return { status: 404, jsonBody: { error: 'Game not found' } };
      if (game.status !== 'voting') {
        return { status: 400, jsonBody: { error: 'Game is not in voting phase' } };
      }
      if (game.currentVotingGroup !== letter) {
        return { status: 400, jsonBody: { error: `Group ${letter} is not currently being voted on` } };
      }

      const votedGroups = parseVotedGroups(game);
      if (votedGroups.includes(letter)) {
        return { status: 400, jsonBody: { error: `Voting already closed for Group ${letter}` } };
      }

      // Find the lie for this group
      const groupStatements = await getGroupStatements(gameId, letter);
      const lieStatement = groupStatements.find(s => s.isLie);
      const lieStatementNumber = lieStatement?.statementNumber ?? null;

      // Get all votes for this group
      const votes = await getGroupVotes(gameId, letter);

      // Score each vote and update player scores
      // First pass: find the fastest correct vote
      let fastestCorrectVote: VoteEntity | null = null;
      for (const vote of votes) {
        const isCorrect = vote.chosenStatement === lieStatementNumber;
        if (isCorrect) {
          if (!fastestCorrectVote || new Date(vote.votedAt).getTime() < new Date(fastestCorrectVote.votedAt).getTime()) {
            fastestCorrectVote = vote;
          }
        }
      }

      // Second pass: score votes and update players
      let fastestVoterName: string | undefined;
      for (const vote of votes) {
        const isCorrect = vote.chosenStatement === lieStatementNumber;
        const isFastest = isCorrect && fastestCorrectVote !== null && vote.rowKey === fastestCorrectVote.rowKey;

        // Look up player to check late arrival status
        let player: PlayerEntity | null = null;
        try {
          player = await playersTable.getEntity<PlayerEntity>(gameId, vote.playerId);
        } catch (error: any) {
          if (error.statusCode !== 404) throw error;
        }

        const basePoints = player?.lateArrival ? 2 : 3;
        const pointsAwarded = isCorrect ? (isFastest ? basePoints + 2 : basePoints) : 0;

        await votesTable.updateEntity({
          partitionKey: gameId,
          rowKey: vote.rowKey,
          isCorrect,
          pointsAwarded,
        }, 'Merge');

        if (pointsAwarded > 0 && player) {
          if (isFastest) {
            await playersTable.updateEntity({
              partitionKey: gameId,
              rowKey: vote.playerId,
              score: (player.score || 0) + pointsAwarded,
              speedBonuses: (player.speedBonuses || 0) + 1,
            }, 'Merge');
            fastestVoterName = player.displayName;
          } else {
            await playersTable.updateEntity({
              partitionKey: gameId,
              rowKey: vote.playerId,
              score: (player.score || 0) + pointsAwarded,
            }, 'Merge');
          }
        }
      }

      // Add to voted groups
      votedGroups.push(letter);
      await gamesTable.updateEntity({
        partitionKey: 'game',
        rowKey: gameId,
        votedGroups: JSON.stringify(votedGroups),
      }, 'Merge');

      // Build vote breakdown
      const breakdown = [0, 0, 0];
      for (const vote of votes) {
        if (vote.chosenStatement >= 1 && vote.chosenStatement <= 3) {
          breakdown[vote.chosenStatement - 1]++;
        }
      }

      return {
        status: 200,
        jsonBody: {
          lieStatementNumber,
          totalVotes: votes.length,
          correctVotes: votes.filter(v => v.chosenStatement === lieStatementNumber).length,
          breakdown: { statement1: breakdown[0], statement2: breakdown[1], statement3: breakdown[2] },
          votedGroups,
          fastestVoter: fastestVoterName || null,
        },
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return { status: error.statusCode, jsonBody: { error: error.message } };
      }
      context.error('Failed to close voting:', error);
      return { status: 500, jsonBody: { error: 'Failed to close voting' } };
    }
  },
});

// POST /api/games/:id/vote
app.http('castVote', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'games/{gameId}/vote',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const gameId = validateGameId(request.params.gameId);
      if (!gameId) return { status: 400, jsonBody: { error: 'Invalid game ID' } };

      let body;
      try {
        body = await request.json() as { playerId: string; groupLetter: string; chosenStatement: number };
      } catch {
        return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
      }

      const { playerId, groupLetter, chosenStatement } = body;
      if (!playerId) return { status: 400, jsonBody: { error: 'playerId is required' } };
      if (!groupLetter) return { status: 400, jsonBody: { error: 'groupLetter is required' } };
      if (![1, 2, 3].includes(chosenStatement)) {
        return { status: 400, jsonBody: { error: 'chosenStatement must be 1, 2, or 3' } };
      }

      const game = await getGameEntity(gameId);
      if (!game) return { status: 404, jsonBody: { error: 'Game not found' } };
      if (game.status !== 'voting') {
        return { status: 400, jsonBody: { error: 'Game is not in voting phase' } };
      }

      const normalizedLetter = groupLetter.toUpperCase();
      if (game.currentVotingGroup !== normalizedLetter) {
        return { status: 400, jsonBody: { error: 'This group is not currently being voted on' } };
      }

      const votedGroups = parseVotedGroups(game);
      if (votedGroups.includes(normalizedLetter)) {
        return { status: 400, jsonBody: { error: 'Voting has already closed for this group' } };
      }

      // Get player and verify they're not in the presenting group
      let player: PlayerEntity;
      try {
        player = await playersTable.getEntity<PlayerEntity>(gameId, playerId);
      } catch (error: any) {
        if (error.statusCode === 404) return { status: 404, jsonBody: { error: 'Player not found' } };
        throw error;
      }

      if (player.groupLetter === normalizedLetter) {
        return { status: 403, jsonBody: { error: 'You cannot vote on your own group' } };
      }

      // Check for duplicate vote
      try {
        await votesTable.getEntity(gameId, `${playerId}_${normalizedLetter}`);
        return { status: 409, jsonBody: { error: 'You have already voted on this group' } };
      } catch (error: any) {
        if (error.statusCode !== 404) throw error;
      }

      await votesTable.createEntity({
        partitionKey: gameId,
        rowKey: `${playerId}_${normalizedLetter}`,
        playerId,
        groupLetter: normalizedLetter,
        chosenStatement,
        votedAt: new Date(),
      });

      return { status: 201, jsonBody: { message: 'Vote recorded' } };
    } catch (error) {
      context.error('Failed to cast vote:', error);
      return { status: 500, jsonBody: { error: 'Failed to cast vote' } };
    }
  },
});

// GET /api/games/:id/voting/results/:letter
app.http('getVotingResults', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'games/{gameId}/voting/results/{letter}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      await requireGameKeeper(request);
      const gameId = validateGameId(request.params.gameId);
      const letter = validateGroupLetter(request.params.letter);

      if (!gameId) return { status: 400, jsonBody: { error: 'Invalid game ID' } };
      if (!letter) return { status: 400, jsonBody: { error: 'Invalid group letter' } };

      const game = await getGameEntity(gameId);
      if (!game) return { status: 404, jsonBody: { error: 'Game not found' } };

      const votedGroups = parseVotedGroups(game);
      if (!votedGroups.includes(letter)) {
        return { status: 400, jsonBody: { error: 'Voting has not closed for this group yet' } };
      }

      // Get statements with isLie
      const groupStatements = await getGroupStatements(gameId, letter);
      const statements = groupStatements.map(s => ({
        statementNumber: s.statementNumber, text: s.text, isLie: s.isLie,
      }));

      // Get votes and build breakdown
      const votes = await getGroupVotes(gameId, letter);
      const breakdown = [0, 0, 0];
      let correctVotes = 0;
      let fastestVoter: string | null = null;
      for (const v of votes) {
        if (v.isCorrect) correctVotes++;
        if (v.pointsAwarded === 5) fastestVoter = v.playerId;
        if (v.chosenStatement >= 1 && v.chosenStatement <= 3) {
          breakdown[v.chosenStatement - 1]++;
        }
      }

      // Look up fastest voter's display name
      let fastestVoterName: string | null = null;
      if (fastestVoter) {
        try {
          const player = await playersTable.getEntity<PlayerEntity>(gameId, fastestVoter);
          fastestVoterName = player.displayName;
        } catch { /* ignore */ }
      }

      return {
        status: 200,
        jsonBody: {
          statements,
          totalVotes: votes.length,
          correctVotes,
          breakdown: { statement1: breakdown[0], statement2: breakdown[1], statement3: breakdown[2] },
          fastestVoter: fastestVoterName,
        },
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return { status: error.statusCode, jsonBody: { error: error.message } };
      }
      context.error('Failed to get voting results:', error);
      return { status: 500, jsonBody: { error: 'Failed to get voting results' } };
    }
  },
});
