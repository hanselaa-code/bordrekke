import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import { MOCK_ROUNDS } from '../data/mockRounds';
import { evaluateRound } from '../engine/ranking';
import type { UseRoomResult } from '../hooks/useRoom';
import type { AssignedCard, PlayerDoc, RoomDoc, RoomStatus } from '../types/game';

const mockUseRoom = vi.fn<() => UseRoomResult>();

vi.mock('../hooks/useRoom', () => ({
  useRoom: () => mockUseRoom(),
}));

vi.mock('../firebase/auth', () => ({
  ensureAnonymousUser: vi.fn(),
}));

vi.mock('../engine/roomService', () => ({
  joinRoomAsPlayer: vi.fn(),
  lockPlayerPosition: vi.fn(),
  unlockPlayerPosition: vi.fn(),
  resetAllLocks: vi.fn(),
  returnToLobby: vi.fn(),
  revealAnswers: vi.fn(),
  startRound: vi.fn(),
}));

import { HostView } from './HostView';
import { PlayerView } from './PlayerView';

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

function buildRoomState(
  status: RoomStatus,
  cards: AssignedCard[],
  options: { title?: string; direction?: string; locked?: boolean } = {},
): UseRoomResult {
  const players: PlayerDoc[] = cards.map((card, index) => ({
    uid: `player-${index + 1}`,
    joinedAt: createMockTimestamp(1000 + index * 100),
    connected: true,
    card,
    lockedAt: options.locked ? createMockTimestamp(2000 + index * 100) : null,
    lockedClientAt: null,
  }));

  const room: RoomDoc = {
    id: 'ABC234',
    hostUid: 'host-1',
    status,
    gameMode: 'coop',
    teams: [],
    activeTeamIndex: 0,
    lastScoredRound: 0,
    roundNumber: 1,
    activeRoundId: 'historical-events-1',
    activeRoundTitle: options.title ?? 'Historiske begivenheter',
    activeRoundDirection: options.direction ?? 'Eldst → Nyest',
    createdAt: createMockTimestamp(500),
    updatedAt: createMockTimestamp(1500),
  };

  return {
    room,
    players,
    evaluation: evaluateRound(players),
    teamEvaluations: {},
    loading: false,
    error: null,
  };
}

function renderPlayer(initialPlayerUid: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/play/ABC234']}>
      <Routes>
        <Route
          path="/play/:roomId"
          element={<PlayerView initialPlayerUid={initialPlayerUid} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderHost(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/host/ABC234']}>
      <Routes>
        <Route path="/host/:roomId" element={<HostView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CardViews SSR rendering (PlayerView & HostView)', () => {
  const moonCard = MOCK_ROUNDS[0].cards[8]; // Månelandingen (1969)
  const berlinCard = MOCK_ROUNDS[0].cards[9]; // Berlinmurens fall (1989)
  const placeholderCard: AssignedCard = {
    id: 'test-placeholder-a',
    label: 'Kort A',
    subtitle: 'Plassholderkort uten bilde',
    answerValue: 10,
    answerDisplay: 'Verdi: 10',
  };

  it('PlayerView (playing, bildekort): viser bilde og kort overleggstekst, men INGEN årstall', () => {
    mockUseRoom.mockReturnValue(buildRoomState('playing', [moonCard, berlinCard]));

    const html = renderPlayer('player-1');

    expect(html).toContain('player-card-big--image');
    expect(html).toContain('<img');
    expect(html).toContain(`src="${moonCard.imageUrl}"`);
    expect(html).toContain(moonCard.label);
    expect(html).toContain(moonCard.subtitle);
    expect(html).not.toContain(moonCard.answerDisplay);
    expect(html).not.toContain(String(moonCard.answerValue));
  });

  it('PlayerView (playing, plassholderkort uten bilde): rendrer tekstkort uten <img>', () => {
    mockUseRoom.mockReturnValue(
      buildRoomState('playing', [placeholderCard], {
        title: 'Plassholder-runde 1',
        direction: 'Lavest → Høyest',
      }),
    );

    const html = renderPlayer('player-1');

    expect(html).toContain('player-card-big');
    expect(html).not.toContain('player-card-big--image');
    expect(html).not.toContain('<img');
    expect(html).toContain(placeholderCard.label);
    expect(html).not.toContain(placeholderCard.answerDisplay);
  });

  it('PlayerView (revealed, bildekort): viser fasit oppå kortet for Plass 1 og venter for Plass 2', () => {
    mockUseRoom.mockReturnValue(
      buildRoomState('revealed', [moonCard, berlinCard], { locked: true }),
    );

    const htmlFirst = renderPlayer('player-1');
    expect(htmlFirst).toContain('reveal-card-thumb');
    expect(htmlFirst).toContain('reveal-card-answer-overlay');
    expect(htmlFirst).toContain(`src="${moonCard.imageUrl}"`);
    expect(htmlFirst).toContain(moonCard.label);
    expect(htmlFirst).toContain(moonCard.answerDisplay);

    const htmlSecond = renderPlayer('player-2');
    expect(htmlSecond).toContain('player-reveal-screen--pending');
    expect(htmlSecond).toContain('Plass #2 · Vent…');
    expect(htmlSecond).not.toContain(berlinCard.answerDisplay);
  });

  it('HostView (playing, bildekort): skjuler korttitler og bilder på storskjerm så lag ikke ser hverandres kort', () => {
    mockUseRoom.mockReturnValue(buildRoomState('playing', [moonCard, berlinCard]));

    const html = renderHost();

    expect(html).not.toContain('slot-thumb');
    expect(html).not.toContain(moonCard.label);
    expect(html).not.toContain(berlinCard.label);
    expect(html).toContain('Eldst → Nyest');
    expect(html).toContain('Status på låsing');
    expect(html).not.toContain(moonCard.answerDisplay);
    expect(html).not.toContain(berlinCard.answerDisplay);
  });

  it('HostView (revealed, bildekort): avslører fasit ett og ett svar (#1 først, #2 skjult til neste sekund)', () => {
    mockUseRoom.mockReturnValue(
      buildRoomState('revealed', [moonCard, berlinCard], { locked: true }),
    );

    const html = renderHost();

    expect(html).toContain('slot-thumb');
    expect(html).toContain(`src="${moonCard.imageUrl}"`);
    expect(html).toContain(moonCard.label);
    expect(html).toContain(moonCard.answerDisplay);
    expect(html).toContain('Avsløres snart…');
    expect(html).not.toContain(berlinCard.label);
    expect(html).not.toContain(berlinCard.answerDisplay);
  });

  it('HostView (revealed, lagmodus): viser fasit først med «Vis leaderboard»-knapp i bunn (skjuler poengtavle til den trykkes)', () => {
    const teamState = buildRoomState('revealed', [moonCard, berlinCard], { locked: true });
    teamState.room!.gameMode = 'teams-simultaneous';
    teamState.room!.teams = [
      { id: 'team-1', name: 'Lag Blå', color: '#2563EB', score: 4 },
      { id: 'team-2', name: 'Lag Rød', color: '#DC2626', score: 2 },
    ];
    mockUseRoom.mockReturnValue(teamState);

    const html = renderHost();

    expect(html).toContain('Riktig fasit-rekkefølge');
    expect(html).toContain('Vis leaderboard');
    expect(html).not.toContain('Lag Blå');
    expect(html).not.toContain('Lag Rød');
  });
});
