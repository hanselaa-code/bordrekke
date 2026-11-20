import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Play,
  RotateCcw,
  SkipForward,
  Smartphone,
  Users,
  XCircle,
} from 'lucide-react';
import { ensureAnonymousUser } from '../firebase/auth';
import { isFirebaseConfigured } from '../firebase/config';
import { ensureP2PHostRoom } from '../engine/p2pBackend';
import {
  resetAllLocks,
  resetGame,
  returnToLobby,
  revealAnswers,
  startRound,
} from '../engine/roomService';
import { useRoom } from '../hooks/useRoom';
import { useWakeLock } from '../hooks/useWakeLock';
import { WakeLockBadge } from '../components/WakeLockBadge';

export function HostView() {
  const { roomId } = useParams<{ roomId: string }>();
  const normalizedRoomId = roomId?.trim().toUpperCase();

  const { room, players, evaluation, loading, error } = useRoom(normalizedRoomId);
  const wakeLock = useWakeLock(true);

  const [hostUid, setHostUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    ensureAnonymousUser()
      .then(async (user) => {
        if (!active) return;
        setHostUid(user.uid);
        if (!isFirebaseConfigured && normalizedRoomId) {
          await ensureP2PHostRoom(normalizedRoomId, user.uid);
        }
      })
      .catch((err) => {
        console.error('Anonym innlogging feilet for host:', err);
        if (active) {
          setAuthError('Kunne ikke starte spillrommet. Last siden på nytt.');
        }
      });
    return () => {
      active = false;
    };
  }, [normalizedRoomId]);

  const joinUrl = useMemo(() => {
    if (!normalizedRoomId || typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}#/play/${normalizedRoomId}`;
  }, [normalizedRoomId]);

  async function handleCopyLink() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError('Kunne ikke kopiere lenken automatisk. Del romkoden manuelt.');
    }
  }

  async function runAction(name: string, fn: () => Promise<void>) {
    if (actionBusy) return;
    setActionError(null);
    setActionBusy(name);
    try {
      await fn();
    } catch (err) {
      console.error(`Handling «${name}» feilet:`, err);
      setActionError(
        err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen.'
      );
    } finally {
      setActionBusy(null);
    }
  }

  async function handleStartOrNextRound() {
    if (!room) return;
    const uid = hostUid ?? room.hostUid;
    await runAction('start', () =>
      startRound(room.id, uid, room.roundNumber, players)
    );
  }

  async function handleResetLocks() {
    if (!room) return;
    await runAction('reset', () => resetAllLocks(room.id, players));
  }

  async function handleReveal() {
    if (!room) return;
    await runAction('reveal', () => revealAnswers(room.id));
  }

  async function handleReturnToLobby() {
    if (!room) return;
    await runAction('lobby', () => returnToLobby(room.id, players));
  }

  async function handleResetGame() {
    if (!room) return;
    await runAction('reset-game', () => resetGame(room.id, players));
  }

  const playersWithCards = useMemo(
    () => evaluation.rankedPlayers.filter((entry) => entry.player.card !== null),
    [evaluation.rankedPlayers]
  );

  const progressPercent =
    evaluation.totalPlayers > 0
      ? Math.round((evaluation.lockedCount / evaluation.totalPlayers) * 100)
      : 0;

  return (
    <main className="page">
      <div className="container">
        <header className="topbar">
          <div className="row">
            <Link to="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                BR
              </span>
              <span>Bordrekke</span>
            </Link>
            {normalizedRoomId && (
              <span className="room-code-pill" aria-label={`Romkode ${normalizedRoomId}`}>
                {normalizedRoomId}
              </span>
            )}
          </div>

          <div className="row">
            <WakeLockBadge isSupported={wakeLock.isSupported} isActive={wakeLock.isActive} />
            <span className="badge badge--dark tabular">
              <Users size={14} aria-hidden="true" />
              <span>
                {players.length} {players.length === 1 ? 'spiller' : 'spillere'}
              </span>
            </span>
          </div>
        </header>

        {(authError || error || actionError) && (
          <div className="alert" role="alert">
            <span>{authError ?? error ?? actionError}</span>
          </div>
        )}

        {loading && (
          <section className="surface stack-sm" aria-live="polite">
            <h1 style={{ fontSize: '1.5rem' }}>Kobler til spillrom…</h1>
            <p style={{ color: 'var(--ink-secondary)' }}>
              Henter sanntidsstatus for rom {normalizedRoomId}.
            </p>
          </section>
        )}

        {!loading && !room && (
          <section className="surface stack-md">
            <h1 style={{ fontSize: '1.625rem' }}>Fant ikke spillrommet</h1>
            <p style={{ color: 'var(--ink-secondary)' }}>
              Rommet <strong>{normalizedRoomId}</strong> finnes ikke eller har blitt
              avsluttet.
            </p>
            <div>
              <Link to="/" className="btn btn--primary">
                Tilbake til forsiden
              </Link>
            </div>
          </section>
        )}

        {!loading && room && room.status === 'lobby' && (
          <section className="host-lobby-grid" aria-label="Lobby for spillvert">
            <div className="surface qr-panel">
              <span className="badge badge--accent">Skann for å bli med</span>
              <div className="qr-frame">
                <QRCodeSVG
                  value={joinUrl}
                  size={232}
                  level="M"
                  bgColor="#FFFFFF"
                  fgColor="#18181B"
                />
              </div>

              <div className="stack-xs" style={{ alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--ink-muted)',
                  }}
                >
                  Romkode
                </span>
                <div className="room-code-big" data-selectable="true">
                  {room.id}
                </div>
              </div>

              <button
                type="button"
                className="btn btn--secondary btn--full"
                onClick={handleCopyLink}
              >
                {copied ? (
                  <>
                    <Check size={18} color="var(--correct)" aria-hidden="true" />
                    <span>Lenke kopiert!</span>
                  </>
                ) : (
                  <>
                    <Copy size={18} aria-hidden="true" />
                    <span>Kopier invitasjonslenke</span>
                  </>
                )}
              </button>
            </div>

            <div className="surface stack-lg">
              <div className="row-between">
                <div className="stack-xs">
                  <span className="badge">Lobby</span>
                  <h1 style={{ fontSize: '1.75rem' }}>Venter på spillere</h1>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="player-count-big tabular">{players.length}</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                    tilkoblet
                  </div>
                </div>
              </div>

              {players.length === 0 ? (
                <div className="surface--subtle stack-xs">
                  <p style={{ fontWeight: 600 }}>Ingen mobiler tilkoblet ennå</p>
                  <p style={{ fontSize: '0.9375rem', color: 'var(--ink-secondary)' }}>
                    Be minst 2 spillere skanne QR-koden eller skrive inn romkoden{' '}
                    <strong>{room.id}</strong> på mobilen sin.
                  </p>
                </div>
              ) : (
                <div className="device-grid" aria-label="Tilkoblede enheter">
                  {players.map((player, index) => (
                    <div key={player.uid} className="device-chip">
                      <span className="device-chip-dot" aria-hidden="true" />
                      <Smartphone size={16} color="var(--ink-muted)" aria-hidden="true" />
                      <span className="tabular">Mobil {index + 1}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="stack-sm">
                <button
                  type="button"
                  className="btn btn--primary btn--lg btn--full"
                  onClick={handleStartOrNextRound}
                  disabled={players.length < 2 || actionBusy !== null}
                >
                  <Play size={22} aria-hidden="true" />
                  <span>
                    {actionBusy === 'start'
                      ? 'Deler ut kort…'
                      : room.roundNumber > 0
                        ? `Start runde ${room.roundNumber + 1}`
                        : 'Start runde / Vis spørsmål'}
                  </span>
                </button>
                {room.roundNumber > 0 && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--full"
                    onClick={handleResetGame}
                    disabled={actionBusy !== null}
                  >
                    <RotateCcw size={18} aria-hidden="true" />
                    <span>
                      {actionBusy === 'reset-game'
                        ? 'Nullstiller…'
                        : 'Nullstill spill (start fra runde 1)'}
                    </span>
                  </button>
                )}
                {players.length < 2 && (
                  <p
                    style={{
                      fontSize: '0.875rem',
                      color: 'var(--ink-muted)',
                      textAlign: 'center',
                    }}
                  >
                    Trenger minst 2 tilkoblede spillere for å starte en runde.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {!loading && room && room.status === 'playing' && (
          <section className="stack-md" aria-label="Aktiv runde">
            <div className="surface stack-md">
              <div className="row-between">
                <span className="badge badge--accent tabular">
                  Runde {room.roundNumber}
                </span>
                <span className="badge badge--dark">
                  {room.activeRoundDirection ?? 'Lavest → Høyest'}
                </span>
              </div>

              <div className="stack-xs">
                <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.25rem)' }}>
                  {room.activeRoundTitle ?? `Runde ${room.roundNumber}`}
                </h1>
                <p style={{ color: 'var(--ink-secondary)' }}>
                  Spillerne diskuterer rekkefølgen og trykker «Lås min plass» på sin mobil (
                  {room.activeRoundDirection ?? 'Lavest → Høyest'}).
                </p>
              </div>

              <div className="stack-xs">
                <div className="row-between">
                  <strong className="tabular" style={{ fontSize: '1.0625rem' }}>
                    {evaluation.lockedCount} av {evaluation.totalPlayers} har låst sin plass
                  </strong>
                  {evaluation.allLocked && (
                    <span className="badge badge--success">Alle har låst!</span>
                  )}
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-valuenow={evaluation.lockedCount}
                  aria-valuemin={0}
                  aria-valuemax={evaluation.totalPlayers}
                >
                  <div
                    className={`progress-fill ${evaluation.allLocked ? 'progress-fill--done' : ''}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="row" style={{ marginTop: '4px' }}>
                <button
                  type="button"
                  className={`btn btn--lg ${evaluation.allLocked ? 'btn--success' : 'btn--dark'}`}
                  style={{ flex: '1 1 240px' }}
                  onClick={handleReveal}
                  disabled={actionBusy !== null}
                >
                  <Eye size={20} aria-hidden="true" />
                  <span>
                    {actionBusy === 'reveal'
                      ? 'Avslører fasit…'
                      : evaluation.allLocked
                        ? 'Vis fasit nå'
                        : `Vis fasit (${evaluation.lockedCount}/${evaluation.totalPlayers} låst)`}
                  </span>
                </button>

                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  onClick={handleResetLocks}
                  disabled={evaluation.lockedCount === 0 || actionBusy !== null}
                >
                  <RotateCcw size={18} aria-hidden="true" />
                  <span>Nullstill plasseringer</span>
                </button>

                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  onClick={handleStartOrNextRound}
                  disabled={players.length < 2 || actionBusy !== null}
                >
                  <SkipForward size={18} aria-hidden="true" />
                  <span>{actionBusy === 'start' ? 'Starter…' : 'Ny runde'}</span>
                </button>

                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  onClick={handleResetGame}
                  disabled={actionBusy !== null}
                >
                  <RotateCcw size={18} aria-hidden="true" />
                  <span>{actionBusy === 'reset-game' ? 'Nullstiller…' : 'Nullstill spill'}</span>
                </button>
              </div>
            </div>

            <div className="surface stack-md">
              <div className="row-between">
                <h2 style={{ fontSize: '1.25rem' }}>Sanntids rekkefølge</h2>
                <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                  Oppdateres umiddelbart når mobiler trykkes
                </span>
              </div>

              <div className="slot-list">
                {playersWithCards.map((entry, idx) => {
                  const isLocked = entry.lockedRank !== null;
                  const card = entry.player.card;
                  return (
                    <div
                      key={entry.player.uid}
                      className={`slot-row ${isLocked ? 'slot-row--locked' : ''}`}
                    >
                      <div className="slot-main">
                        <span
                          className={`slot-rank tabular ${isLocked ? 'slot-rank--locked' : ''}`}
                        >
                          {isLocked ? `#${entry.lockedRank}` : '–'}
                        </span>
                        {card?.imageUrl && (
                          <img
                            className="slot-thumb"
                            src={card.imageUrl}
                            alt={card.imageAlt ?? card.label}
                            draggable={false}
                          />
                        )}
                        <div className="stack-xs" style={{ gap: '2px', minWidth: 0 }}>
                          <strong style={{ fontSize: '1.125rem' }}>
                            {card?.label ?? `Spiller ${idx + 1}`}
                          </strong>
                          <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                            {isLocked
                              ? `Låst som Plass ${entry.lockedRank}`
                              : 'Ikke låst ennå'}
                          </span>
                        </div>
                      </div>

                      <span className={`badge ${isLocked ? 'badge--dark' : ''}`}>
                        {isLocked ? `Plass ${entry.lockedRank}` : 'Venter'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {!loading && room && room.status === 'revealed' && (
          <section className="stack-md" aria-label="Fasit og resultat">
            <div
              className={`score-banner ${
                evaluation.totalPlayers > 0 &&
                evaluation.correctCount === evaluation.totalPlayers
                  ? 'score-banner--perfect'
                  : ''
              }`}
            >
              <span
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  opacity: 0.85,
                }}
              >
                Fasit · Runde {room.roundNumber}
              </span>
              <h1 style={{ color: '#ffffff', fontSize: 'clamp(1.75rem, 5vw, 2.5rem)' }}>
                {evaluation.correctCount} av {evaluation.totalPlayers} riktig plassert!
              </h1>
              <p style={{ opacity: 0.9 }}>
                {room.activeRoundTitle} ({room.activeRoundDirection ?? 'Lavest → Høyest'})
              </p>
            </div>

            <div className="row">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                style={{ flex: '1 1 240px' }}
                onClick={handleStartOrNextRound}
                disabled={players.length < 2 || actionBusy !== null}
              >
                <SkipForward size={20} aria-hidden="true" />
                <span>{actionBusy === 'start' ? 'Starter neste…' : 'Neste runde'}</span>
              </button>

              <button
                type="button"
                className="btn btn--secondary btn--lg"
                onClick={handleReturnToLobby}
                disabled={actionBusy !== null}
              >
                <span>Tilbake til lobby</span>
              </button>

              <button
                type="button"
                className="btn btn--secondary btn--lg"
                onClick={handleResetGame}
                disabled={actionBusy !== null}
              >
                <RotateCcw size={18} aria-hidden="true" />
                <span>
                  {actionBusy === 'reset-game' ? 'Nullstiller…' : 'Nytt spill (Runde 1)'}
                </span>
              </button>
            </div>

            <div className="reveal-grid">
              <div className="surface stack-md">
                <div className="row-between">
                  <h2 style={{ fontSize: '1.25rem' }}>Spillernes rekkefølge</h2>
                  <span className="badge">Innlåst</span>
                </div>

                <div className="slot-list">
                  {playersWithCards.map((entry) => {
                    const isCorrect = entry.isCorrect === true;
                    const card = entry.player.card;
                    return (
                      <div
                        key={entry.player.uid}
                        className={`slot-row ${isCorrect ? 'slot-row--correct' : 'slot-row--wrong'}`}
                      >
                        <div className="slot-main">
                          <span
                            className={`slot-rank tabular ${
                              isCorrect ? 'slot-rank--correct' : 'slot-rank--wrong'
                            }`}
                          >
                            {entry.lockedRank !== null ? `#${entry.lockedRank}` : '–'}
                          </span>
                          {card?.imageUrl && (
                            <img
                              className="slot-thumb"
                              src={card.imageUrl}
                              alt={card.imageAlt ?? card.label}
                              draggable={false}
                            />
                          )}
                          <div className="stack-xs" style={{ gap: '2px', minWidth: 0 }}>
                            <strong style={{ fontSize: '1.0625rem' }}>{card?.label}</strong>
                            <span
                              style={{ fontSize: '0.875rem', color: 'var(--ink-secondary)' }}
                            >
                              {card?.answerDisplay} · Fasit #{entry.correctRank}
                            </span>
                          </div>
                        </div>

                        {isCorrect ? (
                          <CheckCircle2
                            size={24}
                            color="var(--correct)"
                            aria-label="Riktig plass"
                          />
                        ) : (
                          <XCircle size={24} color="var(--wrong)" aria-label="Feil plass" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="surface stack-md">
                <div className="row-between">
                  <h2 style={{ fontSize: '1.25rem' }}>Riktig fasit-rekkefølge</h2>
                  <span className="badge badge--success">
                    {room.activeRoundDirection ?? 'Lavest → Høyest'}
                  </span>
                </div>

                <div className="slot-list">
                  {evaluation.correctOrder.map((entry) => {
                    const card = entry.player.card;
                    return (
                      <div key={entry.player.uid} className="slot-row">
                        <div className="slot-main">
                          <span className="slot-rank slot-rank--locked tabular">
                            #{entry.correctRank}
                          </span>
                          {card?.imageUrl && (
                            <img
                              className="slot-thumb"
                              src={card.imageUrl}
                              alt={card.imageAlt ?? card.label}
                              draggable={false}
                            />
                          )}
                          <div className="stack-xs" style={{ gap: '2px', minWidth: 0 }}>
                            <strong style={{ fontSize: '1.0625rem' }}>{card?.label}</strong>
                            <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                              {entry.lockedRank !== null
                                ? `Ble plassert som #${entry.lockedRank}`
                                : 'Ble ikke låst'}
                            </span>
                          </div>
                        </div>

                        <span className="badge badge--accent tabular">
                          {card?.answerDisplay}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
