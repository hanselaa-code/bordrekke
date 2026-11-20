import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { buildCardsForPlayerCount, getRoundByNumber } from '../data/mockRounds';
import { isFirebaseConfigured, requireFirestore } from '../firebase/config';
import type { PlayerDoc } from '../types/game';
import {
  p2pCreateRoom,
  p2pJoinRoomAsPlayer,
  p2pLockPlayerPosition,
  p2pResetAllLocks,
  p2pResetGame,
  p2pReturnToLobby,
  p2pRevealAnswers,
  p2pStartRound,
  p2pUnlockPlayerPosition,
} from './p2pBackend';
import { generateRoomCode, shuffleArray } from './ranking';

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
 * Kobler en spiller til et eksisterende rom.
 * Bevarer eksisterende kort og låsestatus dersom spilleren laster siden på nytt.
 */
export async function joinRoomAsPlayer(
  roomId: string,
  playerUid: string,
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pJoinRoomAsPlayer(roomId, playerUid);
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

  const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', playerUid);
  const playerSnap = await getDoc(playerRef);

  if (playerSnap.exists()) {
    await updateDoc(playerRef, {
      connected: true,
    });
    return;
  }

  await setDoc(playerRef, {
    uid: playerUid,
    joinedAt: serverTimestamp(),
    connected: true,
    card: null,
    lockedAt: null,
    lockedClientAt: null,
  });
}

/**
 * Starter neste runde og deler atomisk ut unike, stokkede kort til alle spillere.
 */
export async function startRound(
  roomId: string,
  hostUid: string,
  currentRoundNumber: number,
  players: readonly PlayerDoc[],
  selectedRoundIds?: readonly string[],
): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pStartRound(roomId, hostUid, currentRoundNumber, players, selectedRoundIds);
  }

  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) {
    throw new Error('Ugyldig romkode.');
  }
  if (!hostUid.trim()) {
    throw new Error('Mangler vert-ID for å starte runden.');
  }
  if (players.length < 2) {
    throw new Error('Minst 2 spillere må være tilkoblet for å starte en runde.');
  }

  const db = requireFirestore();
  const nextRoundNumber = currentRoundNumber + 1;
  const round = getRoundByNumber(nextRoundNumber, selectedRoundIds);
  const roundForDeal =
    players.length <= round.cards.length
      ? { ...round, cards: shuffleArray(round.cards) }
      : round;
  const cards = shuffleArray(buildCardsForPlayerCount(roundForDeal, players.length));

  const batch = writeBatch(db);
  const roomRef = doc(db, 'rooms', normalizedRoomId);

  batch.update(roomRef, {
    hostUid,
    status: 'playing',
    roundNumber: nextRoundNumber,
    activeRoundId: round.id,
    activeRoundTitle: round.title,
    activeRoundDirection: round.directionLabel,
    updatedAt: serverTimestamp(),
  });

  players.forEach((player, index) => {
    const playerRef = doc(db, 'rooms', normalizedRoomId, 'players', player.uid);
    batch.update(playerRef, {
      card: cards[index],
      lockedAt: null,
      lockedClientAt: null,
    });
  });

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
 * Avslører fasit for den aktive runden på alle tilkoblede skjermer.
 */
export async function revealAnswers(roomId: string): Promise<void> {
  if (!isFirebaseConfigured) {
    return p2pRevealAnswers(roomId);
  }

  const db = requireFirestore();
  const roomRef = doc(db, 'rooms', normalizeRoomId(roomId));
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
