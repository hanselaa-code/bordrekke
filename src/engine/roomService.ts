import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { buildCardsForPlayerCount, getRoundByNumber } from '../data/mockRounds';
import { isFirebaseConfigured, requireFirestore } from '../firebase/config';
import type { GameMode, PlayerDoc, RoomDoc, TeamConfig } from '../types/game';
import {
  p2pCloseRoom,
  p2pConfigureRoomMode,
  p2pCreateRoom,
  p2pJoinRoomAsPlayer,
  p2pLockPlayerPosition,
  p2pRemovePlayerFromRoom,
  p2pResetAllLocks,
  p2pResetGame,
  p2pReturnToLobby,
  p2pRevealAnswers,
  p2pStartRound,
  p2pUnlockPlayerPosition,
} from './p2pBackend';
import { generateRoomCode, shuffleArray } from './ranking';
import { computeUpdatedTeamScores } from './teams';

const MAX_ROOM_CODE_ATTEMPTS = 10;

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

/**
 * Oppretter et nytt spillrom med en unik 6-tegns romkode (Firestore eller P2P WebRTC).
 */
export async function createRoom(hostUid: string): Promise<string> {
  if (!isFirebaseConfigured) {
    return p2pCreateRoom(hostUid);
  }

  const db = requireFirestore();

  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
    const code = generateRoomCode(6);
    const roomRef = doc(db, 'rooms', code);
    const existing = await getDoc(roomRef);

    if (!existing.exists()) {
      await setDoc(roomRef, {
        id: code,
        hostUid,
        status: 'lobby',
        gameMode: 'coop',
        teams: [],
        activeTeamIndex: 0,
        lastScoredRound: 0,
        roundNumber: 0,
        activeRoundId: null,
        activeRoundTitle: null,
        activeRoundDirection: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return code;
    }
  }

  throw new Error('Klarte ikke å generere en unik romkode. Prøv igjen.');
}

/**
 * Oppdaterer spillmodus (samarbeid, lag samtidig, lag på tur), lagliste og aktivt lag.
 */
export async function configureRoomMode(
  roomId: string,
  gameMode: GameMode,
  teams: readonly TeamConfig[],
  activeTeamIndex = 0,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pConfigureRoomMode(roomId, gameMode, teams, activeTeamIndex);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const db = requireFirestore();
  await updateDoc(doc(db, 'rooms', normalizedRoomId), {
    gameMode,
    teams: teams.map((t) => ({ ...t })),
    activeTeamIndex: teams.length > 0 ? activeTeamIndex % teams.length : 0,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Kobler en spiller til et eksisterende rom.
 * Bevarer eksisterende kort og låsestatus dersom spilleren laster siden på nytt.
 */
export async function joinRoomAsPlayer(
  roomId: string,
  playerUid: string,
  deviceId?: string | null,
  teamId?: string | null,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pJoinRoomAsPlayer(roomId, playerUid, teamId);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) {
    throw new Error('Skriv inn en gyldig romkode.');
  }

  const db = requireFirestore();
  const roomRef = doc(db, 'rooms', normalizedRoomId);
  const roomSnap = await getDoc(roomRef);

  if (!roomSnap.exists()) {
    throw new Error(
      `Fant ikke noe rom med koden «${normalizedRoomId}». Sjekk koden og prøv igjen.`,
    );
  }

  const normalizedDeviceId =
    typeof deviceId === 'string' && deviceId.trim().length > 0 ? deviceId.trim().slice(0, 128) : null;
  const normalizedTeamId =
    typeof teamId === 'string' && teamId.trim().length > 0 ? teamId.trim().slice(0, 64) : null;

  const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', playerUid);
  const playerSnap = await getDoc(playerRef);

  if (playerSnap.exists()) {
    await updateDoc(playerRef, {
      connected: true,
      ...(normalizedDeviceId ? { deviceId: normalizedDeviceId } : {}),
      ...(normalizedTeamId ? { teamId: normalizedTeamId } : {}),
    });
    return;
  }

  await setDoc(playerRef, {
    uid: playerUid,
    ...(normalizedDeviceId ? { deviceId: normalizedDeviceId } : {}),
    ...(normalizedTeamId ? { teamId: normalizedTeamId } : {}),
    joinedAt: serverTimestamp(),
    connected: true,
    card: null,
    lockedAt: null,
    lockedClientAt: null,
  });
}

export interface StartRoundOptions {
  gameMode?: GameMode;
  teams?: readonly TeamConfig[];
  activeTeamIndex?: number;
}

/**
 * Starter neste runde og deler atomisk ut unike, stokkede kort til alle spillere (eller per lag i samtidig lagmodus).
 */
export async function startRound(
  roomId: string,
  hostUid: string,
  currentRoundNumber: number,
  players: readonly PlayerDoc[],
  selectedRoundIds?: readonly string[],
  options?: StartRoundOptions,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pStartRound(roomId, hostUid, currentRoundNumber, players, selectedRoundIds, options);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) {
    throw new Error('Ugyldig romkode.');
  }
  if (!hostUid.trim()) {
    throw new Error('Mangler vert-ID for å starte runden.');
  }

  const gameMode: GameMode = options?.gameMode ?? 'coop';
  const teams = options?.teams ?? [];

  if (gameMode === 'teams-simultaneous') {
    const activeTeamsWithPlayers = teams.filter(
      (team) => players.filter((p) => p.teamId === team.id).length >= 2,
    );
    if (activeTeamsWithPlayers.length === 0) {
      throw new Error('Minst ett lag må ha 2 eller flere tilkoblede spillere for å starte.');
    }
  } else if (players.length < 2) {
    throw new Error('Minst 2 spillere må være tilkoblet for å starte en runde.');
  }

  const db = requireFirestore();
  const nextRoundNumber = currentRoundNumber + 1;
  const round = getRoundByNumber(nextRoundNumber, selectedRoundIds);
  const shuffledBasePool = shuffleArray(round.cards);

  const nextActiveTeamIndex =
    gameMode === 'teams-turn' && teams.length > 0
      ? currentRoundNumber === 0
        ? (options?.activeTeamIndex ?? 0) % teams.length
        : ((options?.activeTeamIndex ?? 0) + 1) % teams.length
      : (options?.activeTeamIndex ?? 0);

  const batch = writeBatch(db);
  const roomRef = doc(db, 'rooms', normalizedRoomId);

  batch.update(roomRef, {
    hostUid,
    status: 'playing',
    roundNumber: nextRoundNumber,
    activeTeamIndex: nextActiveTeamIndex,
    activeRoundId: round.id,
    activeRoundTitle: round.title,
    activeRoundDirection: round.directionLabel,
    updatedAt: serverTimestamp(),
  });

  if (gameMode === 'teams-simultaneous') {
    const assignedByUid = new Map<string, ReturnType<typeof buildCardsForPlayerCount>[number]>();
    for (const team of teams) {
      const teamPlayers = players.filter((p) => p.teamId === team.id);
      if (teamPlayers.length === 0) continue;
      // Alle lag får kort trukket fra samme stokkede base-utvalg for 100 % rettferdighet
      const roundForTeam = { ...round, cards: shuffledBasePool };
      const teamCards = shuffleArray(buildCardsForPlayerCount(roundForTeam, teamPlayers.length));
      teamPlayers.forEach((player, idx) => {
        assignedByUid.set(player.uid, teamCards[idx]);
      });
    }

    players.forEach((player) => {
      const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', player.uid);
      batch.update(playerRef, {
        card: assignedByUid.get(player.uid) ?? null,
        lockedAt: null,
        lockedClientAt: null,
      });
    });
  } else {
    const roundForDeal =
      players.length <= round.cards.length
        ? { ...round, cards: shuffledBasePool }
        : round;
    const cards = shuffleArray(buildCardsForPlayerCount(roundForDeal, players.length));

    players.forEach((player, index) => {
      const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', player.uid);
      batch.update(playerRef, {
        card: cards[index],
        lockedAt: null,
        lockedClientAt: null,
      });
    });
  }

  await batch.commit();
}

/**
 * Låser spillerens plass i køen med autoritativt tidsstempel.
 */
export async function lockPlayerPosition(
  roomId: string,
  playerUid: string,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pLockPlayerPosition(roomId, playerUid);
  }

  const db = requireFirestore();
  const playerRef = doc(
    db,
    'rooms',
    normalizeRoomId(roomId),
    'players',
    playerUid,
  );
  await updateDoc(playerRef, {
    lockedAt: serverTimestamp(),
    lockedClientAt: Date.now(),
  });
}

/**
 * Angrer spillerens låste plass slik at øvrige spillere automatisk rykker frem.
 */
export async function unlockPlayerPosition(
  roomId: string,
  playerUid: string,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pUnlockPlayerPosition(roomId, playerUid);
  }

  const db = requireFirestore();
  const playerRef = doc(
    db,
    'rooms',
    normalizeRoomId(roomId),
    'players',
    playerUid,
  );
  await updateDoc(playerRef, {
    lockedAt: null,
    lockedClientAt: null,
  });
}

