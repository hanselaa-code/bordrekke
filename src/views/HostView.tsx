import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  LogOut,
  Play,
  RotateCcw,
  SkipForward,
  Smartphone,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { MOCK_ROUNDS, getRoundByNumber } from '../data/mockRounds';
import { ensureAnonymousUser } from '../firebase/auth';
import { isFirebaseConfigured } from '../firebase/config';
import { ensureP2PHostRoom } from '../engine/p2pBackend';
import {
  closeRoom,
  createRoom,
  removePlayerFromRoom,
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
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const normalizedRoomId = roomId?.trim().toUpperCase();
  const dedupInFlightRef = useRef<Set<string>>(new Set());

  const { room, players, evaluation, loading, error } = useRoom(normalizedRoomId);
  const wakeLock = useWakeLock(true);

  const [hostUid, setHostUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const storageKey = normalizedRoomId ? `bordrekke:selectedRounds:${normalizedRoomId}` : null;
  const [selectedRoundIds, setSelectedRoundIds] = useState<string[]>(() => {
    const allIds = MOCK_ROUNDS.map((r) => r.id);
    if (typeof window === 'undefined' || !storageKey) {
      return allIds;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return allIds;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const validSet = new Set(allIds);
        return parsed.filter((id): id is string => typeof id === 'string' && validSet.has(id));
      }
    } catch {
      // Ignorer ugyldig lagring
    }
    return allIds;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(selectedRoundIds));
    } catch {
      // Ignorer lagringsfeil
    }
  }, [storageKey, selectedRoundIds]);

  function toggleRoundSelection(roundId: string) {
    setSelectedRoundIds((prev) =>
      prev.includes(roundId) ? prev.filter((id) => id !== roundId) : [...prev, roundId]
    );
  }

  function handleSelectAllRounds() {
    setSelectedRoundIds(MOCK_ROUNDS.map((r) => r.id));
  }

  function handleClearAllRounds() {
    setSelectedRoundIds([]);
  }

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
    if (selectedRoundIds.length === 0) {
      setActionError('Velg minst ett spørsmål for å starte runden.');
      return;
    }
    const uid = hostUid ?? room.hostUid;
    await runAction('start', () =>
      startRound(room.id, uid, room.roundNumber, players, selectedRoundIds)
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

  async function handleRemovePlayer(targetUid: string) {
    if (!room) return;
    await runAction(`remove-${targetUid}`, () => removePlayerFromRoom(room.id, targetUid));
  }

  async function handleEndGameToHome() {
    if (actionBusy) return;
    setActionError(null);
    setActionBusy('end-game');
    try {
      if (room) {
        await closeRoom(room.id, players);
      }
    } catch (err) {
      console.error('Kunne ikke lukke rommet rent:', err);
    } finally {
      setActionBusy(null);
      navigate('/');
    }
  }

  async function handleStartFreshRoom() {
    if (actionBusy) return;
    setActionError(null);
    setActionBusy('fresh-room');
    try {
      const user = await ensureAnonymousUser();
      if (room) {
        await closeRoom(room.id, players).catch(() => {});
      }
      const nextCode = await createRoom(user.uid);
      navigate(`/host/${nextCode}`);
    } catch (err) {
      console.error('Kunne ikke opprette nytt rom:', err);
      setActionError(
        err instanceof Error ? err.message : 'Kunne ikke starte et nytt spillrom. Prøv igjen.'
      );
    } finally {
      setActionBusy(null);
    }
  }

  // Automatisk avduplisering: kun én deltakelse per telefon (deviceId) i rommet
  useEffect(() => {
    if (!room || !hostUid || room.hostUid !== hostUid) return;

    const byDevice = new Map<string, typeof players>();
    for (const player of players) {
      const devId = player.deviceId?.trim();
      if (!devId) continue;
      const list = byDevice.get(devId);
      if (list) {
        list.push(player);
      } else {
        byDevice.set(devId, [player]);
      }
    }

    for (const group of byDevice.values()) {
      if (group.length <= 1) continue;
      // Behold den nyeste (eller den som allerede har kort), fjern eldre duplikater
      const sorted = [...group].sort((a, b) => {
        const aHasCard = a.card ? 1 : 0;
        const bHasCard = b.card ? 1 : 0;
        if (aHasCard !== bHasCard) return bHasCard - aHasCard;
        const aTime = a.joinedAt?.toMillis() ?? 0;
        const bTime = b.joinedAt?.toMillis() ?? 0;
        return bTime - aTime;
      });
      const duplicates = sorted.slice(1);
      for (const dup of duplicates) {
        if (dedupInFlightRef.current.has(dup.uid)) continue;
        dedupInFlightRef.current.add(dup.uid);
        void removePlayerFromRoom(room.id, dup.uid)
          .catch((err) => console.error('Kunne ikke fjerne duplikat enhet:', err))
          .finally(() => {
            dedupInFlightRef.current.delete(dup.uid);
          });
      }
    }
  }, [room, hostUid, players]);

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
            <button
              type="button"
              className="btn btn--secondary"
              style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.875rem' }}
              onClick={handleEndGameToHome}
              disabled={actionBusy !== null}
            >
              <LogOut size={15} aria-hidden="true" />
              <span>{actionBusy === 'end-game' ? 'Avslutter…' : 'Avslutt spill'}</span>
            </button>
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
          <div className="stack-md">
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
                      <button
                        type="button"
                        className="device-chip-remove"
                        aria-label={`Fjern Mobil ${index + 1}`}
                        title={`Fjern Mobil ${index + 1}`}
                        onClick={() => handleRemovePlayer(player.uid)}
                        disabled={actionBusy !== null}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="stack-sm">
                <button
                  type="button"
                  className="btn btn--primary btn--lg btn--full"
                  onClick={handleStartOrNextRound}
                  disabled={
                    players.length < 2 || selectedRoundIds.length === 0 || actionBusy !== null
                  }
                >
                  <Play size={22} aria-hidden="true" />
                  <span>
                    {actionBusy === 'start'
                      ? 'Deler ut kort…'
                      : selectedRoundIds.length === 0
                        ? 'Velg minst 1 spørsmål'
                        : room.roundNumber > 0
                          ? `Start runde ${room.roundNumber + 1}: ${getRoundByNumber(room.roundNumber + 1, selectedRoundIds).title}`
                          : `Start runde 1: ${getRoundByNumber(1, selectedRoundIds).title}`}
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
                <button
                  type="button"
                  className="btn btn--secondary btn--full"
                  onClick={handleStartFreshRoom}
                  disabled={actionBusy !== null}
                >
                  <LogOut size={16} aria-hidden="true" />
                  <span>
                    {actionBusy === 'fresh-room'
                      ? 'Oppretter nytt rom…'
                      : 'Start helt nytt spillrom (ny QR-kode)'}
                  </span>
                </button>
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

          <section className="surface stack-md" aria-label="Velg spørsmål til spillet">
            <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div className="stack-xs" style={{ gap: '2px' }}>
                <h2 style={{ fontSize: '1.25rem' }}>Velg spørsmål som skal være med</h2>
                <span className="tabular" style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                  {selectedRoundIds.length} av {MOCK_ROUNDS.length} spørsmål valgt
                </span>
              </div>
              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleSelectAllRounds}
                  disabled={selectedRoundIds.length === MOCK_ROUNDS.length}
                >
                  Velg alle
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleClearAllRounds}
                  disabled={selectedRoundIds.length === 0}
                >
                  Fjern alle
                </button>
              </div>
            </div>

            <div className="round-picker-grid">
              {MOCK_ROUNDS.map((roundOption, idx) => {
                const isSelected = selectedRoundIds.includes(roundOption.id);
                return (
                  <label
                    key={roundOption.id}
                    className={`round-picker-item ${
                      isSelected ? 'round-picker-item--selected' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="round-picker-checkbox"
                      checked={isSelected}
                      onChange={() => toggleRoundSelection(roundOption.id)}
                    />
                    <span className="round-picker-meta">
                      <span className="round-picker-title">
                        {idx + 1}. {roundOption.title}
                      </span>
                      <span className="round-picker-sub">{roundOption.directionLabel}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
          </div>
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
