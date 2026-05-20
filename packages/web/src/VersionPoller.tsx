import { useState, useEffect } from 'react';

interface VersionPollerProps {
  intervalMs?: number;
  onNewVersion?: (newVersion: string) => void;
}

const CURRENT_VERSION = '0.2.4';

export default function VersionPoller({
  intervalMs = 3 * 60 * 1000, // 3 minutes
  onNewVersion,
}: VersionPollerProps) {
  const [hasNotified, setHasNotified] = useState(false);

  useEffect(() => {
    async function checkVersion() {
      try {
        const res = await fetch('/health?token=' + encodeURIComponent(document.cookie.match(/curie_token=([^;]*)/)?.[1] ?? ''), {
          cache: 'no-store',
        });
        const data = await res.json();
        if (data.version && data.version !== CURRENT_VERSION && !hasNotified) {
          setHasNotified(true);
          onNewVersion?.(data.version);
          window.dispatchEvent(new CustomEvent('pwa-version-update'));
        }
      } catch {
        // Silently fail — browser may be offline or server unavailable
      }
    }

    checkVersion();
    const id = setInterval(checkVersion, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, hasNotified, onNewVersion]);

  return null;
}
