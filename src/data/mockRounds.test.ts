/// <reference types="node" />
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import { evaluateRound } from '../engine/ranking';
import type { PlayerDoc } from '../types/game';
import { MOCK_ROUNDS } from './mockRounds';

function createMockTimestamp(ms: number): Timestamp {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1_000_000,
    toMillis: () => ms,
    toDate: () => new Date(ms),
    isEqual: (other: Timestamp) => other.toMillis() === ms,
    valueOf: () => String(ms),
    toJSON: () => ({
      seconds: Math.floor(ms / 1000),
      nanoseconds: (ms % 1000) * 1_000_000,
      type: 'timestamp',
    }),
  } as Timestamp;
}

describe('Historiske begivenheter (MOCK_ROUNDS[0])', () => {
  const historicalRound = MOCK_ROUNDS[0];

  it('ligger først i MOCK_ROUNDS med 10 kort og kronologisk retning', () => {
    expect(historicalRound.id).toBe('historical-events-1');
    expect(historicalRound.title).toBe('Historiske begivenheter');
    expect(historicalRound.directionLabel).toBe('Eldst → Nyest');
    expect(historicalRound.cards).toHaveLength(10);
    expect(MOCK_ROUNDS.length).toBeGreaterThanOrEqual(4);
  });

  it('har unike heltallige årstall i answerValue og matchende answerDisplay', () => {
    const years = historicalRound.cards.map((card) => card.answerValue);
    const uniqueYears = new Set(years);
    const uniqueIds = new Set(historicalRound.cards.map((card) => card.id));

    expect(uniqueIds.size).toBe(10);
    expect(uniqueYears.size).toBe(10);

    for (const card of historicalRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerDisplay).toBe(String(card.answerValue));
    }
  });

  it('lekkasjesikrer alle synlige felt: ingen årstall eller sifre i label, subtitle, imageAlt eller imageUrl', () => {
    for (const card of historicalRound.cards) {
      expect(card.label.trim().length).toBeGreaterThan(0);
      expect(card.subtitle.trim().length).toBeGreaterThan(0);
      expect(card.imageUrl).toBeDefined();
      expect(card.imageAlt).toBeDefined();
      expect(card.imageAlt?.trim().length).toBeGreaterThan(0);

      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/events\/[a-z-]+\.webp$/);
    }
  });

  it('rangerer historiske begivenheter riktig kronologisk gjennom evaluateRound', () => {
    const sampleCards = [
      historicalRound.cards[8], // Månelandingen (1969)
      historicalRound.cards[0], // Slaget på Stiklestad (1030)
      historicalRound.cards[3], // Grunnloven på Eidsvoll (1814)
      historicalRound.cards[9], // Berlinmurens fall (1989)
    ];

    const players: PlayerDoc[] = [
      {
        uid: 'p-1030',
        joinedAt: createMockTimestamp(100),
        connected: true,
        card: sampleCards[1],
        lockedAt: createMockTimestamp(1000),
        lockedClientAt: null,
      },
      {
        uid: 'p-1814',
        joinedAt: createMockTimestamp(200),
        connected: true,
        card: sampleCards[2],
        lockedAt: createMockTimestamp(2000),
        lockedClientAt: null,
      },
      {
        uid: 'p-1969',
        joinedAt: createMockTimestamp(300),
        connected: true,
        card: sampleCards[0],
        lockedAt: createMockTimestamp(3000),
        lockedClientAt: null,
      },
      {
        uid: 'p-1989',
        joinedAt: createMockTimestamp(400),
        connected: true,
        card: sampleCards[3],
        lockedAt: createMockTimestamp(4000),
        lockedClientAt: null,
      },
    ];

    const evaluation = evaluateRound(players);
    expect(evaluation.correctCount).toBe(4);
    expect(evaluation.correctOrder.map((entry) => entry.player.card?.answerValue)).toEqual([
      1030, 1814, 1969, 1989,
    ]);
  });

  it('peker til eksisterende, ikke-tomme WebP-bildefiler under public/images/events/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of historicalRound.cards) {
      expect(card.imageUrl).toBeDefined();
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Kjendiser etter alder (MOCK_ROUNDS[1])', () => {
  const celebrityRound = MOCK_ROUNDS[1];

  it('ligger som runde 2 med 10 kjendiskort og retning Eldst → Yngst', () => {
    expect(celebrityRound.id).toBe('celebrity-ages-1');
    expect(celebrityRound.title).toBe('Kjendiser etter alder');
    expect(celebrityRound.directionLabel).toBe('Eldst → Yngst');
    expect(celebrityRound.cards).toHaveLength(10);
  });

  it('har unike fødselsår og lekkasjesikrede felt uten sifre i synlig tekst', () => {
    const years = celebrityRound.cards.map((card) => card.answerValue);
    expect(new Set(years).size).toBe(10);
    expect(new Set(celebrityRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of celebrityRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerDisplay).toBe(`Født ${card.answerValue}`);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/celebrities\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/celebrities/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of celebrityRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});
