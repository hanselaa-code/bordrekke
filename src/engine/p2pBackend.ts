import Peer, { type DataConnection } from 'peerjs';
import type { Timestamp } from 'firebase/firestore';
import { buildCardsForPlayerCount, getRoundByNumber } from '../data/mockRounds';
import type { AssignedCard, PlayerDoc, RoomDoc, RoomStatus } from '../types/game';
import { generateRoomCode, shuffleArray } from './ranking';

const PEER_PREFIX = 'bordrekke-host-';
const SESSION_UID_KEY = 'bordrekke_p2p_uid';
const CONNECT_TIMEOUT_MS = 12_000;

const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

interface SerializedRoom {
  id: string;
  hostUid: string;
  status: RoomStatus;
  roundNumber: number;
  activeRoundId: string | null;
  activeRoundTitle: string | null;
  activeRoundDirection: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
}

interface SerializedPlayer {
  uid: string;
  joinedAtMs: number | null;
  connected: boolean;
  card: AssignedCard | null;
  lockedAtMs: number | null;
  lockedClientAt: number | null;
}

type ClientToHostMessage =
  | { type: 'JOIN'; playerUid: string }
  | { type: 'LOCK'; playerUid: string }
  | { type: 'UNLOCK'; playerUid: string };

type HostToClientMessage = {
  type: 'STATE';
  room: SerializedRoom;
  players: SerializedPlayer[];
};

export interface P2PRoomSnapshot {
  room: RoomDoc | null;
  players: PlayerDoc[];
  loading: boolean;
  error: string | null;
}

type SnapshotListener = (snapshot: P2PRoomSnapshot) => void;

