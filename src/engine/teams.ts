import type { PlayerDoc, RoomDoc, RoundEvaluation, TeamConfig } from '../types/game';
import { evaluateRound } from './ranking';

export const TEAM_PALETTE: readonly string[] = [
  '#2563EB', // Blå
  '#EA580C', // Oransje
  '#16A34A', // Grønn
  '#7C3AED', // Lilla
  '#DB2777', // Rosa
  '#CA8A04', // Gul
];

export const MIN_TEAM_COUNT = 2;
export const MAX_TEAM_COUNT = 6;

/**
 * Bygger en liste med `count` lag (2–6) og bevarer eksisterende navn og poeng der ID matcher.
 */
export function buildDefaultTeams(
  count: number,
  existingTeams: readonly TeamConfig[] = [],
): TeamConfig[] {
  const safeCount = Math.min(MAX_TEAM_COUNT, Math.max(MIN_TEAM_COUNT, Math.floor(count)));
  const existingById = new Map(existingTeams.map((t) => [t.id, t]));

  return Array.from({ length: safeCount }, (_, index) => {
    const id = `team-${index + 1}`;
    const prev = existingById.get(id);
    return {
      id,
      name: prev?.name?.trim() ? prev.name : `Lag ${index + 1}`,
      color: prev?.color || TEAM_PALETTE[index % TEAM_PALETTE.length],
      score: typeof prev?.score === 'number' && Number.isFinite(prev.score) ? prev.score : 0,
    };
  });
}

/**
 * Evaluerer hvert lag uavhengig i samtidig lagmodus (`teams-simultaneous`).
 */
export function evaluateByTeam(
  teams: readonly TeamConfig[],
  players: readonly PlayerDoc[],
): Record<string, RoundEvaluation> {
  const result: Record<string, RoundEvaluation> = {};
  for (const team of teams) {
    const teamPlayers = players.filter((p) => p.teamId === team.id);
    result[team.id] = evaluateRound(teamPlayers);
  }
  return result;
}

/**
 * Beregner oppdaterte lagpoeng ved fasit-avsløring:
 * 1 poeng per riktig plassert kort (grønt kort).
 * Hvis `room.lastScoredRound >= room.roundNumber` returneres eksisterende lag uendret.
 */
export function computeUpdatedTeamScores(
  room: RoomDoc,
  players: readonly PlayerDoc[],
): { teams: TeamConfig[]; roundPointsByTeamId: Record<string, number> } {
  const roundPointsByTeamId: Record<string, number> = {};

  if (room.gameMode === 'coop' || room.teams.length === 0) {
    return { teams: room.teams, roundPointsByTeamId };
  }

  if (room.gameMode === 'teams-simultaneous') {
    const byTeam = evaluateByTeam(room.teams, players);
    for (const team of room.teams) {
      roundPointsByTeamId[team.id] = byTeam[team.id]?.correctCount ?? 0;
    }
  } else if (room.gameMode === 'teams-turn') {
    const activeTeam = room.teams[room.activeTeamIndex % room.teams.length];
    const evalAll = evaluateRound(players);
    for (const team of room.teams) {
      roundPointsByTeamId[team.id] = team.id === activeTeam?.id ? evalAll.correctCount : 0;
    }
  }

  if (room.lastScoredRound >= room.roundNumber) {
    return { teams: room.teams, roundPointsByTeamId };
  }

  const nextTeams = room.teams.map((team) => ({
    ...team,
    score: team.score + (roundPointsByTeamId[team.id] ?? 0),
  }));

  return { teams: nextTeams, roundPointsByTeamId };
}
