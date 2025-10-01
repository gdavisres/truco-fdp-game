'use strict';

const {
  buildGameCompletionPayload,
  calculateGameStats,
  buildStandings,
  determineWinner,
} = require('../../src/modules/gameLogic/gameCompletion');

describe('game completion helpers', () => {
  it('calculates total rounds and tricks with positive duration', () => {
    const now = Date.now();
    const gameState = {
      startedAt: now - 60_000,
      endedAt: now,
      rounds: [
        { tricks: [{}, {}] },
        { tricks: [{}] },
      ],
    };

    const stats = calculateGameStats(gameState);

    expect(stats.duration).toBeGreaterThanOrEqual(60_000);
    expect(stats.totalRounds).toBe(2);
    expect(stats.totalTricks).toBe(3);
  });

  it('normalizes player records into sorted standings', () => {
    const players = [
      { playerId: 'carla', displayName: 'Carla', livesRemaining: 1 },
      { playerId: 'ana', displayName: 'Ana', livesRemaining: 3 },
      { playerId: 'bruno', displayName: 'Bruno', livesRemaining: 0 },
      { playerId: 'ana', displayName: 'Ana Duplicate', livesRemaining: 4 },
    ];

    const standings = buildStandings({ players, totalRounds: 5 });

    expect(standings).toEqual([
      {
        playerId: 'ana',
        displayName: 'Ana',
        livesRemaining: 3,
        totalRounds: 5,
      },
      {
        playerId: 'carla',
        displayName: 'Carla',
        livesRemaining: 1,
        totalRounds: 5,
      },
      {
        playerId: 'bruno',
        displayName: 'Bruno',
        livesRemaining: 0,
        totalRounds: 5,
      },
    ]);
  });

  it('selects winner only when exactly one player has lives remaining', () => {
    const standings = [
      { playerId: 'ana', livesRemaining: 2 },
      { playerId: 'bruno', livesRemaining: 0 },
    ];

    expect(determineWinner(standings, 'normal')).toBe('ana');
    expect(determineWinner(standings, 'timeout')).toBeNull();
  });

  it('builds completion payload with stats, standings, and reason', () => {
    const now = Date.now();
    const payload = buildGameCompletionPayload({
      reason: 'victory',
      gameState: {
        startedAt: now - 10_000,
        endedAt: now,
        rounds: [{ tricks: [{}] }],
      },
      players: [
        { playerId: 'ana', displayName: 'Ana', livesRemaining: 2 },
        { playerId: 'bruno', displayName: 'Bruno', livesRemaining: 0 },
      ],
    });

    expect(payload.reason).toBe('victory');
    expect(payload.winner).toBe('ana');
    expect(payload.finalStandings[0]).toMatchObject({ playerId: 'ana', livesRemaining: 2 });
    expect(payload.gameStats.totalRounds).toBe(1);
    expect(payload.gameStats.totalTricks).toBe(1);
    expect(payload.gameStats.duration).toBeGreaterThan(0);
  });
});
