import { QRCodeSVG } from 'qrcode.react';

export function QRModal({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const gameUrl = `${window.location.origin}/?game=${gameId}`;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">Join Game</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="flex justify-center mb-4">
          <div className="bg-white p-4 rounded-xl">
            <QRCodeSVG value={gameUrl} size={220} level="M" />
          </div>
        </div>
        <p className="text-4xl font-bold tracking-[0.3em] font-mono text-center">{gameId}</p>
        <p className="text-gray-500 text-sm text-center mt-2">{gameUrl}</p>
        <p className="text-gray-400 text-xs text-center mt-4">Late arrivals earn 2 pts per correct vote (instead of 3)</p>
      </div>
    </div>
  );
}
