import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  Hand,
  Hourglass,
  RotateCcw,
  Users,
  XCircle,
} from 'lucide-react';
import { ensureAnonymousUser } from '../firebase/auth';
import {
  joinRoomAsPlayer,
  lockPlayerPosition,
  unlockPlayerPosition,
} from '../engine/roomService';
import { useRoom } from '../hooks/useRoom';
import { useWakeLock } from '../hooks/useWakeLock';
import { WakeLockBadge } from '../components/WakeLockBadge';

export interface PlayerViewProps {
  initialPlayerUid?: string;
}

export function PlayerView({ initialPlayerUid }: PlayerViewProps = {}) {
  const { roomId } = useParams<{ roomId: string }>();
  const normalizedRoomId = roomId?.trim().toUpperCase();

  const { room, players, evaluation, loading, error } = useRoom(normalizedRoomId);
  const wakeLock = useWakeLock(true);

  const [playerUid, setPlayerUid] = useState<string | null>(initialPlayerUid ?? null);
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(
    initialPlayerUid && normalizedRoomId ? normalizedRoomId : null
  );
  const [joinError, setJoinError] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  const joining = Boolean(normalizedRoomId) && joinedRoomId !== normalizedRoomId && !joinError;

  // Automatisk anonym sesjon + innmelding i rommet uten navnefelt eller innlogging
  useEffect(() => {
    if (!normalizedRoomId) return;

    let cancelled = false;

    async function connectPlayer(targetRoomId: string) {
      try {
        const user = await ensureAnonymousUser();
        if (cancelled) return;
        setPlayerUid(user.uid);
        await joinRoomAsPlayer(targetRoomId, user.uid);
        if (!cancelled) {
          setJoinError(null);
          setJoinedRoomId(targetRoomId);
        }
      } catch (err) {
        console.error('Kunne ikke bli med i rom:', err);
        if (!cancelled) {
          setJoinError(
            err instanceof Error
              ? err.message
              : 'Kunne ikke koble til spillrommet. Sjekk romkoden og prøv igjen.'
          );
        }
      }
    }

    void connectPlayer(normalizedRoomId);

    return () => {
      cancelled = true;
    };
  }, [normalizedRoomId]);

  const myEntry = playerUid ? evaluation.byUid[playerUid] : undefined;
  const myPlayer = myEntry?.player ?? players.find((p) => p.uid === playerUid);
  const myCard = myPlayer?.card ?? null;

  async function handleLock() {
    if (!room || !playerUid || lockBusy) return;
    setLockBusy(true);
    setJoinError(null);
    try {
      await lockPlayerPosition(room.id, playerUid);
    } catch (err) {
      console.error('Låsing feilet:', err);
      setJoinError('Kunne ikke låse plassen din. Prøv igjen.');
    } finally {
      setLockBusy(false);
    }
  }

  async function handleUnlock() {
    if (!room || !playerUid || lockBusy) return;
    setLockBusy(true);
    setJoinError(null);
    try {
      await unlockPlayerPosition(room.id, playerUid);
    } catch (err) {
      console.error('Angring feilet:', err);
      setJoinError('Kunne ikke angre plassering. Prøv igjen.');
    } finally {
      setLockBusy(false);
    }
  }

  // Fullskjerms grønn/rød fasit-visning når verten avslører fasit
  if (!loading && room && room.status === 'revealed') {
    const hasCard = myCard !== null;
    const isCorrect = myEntry?.isCorrect === true;
    const isWrong = hasCard && myEntry?.isCorrect !== true;

    const screenModifier = isCorrect
      ? 'player-reveal-screen--correct'
      : isWrong
        ? 'player-reveal-screen--wrong'
        : 'player-reveal-screen--neutral';

    const verdictText = !hasCard
      ? 'RUNDE FERDIG'
      : isCorrect
        ? 'RIKTIG PLASS!'
        : myEntry?.lockedRank === null
          ? 'IKKE LÅST'
          : 'FEIL PLASS';

    return (
      <main
        className={`player-reveal-screen ${screenModifier}`}
        aria-live="assertive"
      >
        <header className="topbar">
          <span className="reveal-topbar-pill">Rom {room.id}</span>
          <WakeLockBadge
            isSupported={wakeLock.isSupported}
            isActive={wakeLock.isActive}
            inverted
          />
        </header>

        <section className="reveal-center">
          {isCorrect ? (
            <CheckCircle2 size={72} strokeWidth={2.2} aria-hidden="true" />
          ) : isWrong ? (
            <XCircle size={72} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <Hourglass size={64} strokeWidth={2} aria-hidden="true" />
          )}

          <h1 className="reveal-verdict">{verdictText}</h1>

          {hasCard ? (
            <>
              <div className="reveal-card-box">
                <span
                  style={{
                    fontSize: '0.875rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    opacity: 0.85,
                    fontWeight: 600,
                  }}
                >
                  Ditt kort
                </span>
                {myCard.imageUrl && (
                  <img
                    className="reveal-card-thumb"
                    src={myCard.imageUrl}
                    alt={myCard.imageAlt ?? myCard.label}
                    draggable={false}
                  />
                )}
                <div className="reveal-card-name">{myCard.label}</div>
                <div className="reveal-answer-value tabular">
                  {myCard.answerDisplay}
                </div>
              </div>

              <div className="reveal-ranks-pill tabular">
                <span>
                  Din plass:{' '}
                  {myEntry?.lockedRank !== null && myEntry?.lockedRank !== undefined
                    ? `#${myEntry.lockedRank}`
                    : '–'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Fasit:{' '}
                  {myEntry?.correctRank !== null && myEntry?.correctRank !== undefined
                    ? `#${myEntry.correctRank}`
                    : '–'}
                </span>
              </div>
            </>
          ) : (
            <p style={{ fontSize: '1.125rem', opacity: 0.92 }}>
              Du kom inn midt i runden og blir med fra neste runde!
            </p>
          )}
        </section>

        <footer style={{ opacity: 0.85, fontSize: '0.9375rem', fontWeight: 500 }}>
          Venter på at verten starter neste runde…
        </footer>
      </main>
    );
  }

  return (
    <main className="player-shell">
      <header className="topbar">
        <span className="room-code-pill">Rom {normalizedRoomId}</span>
        <WakeLockBadge isSupported={wakeLock.isSupported} isActive={wakeLock.isActive} />
      </header>

      {(joinError || error) && (
        <div className="alert" role="alert">
          <span>{joinError ?? error}</span>
        </div>
      )}

      {(loading || joining) && (
        <section
          className="surface stack-sm"
          style={{ margin: 'auto 0', textAlign: 'center', padding: 'var(--space-8)' }}
          aria-live="polite"
        >
          <h1 style={{ fontSize: '1.5rem' }}>Kobler til bordet…</h1>
          <p style={{ color: 'var(--ink-secondary)' }}>
            Gjør klart spillkortet ditt i rom {normalizedRoomId}.
          </p>
        </section>
      )}

      {!loading && !joining && !room && (
        <section
          className="surface stack-md"
          style={{ margin: 'auto 0', textAlign: 'center' }}
        >
          <h1 style={{ fontSize: '1.5rem' }}>Fant ikke rommet</h1>
          <p style={{ color: 'var(--ink-secondary)' }}>
            Sjekk at romkoden <strong>{normalizedRoomId}</strong> er riktig, eller skann
            QR-koden på nytt.
          </p>
          <Link to="/" className="btn btn--primary btn--full">
            Tilbake til forsiden
          </Link>
        </section>
      )}

      {!loading && !joining && room && room.status === 'lobby' && (
        <section
          className="surface stack-lg"
          style={{
            margin: 'auto 0',
            textAlign: 'center',
            padding: 'var(--space-8) var(--space-6)',
            alignItems: 'center',
          }}
          aria-live="polite"
        >
          <span className="badge badge--success">Tilkoblet</span>

          <div className="stack-xs">
            <h1 style={{ fontSize: '1.875rem' }}>Du er med i rommet!</h1>
            <p style={{ color: 'var(--ink-secondary)', fontSize: '1rem' }}>
              Venter på at verten starter runden…
            </p>
          </div>

          <div className="surface--subtle row" style={{ justifyContent: 'center' }}>
            <Users size={18} color="var(--ink-secondary)" aria-hidden="true" />
            <span className="tabular" style={{ fontWeight: 700 }}>
              {players.length} {players.length === 1 ? 'spiller' : 'spillere'} i lobbyen
            </span>
          </div>

          <p style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
            Legg mobilen på bordet foran deg. Skjermen holdes våken mens spillet pågår.
          </p>
        </section>
      )}

      {!loading && !joining && room && room.status === 'playing' && (
        <section className="player-stage" aria-label="Aktivt spillkort">
          {!myCard ? (
            <div
              className="surface stack-md"
              style={{
                margin: 'auto 0',
                textAlign: 'center',
                padding: 'var(--space-8) var(--space-6)',
                alignItems: 'center',
              }}
            >
              <Hourglass size={40} color="var(--accent)" aria-hidden="true" />
              <h1 style={{ fontSize: '1.5rem' }}>
                Runde pågår — du får kort i neste runde
              </h1>
              <p style={{ color: 'var(--ink-secondary)' }}>
                Hold denne siden åpen, så deles det automatisk ut et kort til deg når
                verten starter neste runde.
              </p>
            </div>
          ) : (
            <>
              <div className="row-between">
                <span className="badge badge--accent tabular">
                  Runde {room.roundNumber}
                </span>
                <span className="badge badge--dark">
                  {room.activeRoundDirection ?? 'Lavest → Høyest'}
                </span>
              </div>

              {myCard.imageUrl ? (
                <article
                  className="player-card-big player-card-big--image"
                  aria-label={`Ditt kort: ${myCard.label}`}
                >
                  <img
                    className="player-card-image"
                    src={myCard.imageUrl}
                    alt={myCard.imageAlt ?? myCard.label}
                    draggable={false}
                  />
                  <span className="player-card-eyebrow-pill">
                    {room.activeRoundTitle ?? 'Ditt kort'}
                  </span>
                  <div className="player-card-overlay">
                    <h1 className="player-card-overlay-label">{myCard.label}</h1>
                    {myCard.subtitle.trim().length > 0 && (
                      <p className="player-card-overlay-subtitle">{myCard.subtitle}</p>
                    )}
                  </div>
                </article>
              ) : (
                <article className="player-card-big" aria-label={`Ditt kort: ${myCard.label}`}>
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      color: 'var(--ink-muted)',
                    }}
                  >
                    {room.activeRoundTitle ?? 'Ditt kort'}
                  </span>
                  <h1 className="player-card-label">{myCard.label}</h1>
                  <p className="player-card-subtitle">{myCard.subtitle}</p>
                </article>
              )}

              {myEntry?.lockedRank !== null && myEntry?.lockedRank !== undefined ? (
                <div className="stack-sm">
                  <div className="player-rank-card" role="status" aria-live="polite">
                    <span className="player-rank-eyebrow">Din låste plassering</span>
                    <div className="player-rank-value tabular">
                      Plass {myEntry.lockedRank}
                    </div>
                    <span
                      className="tabular"
                      style={{ fontSize: '0.875rem', color: '#d4d4d8' }}
                    >
                      {evaluation.lockedCount} av {evaluation.totalPlayers} låst
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn--secondary btn--full"
                    onClick={handleUnlock}
                    disabled={lockBusy}
                  >
                    <RotateCcw size={18} aria-hidden="true" />
                    <span>{lockBusy ? 'Opphever…' : 'Angre plassering'}</span>
                  </button>
                </div>
              ) : (
                <div className="stack-xs">
                  <button
                    type="button"
                    className="btn-tactile-lock"
                    onClick={handleLock}
                    disabled={lockBusy}
                  >
                    <span className="row" style={{ gap: '10px', justifyContent: 'center' }}>
                      <Hand size={24} aria-hidden="true" />
                      <span>
                        {lockBusy ? 'Låser plass…' : 'Lås min plass / Trykk i rekkefølge'}
                      </span>
                    </span>
                    <span className="btn-tactile-sub tabular">
                      {evaluation.lockedCount} av {evaluation.totalPlayers} låst så langt
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
