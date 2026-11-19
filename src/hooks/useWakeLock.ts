import { useEffect, useState } from 'react';

export interface UseWakeLockResult {
  isSupported: boolean;
  isActive: boolean;
  error: string | null;
}

function hasWakeLockSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator &&
    typeof navigator.wakeLock?.request === 'function'
  );
}

/**
 * Holder skjermen våken via Screen Wake Lock API så lenge `enabled` er true.
 * Re-aktiveres automatisk dersom fanen/appen blir synlig igjen.
 */
export function useWakeLock(enabled = true): UseWakeLockResult {
  const isSupported = hasWakeLockSupport();
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !isSupported) {
      return;
    }

    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;

    const handleRelease = () => {
      if (!cancelled) {
        setIsActive(false);
      }
    };

    const requestWakeLock = async () => {
      if (cancelled || document.visibilityState !== 'visible') {
        return;
      }

      try {
        const nextSentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await nextSentinel.release();
          return;
        }
        sentinel = nextSentinel;
        sentinel.addEventListener('release', handleRelease);
        setIsActive(true);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setIsActive(false);
          setError(
            err instanceof Error
              ? err.message
              : 'Kunne ikke aktivere skjerm-lås (Wake Lock).',
          );
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel) {
        sentinel.removeEventListener('release', handleRelease);
        void sentinel.release().catch(() => {
          // Ignorer eventuelle feil dersom wake lock allerede er frigjort av nettleseren.
        });
        sentinel = null;
      }
      setIsActive(false);
    };
  }, [enabled, isSupported]);

  return {
    isSupported,
    isActive: enabled && isSupported ? isActive : false,
    error: enabled && isSupported ? error : null,
  };
}
