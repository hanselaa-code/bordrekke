import type { PlayerDoc, RankedPlayer, RoundEvaluation } from '../types/game';

/** Alfabet uten forvekslbare tegn (0, O, 1, I). */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Stokker en liste med Fisher-Yates og returnerer en ny array uten å mutere input.
 */
export function shuffleArray<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * Genererer en lesbar romkode med store bokstaver og tall uten forvekslbare tegn (0/O/1/I).
 */
export function generateRoomCode(length = 6): string {
  const safeLength = Math.max(1, Math.floor(length));
  const alphabetLength = ROOM_CODE_ALPHABET.length;

  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(safeLength);
    globalThis.crypto.getRandomValues(bytes);
    let code = '';
    for (let i = 0; i < safeLength; i += 1) {
      code += ROOM_CODE_ALPHABET[bytes[i] % alphabetLength];
    }
    return code;
  }

  let code = '';
  for (let i = 0; i < safeLength; i += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * alphabetLength)];
  }
  return code;
}

function isPlayerLocked(player: PlayerDoc): boolean {
  return player.lockedAt !== null || player.lockedClientAt !== null;
}

function getLockTimestampMs(player: PlayerDoc): number {
  return player.lockedAt?.toMillis() ?? player.lockedClientAt ?? Number.MAX_SAFE_INTEGER;
}

function getJoinedTimestampMs(player: PlayerDoc): number {
  return player.joinedAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Evaluerer en runde i sanntid: beregner låst rekkefølge, fasit-rekkefølge og hvem som står riktig.
 */
export function evaluateRound(players: readonly PlayerDoc[]): RoundEvaluation {
  const lockedPlayersSorted = players
    .filter(isPlayerLocked)
    .sort((a, b) => {
      const diff = getLockTimestampMs(a) - getLockTimestampMs(b);
      if (diff !== 0) {
        return diff;
      }
      return a.uid.localeCompare(b.uid);
    });

  const unlockedPlayersSorted = players
    .filter((player) => !isPlayerLocked(player))
    .sort((a, b) => {
      const diff = getJoinedTimestampMs(a) - getJoinedTimestampMs(b);
      if (diff !== 0) {
        return diff;
      }
      return a.uid.localeCompare(b.uid);
    });

  const lockedRankByUid = new Map<string, number>();
  lockedPlayersSorted.forEach((player, index) => {
    lockedRankByUid.set(player.uid, index + 1);
  });

  const playersWithCardsSorted = players
    .filter((player): player is PlayerDoc & { card: NonNullable<PlayerDoc['card']> } => player.card !== null)
    .sort((a, b) => {
      const valueDiff = a.card.answerValue - b.card.answerValue;
      if (valueDiff !== 0) {
        return valueDiff;
      }
      const cardIdDiff = a.card.id.localeCompare(b.card.id);
      if (cardIdDiff !== 0) {
        return cardIdDiff;
      }
      return a.uid.localeCompare(b.uid);
    });

  const correctRankByUid = new Map<string, number>();
  playersWithCardsSorted.forEach((player, index) => {
    correctRankByUid.set(player.uid, index + 1);
  });

  const byUid: Record<string, RankedPlayer> = {};
  for (const player of players) {
    const lockedRank = lockedRankByUid.get(player.uid) ?? null;
    const correctRank = correctRankByUid.get(player.uid) ?? null;

    let isCorrect: boolean | null = null;
    if (lockedRank !== null && player.card !== null) {
      const expectedAtLockedSlot = playersWithCardsSorted[lockedRank - 1];
      isCorrect =
        expectedAtLockedSlot !== undefined &&
        player.card.answerValue === expectedAtLockedSlot.card.answerValue;
    }

    byUid[player.uid] = {
      player,
      lockedRank,
      correctRank,
      isCorrect,
    };
  }

  const rankedPlayers: RankedPlayer[] = [
    ...lockedPlayersSorted.map((player) => byUid[player.uid]),
    ...unlockedPlayersSorted.map((player) => byUid[player.uid]),
  ];

  const correctOrder: RankedPlayer[] = playersWithCardsSorted.map(
    (player) => byUid[player.uid],
  );

  const totalPlayers = players.length;
  const lockedCount = lockedPlayersSorted.length;
  const allLocked = totalPlayers > 0 && lockedCount === totalPlayers;
  const correctCount = rankedPlayers.reduce(
    (count, entry) => (entry.isCorrect === true ? count + 1 : count),
    0,
  );

  return {
    totalPlayers,
    lockedCount,
    allLocked,
    correctCount,
    rankedPlayers,
    correctOrder,
    byUid,
  };
}
