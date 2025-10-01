'use strict';

const { Card } = require('../cardEngine');

const DEFAULT_DECK_SIZE = Card.SUITS.length * Card.RANK_ORDER.length;
const DEFAULT_VIRA_COUNT = 1;

const normalizePlayerOrder = (order) => {
  if (!Array.isArray(order)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  order.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }

    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const toNonNegativeInteger = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return Math.floor(numeric);
};

const normalizeBids = (bids, playerOrder) => {
  const normalized = {};

  if (bids instanceof Map) {
    bids.forEach((bid, playerId) => {
      normalized[playerId] = toNonNegativeInteger(bid, 0);
    });
  } else if (bids && typeof bids === 'object') {
    Object.entries(bids).forEach(([playerId, bid]) => {
      normalized[playerId] = toNonNegativeInteger(bid, 0);
    });
  }

  playerOrder.forEach((playerId) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, playerId)) {
      normalized[playerId] = 0;
    }
  });

  return normalized;
};

const countTrickWins = (round, playerOrder) => {
  const counts = {};
  playerOrder.forEach((playerId) => {
    counts[playerId] = 0;
  });

  if (!round || !Array.isArray(round.tricks)) {
    return counts;
  }

  round.tricks.forEach((trick) => {
    const winner = trick?.winner;
    if (typeof winner === 'string' && Object.prototype.hasOwnProperty.call(counts, winner)) {
      counts[winner] += 1;
    }
  });

  return counts;
};

const calculateRoundResults = ({ round = {}, playerOrder = [] } = {}) => {
  const order = normalizePlayerOrder(playerOrder);
  const bids = normalizeBids(round?.bids, order);
  const actuals = countTrickWins(round, order);

  const livesLost = {};
  const summary = {};

  order.forEach((playerId) => {
    const bid = bids[playerId] ?? 0;
    const actual = actuals[playerId] ?? 0;
    const loss = Math.max(0, Math.abs(bid - actual));

    livesLost[playerId] = loss;
    summary[playerId] = {
      bid,
      actual,
      livesLost: loss,
    };
  });

  return {
    bids,
    actuals,
    livesLost,
    summary,
  };
};

const determineNextCardCount = ({
  previousCardCount = 1,
  playerCount,
  deckSize = DEFAULT_DECK_SIZE,
  viraCount = DEFAULT_VIRA_COUNT,
} = {}) => {
  const sanitizedPrevious = Number.isInteger(previousCardCount) && previousCardCount > 0 ? previousCardCount : 1;
  const sanitizedPlayers = Number.isInteger(playerCount) && playerCount > 0 ? playerCount : 0;

  if (sanitizedPlayers === 0) {
    return sanitizedPrevious;
  }

  const usableCards = Math.max(0, deckSize - viraCount);
  if (usableCards === 0) {
    return sanitizedPrevious;
  }

  const maxPerPlayer = Math.max(1, Math.floor(usableCards / sanitizedPlayers));
  const desiredNext = sanitizedPrevious + 1;

  return Math.min(Math.max(1, desiredNext), maxPerPlayer);
};

module.exports = {
  calculateRoundResults,
  determineNextCardCount,
  constants: {
    DEFAULT_DECK_SIZE,
    DEFAULT_VIRA_COUNT,
  },
  __testUtils: {
    normalizePlayerOrder,
    normalizeBids,
    countTrickWins,
    toNonNegativeInteger,
  },
};