function makeTimestamp(ms: number | null): Timestamp | null {
  if (ms === null) {
    return null;
  }
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

function serializeRoom(room: RoomDoc): SerializedRoom {
  return {
    id: room.id,
    hostUid: room.hostUid,
    status: room.status,
    roundNumber: room.roundNumber,
    activeRoundId: room.activeRoundId,
    activeRoundTitle: room.activeRoundTitle,
    activeRoundDirection: room.activeRoundDirection,
    createdAtMs: room.createdAt?.toMillis() ?? null,
    updatedAtMs: room.updatedAt?.toMillis() ?? null,
  };
}

function deserializeRoom(data: SerializedRoom): RoomDoc {
  return {
    id: data.id,
    hostUid: data.hostUid,
    status: data.status,
    roundNumber: data.roundNumber,
    activeRoundId: data.activeRoundId,
    activeRoundTitle: data.activeRoundTitle,
    activeRoundDirection: data.activeRoundDirection,
    createdAt: makeTimestamp(data.createdAtMs),
    updatedAt: makeTimestamp(data.updatedAtMs),
  };
}

function serializePlayer(player: PlayerDoc): SerializedPlayer {
  return {
    uid: player.uid,
    joinedAtMs: player.joinedAt?.toMillis() ?? null,
    connected: player.connected,
    card: player.card,
    lockedAtMs: player.lockedAt?.toMillis() ?? null,
    lockedClientAt: player.lockedClientAt,
  };
}

function deserializePlayer(data: SerializedPlayer): PlayerDoc {
  return {
    uid: data.uid,
    joinedAt: makeTimestamp(data.joinedAtMs),
    connected: data.connected,
    card: data.card,
    lockedAt: makeTimestamp(data.lockedAtMs),
    lockedClientAt: data.lockedClientAt,
  };
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

function generateLocalUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `p2p_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  }
  return `p2p_${Math.random().toString(36).slice(2, 14)}`;
}

let inMemoryUid: string | null = null;

/**
 * Returnerer en stabil anonym sesjons-ID per fane/enhet i P2P-modus.
 * Bruker sessionStorage slik at reload bevarer spilleren, mens to faner på samme PC får egne ID-er.
 */
export function getLocalAnonymousUid(): string {
  if (inMemoryUid) {
    return inMemoryUid;
  }
  try {
    const existing = window.sessionStorage.getItem(SESSION_UID_KEY);
    if (existing) {
      inMemoryUid = existing;
      return existing;
    }
    const created = generateLocalUid();
    window.sessionStorage.setItem(SESSION_UID_KEY, created);
    inMemoryUid = created;
    return created;
  } catch {
    inMemoryUid = generateLocalUid();
    return inMemoryUid;
  }
}

interface HostSession {
  roomId: string;
  peer: Peer;
  room: RoomDoc;
  players: Map<string, PlayerDoc>;
  connections: Map<string, DataConnection>;
  connToUid: Map<DataConnection, string>;
}

interface ClientSession {
  roomId: string;
  playerUid: string;
  peer: Peer;
  conn: DataConnection | null;
  room: RoomDoc | null;
  players: PlayerDoc[];
  loading: boolean;
  error: string | null;
  readyPromise: Promise<void>;
}

let activeHost: HostSession | null = null;
let activeClient: ClientSession | null = null;
const listenersByRoom = new Map<string, Set<SnapshotListener>>();

function notifyRoom(roomId: string, snapshot: P2PRoomSnapshot): void {
  const listeners = listenersByRoom.get(roomId);
  if (!listeners) {
    return;
  }
  listeners.forEach((listener) => listener(snapshot));
}

function broadcastHostState(host: HostSession): void {
  const playersList = Array.from(host.players.values());
  const message: HostToClientMessage = {
    type: 'STATE',
    room: serializeRoom(host.room),
    players: playersList.map(serializePlayer),
  };

  host.connections.forEach((conn) => {
    if (conn.open) {
      try {
        conn.send(message);
      } catch {
        // Ignorer lukket kanal; opprydding skjer på close-hendelsen.
      }
    }
  });

  notifyRoom(host.roomId, {
    room: host.room,
    players: playersList,
    loading: false,
    error: null,
  });
}

function handleClientMessage(host: HostSession, conn: DataConnection, raw: unknown): void {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) {
    return;
  }
  const msg = raw as ClientToHostMessage;
  const now = Date.now();

  if (msg.type === 'JOIN' && typeof msg.playerUid === 'string') {
    const uid = msg.playerUid.trim();
    if (!uid) {
      return;
    }
    host.connections.set(uid, conn);
    host.connToUid.set(conn, uid);

    const existing = host.players.get(uid);
    if (existing) {
      host.players.set(uid, { ...existing, connected: true });
    } else {
      host.players.set(uid, {
        uid,
        joinedAt: makeTimestamp(now),
        connected: true,
        card: null,
        lockedAt: null,
        lockedClientAt: null,
      });
    }
    broadcastHostState(host);
    return;
  }

  if (msg.type === 'LOCK' && typeof msg.playerUid === 'string') {
    if (host.room.status === 'revealed') {
      return;
    }
    const existing = host.players.get(msg.playerUid);
    if (!existing) {
      return;
    }
    host.players.set(msg.playerUid, {
      ...existing,
      lockedAt: makeTimestamp(now),
      lockedClientAt: now,
    });
    broadcastHostState(host);
    return;
  }

  if (msg.type === 'UNLOCK' && typeof msg.playerUid === 'string') {
    if (host.room.status === 'revealed') {
      return;
    }
    const existing = host.players.get(msg.playerUid);
    if (!existing) {
      return;
    }
    host.players.set(msg.playerUid, {
      ...existing,
      lockedAt: null,
      lockedClientAt: null,
    });
    broadcastHostState(host);
  }
}

function cleanupHost(): void {
  if (!activeHost) {
    return;
  }
  try {
    activeHost.peer.destroy();
  } catch {
    // Ignorer
  }
  activeHost = null;
}

function cleanupClient(): void {
  if (!activeClient) {
    return;
  }
  try {
    activeClient.conn?.close();
    activeClient.peer.destroy();
  } catch {
    // Ignorer
  }
  activeClient = null;
}

/**
 * Oppretter et nytt P2P-rom der denne nettleseren fungerer som autoritativ vert.
 */
export async function p2pCreateRoom(hostUid: string, requestedCode?: string): Promise<string> {
  cleanupClient();
  cleanupHost();

  const code = requestedCode ? normalizeRoomId(requestedCode) : generateRoomCode(6);
  const peerId = `${PEER_PREFIX}${code}`;

  return new Promise<string>((resolve, reject) => {
    const peer = new Peer(peerId, PEER_OPTIONS);
    let settled = false;

    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        peer.destroy();
        reject(new Error('Tidsavbrudd ved opprettelse av P2P-rom. Sjekk internettforbindelsen og prøv igjen.'));
      }
    }, CONNECT_TIMEOUT_MS);

    peer.on('open', () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);

      const now = Date.now();
      const host: HostSession = {
        roomId: code,
        peer,
        room: {
          id: code,
          hostUid,
          status: 'lobby',
          roundNumber: 0,
          activeRoundId: null,
          activeRoundTitle: null,
          activeRoundDirection: null,
          createdAt: makeTimestamp(now),
          updatedAt: makeTimestamp(now),
        },
        players: new Map(),
        connections: new Map(),
        connToUid: new Map(),
      };
      activeHost = host;

      peer.on('connection', (conn) => {
        conn.on('data', (data) => {
          handleClientMessage(host, conn, data);
        });
        conn.on('close', () => {
          const uid = host.connToUid.get(conn);
          host.connToUid.delete(conn);
          if (uid && host.connections.get(uid) === conn) {
            host.connections.delete(uid);
            const player = host.players.get(uid);
            if (player) {
              host.players.set(uid, { ...player, connected: false });
              broadcastHostState(host);
            }
          }
        });
      });

      broadcastHostState(host);
      resolve(code);
    });

    peer.on('error', (err) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        peer.destroy();
        reject(
          new Error(
            err instanceof Error && err.message
              ? `Kunne ikke starte P2P-rom: ${err.message}`
              : 'Kunne ikke starte P2P-rom. Prøv igjen.',
          ),
        );
      }
    });
  });
}

/**
 * Kobler en mobil/spiller direkte til verten for rommet via WebRTC DataChannel.
 */
export async function p2pJoinRoomAsPlayer(roomId: string, playerUid: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) {
    throw new Error('Skriv inn en gyldig romkode.');
  }

  if (
    activeClient &&
    activeClient.roomId === normalizedRoomId &&
    activeClient.playerUid === playerUid &&
    !activeClient.error
  ) {
    return activeClient.readyPromise;
  }

  cleanupClient();

  const targetPeerId = `${PEER_PREFIX}${normalizedRoomId}`;
  const peer = new Peer(PEER_OPTIONS);

  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const session: ClientSession = {
    roomId: normalizedRoomId,
    playerUid,
    peer,
    conn: null,
    room: null,
    players: [],
    loading: true,
    error: null,
    readyPromise,
  };
  activeClient = session;

  let settled = false;
  const fail = (message: string) => {
    session.loading = false;
    session.error = message;
    notifyRoom(normalizedRoomId, {
      room: session.room,
      players: session.players,
      loading: false,
      error: message,
    });
    if (!settled) {
      settled = true;
      rejectReady(new Error(message));
    }
  };

  const timeout = window.setTimeout(() => {
    if (!settled) {
      fail(
        `Fant ikke verten for rommet «${normalizedRoomId}». Sjekk romkoden og at Host-skjermen fortsatt er åpen.`,
      );
    }
  }, CONNECT_TIMEOUT_MS);

  peer.on('open', () => {
    const conn = peer.connect(targetPeerId, { reliable: true });
    session.conn = conn;

    conn.on('open', () => {
      const joinMsg: ClientToHostMessage = { type: 'JOIN', playerUid };
      conn.send(joinMsg);
    });

    conn.on('data', (raw) => {
      if (!raw || typeof raw !== 'object' || !('type' in raw)) {
        return;
      }
      const msg = raw as HostToClientMessage;
      if (msg.type === 'STATE') {
        session.room = deserializeRoom(msg.room);
        session.players = msg.players.map(deserializePlayer);
        session.loading = false;
        session.error = null;

        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolveReady();
        }

        notifyRoom(normalizedRoomId, {
          room: session.room,
          players: session.players,
          loading: false,
          error: null,
        });
      }
    });

    conn.on('close', () => {
      if (!settled) {
        window.clearTimeout(timeout);
        fail('Tilkoblingen til verten ble brutt.');
      } else {
        session.error = 'Tilkoblingen til verten ble brutt. Last siden på nytt for å koble til igjen.';
        notifyRoom(normalizedRoomId, {
          room: session.room,
          players: session.players,
          loading: false,
          error: session.error,
        });
      }
    });

    conn.on('error', () => {
      window.clearTimeout(timeout);
      fail(`Kunne ikke koble til rommet «${normalizedRoomId}».`);
    });
  });

  peer.on('error', (err) => {
    window.clearTimeout(timeout);
    const errType = (err as { type?: string } | null)?.type;
    if (errType === 'peer-unavailable') {
      fail(
        `Fant ikke rommet «${normalizedRoomId}». Sjekk at koden er riktig og at Host-skjermen er åpen.`,
      );
    } else {
      fail('Nettverksfeil ved tilkobling til rommet. Prøv igjen.');
    }
  });

  return readyPromise;
}

export async function p2pStartRound(
  roomId: string,
  hostUid: string,
  currentRoundNumber: number,
  players: readonly PlayerDoc[],
  selectedRoundIds?: readonly string[],
): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!activeHost || activeHost.roomId !== normalizedRoomId) {
    throw new Error('Du er ikke aktiv vert for dette rommet.');
  }
  if (players.length < 2) {
    throw new Error('Minst 2 spillere må være tilkoblet for å starte en runde.');
  }

  const nextRoundNumber = currentRoundNumber + 1;
  const round = getRoundByNumber(nextRoundNumber, selectedRoundIds);
  const roundForDeal =
    players.length <= round.cards.length
      ? { ...round, cards: shuffleArray(round.cards) }
      : round;
  const cards = shuffleArray(buildCardsForPlayerCount(roundForDeal, players.length));

  const now = Date.now();
  activeHost.room = {
    ...activeHost.room,
    hostUid,
    status: 'playing',
    roundNumber: nextRoundNumber,
    activeRoundId: round.id,
    activeRoundTitle: round.title,
    activeRoundDirection: round.directionLabel,
    updatedAt: makeTimestamp(now),
  };

  players.forEach((player, index) => {
    const existing = activeHost?.players.get(player.uid) ?? player;
    activeHost?.players.set(player.uid, {
      ...existing,
      card: cards[index],
      lockedAt: null,
      lockedClientAt: null,
    });
  });

  broadcastHostState(activeHost);
}

export async function p2pLockPlayerPosition(roomId: string, playerUid: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (activeHost && activeHost.roomId === normalizedRoomId) {
    if (activeHost.room.status === 'revealed') {
      return;
    }
    const existing = activeHost.players.get(playerUid);
    if (existing) {
      const now = Date.now();
      activeHost.players.set(playerUid, {
        ...existing,
        lockedAt: makeTimestamp(now),
        lockedClientAt: now,
      });
      broadcastHostState(activeHost);
    }
    return;
  }

  if (!activeClient || activeClient.roomId !== normalizedRoomId || !activeClient.conn?.open) {
    throw new Error('Ikke tilkoblet verten.');
  }
  const msg: ClientToHostMessage = { type: 'LOCK', playerUid };
  activeClient.conn.send(msg);
}

export async function p2pUnlockPlayerPosition(roomId: string, playerUid: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (activeHost && activeHost.roomId === normalizedRoomId) {
    if (activeHost.room.status === 'revealed') {
      return;
    }
    const existing = activeHost.players.get(playerUid);
    if (existing) {
      activeHost.players.set(playerUid, {
        ...existing,
        lockedAt: null,
        lockedClientAt: null,
      });
      broadcastHostState(activeHost);
    }
    return;
  }

  if (!activeClient || activeClient.roomId !== normalizedRoomId || !activeClient.conn?.open) {
    throw new Error('Ikke tilkoblet verten.');
  }
  const msg: ClientToHostMessage = { type: 'UNLOCK', playerUid };
  activeClient.conn.send(msg);
}

export async function p2pResetAllLocks(roomId: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!activeHost || activeHost.roomId !== normalizedRoomId) {
    throw new Error('Du er ikke aktiv vert for dette rommet.');
  }

  activeHost.players.forEach((player, uid) => {
    activeHost?.players.set(uid, {
      ...player,
      lockedAt: null,
      lockedClientAt: null,
    });
  });
  activeHost.room = {
    ...activeHost.room,
    updatedAt: makeTimestamp(Date.now()),
  };
  broadcastHostState(activeHost);
}

export async function p2pRevealAnswers(roomId: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!activeHost || activeHost.roomId !== normalizedRoomId) {
    throw new Error('Du er ikke aktiv vert for dette rommet.');
  }

  activeHost.room = {
    ...activeHost.room,
    status: 'revealed',
    updatedAt: makeTimestamp(Date.now()),
  };
  broadcastHostState(activeHost);
}

export async function p2pReturnToLobby(roomId: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!activeHost || activeHost.roomId !== normalizedRoomId) {
    throw new Error('Du er ikke aktiv vert for dette rommet.');
  }

  activeHost.room = {
    ...activeHost.room,
    status: 'lobby',
    activeRoundId: null,
    activeRoundTitle: null,
    activeRoundDirection: null,
    updatedAt: makeTimestamp(Date.now()),
  };
  activeHost.players.forEach((player, uid) => {
    activeHost?.players.set(uid, {
      ...player,
      card: null,
      lockedAt: null,
      lockedClientAt: null,
    });
  });
  broadcastHostState(activeHost);
}

export async function p2pResetGame(roomId: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!activeHost || activeHost.roomId !== normalizedRoomId) {
    throw new Error('Du er ikke aktiv vert for dette rommet.');
  }

  activeHost.room = {
    ...activeHost.room,
    status: 'lobby',
    roundNumber: 0,
    activeRoundId: null,
    activeRoundTitle: null,
    activeRoundDirection: null,
    updatedAt: makeTimestamp(Date.now()),
  };
  activeHost.players.forEach((player, uid) => {
    activeHost?.players.set(uid, {
      ...player,
      card: null,
      lockedAt: null,
      lockedClientAt: null,
    });
  });
  broadcastHostState(activeHost);
}

/**
 * Abonnerer på sanntidsendringer for et P2P-rom (fungerer både for Host og Mobil).
 */
export function subscribeP2PRoom(roomId: string, listener: SnapshotListener): () => void {
  const normalizedRoomId = normalizeRoomId(roomId);
  let listeners = listenersByRoom.get(normalizedRoomId);
  if (!listeners) {
    listeners = new Set();
    listenersByRoom.set(normalizedRoomId, listeners);
  }
  listeners.add(listener);

  // Send umiddelbart gjeldende status hvis allerede aktiv
  if (activeHost && activeHost.roomId === normalizedRoomId) {
    listener({
      room: activeHost.room,
      players: Array.from(activeHost.players.values()),
      loading: false,
      error: null,
    });
  } else if (activeClient && activeClient.roomId === normalizedRoomId) {
    listener({
      room: activeClient.room,
      players: activeClient.players,
      loading: activeClient.loading,
      error: activeClient.error,
    });
  } else {
    listener({
      room: null,
      players: [],
      loading: true,
      error: null,
    });
  }

  return () => {
    const current = listenersByRoom.get(normalizedRoomId);
    if (current) {
      current.delete(listener);
      if (current.size === 0) {
        listenersByRoom.delete(normalizedRoomId);
      }
    }
  };
}

/**
 * Sikrer at denne nettleseren er aktiv P2P-vert for rommet (f.eks. ved sidelasting av Host-visning).
 */
export async function ensureP2PHostRoom(roomId: string, hostUid: string): Promise<void> {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) {
    return;
  }
  if (activeHost && activeHost.roomId === normalizedRoomId) {
    return;
  }
  await p2pCreateRoom(hostUid, normalizedRoomId);
}

