import { useState, useEffect } from 'react';

interface UpdateNotificationProps {
  onReload?: () => void;
}

export default function UpdateNotification({ onReload }: UpdateNotificationProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handleUpdateAvailable = () => setShow(true);
    const handleControllerUpdated = () => {
      setShow(false);
      onReload?.();
    };

    window.addEventListener('pwa-update-available', handleUpdateAvailable);
    window.addEventListener('pwa-controller-updated', handleControllerUpdated);

    return () => {
      window.removeEventListener('pwa-update-available', handleUpdateAvailable);
      window.removeEventListener('pwa-controller-updated', handleControllerUpdated);
    };
  }, [onReload]);

  const handleUpdate = () => {
    setShow(false);

    // Try to message the waiting service worker directly
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        if (reg.waiting) {
          reg.waiting.postMessage('SKIP_WAITING');
        }
      });
    }

    // Fallback: if window tracks the installing worker
    if ((window as any)._pendingUpdateWorker) {
      (window as any)._pendingUpdateWorker.postMessage('SKIP_WAITING');
    }
  };

  if (!show) return null;

  return (
    <div className="bg-blue-500/10 border-b border-blue-500/20 text-blue-400 px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2 select-none shrink-0 z-50 animate-fadeIn">
      <svg className="animate-bounce shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      Update available
      <button
        onClick={handleUpdate}
        className="bg-blue-500/20 border border-blue-500/40 text-blue-400 px-2 py-0.5 rounded-[4px] text-[11px] font-bold cursor-pointer hover:bg-blue-500/30 transition-all duration-100"
      >
        Update
      </button>
    </div>
  );
}
