/// <reference types="node" />
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import { evaluateRound } from '../engine/ranking';
import type { PlayerDoc } from '../types/game';
import { MOCK_ROUNDS, ROUND_CATEGORIES, getRoundByNumber } from './mockRounds';

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

describe('Dødeligste sykdommer i historien (MOCK_ROUNDS[6])', () => {
  const diseasesRound = MOCK_ROUNDS[6];

  it('ligger som runde 7 med 10 bakterie-/virussykdommer og retning Færrest → Flest', () => {
    expect(diseasesRound.id).toBe('deadliest-diseases-1');
    expect(diseasesRound.title).toBe('Dødeligste sykdommer i historien');
    expect(diseasesRound.directionLabel).toBe('Færrest → Flest');
    expect(diseasesRound.cards).toHaveLength(10);
  });

  it('har strengt stigende, unike dødstall og lekkasjesikrede felt uten sifre', () => {
    const deaths = diseasesRound.cards.map((card) => card.answerValue);
    expect(new Set(deaths).size).toBe(10);
    expect(new Set(diseasesRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of diseasesRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.subtitle).toMatch(/^(Virus|Bakterie)/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/diseases\/[a-z-]+\.svg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme SVG-illustrasjoner under public/images/diseases/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of diseasesRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(500);
    }
  });
});

describe('Matvarer og holdbarhet (MOCK_ROUNDS[7])', () => {
  const foodRound = MOCK_ROUNDS[7];

  it('ligger som runde 8 med 10 matvarer og retning Kortest → Lengst', () => {
    expect(foodRound.id).toBe('food-shelf-life-1');
    expect(foodRound.title).toBe('Matvarer og holdbarhet');
    expect(foodRound.directionLabel).toBe('Kortest → Lengst');
    expect(foodRound.cards).toHaveLength(10);
  });

  it('har unike holdbarhetsverdier og lekkasjesikrede felt uten sifre', () => {
    const values = foodRound.cards.map((card) => card.answerValue);
    expect(new Set(values).size).toBe(10);
    expect(new Set(foodRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of foodRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/food\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/food/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of foodRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Høyest mulig levealder (MOCK_ROUNDS[8])', () => {
  const organismRound = MOCK_ROUNDS[8];

  it('ligger som runde 9 med 10 organismer inkludert menneske og retning Kortest → Lengst', () => {
    expect(organismRound.id).toBe('organism-lifespan-1');
    expect(organismRound.title).toBe('Høyest mulig levealder');
    expect(organismRound.directionLabel).toBe('Kortest → Lengst');
    expect(organismRound.cards).toHaveLength(10);
    expect(organismRound.cards.some((card) => card.label === 'Menneske')).toBe(true);
  });

  it('har unike levealdre og lekkasjesikrede felt uten sifre', () => {
    const values = organismRound.cards.map((card) => card.answerValue);
    expect(new Set(values).size).toBe(10);
    expect(new Set(organismRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of organismRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/organisms\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/organisms/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of organismRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Kalorier per 100 g matvare (MOCK_ROUNDS[9])', () => {
  const caloriesRound = MOCK_ROUNDS[9];

  it('ligger som runde 10 med 10 matvarer og retning Færrest → Flest', () => {
    expect(caloriesRound.id).toBe('food-calories-1');
    expect(caloriesRound.title).toBe('Kalorier per 100 g matvare');
    expect(caloriesRound.directionLabel).toBe('Færrest → Flest');
    expect(caloriesRound.cards).toHaveLength(10);
  });

  it('har unike kcal-verdier og lekkasjesikrede felt uten sifre', () => {
    const values = caloriesRound.cards.map((card) => card.answerValue);
    expect(new Set(values).size).toBe(10);
    expect(new Set(caloriesRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of caloriesRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.answerDisplay).toBe(`${card.answerValue} kcal`);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/calories\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/calories/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of caloriesRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Flest OL-gull (MOCK_ROUNDS[10])', () => {
  const olympicRound = MOCK_ROUNDS[10];

  it('ligger som runde 11 med 10 utøvere og retning Færrest → Flest', () => {
    expect(olympicRound.id).toBe('olympic-golds-1');
    expect(olympicRound.title).toBe('Flest OL-gull (sommer og vinter)');
    expect(olympicRound.directionLabel).toBe('Færrest → Flest');
    expect(olympicRound.cards).toHaveLength(10);
  });

  it('har unike antall OL-gull og lekkasjesikrede felt uten sifre', () => {
    const golds = olympicRound.cards.map((card) => card.answerValue);
    expect(new Set(golds).size).toBe(10);
    expect(new Set(olympicRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of olympicRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.answerDisplay).toBe(`${card.answerValue} OL-gull`);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/olympians\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/olympians/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of olympicRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Mest solgte album gjennom tidene (MOCK_ROUNDS[11])', () => {
  const albumsRound = MOCK_ROUNDS[11];

  it('ligger som runde 12 med 10 album og retning Færrest → Flest', () => {
    expect(albumsRound.id).toBe('best-selling-albums-1');
    expect(albumsRound.title).toBe('Mest solgte album gjennom tidene');
    expect(albumsRound.directionLabel).toBe('Færrest → Flest');
    expect(albumsRound.cards).toHaveLength(10);
  });

  it('har unike salgstall og lekkasjesikrede felt uten sifre', () => {
    const sales = albumsRound.cards.map((card) => card.answerValue);
    expect(new Set(sales).size).toBe(10);
    expect(new Set(albumsRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of albumsRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.answerDisplay).toBe(`ca. ${card.answerValue} mill.`);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/albums\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/albums/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of albumsRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('getRoundByNumber med valgte spørsmål', () => {
  it('sykler kun gjennom de avhukede rundene i rekkefølge', () => {
    const selected = ['celebrity-ages-1', 'olympic-golds-1'];
    expect(getRoundByNumber(1, selected).id).toBe('celebrity-ages-1');
    expect(getRoundByNumber(2, selected).id).toBe('olympic-golds-1');
    expect(getRoundByNumber(3, selected).id).toBe('celebrity-ages-1');
  });
});

describe('Flest mål på det norske landslaget (MOCK_ROUNDS[12])', () => {
  const norwayRound = MOCK_ROUNDS[12];

  it('ligger som runde 13 med 10 spillere og retning Færrest → Flest', () => {
    expect(norwayRound.id).toBe('norway-top-scorers-1');
    expect(norwayRound.title).toBe('Flest mål på det norske landslaget');
    expect(norwayRound.directionLabel).toBe('Færrest → Flest');
    expect(norwayRound.cards).toHaveLength(10);
  });

  it('har unike måltall og lekkasjesikrede felt uten sifre', () => {
    const goals = norwayRound.cards.map((card) => card.answerValue);
    expect(new Set(goals).size).toBe(10);
    expect(new Set(norwayRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of norwayRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.answerDisplay).toBe(`${card.answerValue} mål`);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/landslaget\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/landslaget/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of norwayRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Beste åpningsweekend på kino (MOCK_ROUNDS[13])', () => {
  const movieRound = MOCK_ROUNDS[13];

  it('ligger som runde 14 i kategorien Film med 10 filmer og retning Lavest → Høyest', () => {
    expect(movieRound.id).toBe('movie-opening-weekend-1');
    expect(movieRound.category).toBe('Film');
    expect(movieRound.title).toBe('Beste åpningsweekend på kino (2010–2026)');
    expect(movieRound.directionLabel).toBe('Lavest → Høyest');
    expect(movieRound.cards).toHaveLength(10);
  });

  it('har unike åpningshelg-tall og lekkasjesikrede felt uten sifre', () => {
    const totals = movieRound.cards.map((card) => card.answerValue);
    expect(new Set(totals).size).toBe(10);
    expect(new Set(movieRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of movieRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.answerDisplay).toContain('mill.');
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/movies\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/movies/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of movieRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Norske julekalendere på TV (MOCK_ROUNDS[14])', () => {
  const juleRound = MOCK_ROUNDS[14];

  it('ligger som runde 15 i kategorien Film med 10 julekalendere og retning Eldst → Nyest', () => {
    expect(juleRound.id).toBe('norwegian-advent-calendars-1');
    expect(juleRound.category).toBe('Film');
    expect(juleRound.title).toBe('Norske julekalendere på TV');
    expect(juleRound.directionLabel).toBe('Eldst → Nyest');
    expect(juleRound.cards).toHaveLength(10);
  });

  it('har unike årstall og lekkasjesikrede felt uten sifre', () => {
    const years = juleRound.cards.map((card) => card.answerValue);
    expect(new Set(years).size).toBe(10);
    expect(new Set(juleRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of juleRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThanOrEqual(1970);
      expect(card.answerDisplay).toBe(String(card.answerValue));
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/julekalendere\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/julekalendere/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of juleRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Flest avspillinger på Spotify i 2025 (MOCK_ROUNDS[15])', () => {
  const spotifyRound = MOCK_ROUNDS[15];

  it('ligger som runde 16 i kategorien Musikk med 10 artister/band og retning Færrest → Flest', () => {
    expect(spotifyRound.id).toBe('spotify-most-streamed-2025');
    expect(spotifyRound.category).toBe('Musikk');
    expect(spotifyRound.title).toBe('Flest avspillinger på Spotify i 2025');
    expect(spotifyRound.directionLabel).toBe('Færrest → Flest');
    expect(spotifyRound.cards).toHaveLength(10);
  });

  it('har unike rangeringer og lekkasjesikrede felt uten sifre', () => {
    const ranks = spotifyRound.cards.map((card) => card.answerValue);
    expect(new Set(ranks).size).toBe(10);
    expect(new Set(spotifyRound.cards.map((card) => card.id)).size).toBe(10);

    for (const card of spotifyRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThanOrEqual(1);
      expect(card.answerValue).toBeLessThanOrEqual(10);
      expect(card.answerDisplay).toContain('-plass');
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/spotify\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/spotify/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of spotifyRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Vekt på dyr (MOCK_ROUNDS[16])', () => {
  const animalRound = MOCK_ROUNDS[16];

  it('ligger som runde 17 i kategorien Lett blanding med 10 dyr og retning Lavest → Høyest', () => {
    expect(animalRound.id).toBe('animal-weights-1');
    expect(animalRound.category).toBe('Lett blanding');
    expect(animalRound.title).toBe('Vekt på dyr');
    expect(animalRound.directionLabel).toBe('Lavest → Høyest');
    expect(animalRound.cards).toHaveLength(10);
  });

  it('har strengt stigende, unike vekter og lekkasjesikrede felt uten sifre', () => {
    const weights = animalRound.cards.map((card) => card.answerValue);
    expect(new Set(weights).size).toBe(10);
    expect(new Set(animalRound.cards.map((card) => card.id)).size).toBe(10);

    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeGreaterThan(weights[i - 1]);
    }

    for (const card of animalRound.cards) {
      expect(Number.isInteger(card.answerValue)).toBe(true);
      expect(card.answerValue).toBeGreaterThan(0);
      expect(card.label).not.toMatch(/\d/);
      expect(card.subtitle).not.toMatch(/\d/);
      expect(card.imageAlt).not.toMatch(/\d/);
      expect(card.imageUrl).toMatch(/^\.\/images\/animals\/[a-z-]+\.jpg$/);
    }
  });

  it('peker til eksisterende, ikke-tomme bildefiler under public/images/animals/', () => {
    const publicDir = resolve(process.cwd(), 'public');

    for (const card of animalRound.cards) {
      const relativeAssetPath = (card.imageUrl ?? '').replace(/^\.\//, '');
      const fullPath = resolve(publicDir, relativeAssetPath);
      const stats = statSync(fullPath);

      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });
});

describe('Kategorier (ROUND_CATEGORIES)', () => {
  it('har alle 8 kategorier og hver runde tilhører en gyldig kategori', () => {
    expect(ROUND_CATEGORIES).toEqual([
      'Mat',
      'Sport',
      'Musikk',
      'Film',
      'Vitenskap',
      'Geografi',
      'Historie',
      'Lett blanding',
    ]);

    for (const round of MOCK_ROUNDS) {
      expect(ROUND_CATEGORIES).toContain(round.category);
    }
  });
});
