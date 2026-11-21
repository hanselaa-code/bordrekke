import { describe, expect, it } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import type { AssignedCard, PlayerDoc, RoomDoc } from '../types/game';
import { buildDefaultTeams, computeUpdatedTeamScores, evaluateByTeam } from './teams';

function ts(ms: number): Timestamp {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    toMillis: () => ms,
    toDate: () => new Date(ms),
    isEqual: (other: Timestamp) => other.toMillis() === ms,
    valueOf: () => String(ms),
    toJSON: () => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0, type: 'timestamp' }),
  } as Timestamp;
}

function card(id: string, val: number): AssignedCard {
  return { id, label: id, subtitle: '', answerValue: val, answerDisplay: String(val) };
}

function makePlayer(uid: string, teamId: string | null, answerVal: number, lockedMs: number): PlayerDoc {
  return {
    uid,
    teamId,
    joinedAt: ts(100),
    connected: true,
    card: card(`c-${answerVal}`, answerVal),
    lockedAt: ts(lockedMs),
    lockedClientAt: null,
  };
}

describe('Lagmodus og poenggiving (1 poeng per riktig plassert kort)', () => {
  it('bygger standardlag og bevarer egne lagnavn og poeng ved endring av antall', () => {
    const initial = buildDefaultTeams(2);
    expect(initial).toHaveLength(2);
    expect(initial[0].name).toBe('Lag 1');

    const customized = [
      { ...initial[0], name: 'Røde Ulver', score: 7 },
      { ...initial[1], name: 'Blå Ørner', score: 4 },
    ];
    const expanded = buildDefaultTeams(3, customized);
    expect(expanded).toHaveLength(3);
    expect(expanded[0].name).toBe('Røde Ulver');
    expect(expanded[0].score).toBe(7);
    expect(expanded[2].name).toBe('Lag 3');
    expect(expanded[2].score).toBe(0);
  });

  it('gir nøyaktig 1 poeng per grønt kort per lag i samtidig lagmodus (f.eks. 3 grønne + 2 røde = 3 poeng)', () => {
    const teams = buildDefaultTeams(2);
    const players: PlayerDoc[] = [
      // Lag 1: 5 kort (10, 20, 30, 40, 50) -> låser 10, 20, 30, 50, 40 => 3 riktige, 2 feil = 3 poeng
      makePlayer('t1-1', 'team-1', 10, 1000),
      makePlayer('t1-2', 'team-1', 20, 2000),
      makePlayer('t1-3', 'team-1', 30, 3000),
      makePlayer('t1-4', 'team-1', 50, 4000),
      makePlayer('t1-5', 'team-1', 40, 5000),
      // Lag 2: 3 kort (10, 20, 30) -> låser 10, 20, 30 => 3 riktige = 3 poeng
      makePlayer('t2-1', 'team-2', 10, 1100),
      makePlayer('t2-2', 'team-2', 20, 2100),
      makePlayer('t2-3', 'team-2', 30, 3100),
    ];

    const byTeam = evaluateByTeam(teams, players);
    expect(byTeam['team-1'].correctCount).toBe(3);
    expect(byTeam['team-2'].correctCount).toBe(3);

    const room: RoomDoc = {
      id: 'TEAM01',
      hostUid: 'host',
      status: 'playing',
      gameMode: 'teams-simultaneous',
      teams,
      activeTeamIndex: 0,
      lastScoredRound: 0,
      roundNumber: 1,
      activeRoundId: 'r1',
      activeRoundTitle: 'Test',
      activeRoundDirection: 'Lavest → Høyest',
      createdAt: ts(1),
      updatedAt: ts(2),
    };

    const first = computeUpdatedTeamScores(room, players);
    expect(first.roundPointsByTeamId['team-1']).toBe(3);
    expect(first.roundPointsByTeamId['team-2']).toBe(3);
    expect(first.teams[0].score).toBe(3);
    expect(first.teams[1].score).toBe(3);

    // Idempotens: dobbeltkall for samme runde skal ikke gi doble poeng
    const second = computeUpdatedTeamScores(
      { ...room, teams: first.teams, lastScoredRound: 1 },
      players,
    );
    expect(second.teams[0].score).toBe(3);
    expect(second.teams[1].score).toBe(3);
  });

  it('gir poeng kun til laget som har turen i rullerende lagmodus (teams-turn)', () => {
    const teams = buildDefaultTeams(2);
    const players: PlayerDoc[] = [
      makePlayer('p1', null, 10, 1000),
      makePlayer('p2', null, 20, 2000),
      makePlayer('p3', null, 40, 3000),
      makePlayer('p4', null, 30, 4000),
    ]; // 2 riktige, 2 feil => +2 poeng til aktivt lag (Lag 2, index 1)

    const room: RoomDoc = {
      id: 'TURN01',
      hostUid: 'host',
      status: 'playing',
      gameMode: 'teams-turn',
      teams,
      activeTeamIndex: 1,
      lastScoredRound: 0,
      roundNumber: 1,
      activeRoundId: 'r1',
      activeRoundTitle: 'Test',
      activeRoundDirection: 'Lavest → Høyest',
      createdAt: ts(1),
      updatedAt: ts(2),
    };

    const res = computeUpdatedTeamScores(room, players);
    expect(res.teams[0].score).toBe(0);
    expect(res.teams[1].score).toBe(2);
  });
});
