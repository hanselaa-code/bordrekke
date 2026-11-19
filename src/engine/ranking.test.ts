import { describe, expect, it } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import {
  MOCK_ROUNDS,
  buildCardsForPlayerCount,
  getRoundByNumber,
} from '../data/mockRounds';
import type { AssignedCard, PlayerDoc } from '../types/game';
import { evaluateRound, generateRoomCode, shuffleArray } from './ranking';

function createMockTimestamp(ms: number): Timestamp {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1_000_000,
    toMillis: () => ms,
    toDate: () => new Date(ms),
    isEqual: (other: Timestamp) => other.toMillis() === ms,
    valueOf: () => String(ms),
    toJSON: () => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000, type: 'timestamp' }),
  } as Timestamp;
}

function makeCard(id: string, answerValue: number): AssignedCard {
  return {
    id,
    label: `Kort ${id.toUpperCase()}`,
    subtitle: 'Plassholderkort',
    answerValue,
    answerDisplay: `Verdi: ${answerValue}`,
  };
}

function makePlayer(overrides: Partial<PlayerDoc> & { uid: string }): PlayerDoc {
  return {
    uid: overrides.uid,
    joinedAt: overrides.joinedAt ?? createMockTimestamp(1000),
    connected: overrides.connected ?? true,
    card: overrides.card ?? null,
    lockedAt: overrides.lockedAt ?? null,
    lockedClientAt: overrides.lockedClientAt ?? null,
  };
}

describe('evaluateRound', () => {
  it('håndterer tom spillerliste korrekt', () => {
    const result = evaluateRound([]);
    expect(result.totalPlayers).toBe(0);
    expect(result.lockedCount).toBe(0);
    expect(result.allLocked).toBe(false);
    expect(result.correctCount).toBe(0);
    expect(result.rankedPlayers).toEqual([]);
    expect(result.correctOrder).toEqual([]);
    expect(result.byUid).toEqual({});
  });

  it('evaluerer alle spillere som riktige når låst rekkefølge matcher fasit', () => {
    const players: PlayerDoc[] = [
      makePlayer({
        uid: 'p3',
        card: makeCard('c', 90),
        lockedAt: createMockTimestamp(3000),
      }),
      makePlayer({
        uid: 'p1',
        card: makeCard('a', 10),
        lockedAt: createMockTimestamp(1000),
      }),
      makePlayer({
        uid: 'p2',
        card: makeCard('b', 50),
        lockedAt: createMockTimestamp(2000),
      }),
    ];

    const result = evaluateRound(players);

    expect(result.totalPlayers).toBe(3);
    expect(result.lockedCount).toBe(3);
    expect(result.allLocked).toBe(true);
    expect(result.correctCount).toBe(3);
    expect(result.rankedPlayers.map((r) => r.player.uid)).toEqual(['p1', 'p2', 'p3']);
    expect(result.correctOrder.map((r) => r.player.uid)).toEqual(['p1', 'p2', 'p3']);
    expect(result.byUid.p1.lockedRank).toBe(1);
    expect(result.byUid.p1.correctRank).toBe(1);
    expect(result.byUid.p1.isCorrect).toBe(true);
    expect(result.byUid.p2.lockedRank).toBe(2);
    expect(result.byUid.p2.isCorrect).toBe(true);
    expect(result.byUid.p3.lockedRank).toBe(3);
    expect(result.byUid.p3.isCorrect).toBe(true);
  });

  it('evaluerer delvis riktig rekkefølge presist', () => {
    const players: PlayerDoc[] = [
      makePlayer({
        uid: 'p1',
        card: makeCard('a', 10),
        lockedAt: createMockTimestamp(1000), // #1 -> riktig (10)
      }),
      makePlayer({
        uid: 'p2',
        card: makeCard('c', 90),
        lockedAt: createMockTimestamp(2000), // #2 -> feil (skulle vært 50)
      }),
      makePlayer({
        uid: 'p3',
        card: makeCard('b', 50),
        lockedAt: createMockTimestamp(3000), // #3 -> feil (skulle vært 90)
      }),
    ];

    const result = evaluateRound(players);

    expect(result.allLocked).toBe(true);
    expect(result.correctCount).toBe(1);
    expect(result.byUid.p1.isCorrect).toBe(true);
    expect(result.byUid.p2.isCorrect).toBe(false);
    expect(result.byUid.p2.lockedRank).toBe(2);
    expect(result.byUid.p2.correctRank).toBe(3);
    expect(result.byUid.p3.isCorrect).toBe(false);
    expect(result.byUid.p3.lockedRank).toBe(3);
    expect(result.byUid.p3.correctRank).toBe(2);
  });

  it('skifter plassnummer når en spiller angrer låsing', () => {
    const beforeUnlock: PlayerDoc[] = [
      makePlayer({
        uid: 'p1',
        joinedAt: createMockTimestamp(100),
        card: makeCard('a', 10),
        lockedAt: createMockTimestamp(1000),
      }),
      makePlayer({
        uid: 'p2',
        joinedAt: createMockTimestamp(200),
        card: makeCard('b', 20),
        lockedAt: createMockTimestamp(2000),
      }),
      makePlayer({
        uid: 'p3',
        joinedAt: createMockTimestamp(300),
        card: makeCard('c', 30),
        lockedAt: createMockTimestamp(3000),
      }),
    ];

    const afterUnlock: PlayerDoc[] = beforeUnlock.map((p) =>
      p.uid === 'p1' ? { ...p, lockedAt: null, lockedClientAt: null } : p,
    );

    const result = evaluateRound(afterUnlock);

    expect(result.lockedCount).toBe(2);
    expect(result.allLocked).toBe(false);
    expect(result.rankedPlayers.map((r) => r.player.uid)).toEqual(['p2', 'p3', 'p1']);
    expect(result.byUid.p2.lockedRank).toBe(1);
    expect(result.byUid.p3.lockedRank).toBe(2);
    expect(result.byUid.p1.lockedRank).toBeNull();
    expect(result.byUid.p1.isCorrect).toBeNull();
  });

  it('bruker deterministisk uid.localeCompare som tie-breaker ved like tidsstempler', () => {
    const sameTime = createMockTimestamp(5000);
    const players: PlayerDoc[] = [
      makePlayer({ uid: 'zeta', card: makeCard('a', 10), lockedAt: sameTime }),
      makePlayer({ uid: 'alpha', card: makeCard('b', 20), lockedAt: sameTime }),
      makePlayer({ uid: 'beta', card: makeCard('c', 30), lockedAt: sameTime }),
    ];

    const result = evaluateRound(players);
    expect(result.rankedPlayers.map((r) => r.player.uid)).toEqual([
      'alpha',
      'beta',
      'zeta',
    ]);
    expect(result.byUid.alpha.lockedRank).toBe(1);
    expect(result.byUid.beta.lockedRank).toBe(2);
    expect(result.byUid.zeta.lockedRank).toBe(3);
  });

  it('bruker lockedClientAt som fallback mens serverTimestamp venter', () => {
    const players: PlayerDoc[] = [
      makePlayer({
        uid: 'p1',
        card: makeCard('a', 10),
        lockedAt: null,
        lockedClientAt: 2000,
      }),
      makePlayer({
        uid: 'p2',
        card: makeCard('b', 20),
        lockedAt: createMockTimestamp(1500),
        lockedClientAt: 9999,
      }),
    ];

    const result = evaluateRound(players);
    expect(result.lockedCount).toBe(2);
    expect(result.byUid.p2.lockedRank).toBe(1);
    expect(result.byUid.p1.lockedRank).toBe(2);
  });

  it('håndterer like answerValue på to kort som gyldige i begge tilsvarende posisjoner', () => {
    const players: PlayerDoc[] = [
      makePlayer({
        uid: 'p1',
        card: makeCard('a', 50),
        lockedAt: createMockTimestamp(2000),
      }),
      makePlayer({
        uid: 'p2',
        card: makeCard('b', 50),
        lockedAt: createMockTimestamp(1000),
      }),
    ];

    const result = evaluateRound(players);
    expect(result.correctCount).toBe(2);
    expect(result.byUid.p1.isCorrect).toBe(true);
    expect(result.byUid.p2.isCorrect).toBe(true);
  });
});

