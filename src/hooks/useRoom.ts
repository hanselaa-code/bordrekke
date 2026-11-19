import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { evaluateRound } from '../engine/ranking';
import { isFirebaseConfigured, requireFirestore } from '../firebase/config';
import type {
  AssignedCard,
  PlayerDoc,
  RoomDoc,
  RoomStatus,
  RoundEvaluation,
} from '../types/game';

export interface UseRoomResult {
  room: RoomDoc | null;
  players: PlayerDoc[];
  evaluation: RoundEvaluation;
  loading: boolean;
  error: string | null;
}

function isRoomStatus(value: unknown): value is RoomStatus {
  return value === 'lobby' || value === 'playing' || value === 'revealed';
}

function asTimestampOrNull(value: unknown): Timestamp | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as Timestamp).toMillis === 'function'
  ) {
    return value as Timestamp;
  }
  return null;
}

export function parseAssignedCard(value: unknown): AssignedCard | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.subtitle === 'string' &&
    typeof record.answerValue === 'number' &&
    typeof record.answerDisplay === 'string'
  ) {
    const card: AssignedCard = {
      id: record.id,
      label: record.label,
      subtitle: record.subtitle,
      answerValue: record.answerValue,
      answerDisplay: record.answerDisplay,
    };

    if (typeof record.imageUrl === 'string' && record.imageUrl.trim().length > 0) {
      card.imageUrl = record.imageUrl;
    }

    if (typeof record.imageAlt === 'string' && record.imageAlt.trim().length > 0) {
      card.imageAlt = record.imageAlt;
    }

    return card;
  }
  return null;
}

function parseRoomDoc(id: string, data: DocumentData): RoomDoc {
  return {
    id,
    hostUid: typeof data.hostUid === 'string' ? data.hostUid : '',
    status: isRoomStatus(data.status) ? data.status : 'lobby',
    roundNumber: typeof data.roundNumber === 'number' ? data.roundNumber : 0,
    activeRoundId: typeof data.activeRoundId === 'string' ? data.activeRoundId : null,
    activeRoundTitle: typeof data.activeRoundTitle === 'string' ? data.activeRoundTitle : null,
    activeRoundDirection:
      typeof data.activeRoundDirection === 'string' ? data.activeRoundDirection : null,
    createdAt: asTimestampOrNull(data.createdAt),
    updatedAt: asTimestampOrNull(data.updatedAt),
  };
}

function parsePlayerDoc(id: string, data: DocumentData): PlayerDoc {
  return {
    uid: typeof data.uid === 'string' ? data.uid : id,
    joinedAt: asTimestampOrNull(data.joinedAt),
    connected: typeof data.connected === 'boolean' ? data.connected : true,
    card: parseAssignedCard(data.card),
    lockedAt: asTimestampOrNull(data.lockedAt),
    lockedClientAt: typeof data.lockedClientAt === 'number' ? data.lockedClientAt : null,
  };
}

interface RoomSnapshotState {
  roomId: string;
  room: RoomDoc | null;
  players: PlayerDoc[];
  roomLoaded: boolean;
  playersLoaded: boolean;
  error: string | null;
}

const EMPTY_PLAYERS: PlayerDoc[] = [];

/**
 * Abonnerer i sanntid på romdokumentet og alle spillere i rommet via Firestore onSnapshot.
 */
export function useRoom(roomId: string | undefined): UseRoomResult {
  const normalizedRoomId = roomId?.trim().toUpperCase() ?? '';
  const [snapshotState, setSnapshotState] = useState<RoomSnapshotState | null>(null);

  useEffect(() => {
    if (!normalizedRoomId || !isFirebaseConfigured) {
      return;
    }

    const db = requireFirestore();
    const roomRef = doc(db, 'rooms', normalizedRoomId);
    const playersRef = collection(db, 'rooms', normalizedRoomId, 'players');

    const unsubscribeRoom = onSnapshot(
      roomRef,
      (snapshot) => {
        setSnapshotState((prev) => {
          const base =
            prev && prev.roomId === normalizedRoomId
              ? prev
              : {
                  roomId: normalizedRoomId,
                  room: null,
                  players: EMPTY_PLAYERS,
                  roomLoaded: false,
                  playersLoaded: false,
                  error: null,
                };

          if (!snapshot.exists()) {
            return {
              ...base,
              room: null,
              roomLoaded: true,
              error: `Fant ikke rommet «${normalizedRoomId}».`,
            };
          }

          return {
            ...base,
            room: parseRoomDoc(snapshot.id, snapshot.data()),
            roomLoaded: true,
            error: null,
          };
        });
      },
      (snapshotError) => {
        setSnapshotState((prev) => ({
          roomId: normalizedRoomId,
          room: null,
          players: prev && prev.roomId === normalizedRoomId ? prev.players : EMPTY_PLAYERS,
          roomLoaded: true,
          playersLoaded: prev && prev.roomId === normalizedRoomId ? prev.playersLoaded : true,
          error: snapshotError.message || 'Kunne ikke hente romdata fra Firestore.',
        }));
      },
    );

    const unsubscribePlayers = onSnapshot(
      playersRef,
      (snapshot) => {
        const nextPlayers = snapshot.docs.map((playerDoc) =>
          parsePlayerDoc(playerDoc.id, playerDoc.data()),
        );
        setSnapshotState((prev) => {
          const base =
            prev && prev.roomId === normalizedRoomId
              ? prev
              : {
                  roomId: normalizedRoomId,
                  room: null,
                  players: EMPTY_PLAYERS,
                  roomLoaded: false,
                  playersLoaded: false,
                  error: null,
                };

          return {
            ...base,
            players: nextPlayers,
            playersLoaded: true,
          };
        });
      },
      (snapshotError) => {
        setSnapshotState((prev) => ({
          roomId: normalizedRoomId,
          room: prev && prev.roomId === normalizedRoomId ? prev.room : null,
          players: prev && prev.roomId === normalizedRoomId ? prev.players : EMPTY_PLAYERS,
          roomLoaded: prev && prev.roomId === normalizedRoomId ? prev.roomLoaded : true,
          playersLoaded: true,
          error: snapshotError.message || 'Kunne ikke hente spillerliste fra Firestore.',
        }));
      },
    );

    return () => {
      unsubscribeRoom();
      unsubscribePlayers();
    };
  }, [normalizedRoomId]);

  const activeState =
    normalizedRoomId &&
    isFirebaseConfigured &&
    snapshotState &&
    snapshotState.roomId === normalizedRoomId
      ? snapshotState
      : null;

  const room = activeState ? activeState.room : null;
  const players = activeState ? activeState.players : EMPTY_PLAYERS;
  const loading = Boolean(
    normalizedRoomId &&
      isFirebaseConfigured &&
      (!activeState || (!activeState.error && (!activeState.roomLoaded || !activeState.playersLoaded))),
  );
  const error = !normalizedRoomId
    ? null
    : !isFirebaseConfigured
      ? 'Firebase er ikke konfigurert. Legg inn miljøvariabler før du bruker sanntidsrom.'
      : (activeState?.error ?? null);

  const evaluation = useMemo(() => evaluateRound(players), [players]);

  return {
    room,
    players,
    evaluation,
    loading,
    error,
  };
}
