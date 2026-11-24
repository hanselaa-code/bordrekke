import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  LogOut,
  Play,
  QrCode,
  RotateCcw,
  Settings2,
  SkipForward,
  Smartphone,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { MOCK_ROUNDS, ROUND_CATEGORIES, getRoundByNumber } from '../data/mockRounds';
import { ensureAnonymousUser } from '../firebase/auth';
import { isFirebaseConfigured } from '../firebase/config';
import { ensureP2PHostRoom } from '../engine/p2pBackend';
import {
  closeRoom,
  configureRoomMode,
  createRoom,
  reassignPlayerCard,
  removePlayerFromRoom,
  resetAllLocks,
  resetGame,
  returnToLobby,
  revealAnswers,
  startRound,
} from '../engine/roomService';
import { buildDefaultTeams, computeUpdatedTeamScores } from '../engine/teams';
import type { AssignedCard, GameMode, PlayerDoc, RoundCategory, TeamConfig } from '../types/game';
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
  const [lobbyPhase, setLobbyPhase] = useState<'setup' | 'qr-lobby' | 'ready'>('setup');
  const [revealStage, setRevealStage] = useState<'fasit' | 'leaderboard'>('fasit');
  const [revealProgress, setRevealProgress] = useState<{ key: string; count: number } | null>(null);
  const [showFinalSummary, setShowFinalSummary] = useState(false);
  const [showReconnectModal, setShowReconnectModal] = useState(false);

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
    if (room.roundNumber >= totalSelectedRounds) {
      setShowFinalSummary(true);
      return;
    }
    setRevealStage('fasit');
    setShowFinalSummary(false);
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
    setRevealStage('fasit');
    setShowFinalSummary(false);
    await runAction('reveal', () => revealAnswers(room.id, room, players));
  }

  async function handleReturnToLobby(nextLobbyPhase: 'setup' | 'ready' = 'ready') {
    if (!room) return;
    setRevealStage('fasit');
    setShowFinalSummary(false);
    setLobbyPhase(nextLobbyPhase);
    await runAction('lobby', () => returnToLobby(room.id, players));
  }

  async function handleResetGame() {
    if (!room) return;
    setRevealStage('fasit');
    setShowFinalSummary(false);
    setLobbyPhase(players.length > 0 ? 'ready' : 'setup');
    await runAction('reset-game', () => resetGame(room.id, players, room.teams));
  }

  async function handleRemovePlayer(targetUid: string) {
    if (!room) return;
    await runAction(`remove-${targetUid}`, () => removePlayerFromRoom(room.id, targetUid));
  }

  async function handleReassignCard(fromPlayer: PlayerDoc, toPlayer: PlayerDoc) {
    if (!room) return;
    await runAction(`reassign-${fromPlayer.uid}-${toPlayer.uid}`, () =>
      reassignPlayerCard(room.id, fromPlayer, toPlayer.uid, toPlayer.teamId)
    );
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
      setLobbyPhase('setup');
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

  // Automatisk avduplisering og sømløs gjenoppkobling per telefon (deviceId):
  // Hvis samme telefon kobler på med ny økt midt i runden, overføres kortet automatisk til den nye økten.
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
      // Behold den nyeste økten (den som faktisk er åpen på telefonen nå).
      // Merk: En helt ny tilkobling kan ha joinedAt === null mens serverTimestamp() ventes,
      // derfor behandles null som NYEST (MAX_SAFE_INTEGER) slik at den aldri slettes ved feil!
      const sorted = [...group].sort((a, b) => {
        const aTime = a.joinedAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
        const bTime = b.joinedAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
        return bTime - aTime;
      });
      const newest = sorted[0];
      const duplicates = sorted.slice(1);
      const olderWithCard = newest.card === null ? duplicates.find((d) => d.card !== null) : undefined;

      for (const dup of duplicates) {
        if (dedupInFlightRef.current.has(dup.uid)) continue;
        dedupInFlightRef.current.add(dup.uid);

        const op =
          olderWithCard && dup.uid === olderWithCard.uid
            ? reassignPlayerCard(room.id, dup, newest.uid, newest.teamId)
            : removePlayerFromRoom(room.id, dup.uid);

        void op
          .catch((err) => console.error('Kunne ikke rydde/overføre duplikat enhet:', err))
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

  const totalSelectedRounds =
    selectedRoundIds.length > 0 ? selectedRoundIds.length : MOCK_ROUNDS.length;
  const isLastRound = room !== null && room.roundNumber >= totalSelectedRounds;

  // Unike kort i spill denne runden, sortert fra #1 til #N (riktig fasit-rekkefølge)
  const hostFasitCards = useMemo(() => {
    const seen = new Set<string>();
    const uniqueCards: AssignedCard[] = [];
    for (const entry of evaluation.correctOrder) {
      const card = entry.player.card;
      if (!card || seen.has(card.id)) continue;
      seen.add(card.id);
      uniqueCards.push(card);
    }
    uniqueCards.sort((a, b) => a.answerValue - b.answerValue);
    return uniqueCards;
  }, [evaluation.correctOrder]);

  const currentRevealKey =
    room && room.status === 'revealed' ? `${room.id}:${room.roundNumber}` : null;

  const revealedCount =
    currentRevealKey && revealProgress?.key === currentRevealKey
      ? revealProgress.count
      : 1;

  const isFasitFullyRevealed =
    hostFasitCards.length === 0 || revealedCount >= hostFasitCards.length;

  // Sekvensiell avsløring på storskjermen (1 sekund per svar, synkronisert med mobilene)
  useEffect(() => {
    if (!currentRevealKey) {
      return;
    }

    const total = hostFasitCards.length;
    if (total <= 1) {
      return;
    }

    let step = 1;
    const intervalId = window.setInterval(() => {
      step += 1;
      setRevealProgress({ key: currentRevealKey, count: Math.min(step, total) });
      if (step >= total) {
        window.clearInterval(intervalId);
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentRevealKey, hostFasitCards.length]);

  const waitingPlayersWithoutCard = useMemo(() => {
    if (!room || room.status !== 'playing') return [];
    return players.filter((p) => p.card === null);
  }, [room, players]);

  const unassignedTeamPlayers = useMemo(() => {
    if (!room || room.gameMode !== 'teams-simultaneous') return [];
    const validTeamIds = new Set(room.teams.map((t) => t.id));
    return players.filter((p) => !p.teamId || !validTeamIds.has(p.teamId));
  }, [room, players]);

  const winnerTeams = useMemo(() => {
    if (sortedLeaderboard.length === 0) return [];
    const topScore = sortedLeaderboard[0].score;
    return sortedLeaderboard.filter((t) => t.score === topScore);
  }, [sortedLeaderboard]);

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
            {room && room.status !== 'lobby' && (
              <button
                type="button"
                className={`btn ${waitingPlayersWithoutCard.length > 0 ? 'btn--primary' : 'btn--secondary'}`}
                style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.875rem' }}
                onClick={() => setShowReconnectModal(true)}
              >
                <QrCode size={15} aria-hidden="true" />
                <span>
                  Koble til spiller
                  {waitingPlayersWithoutCard.length > 0
                    ? ` (${waitingPlayersWithoutCard.length} venter)`
                    : ''}
                </span>
              </button>
            )}
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
            {lobbyPhase === 'setup' && (
              <>
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
              </>
            )}

            {lobbyPhase === 'qr-lobby' && (
              <div className="stack-md">
                <div className="surface row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                  <div className="stack-xs" style={{ gap: '2px' }}>
                    <span className="badge badge--accent">Spill-lobby</span>
                    <h1 style={{ fontSize: '1.5rem' }}>
                      {isSimultaneousTeams
                        ? 'Skann QR-koden til ditt lag'
                        : 'Skann QR-koden for å bli med'}
                    </h1>
                  </div>
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setLobbyPhase('setup')}
                    >
                      <ArrowLeft size={16} aria-hidden="true" />
                      <span>Endre oppsett</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => setLobbyPhase('ready')}
                      disabled={!canStartRound || actionBusy !== null}
                    >
                      <Play size={18} aria-hidden="true" />
                      <span>Start spillet</span>
                    </button>
                  </div>
                </div>

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
                        style={{ borderTop: `8px solid ${team.color}` }}
                      >
                        <div className="row-between" style={{ width: '100%' }}>
                          <h2 className="team-qr-name" style={{ color: team.color }}>
                            {team.name}
                          </h2>
                          <span className="badge badge--dark tabular">
                            {teamPlayers.length} {teamPlayers.length === 1 ? 'mobil' : 'mobiler'}
                          </span>
                        </div>

                        <div className="qr-frame" style={{ padding: '14px' }}>
                          <QRCodeSVG
                            value={teamUrl}
                            size={220}
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
                  {unassignedTeamPlayers.length > 0 && (
                    <div className="alert" role="status">
                      <span>
                        <strong>
                          {unassignedTeamPlayers.length}{' '}
                          {unassignedTeamPlayers.length === 1 ? 'mobil' : 'mobiler'}
                        </strong>{' '}
                        har ikke valgt lag ennå — de kan trykke på riktig lag direkte på sin egen
                        mobil før du starter!
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn--primary btn--lg btn--full"
                    onClick={() => setLobbyPhase('ready')}
                    disabled={!canStartRound || actionBusy !== null}
                  >
                    <Play size={22} aria-hidden="true" />
                    <span>Start spillet</span>
                  </button>
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
                      Minst ett lag må ha 2 eller flere tilkoblede mobiler for å starte spillet.
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
                  onClick={() => setLobbyPhase('ready')}
                  disabled={!canStartRound || actionBusy !== null}
                >
                  <Play size={22} aria-hidden="true" />
                  <span>Start spillet</span>
                </button>
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
                    Trenger minst 2 tilkoblede spillere for å starte spillet.
                  </p>
                )}
              </div>
            </div>
          </section>
            )}
              </div>
            )}

            {lobbyPhase === 'setup' && (
              <>
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

                <div className="surface stack-sm">
                  <button
                    type="button"
                    className="btn btn--primary btn--lg btn--full"
                    onClick={() => setLobbyPhase('qr-lobby')}
                    disabled={selectedRoundIds.length === 0 || actionBusy !== null}
                  >
                    <QrCode size={22} aria-hidden="true" />
                    <span>
                      {selectedRoundIds.length === 0
                        ? 'Velg minst 1 spørsmål først'
                        : 'Klargjør spill-lobby'}
                    </span>
                  </button>
                  <p style={{ fontSize: '0.875rem', color: 'var(--ink-muted)', textAlign: 'center' }}>
                    Viser store QR-koder på storskjermen slik at deltakerne kan koble seg til
                    {isSimultaneousTeams ? ' riktig lag' : ' rommet'}.
                  </p>
                </div>
              </>
            )}

            {lobbyPhase === 'ready' && (
              <section className="surface stack-lg" aria-label="Klar til å starte runde">
                <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                  <div className="stack-xs" style={{ gap: '4px' }}>
                    <span className="badge badge--success">Klar til spill</span>
                    <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.35rem)' }}>
                      {isTeamMode ? 'Lagene er klare!' : 'Alle er klare!'}
                    </h1>
                  </div>
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setLobbyPhase('qr-lobby')}
                    >
                      <QrCode size={16} aria-hidden="true" />
                      <span>Vis QR-koder</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setLobbyPhase('setup')}
                    >
                      <Settings2 size={16} aria-hidden="true" />
                      <span>Oppsett</span>
                    </button>
                  </div>
                </div>

                {isTeamMode ? (
                  <div className="ready-teams-grid">
                    {sortedLeaderboard.map((team, rankIdx) => {
                      const teamPlayerCount = isSimultaneousTeams
                        ? players.filter((p) => p.teamId === team.id).length
                        : players.length;
                      const isUpNext = isTurnTeams && nextTurnTeam?.id === team.id;
                      return (
                        <div
                          key={team.id}
                          className="ready-team-card"
                          style={{ borderTop: `6px solid ${team.color}` }}
                        >
                          <div className="row-between" style={{ width: '100%' }}>
                            <span className="badge tabular">#{rankIdx + 1}</span>
                            {isUpNext && (
                              <span
                                className="team-pill"
                                style={{ backgroundColor: team.color, color: '#ffffff' }}
                              >
                                Neste tur
                              </span>
                            )}
                          </div>
                          <h2 className="ready-team-name" style={{ color: team.color }}>
                            {team.name}
                          </h2>
                          <div className="row-between" style={{ width: '100%' }}>
                            <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                              {isSimultaneousTeams
                                ? `${teamPlayerCount} ${teamPlayerCount === 1 ? 'spiller' : 'spillere'}`
                                : 'Felles bord'}
                            </span>
                            <strong className="tabular" style={{ fontSize: '1.25rem' }}>
                              {team.score} p
                            </strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="surface--subtle row-between">
                    <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>
                      Tilkoblede spillere
                    </span>
                    <span className="badge badge--dark tabular" style={{ fontSize: '1rem' }}>
                      {players.length} mobiler klare
                    </span>
                  </div>
                )}

                <div className="stack-sm">
                  {isLastRound ? (
                    <>
                      <div className="surface--subtle stack-xs" style={{ textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.125rem' }}>
                          Alle {totalSelectedRounds} valgte spørsmål er spilt!
                        </strong>
                        <p style={{ fontSize: '0.9375rem', color: 'var(--ink-secondary)' }}>
                          Nullstill spillet for å starte på nytt, eller velg nye spørsmål i oppsettet.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn--primary btn--lg btn--full"
                        onClick={handleResetGame}
                        disabled={actionBusy !== null}
                      >
                        <RotateCcw size={20} aria-hidden="true" />
                        <span>Start nytt spill (Runde 1)</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--full"
                        onClick={() => setLobbyPhase('setup')}
                        disabled={actionBusy !== null}
                      >
                        <Settings2 size={18} aria-hidden="true" />
                        <span>Velg nye spørsmål i oppsett</span>
                      </button>
                    </>
                  ) : (
                    <>
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
                            : isTurnTeams && nextTurnTeam
                              ? `Start runde ${room.roundNumber + 1} av ${totalSelectedRounds} (${nextTurnTeam.name})`
                              : `Start runde ${room.roundNumber + 1} av ${totalSelectedRounds}`}
                        </span>
                      </button>
                      <p style={{ fontSize: '0.9375rem', color: 'var(--ink-secondary)', textAlign: 'center' }}>
                        Neste spørsmål:{' '}
                        <strong>
                          {getRoundByNumber(room.roundNumber + 1, selectedRoundIds).title}
                        </strong>{' '}
                        ({getRoundByNumber(room.roundNumber + 1, selectedRoundIds).directionLabel})
                      </p>
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
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        {!loading && room && room.status === 'playing' && (
          <section className="stack-md" aria-label="Aktiv runde">
            <div className="surface stack-md">
              <div className="row-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
                <div className="row" style={{ gap: '8px' }}>
                  <span className="badge badge--accent tabular">
                    Runde {room.roundNumber} av {totalSelectedRounds}
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
                  {room.activeRoundDirection ?? 'Lavest → Høyest'}). Kortene holdes skjult på
                  storskjermen frem til fasiten avsløres.
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

                {!isLastRound && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--lg"
                    onClick={handleStartOrNextRound}
                    disabled={players.length < 2 || actionBusy !== null}
                  >
                    <SkipForward size={18} aria-hidden="true" />
                    <span>{actionBusy === 'start' ? 'Starter…' : 'Hopp til neste'}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  onClick={() => handleReturnToLobby('ready')}
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
                                  <strong style={{ fontSize: '0.9375rem' }}>
                                    {isLocked
                                      ? `Plass ${entry.lockedRank} låst`
                                      : `Spiller ${idx + 1} tenker…`}
                                  </strong>
                                </div>
                                {isLocked ? (
                                  <CheckCircle2
                                    size={20}
                                    color="var(--correct)"
                                    aria-label="Låst"
                                  />
                                ) : (
                                  <span className="badge">Venter</span>
                                )}
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
                <h2 style={{ fontSize: '1.25rem' }}>Status på låsing</h2>
                <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                  Kort holdes skjult til fasiten avsløres
                </span>
              </div>

              <div className="slot-list">
                {playersWithCards.map((entry, idx) => {
                  const isLocked = entry.lockedRank !== null;
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
                        <div className="stack-xs" style={{ gap: '2px', minWidth: 0 }}>
                          <strong style={{ fontSize: '1.0625rem' }}>
                            {isLocked
                              ? `Plass ${entry.lockedRank} er låst`
                              : `Spiller ${idx + 1}`}
                          </strong>
                          <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                            {isLocked ? 'Klar til avsløring' : 'Ikke låst ennå'}
                          </span>
                        </div>
                      </div>

                      {isLocked ? (
                        <span className="badge badge--success">Plass {entry.lockedRank} ✓</span>
                      ) : (
                        <span className="badge">Venter</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </section>
        )}

        {!loading && room && room.status === 'revealed' && showFinalSummary && (
          <section className="stack-md" aria-label="Sluttresultat">
            <div className="score-banner score-banner--winner">
              <span
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  opacity: 0.9,
                }}
              >
                Sluttresultat · Alle {totalSelectedRounds} spørsmål fullført
              </span>
              <h1 style={{ color: '#ffffff', fontSize: 'clamp(2rem, 5vw, 3rem)' }}>
                {isTeamMode && winnerTeams.length > 0
                  ? winnerTeams.length === 1
                    ? `Vinner: ${winnerTeams[0].name}!`
                    : `Uavgjort: ${winnerTeams.map((t) => t.name).join(' & ')}!`
                  : 'Spillet er ferdig!'}
              </h1>
              {isTeamMode && winnerTeams.length > 0 && (
                <p style={{ fontSize: '1.25rem', fontWeight: 700, opacity: 0.95 }}>
                  {winnerTeams[0].score} poeng totalt
                </p>
              )}
            </div>

            {isTeamMode && sortedLeaderboard.length > 0 && (
              <section className="surface stack-md" aria-label="Endelig poengtavle">
                <div className="row-between">
                  <div className="row" style={{ gap: '8px' }}>
                    <Trophy size={22} color="var(--accent)" aria-hidden="true" />
                    <h2 style={{ fontSize: '1.375rem' }}>Endelig poengtavle</h2>
                  </div>
                  <span className="badge tabular">{totalSelectedRounds} runder spilt</span>
                </div>
                <div className="scoreboard-list">
                  {sortedLeaderboard.map((team, rankIdx) => (
                    <div
                      key={team.id}
                      className="scoreboard-row"
                      style={{ borderLeft: `6px solid ${team.color}` }}
                    >
                      <div className="row" style={{ gap: '12px' }}>
                        <span className="slot-rank slot-rank--locked tabular">
                          #{rankIdx + 1}
                        </span>
                        <strong style={{ fontSize: '1.25rem' }}>{team.name}</strong>
                      </div>
                      <span className="badge badge--dark tabular" style={{ fontSize: '1.125rem' }}>
                        {team.score} poeng
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="surface stack-sm">
              <button
                type="button"
                className="btn btn--primary btn--lg btn--full"
                onClick={handleResetGame}
                disabled={actionBusy !== null}
              >
                <RotateCcw size={20} aria-hidden="true" />
                <span>
                  {actionBusy === 'reset-game' ? 'Nullstiller…' : 'Start nytt spill (Runde 1)'}
                </span>
              </button>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  style={{ flex: '1 1 200px' }}
                  onClick={() => handleReturnToLobby('setup')}
                  disabled={actionBusy !== null}
                >
                  <Settings2 size={18} aria-hidden="true" />
                  <span>Tilbake til oppsett</span>
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  style={{ flex: '1 1 200px' }}
                  onClick={handleStartFreshRoom}
                  disabled={actionBusy !== null}
                >
                  <LogOut size={18} aria-hidden="true" />
                  <span>Nytt spillrom (ny QR-kode)</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {!loading && room && room.status === 'revealed' && !showFinalSummary && (
          <section className="stack-md" aria-label="Fasit og resultat">
            {revealStage === 'fasit' ? (
              <>
                <div className="score-banner">
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      opacity: 0.85,
                    }}
                  >
                    Fasit · Runde {room.roundNumber} av {totalSelectedRounds}
                  </span>
                  <h1 style={{ color: '#ffffff', fontSize: 'clamp(1.75rem, 5vw, 2.5rem)' }}>
                    {room.activeRoundTitle}
                  </h1>
                  <p style={{ opacity: 0.9 }}>
                    {room.activeRoundDirection ?? 'Lavest → Høyest'} · Avsløres ett og ett svar
                  </p>
                </div>

                <div className="surface stack-md">
                  <div className="row-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
                    <h2 style={{ fontSize: '1.25rem' }}>Riktig fasit-rekkefølge</h2>
                    <span className="badge badge--success tabular">
                      {Math.min(revealedCount, hostFasitCards.length)} av {hostFasitCards.length} avslørt
                    </span>
                  </div>

                  <div className="slot-list">
                    {hostFasitCards.map((card, idx) => {
                      const isCardRevealed = idx < revealedCount;
                      if (!isCardRevealed) {
                        return (
                          <div key={card.id} className="slot-row slot-row--pending">
                            <div className="slot-main">
                              <span className="slot-rank tabular">#{idx + 1}</span>
                              <div className="stack-xs" style={{ gap: '2px', minWidth: 0 }}>
                                <strong style={{ fontSize: '1.0625rem', color: 'var(--ink-muted)' }}>
                                  Avsløres snart…
                                </strong>
                              </div>
                            </div>
                            <span className="badge tabular">?</span>
                          </div>
                        );
                      }

                      return (
                        <div key={card.id} className="slot-row slot-row--reveal-pop">
                          <div className="slot-main">
                            <span className="slot-rank slot-rank--locked tabular">
                              #{idx + 1}
                            </span>
                            {card.imageUrl && (
                              <img
                                className="slot-thumb"
                                src={card.imageUrl}
                                alt={card.imageAlt ?? card.label}
                                draggable={false}
                              />
                            )}
                            <div className="stack-xs" style={{ gap: '2px', minWidth: 0 }}>
                              <strong style={{ fontSize: '1.125rem' }}>{card.label}</strong>
                              {card.subtitle && (
                                <span style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
                                  {card.subtitle}
                                </span>
                              )}
                            </div>
                          </div>

                          <span
                            className="badge badge--accent tabular"
                            style={{ fontSize: '1rem', padding: '6px 12px' }}
                          >
                            {card.answerDisplay}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {isTeamMode ? (
                  <div className="surface stack-sm">
                    <button
                      type="button"
                      className="btn btn--primary btn--lg btn--full"
                      onClick={() => setRevealStage('leaderboard')}
                    >
                      <Trophy size={22} aria-hidden="true" />
                      <span>
                        {isFasitFullyRevealed
                          ? 'Vis leaderboard'
                          : 'Vis leaderboard (hopp over nedtelling)'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="surface stack-md">
                    {isFasitFullyRevealed && (
                      <div className="row-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
                        <strong style={{ fontSize: '1.25rem' }}>
                          Resultat: {evaluation.correctCount} av {evaluation.totalPlayers} riktig
                          plassert!
                        </strong>
                        {evaluation.totalPlayers > 0 &&
                          evaluation.correctCount === evaluation.totalPlayers && (
                            <span className="badge badge--success">Full pott!</span>
                          )}
                      </div>
                    )}

                    <div className="row">
                      {isLastRound ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--lg"
                          style={{ flex: '1 1 240px' }}
                          onClick={() => setShowFinalSummary(true)}
                        >
                          <Trophy size={20} aria-hidden="true" />
                          <span>Se sluttresultat</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--primary btn--lg"
                          style={{ flex: '1 1 240px' }}
                          onClick={handleStartOrNextRound}
                          disabled={!canStartRound || actionBusy !== null}
                        >
                          <SkipForward size={20} aria-hidden="true" />
                          <span>
                            {actionBusy === 'start' ? 'Starter neste…' : 'Neste runde'}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn--secondary btn--lg"
                        onClick={() => handleReturnToLobby('ready')}
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
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="score-banner">
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      opacity: 0.85,
                    }}
                  >
                    Poengtavle · Runde {room.roundNumber} av {totalSelectedRounds}
                  </span>
                  <h1 style={{ color: '#ffffff', fontSize: 'clamp(1.75rem, 5vw, 2.5rem)' }}>
                    {isTurnTeams && activeTurnTeam
                      ? `${activeTurnTeam.name} fikk +${evaluation.correctCount} poeng!`
                      : 'Oppdatert leaderboard'}
                  </h1>
                  <p style={{ opacity: 0.9 }}>
                    {room.activeRoundTitle} ({room.activeRoundDirection ?? 'Lavest → Høyest'})
                  </p>
                </div>

                {sortedLeaderboard.length > 0 && (
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
                              <span
                                className="badge badge--dark tabular"
                                style={{ fontSize: '1rem' }}
                              >
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
                  {isLastRound ? (
                    <button
                      type="button"
                      className="btn btn--primary btn--lg"
                      style={{ flex: '1 1 240px' }}
                      onClick={() => setShowFinalSummary(true)}
                    >
                      <Trophy size={20} aria-hidden="true" />
                      <span>Se sluttresultat</span>
                    </button>
                  ) : (
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
                  )}

                  <button
                    type="button"
                    className="btn btn--secondary btn--lg"
                    onClick={() => setRevealStage('fasit')}
                  >
                    <Eye size={18} aria-hidden="true" />
                    <span>Vis fasit igjen</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn--secondary btn--lg"
                    onClick={() => handleReturnToLobby('ready')}
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
              </>
            )}
          </section>
        )}
        {showReconnectModal && room && (
          <div
            className="reconnect-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Koble til spiller på nytt"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowReconnectModal(false);
              }
            }}
          >
            <div className="reconnect-modal stack-md">
              <div className="row-between">
                <div className="stack-xs" style={{ gap: '2px' }}>
                  <span className="badge badge--accent">Spillmester · Gjenoppkobling</span>
                  <h2 style={{ fontSize: '1.375rem' }}>Koble til spiller under runden</h2>
                </div>
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ minHeight: '36px', padding: '6px 10px' }}
                  onClick={() => setShowReconnectModal(false)}
                  aria-label="Lukk vindu"
                >
                  <X size={18} aria-hidden="true" />
                  <span>Lukk</span>
                </button>
              </div>

              <p style={{ fontSize: '0.9375rem', color: 'var(--ink-secondary)' }}>
                Hvis en deltaker faller ut, kan de skanne QR-koden under eller bruke romkoden{' '}
                <strong>{room.id}</strong>. Samme telefon får kortet sitt automatisk tilbake. Hvis
                de byttet nettleser, kan du overføre plassen deres under uten å avbryte runden.
              </p>

              {isSimultaneousTeams ? (
                <div className="reconnect-qr-grid">
                  {room.teams.map((team) => (
                    <div
                      key={team.id}
                      className="reconnect-qr-card"
                      style={{ borderTop: `5px solid ${team.color}` }}
                    >
                      <strong style={{ color: team.color, fontSize: '0.9375rem' }}>
                        {team.name}
                      </strong>
                      <div className="qr-frame" style={{ padding: '8px' }}>
                        <QRCodeSVG
                          value={getTeamJoinUrl(team.id)}
                          size={128}
                          level="M"
                          bgColor="#FFFFFF"
                          fgColor="#18181B"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="surface--subtle row"
                  style={{ justifyContent: 'center', gap: 'var(--space-5)', flexWrap: 'wrap' }}
                >
                  <div className="qr-frame" style={{ padding: '10px' }}>
                    <QRCodeSVG
                      value={joinUrl}
                      size={156}
                      level="M"
                      bgColor="#FFFFFF"
                      fgColor="#18181B"
                    />
                  </div>
                  <div className="stack-xs" style={{ alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
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
                </div>
              )}

              {room.status === 'playing' && waitingPlayersWithoutCard.length > 0 && (
                <div className="stack-sm">
                  <div className="row-between">
                    <h3 style={{ fontSize: '1.0625rem' }}>
                      Tilkoblede mobiler som venter på kort ({waitingPlayersWithoutCard.length})
                    </h3>
                    <span className="badge">Kort holdes skjult</span>
                  </div>

                  {waitingPlayersWithoutCard.map((waitingPlayer, wIdx) => {
                    const waitingTeam = isSimultaneousTeams
                      ? room.teams.find((t) => t.id === waitingPlayer.teamId) ?? null
                      : null;

                    const candidateSlots = players
                      .filter(
                        (p) =>
                          p.card !== null &&
                          p.uid !== waitingPlayer.uid &&
                          (!isSimultaneousTeams ||
                            !waitingPlayer.teamId ||
                            p.teamId === waitingPlayer.teamId)
                      )
                      // Vis ulåste plasser først (mest sannsynlig den som falt ut)
                      .sort((a, b) => {
                        const aLocked = a.lockedAt ? 1 : 0;
                        const bLocked = b.lockedAt ? 1 : 0;
                        return aLocked - bLocked;
                      });

                    return (
                      <div
                        key={waitingPlayer.uid}
                        className="surface--subtle stack-sm"
                        style={{
                          borderLeft: waitingTeam
                            ? `5px solid ${waitingTeam.color}`
                            : '5px solid var(--accent)',
                        }}
                      >
                        <div className="row-between" style={{ flexWrap: 'wrap', gap: '8px' }}>
                          <div className="row" style={{ gap: '8px' }}>
                            <Smartphone size={16} aria-hidden="true" />
                            <strong>Ny tilkobling #{wIdx + 1}</strong>
                            {waitingTeam && (
                              <span
                                className="team-pill"
                                style={{
                                  backgroundColor: waitingTeam.color,
                                  color: '#ffffff',
                                }}
                              >
                                {waitingTeam.name}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn btn--secondary"
                            style={{ minHeight: '30px', padding: '2px 10px', fontSize: '0.8125rem' }}
                            onClick={() => handleRemovePlayer(waitingPlayer.uid)}
                            disabled={actionBusy !== null}
                          >
                            <X size={14} aria-hidden="true" />
                            <span>Fjern</span>
                          </button>
                        </div>

                        {candidateSlots.length > 0 ? (
                          <div className="stack-xs">
                            <span style={{ fontSize: '0.8125rem', color: 'var(--ink-muted)' }}>
                              Overfør aktivt kort fra frafalt spiller (eller la stå til neste runde):
                            </span>
                            <div className="row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                              {candidateSlots.map((slot, sIdx) => {
                                const isLocked = slot.lockedAt !== null;
                                return (
                                  <button
                                    key={slot.uid}
                                    type="button"
                                    className={`btn ${isLocked ? 'btn--secondary' : 'btn--primary'}`}
                                    style={{
                                      minHeight: '36px',
                                      padding: '6px 12px',
                                      fontSize: '0.8125rem',
                                    }}
                                    onClick={() => handleReassignCard(slot, waitingPlayer)}
                                    disabled={actionBusy !== null}
                                  >
                                    <span>
                                      Overfør fra Spiller {sIdx + 1}{' '}
                                      {isLocked ? '(låst)' : '(ikke låst)'}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.8125rem', color: 'var(--ink-muted)' }}>
                            Blir automatisk med fra neste runde.
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
