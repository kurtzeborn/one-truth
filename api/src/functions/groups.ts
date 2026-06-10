import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { gamesTable, playersTable } from '../shared/storage.js';
import { requireGameKeeper, AuthError } from '../shared/auth.js';
import { GameEntity, PlayerEntity } from '../shared/types.js';

// POST /api/games/:id/assign-groups
app.http('assignGroups', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'games/{gameId}/assign-groups',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      await requireGameKeeper(request);
      const gameId = request.params.gameId?.toUpperCase();
      if (!gameId) {
        return { status: 400, jsonBody: { error: 'Game ID is required' } };
      }

      let body;
      try {
        body = await request.json() as { groupSize: number };
      } catch {
        return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
      }

      const groupSize = body.groupSize;
      if (!groupSize || !Number.isInteger(groupSize) || groupSize < 2 || groupSize > 20) {
        return { status: 400, jsonBody: { error: 'Group size must be an integer between 2 and 20' } };
      }

      // Get game
      let game: GameEntity;
      try {
        game = await gamesTable.getEntity<GameEntity>('game', gameId);
      } catch (error: any) {
        if (error.statusCode === 404) {
          return { status: 404, jsonBody: { error: 'Game not found' } };
        }
        throw error;
      }

      if (game.status !== 'lobby') {
        return { status: 400, jsonBody: { error: 'Groups can only be assigned during the lobby phase' } };
      }

      // Get all players
      const players: PlayerEntity[] = [];
      const entities = playersTable.listEntities<PlayerEntity>({
        queryOptions: { filter: `PartitionKey eq '${gameId}'` },
      });
      for await (const p of entities) {
        players.push(p);
      }

      if (players.length < 2) {
        return { status: 400, jsonBody: { error: 'At least 2 players are required to assign groups' } };
      }

      // Shuffle players randomly (Fisher-Yates)
      const shuffled = [...players];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Assign group letters
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const numGroups = Math.ceil(shuffled.length / groupSize);

      if (numGroups > 26) {
        return { status: 400, jsonBody: { error: 'Too many groups. Increase group size.' } };
      }

      // Distribute players evenly across groups
      for (let i = 0; i < shuffled.length; i++) {
        const groupIndex = i % numGroups;
        shuffled[i].groupLetter = letters[groupIndex];
      }

      // Update all players with group assignments
      for (const player of shuffled) {
        await playersTable.updateEntity({
          partitionKey: gameId,
          rowKey: player.rowKey,
          groupLetter: player.groupLetter,
        }, 'Merge');
      }

      // Update game status and group size
      await gamesTable.updateEntity({
        partitionKey: 'game',
        rowKey: gameId,
        status: 'grouping',
        groupSize,
      }, 'Merge');

      // Build group roster for response
      const groups: Record<string, string[]> = {};
      for (const player of shuffled) {
        const letter = player.groupLetter!;
        if (!groups[letter]) groups[letter] = [];
        groups[letter].push(player.displayName);
      }

      return {
        status: 200,
        jsonBody: {
          id: gameId,
          status: 'grouping',
          groupSize,
          groups,
          playerCount: shuffled.length,
          groupCount: numGroups,
        },
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return { status: error.statusCode, jsonBody: { error: error.message } };
      }
      context.error('Failed to assign groups:', error);
      return { status: 500, jsonBody: { error: 'Failed to assign groups' } };
    }
  },
});

// GET /api/games/:id/groups
app.http('getGroups', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'games/{gameId}/groups',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      await requireGameKeeper(request);
      const gameId = request.params.gameId?.toUpperCase();
      if (!gameId) {
        return { status: 400, jsonBody: { error: 'Game ID is required' } };
      }

      // Verify game exists
      try {
        await gamesTable.getEntity('game', gameId);
      } catch (error: any) {
        if (error.statusCode === 404) {
          return { status: 404, jsonBody: { error: 'Game not found' } };
        }
        throw error;
      }

      // Get all players and organize by group
      const groups: Record<string, Array<{ id: string; displayName: string }>> = {};
      const entities = playersTable.listEntities<PlayerEntity>({
        queryOptions: { filter: `PartitionKey eq '${gameId}'` },
      });
      for await (const p of entities) {
        const letter = p.groupLetter || 'Unassigned';
        if (!groups[letter]) groups[letter] = [];
        groups[letter].push({ id: p.rowKey, displayName: p.displayName });
      }

      return { status: 200, jsonBody: groups };
    } catch (error) {
      if (error instanceof AuthError) {
        return { status: error.statusCode, jsonBody: { error: error.message } };
      }
      context.error('Failed to get groups:', error);
      return { status: 500, jsonBody: { error: 'Failed to get groups' } };
    }
  },
});
