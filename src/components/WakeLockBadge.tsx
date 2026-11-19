interface WakeLockBadgeProps {
  isSupported: boolean;
  isActive: boolean;
  inverted?: boolean;
}

export function WakeLockBadge({
  isSupported,
  isActive,
  inverted = false,
}: WakeLockBadgeProps) {
  const label = !isSupported
    ? 'Wake Lock ikke støttet'
    : isActive
      ? 'Skjerm holdes våken'
      : 'Skjermlås inaktiv';

  if (inverted) {
    return (
      <span className="reveal-topbar-pill" role="status" aria-live="polite">
        <span
          className={`wake-dot ${isActive ? 'wake-dot--active' : ''}`}
          aria-hidden="true"
        />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span className="badge" role="status" aria-live="polite">
      <span
        className={`wake-dot ${isActive ? 'wake-dot--active' : ''}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}
