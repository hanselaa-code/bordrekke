import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  LogOut,
  Play,
  RotateCcw,
  SkipForward,
  Smartphone,
  Trophy,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { MOCK_ROUNDS, ROUND_CATEGORIES, getRoundByNumber } from '../data/mockRounds';
import { ensureAnonymousUser } from '../firebase/auth';
import { isFirebaseConfigured } from '../firebase/config';
import { ensureP2PHostRoom } from '../engine/p2pBackend';
import {
  closeRoom,
  configureRoomMode,
  createRoom,
  removePlayerFromRoom,
  resetAllLocks,
  resetGame,
  returnToLobby,
  revealAnswers,
  startRound,
} from '../engine/roomService';
import { buildDefaultTeams, computeUpdatedTeamScores } from '../engine/teams';
import type { GameMode, RoundCategory, TeamConfig } from '../types/game';
import { useRoom } from '../hooks/useRoom';
import { useWakeLock } from '../hooks/useWakeLock';
import { WakeLockBadge } from '../components/WakeLockBadge';

export function HostView() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const normalizedRoomId = roomId?.trim().toUpperCase();
  const dedupInFlightRef = useRef<Set<string>>(new Set());

  const { room, players, evaluation, teamEvaluations, loading, error } = useRoom(normalizedRoomId);
  const wakeLock = useWakeLock(true);

  const [hostUid, setHostUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const [expandedCategories, setExpandedCategories] = useState<RoundCategory[]>([]);

  function toggleCategoryExpanded(category: RoundCategory) {
    setExpandedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  }

  function toggleCategorySelection(category: RoundCategory) {
    const categoryIds = MOCK_ROUNDS.filter((r) => r.category === category).map((r) => r.id);
    if (categoryIds.length === 0) return;
    setSelectedRoundIds((prev) => {
      const allSelected = categoryIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !categoryIds.includes(id));
      }
      const next = new Set(prev);
      for (const id of categoryIds) {
        next.add(id);
      }
      return Array.from(next);
    });
  }

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

  function getTeamJoinUrl(teamId: string): string {
    if (!joinUrl) return '';
    return `${joinUrl}?team=${encodeURIComponent(teamId)}`;
  }

  async function handleCopyLink(targetUrl = joinUrl, key = 'main') {
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setActionError('Kunne ikke kopiere lenken automatisk. Del romkoden manuelt.');
    }
  }

  async function handleSelectGameMode(nextMode: GameMode) {
    if (!room) return;
    const nextTeams: TeamConfig[] =
      nextMode === 'coop'
        ? []
        : room.teams.length >= 2
          ? room.teams
          : buildDefaultTeams(nextMode === 'teams-simultaneous' ? 3 : 2);
    await runAction('mode', () => configureRoomMode(room.id, nextMode, nextTeams, 0));
  }

  async function handleSetTeamCount(count: number) {
    if (!room || room.gameMode === 'coop') return;
    const nextTeams = buildDefaultTeams(count, room.teams);
    await runAction('team-count', () =>
      configureRoomMode(room.id, room.gameMode, nextTeams, 0)
    );
  }

  async function handleRenameTeam(teamId: string, nextName: string) {
    if (!room) return;
    const trimmed = nextName.trim();
    const nextTeams = room.teams.map((t, idx) =>
      t.id === teamId ? { ...t, name: trimmed || `Lag ${idx + 1}` } : t
    );
    await configureRoomMode(room.id, room.gameMode, nextTeams, room.activeTeamIndex);
  }

  async function handleSetActiveTeam(index: number) {
    if (!room || room.teams.length === 0) return;
    await runAction('active-team', () =>
      configureRoomMode(room.id, room.gameMode, room.teams, index)
    );
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
      startRound(room.id, uid, room.roundNumber, players, selectedRoundIds, {
        gameMode: room.gameMode,
        teams: room.teams,
        activeTeamIndex: room.activeTeamIndex,
      })
    );
  }

  async function handleResetLocks() {
    if (!room) return;
    await runAction('reset', () => resetAllLocks(room.id, players));
  }

  async function handleReveal() {
    if (!room) return;
    await runAction('reveal', () => revealAnswers(room.id, room, players));
  }

  async function handleReturnToLobby() {
    if (!room) return;
    await runAction('lobby', () => returnToLobby(room.id, players));
  }

  async function handleResetGame() {
    if (!room) return;
    await runAction('reset-game', () => resetGame(room.id, players, room.teams));
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

  const isTeamMode = room !== null && room.gameMode !== 'coop' && room.teams.length > 0;
  const isSimultaneousTeams = room?.gameMode === 'teams-simultaneous';
  const isTurnTeams = room?.gameMode === 'teams-turn';

  const activeTurnTeam =
    isTurnTeams && room && room.teams.length > 0
      ? room.teams[room.activeTeamIndex % room.teams.length]
      : null;

  const nextTurnTeam =
    isTurnTeams && room && room.teams.length > 0
      ? room.teams[
          (room.roundNumber === 0 ? room.activeTeamIndex : room.activeTeamIndex + 1) %
            room.teams.length
        ]
      : null;

  const canStartRound = useMemo(() => {
    if (!room || selectedRoundIds.length === 0) return false;
    if (room.gameMode === 'teams-simultaneous') {
      return room.teams.some(
        (team) => players.filter((p) => p.teamId === team.id).length >= 2
      );
    }
    return players.length >= 2;
  }, [room, players, selectedRoundIds.length]);

  const sortedLeaderboard = useMemo(() => {
    if (!room || room.teams.length === 0) return [];
    return [...room.teams].sort((a, b) => b.score - a.score);
  }, [room]);

  const roundPointsByTeamId = useMemo(() => {
    if (!room || room.gameMode === 'coop' || room.teams.length === 0) {
      return {} as Record<string, number>;
    }
    return computeUpdatedTeamScores(room, players).roundPointsByTeamId;
  }, [room, players]);

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
            <section className="surface stack-md" aria-label="Spillmodus og lagoppsett">
              <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <div className="stack-xs" style={{ gap: '2px' }}>
                  <h2 style={{ fontSize: '1.125rem' }}>Spillmodus</h2>
                  <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                    Velg samarbeid eller teambuilding med lag og poengtavle (1 poeng per grønt kort)
                  </span>
                </div>
              </div>

              <div className="mode-grid">
                <button
                  type="button"
                  className={`mode-card ${room.gameMode === 'coop' ? 'mode-card--active' : ''}`}
                  onClick={() => handleSelectGameMode('coop')}
                  disabled={actionBusy !== null}
                >
                  <strong>Samarbeid (1 bord)</strong>
                  <span>Alle rundt bordet spiller sammen som ett lag</span>
                </button>
                <button
                  type="button"
                  className={`mode-card ${room.gameMode === 'teams-simultaneous' ? 'mode-card--active' : ''}`}
                  onClick={() => handleSelectGameMode('teams-simultaneous')}
                  disabled={actionBusy !== null}
                >
                  <strong>Lag – samtidig</strong>
                  <span>Stor gruppe · egen QR-kode per lag · samme spørsmål samtidig</span>
                </button>
                <button
                  type="button"
                  className={`mode-card ${room.gameMode === 'teams-turn' ? 'mode-card--active' : ''}`}
                  onClick={() => handleSelectGameMode('teams-turn')}
                  disabled={actionBusy !== null}
                >
                  <strong>Lag – på tur</strong>
                  <span>Liten gruppe · bruker alle telefonene · lagene rullerer på tur</span>
                </button>
              </div>

              {isTeamMode && (
                <div className="stack-sm">
                  <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                      Antall lag ({room.teams.length})
                    </span>
                    <div className="row" style={{ gap: '6px' }}>
                      {[2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`btn ${room.teams.length === n ? 'btn--primary' : 'btn--secondary'}`}
                          style={{ minHeight: '36px', minWidth: '40px', padding: '4px 10px' }}
                          onClick={() => handleSetTeamCount(n)}
                          disabled={actionBusy !== null}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="team-config-grid">
                    {room.teams.map((team, idx) => (
                      <div
                        key={team.id}
                        className="team-config-chip"
                        style={{ borderLeft: `5px solid ${team.color}` }}
                      >
                        <input
                          type="text"
                          className="team-name-input"
                          defaultValue={team.name}
                          aria-label={`Navn på ${team.name}`}
                          maxLength={28}
                          onBlur={(e) => {
                            if (e.target.value.trim() !== team.name) {
                              void handleRenameTeam(team.id, e.target.value);
                            }
                          }}
                        />
                        <span className="badge badge--dark tabular">{team.score} p</span>
                        {isTurnTeams && (
                          <button
                            type="button"
                            className={`btn ${
                              room.activeTeamIndex % room.teams.length === idx
                                ? 'btn--primary'
                                : 'btn--secondary'
                            }`}
                            style={{ minHeight: '30px', padding: '2px 8px', fontSize: '0.75rem' }}
                            onClick={() => handleSetActiveTeam(idx)}
                            disabled={actionBusy !== null}
                          >
                            {room.activeTeamIndex % room.teams.length === idx
                              ? 'Har turen'
                              : 'Gi tur'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {isSimultaneousTeams ? (
              <section className="stack-md" aria-label="QR-koder per lag">
                <div className="team-qr-grid">
                  {room.teams.map((team) => {
                    const teamPlayers = players.filter((p) => p.teamId === team.id);
                    const teamUrl = getTeamJoinUrl(team.id);
                    return (
                      <div
                        key={team.id}
                        className="surface team-qr-card"
                        style={{ borderTop: `6px solid ${team.color}` }}
                      >
                        <div className="row-between" style={{ width: '100%' }}>
                          <span
                            className="team-pill"
                            style={{ backgroundColor: team.color, color: '#ffffff' }}
                          >
                            {team.name}
                          </span>
                          <span className="badge badge--dark tabular">
                            {teamPlayers.length} {teamPlayers.length === 1 ? 'mobil' : 'mobiler'}
                          </span>
                        </div>

                        <div className="qr-frame" style={{ padding: '12px' }}>
                          <QRCodeSVG
                            value={teamUrl}
                            size={176}
                            level="M"
                            bgColor="#FFFFFF"
                            fgColor="#18181B"
                          />
                        </div>

                        <button
                          type="button"
                          className="btn btn--secondary btn--full"
                          style={{ minHeight: '38px', fontSize: '0.875rem' }}
                          onClick={() => handleCopyLink(teamUrl, team.id)}
                        >
                          {copiedKey === team.id ? (
                            <>
                              <Check size={16} color="var(--correct)" aria-hidden="true" />
                              <span>Lenke kopiert!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={16} aria-hidden="true" />
                              <span>Kopier laglenke</span>
                            </>
                          )}
                        </button>

                        {teamPlayers.length > 0 && (
                          <div className="device-grid" style={{ width: '100%' }}>
                            {teamPlayers.map((player, index) => (
                              <div key={player.uid} className="device-chip">
                                <span
                                  className="device-chip-dot"
                                  style={{ background: team.color }}
                                  aria-hidden="true"
                                />
                                <span className="tabular">Mobil {index + 1}</span>
                                <button
                                  type="button"
                                  className="device-chip-remove"
                                  aria-label={`Fjern Mobil ${index + 1} fra ${team.name}`}
                                  onClick={() => handleRemovePlayer(player.uid)}
                                  disabled={actionBusy !== null}
                                >
                                  <X size={13} aria-hidden="true" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="surface stack-sm">
                  <button
                    type="button"
                    className="btn btn--primary btn--lg btn--full"
                    onClick={handleStartOrNextRound}
                    disabled={!canStartRound || actionBusy !== null}
                  >
                    <Play size={22} aria-hidden="true" />
                    <span>
                      {actionBusy === 'start'
                        ? 'Deler ut kort til alle lag…'
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
                      <span>Nullstill spill og poeng (start fra runde 1)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--secondary btn--full"
                    onClick={handleStartFreshRoom}
                    disabled={actionBusy !== null}
                  >
                    <LogOut size={16} aria-hidden="true" />
                    <span>Start helt nytt spillrom (ny QR-kode)</span>
                  </button>
                  {!canStartRound && selectedRoundIds.length > 0 && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--ink-muted)', textAlign: 'center' }}>
                      Minst ett lag må ha 2 eller flere tilkoblede mobiler for å starte.
                    </p>
                  )}
                </div>
              </section>
            ) : (
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
                onClick={() => handleCopyLink(joinUrl, 'main')}
              >
                {copiedKey === 'main' ? (
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
                  disabled={!canStartRound || actionBusy !== null}
                >
                  <Play size={22} aria-hidden="true" />
                  <span>
                    {actionBusy === 'start'
                      ? 'Deler ut kort…'
                      : selectedRoundIds.length === 0
                        ? 'Velg minst 1 spørsmål'
                        : isTurnTeams && nextTurnTeam
                          ? `Start runde ${room.roundNumber + 1} (${nextTurnTeam.name}): ${getRoundByNumber(room.roundNumber + 1, selectedRoundIds).title}`
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
            )}

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

            <div className="category-list">
              {ROUND_CATEGORIES.map((category) => {
                const categoryRounds = MOCK_ROUNDS.filter((r) => r.category === category);
                const selectedInCat = categoryRounds.filter((r) =>
                  selectedRoundIds.includes(r.id)
                ).length;
                const allInCatSelected =
                  categoryRounds.length > 0 && selectedInCat === categoryRounds.length;
                const isExpanded = expandedCategories.includes(category);

                return (
                  <div key={category} className="category-card">
                    <div className="category-header">
                      <button
                        type="button"
                        className="category-toggle-btn"
                        aria-expanded={isExpanded}
                        onClick={() => toggleCategoryExpanded(category)}
                      >
                        {isExpanded ? (
                          <ChevronDown size={18} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={18} aria-hidden="true" />
                        )}
                        <span className="category-name">{category}</span>
                        <span className="badge tabular" style={{ fontSize: '0.75rem' }}>
                          {selectedInCat}/{categoryRounds.length}
                        </span>
                      </button>

                      <label className="category-all-label">
                        <input
                          type="checkbox"
                          className="round-picker-checkbox"
                          checked={allInCatSelected}
                          disabled={categoryRounds.length === 0}
                          onChange={() => toggleCategorySelection(category)}
                        />
                        <span>Alle</span>
                      </label>
                    </div>

                    {isExpanded && (
                      <div className="category-questions">
                        {categoryRounds.length === 0 ? (
                          <p className="category-empty">
                            Ingen spørsmål i denne kategorien ennå.
                          </p>
                        ) : (
                          categoryRounds.map((roundOption) => {
                            const isSelected = selectedRoundIds.includes(roundOption.id);
                            return (
                              <label
                                key={roundOption.id}
                                className={`category-question-row ${
                                  isSelected ? 'category-question-row--selected' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="round-picker-checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleRoundSelection(roundOption.id)}
                                />
                                <span className="category-question-title">
                                  {roundOption.title}
                                </span>
                                <span className="category-question-dir">
                                  {roundOption.directionLabel}
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          </div>
        )}

        {!loading && room && room.status === 'playing' && (
          <section className="stack-md" aria-label="Aktiv runde">
            <div className="surface stack-md">
              <div className="row-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
                <div className="row" style={{ gap: '8px' }}>
                  <span className="badge badge--accent tabular">
                    Runde {room.roundNumber}
                  </span>
                  {activeTurnTeam && (
                    <span
                      className="team-pill"
                      style={{ backgroundColor: activeTurnTeam.color, color: '#ffffff' }}
                    >
                      {activeTurnTeam.name} sin tur!
                    </span>
                  )}
                  {isSimultaneousTeams && (
                    <span className="badge">Alle lag spiller samtidig</span>
                  )}
                </div>
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

            {isSimultaneousTeams ? (
              <div className="team-qr-grid">
                {room.teams.map((team) => {
                  const teamEval = teamEvaluations[team.id];
                  const teamCards = (teamEval?.rankedPlayers ?? []).filter(
                    (e) => e.player.card !== null
                  );
                  return (
                    <div
                      key={team.id}
                      className="surface stack-sm"
                      style={{ borderTop: `5px solid ${team.color}` }}
                    >
                      <div className="row-between">
                        <span
                          className="team-pill"
                          style={{ backgroundColor: team.color, color: '#ffffff' }}
                        >
                          {team.name}
                        </span>
                        <span
                          className={`badge tabular ${
                            teamEval?.allLocked ? 'badge--success' : 'badge--dark'
                          }`}
                        >
                          {teamEval?.lockedCount ?? 0}/{teamEval?.totalPlayers ?? 0} låst
                        </span>
                      </div>

                      {teamCards.length === 0 ? (
                        <p style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                          Ingen aktive kort på dette laget i denne runden.
                        </p>
                      ) : (
                        <div className="slot-list">
                          {teamCards.map((entry, idx) => {
                            const isLocked = entry.lockedRank !== null;
                            const card = entry.player.card;
                            return (
                              <div
                                key={entry.player.uid}
                                className={`slot-row ${isLocked ? 'slot-row--locked' : ''}`}
                              >
                                <div className="slot-main">
                                  <span
                                    className={`slot-rank tabular ${
                                      isLocked ? 'slot-rank--locked' : ''
                                    }`}
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
                                  <strong style={{ fontSize: '1rem' }}>
                                    {card?.label ?? `Spiller ${idx + 1}`}
                                  </strong>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
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
            )}
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
                {isSimultaneousTeams
                  ? 'Fasit avslørt for alle lag!'
                  : isTurnTeams && activeTurnTeam
                    ? `${activeTurnTeam.name} fikk +${evaluation.correctCount} poeng!`
                    : `${evaluation.correctCount} av ${evaluation.totalPlayers} riktig plassert!`}
              </h1>
              <p style={{ opacity: 0.9 }}>
                {room.activeRoundTitle} ({room.activeRoundDirection ?? 'Lavest → Høyest'})
              </p>
            </div>

            {isTeamMode && sortedLeaderboard.length > 0 && (
              <section className="surface stack-md" aria-label="Poengtavle">
                <div className="row-between">
                  <div className="row" style={{ gap: '8px' }}>
                    <Trophy size={20} color="var(--accent)" aria-hidden="true" />
                    <h2 style={{ fontSize: '1.25rem' }}>Poengtavle</h2>
                  </div>
                  <span className="badge">1 poeng per riktig kort</span>
                </div>
                <div className="scoreboard-list">
                  {sortedLeaderboard.map((team, rankIdx) => {
                    const earned = roundPointsByTeamId[team.id] ?? 0;
                    return (
                      <div
                        key={team.id}
                        className="scoreboard-row"
                        style={{ borderLeft: `6px solid ${team.color}` }}
                      >
                        <div className="row" style={{ gap: '12px' }}>
                          <span className="slot-rank slot-rank--locked tabular">
                            #{rankIdx + 1}
                          </span>
                          <strong style={{ fontSize: '1.125rem' }}>{team.name}</strong>
                        </div>
                        <div className="row" style={{ gap: '10px' }}>
                          {earned > 0 && (
                            <span className="badge badge--success tabular">+{earned} p</span>
                          )}
                          <span className="badge badge--dark tabular" style={{ fontSize: '1rem' }}>
                            {team.score} poeng
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="row">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                style={{ flex: '1 1 240px' }}
                onClick={handleStartOrNextRound}
                disabled={!canStartRound || actionBusy !== null}
              >
                <SkipForward size={20} aria-hidden="true" />
                <span>
                  {actionBusy === 'start'
                    ? 'Starter neste…'
                    : isTurnTeams && nextTurnTeam
                      ? `Neste runde (${nextTurnTeam.name} sin tur)`
                      : 'Neste runde'}
                </span>
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
