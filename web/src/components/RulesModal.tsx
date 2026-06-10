export function RulesModal({ hasLateArrivals, onClose }: { hasLateArrivals: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Scoring Rules</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="space-y-3 text-gray-300">
          <div>
            <p className="font-semibold text-white mb-1">How to play</p>
            <p className="text-sm">Each group writes 2 truths and 1 lie. Vote on which statement you think is the lie for each group.</p>
          </div>
          <div>
            <p className="font-semibold text-white mb-1">Scoring</p>
            <ul className="text-sm space-y-1">
              <li>• <span className="text-green-400">3 points</span> for each correct vote</li>
              <li>• <span className="text-yellow-400">+2 bonus</span> for the fastest correct vote per group</li>
              <li>• You cannot vote on your own group</li>
            </ul>
          </div>
          {hasLateArrivals && (
            <div className="border-t border-gray-700 pt-3">
              <p className="font-semibold text-white mb-1 text-sm">Late Arrivals</p>
              <p className="text-xs text-gray-400">
                Players who joined after groups were formed earn <span className="text-blue-400">2 points</span> per correct vote instead of 3. They are still eligible for the speed bonus.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
