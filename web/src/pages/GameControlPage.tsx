import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { fetchAuthStatus, fetchGame, fetchGameState, fetchGroups, assignGroups, transitionGame, deleteGame } from '../api';

function LobbyView({ gameId, playerCount, players }: {
  gameId: string;
  playerCount: number;
  players?: Array<{ id: string; displayName: string }>;
}) {
  const [groupSize, setGroupSize] = useState(5);
  const queryClient = useQueryClient();

  const assignMutation = useMutation({
    mutationFn: () => assignGroups(gameId, groupSize),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['game', gameId] });
      queryClient.invalidateQueries({ queryKey: ['gameState', gameId] });
    },
  });

  const gameUrl = `${window.location.origin}/?game=${gameId}`;

  return (
    <div className="flex flex-col items-center gap-8">
      {/* QR Code */}
      <div className="bg-white p-6 rounded-2xl">
        <QRCodeSVG value={gameUrl} size={280} level="M" />
      </div>
      <div className="text-center">
        <p className="text-6xl font-bold tracking-[0.3em] font-mono">{gameId}</p>
        <p className="text-gray-400 mt-2 text-sm">{gameUrl}</p>
      </div>

      {/* Player count and list */}
      <div className="w-full max-w-md">
        <h2 className="text-xl font-semibold mb-3 text-center">
          {playerCount} {playerCount === 1 ? 'player' : 'players'} joined
        </h2>
        {players && players.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center mb-6">
            {players.map(p => (
              <span key={p.id} className="px-3 py-1 rounded-full bg-gray-800 text-sm">
                {p.displayName}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Group assignment controls */}
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-4">
          <label className="text-gray-400 whitespace-nowrap">Group size:</label>
          <input
            type="number"
            min={2}
            max={20}
            value={groupSize}
            onChange={(e) => setGroupSize(Math.max(2, Math.min(20, parseInt(e.target.value) || 2)))}
            className="w-20 p-2 rounded bg-gray-800 border border-gray-700 text-center"
          />
          <span className="text-gray-500 text-sm">
            ({Math.ceil(playerCount / groupSize)} groups)
          </span>
        </div>
        <button
          onClick={() => assignMutation.mutate()}
          disabled={assignMutation.isPending || playerCount < 2}
          className="w-full p-3 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 font-semibold"
        >
          {assignMutation.isPending ? 'Assigning...' : 'Assign Groups'}
        </button>
        {playerCount < 2 && (
          <p className="text-yellow-400 text-sm text-center">Need at least 2 players</p>
        )}
        {assignMutation.isError && (
          <p className="text-red-400 text-sm text-center">{assignMutation.error.message}</p>
        )}
      </div>
    </div>
  );
}

function GroupingView({ gameId, groups }: {
  gameId: string;
  groups: Record<string, Array<{ id: string; displayName: string }>>;
}) {
  const queryClient = useQueryClient();

  const transitionMutation = useMutation({
    mutationFn: () => transitionGame(gameId, 'statements'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['game', gameId] });
    },
  });

  const sortedLetters = Object.keys(groups).sort();

  return (
    <div className="w-full max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold text-center">Group Roster</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {sortedLetters.map(letter => (
          <div key={letter} className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-xl font-bold text-blue-400 mb-2">
              Group {letter}
              <span className="text-gray-500 text-sm font-normal ml-2">({groups[letter].length})</span>
            </h3>
            <ul className="space-y-1">
              {groups[letter].map(p => (
                <li key={p.id} className="text-gray-300 text-sm">{p.displayName}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex justify-center pt-4">
        <button
          onClick={() => transitionMutation.mutate()}
          disabled={transitionMutation.isPending}
          className="px-8 py-3 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 font-semibold"
        >
          {transitionMutation.isPending ? 'Starting...' : 'Begin Statements →'}
        </button>
      </div>
      {transitionMutation.isError && (
        <p className="text-red-400 text-center">{transitionMutation.error.message}</p>
      )}
    </div>
  );
}

export function GameControlPage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: auth, isLoading: authLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: fetchAuthStatus,
  });

  const { data: game, isLoading: gameLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => fetchGame(gameId!),
    enabled: !!gameId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'results') return false;
      return 5000;
    },
  });

  // Poll for player list during lobby using a fake GK state query
  const { data: lobbyState } = useQuery({
    queryKey: ['gameState', gameId, 'lobby'],
    queryFn: () => fetchGameState(gameId!, '__gk__'),
    enabled: !!gameId && game?.status === 'lobby',
    refetchInterval: 3000,
  });

  // Fetch groups when in grouping phase
  const { data: groups } = useQuery({
    queryKey: ['groups', gameId],
    queryFn: () => fetchGroups(gameId!),
    enabled: !!gameId && (game?.status === 'grouping' || game?.status === 'statements'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGame(gameId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
      navigate('/manage');
    },
  });

  if (authLoading || gameLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!auth?.isGameKeeper) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-400 mb-4">Not authorized as a game keeper</p>
          <a href="/manage" className="text-blue-400 hover:underline">Sign in →</a>
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <p className="text-red-400">Game not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <a href="/manage" className="text-blue-400 hover:underline text-sm">← Dashboard</a>
            <h1 className="text-2xl font-bold mt-1">Game {game.id}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="px-3 py-1 rounded-full bg-gray-800 text-sm capitalize">{game.status}</span>
            {game.status === 'lobby' && (
              <button
                onClick={() => { if (confirm('Delete this game?')) deleteMutation.mutate(); }}
                className="text-red-400 hover:text-red-300 text-sm"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Phase-specific content */}
        <div className="flex justify-center">
          {game.status === 'lobby' && (
            <LobbyView
              gameId={game.id}
              playerCount={lobbyState?.players?.length ?? 0}
              players={lobbyState?.players}
            />
          )}
          {game.status === 'grouping' && groups && (
            <GroupingView gameId={game.id} groups={groups} />
          )}
          {game.status === 'statements' && (
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4">Statements Phase</h2>
              <p className="text-gray-400">Statement status board coming in Phase 3</p>
            </div>
          )}
          {game.status === 'voting' && (
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4">Voting Phase</h2>
              <p className="text-gray-400">Voting controls coming in Phase 4</p>
            </div>
          )}
          {game.status === 'results' && (
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4">Results</h2>
              <p className="text-gray-400">Leaderboard coming in Phase 5</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
