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

describe('Hits 1980–2000 (MOCK_ROUNDS[2])', () => {
  const hitsRound = MOCK_ROUNDS[2];

  it('ligger som runde 3 med 10 låter og retning Eldst → Nyest', () => {
    expect(hitsRound.id).toBe('music-hits-1980-2000');
    expect(hitsRound.title).toBe('Hits 1980–2000');
    expect(hitsRound.directionLabel).toBe('Eldst → Nyest');
    expect(hitsRound.cards).toHaveLength(10);
  });

  it('har unike utgivelsesår mellom 1980 og 2000 og lekkasjesikrede felt', () => {
    const years = hitsRound.cards.map((card) => card.answerValue);
    expect(new Set(years).size).toBe(10);
    expect(new Set(hitsRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of hitsRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThanOrEqual(1980);
      expect(card.answerValue).toBeLessThanOrEqual(2000);
      expect(card.answerDisplay).toBe(String(card.answerValue));
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/hits\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/hits/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of hitsRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Land etter størrelse (MOCK_ROUNDS[3])', () => {
  const countriesRound = MOCK_ROUNDS[3];

  it('ligger som runde 4 med 10 land og retning Minst → Størst', () => {
    expect(countriesRound.id).toBe('countries-by-area-1');
    expect(countriesRound.title).toBe('Land etter størrelse');
    expect(countriesRound.directionLabel).toBe('Minst → Størst');
    expect(countriesRound.cards).toHaveLength(10);
  });

  it('har unike arealer i km² og lekkasjesikrede felt uten sifre', () => {
    const areas = countriesRound.cards.map((card) => card.answerValue);
    expect(new Set(areas).size).toBe(10);
    expect(new Set(countriesRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of countriesRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerDisplay).toContain('km²');
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/countries\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/countries/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of countriesRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Sosiale medier i Norge (MOCK_ROUNDS[4])', () => {
  const socialRound = MOCK_ROUNDS[4];

  it('ligger som runde 5 med 10 plattformer og retning Minst → Mest', () => {
    expect(socialRound.id).toBe('social-media-norway-1');
    expect(socialRound.title).toBe('Sosiale medier i Norge (daglig bruk)');
    expect(socialRound.directionLabel).toBe('Minst → Mest');
    expect(socialRound.cards).toHaveLength(10);
  });

  it('har unike daglige brukerprosenter og lekkasjesikrede felt uten sifre', () => {
    const values = socialRound.cards.map((card) => card.answerValue);
    expect(new Set(values).size).toBe(10);
    expect(new Set(socialRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of socialRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerDisplay).toBe(`${card.answerValue} % daglig`);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/social\/[a-z-]+\.svg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme SVG-filer under public/images/social/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of socialRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(200);
    }
  });
});

describe('Norske slangord og uttrykk (MOCK_ROUNDS[5])', () => {
  const slangRound = MOCK_ROUNDS[5];

  it('ligger som runde 6 med 10 tekstkort uten bilde og retning Eldst → Nyest', () => {
    expect(slangRound.id).toBe('norwegian-slang-1');
    expect(slangRound.title).toBe('Norske slangord og uttrykk');
    expect(slangRound.directionLabel).toBe('Eldst → Nyest');
    expect(slangRound.cards).toHaveLength(10);
  });

  it('har unike årstall og kun uttrykket/ordet på kortet uten sifre', () => {
    const years = slangRound.cards.map((card) => card.answerValue);
    expect(new Set(years).size).toBe(10);
    expect(new Set(slangRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of slangRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerDisplay).toBe(String(card.answerValue));
      expect(card.imageUrl).toBeUndefined();
      expect(card.label.trim().length).toBeGreaterThan(0);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).toBe('');
    }
  });
});
