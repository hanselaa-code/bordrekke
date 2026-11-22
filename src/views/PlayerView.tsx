import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Hand,
  Hourglass,
  RotateCcw,
  Users,
  XCircle,
} from 'lucide-react';
import { ensureAnonymousUser, getStableDeviceId } from '../firebase/auth';
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
  const [searchParams] = useSearchParams();
  const normalizedRoomId = roomId?.trim().toUpperCase();
  const requestedTeamId = searchParams.get('team')?.trim() || null;

  const { room, players, evaluation, teamEvaluations, loading, error } = useRoom(normalizedRoomId);
  const wakeLock = useWakeLock(true);

  const [playerUid, setPlayerUid] = useState<string | null>(initialPlayerUid ?? null);
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(
    initialPlayerUid && normalizedRoomId ? normalizedRoomId : null
  );
  const [joinError, setJoinError] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [revealedRoundKey, setRevealedRoundKey] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

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
        await joinRoomAsPlayer(targetRoomId, user.uid, getStableDeviceId(), requestedTeamId);
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
  }, [normalizedRoomId, requestedTeamId, retryCount]);

  const rawMyPlayer = players.find((p) => p.uid === playerUid);
  const myTeamId = rawMyPlayer?.teamId ?? requestedTeamId;
  const isSimultaneousTeams = room?.gameMode === 'teams-simultaneous';
  const isTurnTeams = room?.gameMode === 'teams-turn';

  const activeEvaluation =
    isSimultaneousTeams && myTeamId && teamEvaluations[myTeamId]
      ? teamEvaluations[myTeamId]
      : evaluation;

  const myTeam =
    isSimultaneousTeams && myTeamId
      ? room?.teams.find((t) => t.id === myTeamId) ?? null
      : isTurnTeams && room && room.teams.length > 0
        ? room.teams[room.activeTeamIndex % room.teams.length] ?? null
        : null;

  const myEntry = playerUid ? activeEvaluation.byUid[playerUid] : undefined;
  const myPlayer = myEntry?.player ?? rawMyPlayer;
  const myCard = myPlayer?.card ?? null;

  const isRoomRevealed = !loading && room !== null && room.status === 'revealed';
  const currentRevealKey = room ? `${room.id}:${room.roundNumber}` : null;
  const revealDelayMs = !isRoomRevealed || myCard === null
    ? 0
    : myEntry?.lockedRank !== null && myEntry?.lockedRank !== undefined
      ? Math.max(0, (myEntry.lockedRank - 1) * 1000)
      : activeEvaluation.lockedCount * 1000;

  const isMyRevealReady =
    isRoomRevealed &&
    (revealDelayMs === 0 || (currentRevealKey !== null && revealedRoundKey === currentRevealKey));

  // Sekvensiell avsløring på rekke og rad (1 sekund mellom hver telefon: Plass 1 → 2 → 3 → …)
  useEffect(() => {
    if (!isRoomRevealed || !currentRevealKey) {
      return;
    }

    if (revealDelayMs === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRevealedRoundKey(currentRevealKey);
    }, revealDelayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isRoomRevealed, currentRevealKey, revealDelayMs]);

  // Diskret vibrasjon når akkurat denne telefonen lyser opp
  useEffect(() => {
    if (!isMyRevealReady || myCard === null) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(myEntry?.isCorrect === true ? 60 : [70, 45, 70]);
      } catch {
        // Ignorer hvis nettleseren blokkerer vibrasjon
      }
    }
  }, [isMyRevealReady, currentRevealKey, myCard, myEntry?.isCorrect]);

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

  // Fullskjerms grønn/rød fasit-visning når verten avslører fasit (på rekke og rad med 1 sek mellomrom)
  if (!loading && room && room.status === 'revealed') {
    const hasCard = myCard !== null;
    const isCorrect = isMyRevealReady && myEntry?.isCorrect === true;
    const isWrong = isMyRevealReady && hasCard && myEntry?.isCorrect !== true;

    const screenModifier = !isMyRevealReady
      ? 'player-reveal-screen--pending'
      : isCorrect
        ? 'player-reveal-screen--correct'
        : isWrong
          ? 'player-reveal-screen--wrong'
          : 'player-reveal-screen--neutral';

    const verdictText = !isMyRevealReady
      ? 'AVSLØRER…'
      : !hasCard
        ? 'RUNDE FERDIG'
        : isCorrect
          ? 'RIKTIG PLASS!'
          : myEntry?.lockedRank === null
            ? 'IKKE LÅST'
            : 'FEIL PLASS';

    return (
      <main
        key={isMyRevealReady ? 'revealed-active' : 'revealed-pending'}
        className={`player-reveal-screen ${screenModifier}`}
        aria-live="assertive"
      >
        <header className="topbar">
          <div className="row" style={{ gap: '8px' }}>
            {myTeam && (
              <span
                className="team-pill"
                style={{
                  backgroundColor: myTeam.color,
                  color: '#ffffff',
                  border: '1.5px solid rgba(255,255,255,0.55)',
                }}
              >
                {isTurnTeams ? `${myTeam.name} sin tur` : myTeam.name}
              </span>
            )}
            <span className="reveal-topbar-pill">Rom {room.id}</span>
          </div>
          <WakeLockBadge
            isSupported={wakeLock.isSupported}
            isActive={wakeLock.isActive}
            inverted
          />
        </header>

        <section className="reveal-center">
          <div className="reveal-header-block">
            {isMyRevealReady ? (
              isCorrect ? (
                <CheckCircle2 size={56} strokeWidth={2.3} aria-hidden="true" />
              ) : isWrong ? (
                <XCircle size={56} strokeWidth={2.3} aria-hidden="true" />
              ) : (
                <Hourglass size={52} strokeWidth={2} aria-hidden="true" />
              )
            ) : (
              <Hourglass
                size={48}
                strokeWidth={2}
                className="reveal-pending-pulse"
                aria-hidden="true"
              />
            )}
            <h1 className="reveal-verdict">{verdictText}</h1>
          </div>

          {hasCard ? (
            <>
              <div
                className={`reveal-card-stage ${
                  myCard.imageUrl ? 'reveal-card-stage--image' : ''
                }`}
              >
                {myCard.imageUrl && (
                  <img
                    className="reveal-card-thumb"
                    src={myCard.imageUrl}
                    alt={myCard.imageAlt ?? myCard.label}
                    draggable={false}
                  />
                )}

                {isMyRevealReady ? (
                  <div
                    className={`reveal-card-answer-overlay ${
                      isCorrect
                        ? 'reveal-card-answer-overlay--correct'
                        : 'reveal-card-answer-overlay--wrong'
                    }`}
                  >
                    <span className="reveal-card-answer-eyebrow">Fasit</span>
                    <div className="reveal-answer-value tabular">
                      {myCard.answerDisplay}
                    </div>
                  </div>
                ) : (
                  <div className="reveal-card-pending-overlay">
                    <span className="reveal-pending-pill tabular">
                      {myEntry?.lockedRank !== null && myEntry?.lockedRank !== undefined
                        ? `Plass #${myEntry.lockedRank} · Vent…`
                        : 'Venter på tur…'}
                    </span>
                  </div>
                )}

                <div className="reveal-card-caption">
                  <div className="reveal-card-name">{myCard.label}</div>
                </div>
              </div>

              {isMyRevealReady && (
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
              )}
            </>
          ) : (
            <p style={{ fontSize: '1.125rem', opacity: 0.92 }}>
              Du kom inn midt i runden og blir med fra neste runde!
            </p>
          )}
        </section>

        <footer style={{ opacity: 0.85, fontSize: '0.9375rem', fontWeight: 500 }}>
          {isMyRevealReady
            ? 'Venter på at verten starter neste runde…'
            : 'Telefonene avsløres én etter én langs bordet…'}
        </footer>
      </main>
    );
  }

  return (
    <main className="player-shell">
      <header className="topbar">
        <div className="row" style={{ gap: '8px' }}>
          {myTeam && (
            <span
              className="team-pill"
              style={{ backgroundColor: myTeam.color, color: '#ffffff' }}
            >
              {isTurnTeams ? `${myTeam.name} sin tur` : myTeam.name}
            </span>
          )}
          <span className="room-code-pill">Rom {normalizedRoomId}</span>
        </div>
        <WakeLockBadge isSupported={wakeLock.isSupported} isActive={wakeLock.isActive} />
      </header>

      {(joinError || error) && (
        <div className="alert stack-sm" role="alert">
          <span>{joinError ?? error}</span>
          <button
            type="button"
            className="btn btn--secondary btn--full"
            onClick={() => {
              setJoinError(null);
              setJoinedRoomId(null);
              setRetryCount((c) => c + 1);
            }}
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span>Prøv å koble til på nytt</span>
          </button>
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
              {isSimultaneousTeams && myTeam
                ? `${activeEvaluation.totalPlayers} ${activeEvaluation.totalPlayers === 1 ? 'spiller' : 'spillere'} på ${myTeam.name}`
                : `${players.length} ${players.length === 1 ? 'spiller' : 'spillere'} i lobbyen`}
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
                  {myCard.subtitle.trim().length > 0 && (
                    <p className="player-card-subtitle">{myCard.subtitle}</p>
                  )}
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
                      {activeEvaluation.lockedCount} av {activeEvaluation.totalPlayers} låst
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
                      {activeEvaluation.lockedCount} av {activeEvaluation.totalPlayers} låst så langt
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
