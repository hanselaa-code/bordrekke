import type { Timestamp } from 'firebase/firestore';

export type RoomStatus = 'lobby' | 'playing' | 'revealed';

/**
 * Kort som deles ut til én tilkoblet mobilskjerm per runde.
 * Kan inneholde bilde (for bildebaserte runder) eller kun tekst (for plassholder-runder).
 */
export interface AssignedCard {
  id: string;
  label: string;
  subtitle: string;
  /** Relativ bilde-URL (f.eks. './images/events/slug.webp') for bildekort. */
  imageUrl?: string;
  /** Beskrivende alternativ tekst på norsk uten årstall. */
  imageAlt?: string;
  /** Numerisk fasit-verdi som brukes for å beregne riktig sortering (lavest til høyest). */
  answerValue: number;
  /** Lesbar fasit-tekst som vises når verten avslører fasit. */
  answerDisplay: string;
}

/**
 * Spillrunde som inneholder tittel, sorteringsretning og kortsett.
 */
export interface MockRound {
  id: string;
  title: string;
  directionLabel: string;
  cards: AssignedCard[];
}

/**
 * Firestore-dokument: rooms/{roomId}
 */
export interface RoomDoc {
  id: string;
  hostUid: string;
  status: RoomStatus;
  roundNumber: number;
  activeRoundId: string | null;
  activeRoundTitle: string | null;
  activeRoundDirection: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * Firestore-dokument: rooms/{roomId}/players/{playerUid}
 */
export interface PlayerDoc {
  uid: string;
  joinedAt: Timestamp | null;
  connected: boolean;
  card: AssignedCard | null;
  /** Satt av Firestore serverTimestamp() når spilleren trykker «Lås min plass». */
  lockedAt: Timestamp | null;
  /** Lokal klient-fallback (Date.now()) kun mens serverTimestamp venter på bekreftelse. */
  lockedClientAt: number | null;
}

/**
 * Evaluert spillerstatus for sanntidsvisning og fasit-avsløring.
 */
export interface RankedPlayer {
  player: PlayerDoc;
  /** 1-basert plassering basert på rekkefølgen spillerne trykket seg inn i, eller null hvis ikke låst. */
  lockedRank: number | null;
  /** 1-basert riktig plassering i fasit-rekkefølgen blant de utdelte kortene, eller null hvis intet kort. */
  correctRank: number | null;
  /** true hvis spillerens låste plassering stemmer med fasit-rekkefølgen, false hvis feil, null hvis ikke låst/intet kort. */
  isCorrect: boolean | null;
}

export interface RoundEvaluation {
  totalPlayers: number;
  lockedCount: number;
  allLocked: boolean;
  correctCount: number;
  /** Spillere sortert etter låst rekkefølge (låste først, deretter ulåste etter joinedAt). */
  rankedPlayers: RankedPlayer[];
  /** Spillere med kort sortert etter fasit (lavest answerValue til høyest). */
  correctOrder: RankedPlayer[];
  /** Oppslag per spiller-UID for rask O(1)-tilgang i Mobil-visning. */
  byUid: Record<string, RankedPlayer>;
}