describe('mockRounds og buildCardsForPlayerCount', () => {
  it('sykler uendelig gjennom MOCK_ROUNDS via getRoundByNumber', () => {
    const count = MOCK_ROUNDS.length;
    expect(count).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < count; i += 1) {
      expect(getRoundByNumber(i + 1).id).toBe(MOCK_ROUNDS[i].id);
    }

    expect(getRoundByNumber(count + 1).id).toBe(MOCK_ROUNDS[0].id);
    expect(getRoundByNumber(count + 2).id).toBe(MOCK_ROUNDS[1].id);
  });

  it('genererer nøyaktig antall kort for 2 til 10 spillere', () => {
    const round = MOCK_ROUNDS[0];
    expect(buildCardsForPlayerCount(round, 2)).toHaveLength(2);
    expect(buildCardsForPlayerCount(round, 6)).toHaveLength(6);
    expect(buildCardsForPlayerCount(round, 10)).toHaveLength(10);
  });

  it('genererer unike ekstra plassholderkort når playerCount > 10 (inkludert > 26)', () => {
    const round = MOCK_ROUNDS[0];
    const cards30 = buildCardsForPlayerCount(round, 30);

    expect(cards30).toHaveLength(30);
    expect(cards30[10].label).toBe('Kort K');
    expect(cards30[25].label).toBe('Kort Z');
    expect(cards30[26].label).toBe('Kort #27');

    const uniqueIds = new Set(cards30.map((c) => c.id));
    const uniqueValues = new Set(cards30.map((c) => c.answerValue));
    const uniqueLabels = new Set(cards30.map((c) => c.label));

    expect(uniqueIds.size).toBe(30);
    expect(uniqueValues.size).toBe(30);
    expect(uniqueLabels.size).toBe(30);
  });
});

describe('shuffleArray og generateRoomCode', () => {
  it('stokker uten å mutere input og bevarer alle elementer', () => {
    const original = [1, 2, 3, 4, 5];
    let seed = 0.2;
    const deterministicRng = () => {
      seed = (seed + 0.37) % 1;
      return seed;
    };

    const shuffled = shuffleArray(original, deterministicRng);

    expect(original).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled).not.toBe(original);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });

  it('genererer romkoder med riktig lengde og uten forvekslbare tegn (0, O, 1, I)', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-Z2-9]+$/);
      expect(code).not.toMatch(/[0O1I]/);
    }

    expect(generateRoomCode(8)).toHaveLength(8);
  });
});
