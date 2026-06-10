import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchAuthStatus, createGame, deleteGame, fetchGames } from '../api';
import type { Game } from '../types';

const STATUS_LABELS: Record<string, string> = {
  lobby: 'Lobby',
  grouping: 'Grouping',
  statements: 'Statements',
  voting: 'Voting',
  results: 'Results',
};

const STATUS_COLORS: Record<string, string> = {
  lobby: 'bg-blue-600',
  grouping: 'bg-purple-600',
  statements: 'bg-yellow-600',
  voting: 'bg-orange-600',
  results: 'bg-green-600',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: auth, isLoading: authLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: fetchAuthStatus,
  });

  const createMutation = useMutation({
    mutationFn: createGame,
    onSuccess: (game: Game) => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
      navigate(`/manage/game/${game.id}`);
    },
  });

  const { data: games, isLoading: gamesLoading } = useQuery({
    queryKey: ['games'],
    queryFn: fetchGames,
    enabled: auth?.isGameKeeper,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGame,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
    },
  });

  if (authLoading) {
    return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Loading...</div>;
  }

  if (!auth?.isGameKeeper) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="text-center">
          {auth?.isAuthenticated ? (
            <>
              <p className="mb-2">Signed in as {auth.user?.userDetails}</p>
              <p className="text-red-400 mb-4">You are not authorized as a game keeper.</p>
              <a href="/.auth/logout" className="text-blue-400 hover:underline">Sign out</a>
            </>
          ) : (
            <>
              <p className="mb-4">Sign in to manage games</p>
              <a href="/.auth/login/aad" className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">Sign In</a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Game Keeper</h1>
          <div className="space-x-4 text-sm">
            <a href="/manage/keepers" className="text-blue-400 hover:underline">Manage Keepers</a>
            <a href="/.auth/logout" className="text-gray-400 hover:underline">Sign Out</a>
          </div>
        </div>

        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="w-full p-4 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 font-semibold text-lg mb-8"
        >
          {createMutation.isPending ? 'Creating...' : '+ Create New Game'}
        </button>

        {createMutation.isError && (
          <p className="text-red-400 mb-4">{createMutation.error.message}</p>
        )}

        {deleteMutation.isError && (
          <p className="text-red-400 mb-4">{deleteMutation.error.message}</p>
        )}

        <h2 className="text-xl font-semibold mb-4">Your Games</h2>
        {gamesLoading ? (
          <p className="text-gray-400 text-center">Loading games...</p>
        ) : !games?.length ? (
          <p className="text-gray-500 text-center">No games yet. Create one to get started!</p>
        ) : (
          <div className="space-y-3">
            {games.map((game) => (
              <div
                key={game.id}
                className="bg-gray-800 rounded-lg p-4 flex items-center justify-between"
              >
                <button
                  onClick={() => navigate(`/manage/game/${game.id}`)}
                  className="flex-1 text-left hover:bg-gray-700 -m-4 p-4 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-lg font-bold">{game.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[game.status] || 'bg-gray-600'}`}>
                      {STATUS_LABELS[game.status] || game.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    {game.playerCount} player{game.playerCount !== 1 ? 's' : ''}
                    {' · '}
                    {new Date(game.createdAt).toLocaleDateString()}
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete game ${game.id}?`)) {
                      deleteMutation.mutate(game.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="ml-4 text-red-400 hover:text-red-300 p-2 shrink-0"
                  title="Delete game"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