/**
 * Nullstiller låste plasseringer for alle spillere i rommet.
 */
export async function resetAllLocks(
  roomId: string,
  players: readonly PlayerDoc[],
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pResetAllLocks(roomId);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const db = requireFirestore();
  const batch = writeBatch(db);

  players.forEach((player) => {
    const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', player.uid);
    batch.update(playerRef, {
      lockedAt: null,
      lockedClientAt: null,
    });
  });

  const roomRef = doc(db, 'rooms', normalizedRoomId);
  batch.update(roomRef, {
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Avslører fasit for den aktive runden på alle tilkoblede skjermer og oppdaterer lagpoeng (1 poeng per riktig kort).
 */
export async function revealAnswers(
  roomId: string,
  room?: RoomDoc | null,
  players?: readonly PlayerDoc[],
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pRevealAnswers(roomId);
  }

  const db = requireFirestore();
  const roomRef = doc(db, 'rooms', normalizeRoomId(roomId));

  if (room && players && room.gameMode !== 'coop' && room.teams.length > 0) {
    const { teams } = computeUpdatedTeamScores(room, players);
    await updateDoc(roomRef, {
      status: 'revealed',
      teams,
      lastScoredRound: room.roundNumber,
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(roomRef, {
    status: 'revealed',
    updatedAt: serverTimestamp(),
  });
}

/**
 * Setter rommet tilbake til lobby og fjerner utdelte kort og låsestatus fra alle spillere.
 */
export async function returnToLobby(
  roomId: string,
  players: readonly PlayerDoc[],
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pReturnToLobby(roomId);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const db = requireFirestore();
  const batch = writeBatch(db);

  const roomRef = doc(db, 'rooms', normalizedRoomId);
  batch.update(roomRef, {
    status: 'lobby',
    activeRoundId: null,
    activeRoundTitle: null,
    activeRoundDirection: null,
    updatedAt: serverTimestamp(),
  });

  players.forEach((player) => {
    const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', player.uid);
    batch.update(playerRef, {
      card: null,
      lockedAt: null,
      lockedClientAt: null,
    });
  });

  await batch.commit();
}

/**
 * Nullstiller spillet tilbake til lobby og runde 0, og fjerner kort og låsestatus fra alle spillere.
 */
export async function resetGame(
  roomId: string,
  players: readonly PlayerDoc[],
  teams?: readonly TeamConfig[],
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pResetGame(roomId);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const db = requireFirestore();
  const batch = writeBatch(db);

  const roomRef = doc(db, 'rooms', normalizedRoomId);
  batch.update(roomRef, {
    status: 'lobby',
    roundNumber: 0,
    activeTeamIndex: 0,
    lastScoredRound: 0,
    ...(teams ? { teams: teams.map((t) => ({ ...t, score: 0 })) } : {}),
    activeRoundId: null,
    activeRoundTitle: null,
    activeRoundDirection: null,
    updatedAt: serverTimestamp(),
  });

  players.forEach((player) => {
    const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', player.uid);
    batch.update(playerRef, {
      card: null,
      lockedAt: null,
      lockedClientAt: null,
    });
  });

  await batch.commit();
}

/**
 * Fjerner én spiller fra rommet (brukes til automatisk avduplisering per telefon og manuell fjerning av vert).
 */
export async function removePlayerFromRoom(
  roomId: string,
  playerUid: string,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pRemovePlayerFromRoom(roomId, playerUid);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const db = requireFirestore();
  await deleteDoc(doc(db, 'rooms', normalizedRoomId, 'players', playerUid));
}

/**
 * Overfører atomisk aktivt kort, låsestatus og lagtilhørighet fra en frafalt spillerøkt
 * til en nyoppkoblet telefon, og sletter den gamle spøkelsesøkten.
 */
export async function reassignPlayerCard(
  roomId: string,
  fromPlayer: PlayerDoc,
  toPlayerUid: string,
  preserveTargetTeamId?: string | null,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return;
  }
  if (fromPlayer.uid === toPlayerUid) {
    return;
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const db = requireFirestore();
  const batch = writeBatch(db);

  const targetRef = doc(db, 'rooms', normalizedRoomId, 'players', toPlayerUid);
  const oldRef = doc(db, 'rooms', normalizedRoomId, 'players', fromPlayer.uid);
  const roomRef = doc(db, 'rooms', normalizedRoomId);

  const resolvedTeamId = preserveTargetTeamId ?? fromPlayer.teamId ?? null;

  batch.update(targetRef, {
    card: fromPlayer.card,
    lockedAt: fromPlayer.lockedAt ?? null,
    lockedClientAt: fromPlayer.lockedClientAt ?? null,
    ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
    connected: true,
  });
  batch.delete(oldRef);
  batch.update(roomRef, {
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Avslutter og sletter rommet fullstendig slik at spillmester kan starte et helt nytt spill/rom.
 */
export async function closeRoom(
  roomId: string,
  players: readonly PlayerDoc[],
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pCloseRoom(roomId);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  const db = requireFirestore();
  const batch = writeBatch(db);

  players.forEach((player) => {
    batch.delete(doc(db, 'rooms', normalizedRoomId, 'players', player.uid));
  });
  batch.delete(doc(db, 'rooms', normalizedRoomId));

  await batch.commit();
}
