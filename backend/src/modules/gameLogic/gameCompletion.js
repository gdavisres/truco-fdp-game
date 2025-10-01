'use strict';

const toTimestamp = (value, fallback = Date.now()) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return typeof fallback === 'function' ? fallback() : fallback;
};

const calculateGameStats = (gameState = {}) => {
  const startedAt = toTimestamp(gameState.startedAt, Date.now);
  const endedAt = toTimestamp(gameState.endedAt, Date.now);

  const totalRounds = Array.isArray(gameState.rounds) ? gameState.rounds.length : 0;
  const totalTricks = Array.isArray(gameState.rounds)
    ? gameState.rounds.reduce((sum, round) => {
        if (!round) {
          return sum;
        }
        const tricks = Array.isArray(round.tricks) ? round.tricks.length : 0;
        return sum + tricks;
      }, 0)
    : 0;

  return {
    duration: Math.max(0, endedAt - startedAt),
    totalRounds,
    totalTricks,
  };
};

const normalizePlayers = (players = []) => {
  const byId = new Map();

  players.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const playerId = entry.playerId ?? entry.id ?? null;
    if (!playerId || byId.has(playerId)) {
      return;
    }

    const displayName = entry.displayName ?? entry.name ?? playerId;
    const lives = Number.isFinite(entry.lives) ? entry.lives : Number.isFinite(entry.livesRemaining) ? entry.livesRemaining : null;

    byId.set(playerId, {
      playerId,
      displayName,
      livesRemaining: lives,
    });
  });

  return Array.from(byId.values());
};

const buildStandings = ({ players = [], totalRounds = 0 } = {}) => {
  const normalized = normalizePlayers(players).map((entry) => ({
    ...entry,
    totalRounds,
  }));

  normalized.sort((left, right) => {
    const leftLives = Number.isFinite(left.livesRemaining) ? left.livesRemaining : -Infinity;
    const rightLives = Number.isFinite(right.livesRemaining) ? right.livesRemaining : -Infinity;

    if (rightLives !== leftLives) {
      return rightLives - leftLives;
    }

    const leftName = (left.displayName ?? left.playerId ?? '').toLowerCase();
    const rightName = (right.displayName ?? right.playerId ?? '').toLowerCase();

    if (leftName < rightName) {
      return -1;
    }
    if (leftName > rightName) {
      return 1;
    }

    return 0;
  });

  return normalized;
};

const determineWinner = (standings = [], reason = 'normal') => {
  if (!Array.isArray(standings) || standings.length === 0) {
    return null;
  }

  if (reason === 'timeout') {
    return null;
  }

  const alive = standings.filter((entry) => Number.isFinite(entry?.livesRemaining) && entry.livesRemaining > 0);

  if (alive.length === 1) {
    return alive[0].playerId ?? null;
  }

  return null;
};

const buildGameCompletionPayload = ({ gameState = {}, players = [], reason = 'normal' } = {}) => {
  const stats = calculateGameStats(gameState);
  const standings = buildStandings({ players, totalRounds: stats.totalRounds });
  const winner = determineWinner(standings, reason);

  return {
    winner,
    finalStandings: standings,
    gameStats: stats,
    reason,
  };
};

module.exports = {
  buildGameCompletionPayload,
  calculateGameStats,
  buildStandings,
  determineWinner,
};
