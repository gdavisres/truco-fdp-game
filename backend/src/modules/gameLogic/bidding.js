'use strict';

const normalizeBids = (input) => {
  if (!input) {
    return new Map();
  }

  if (input instanceof Map) {
    return new Map(input);
  }

  if (typeof input === 'object') {
    return new Map(
      Object.entries(input).filter(([, value]) => Number.isFinite(Number(value))),
    );
  }

  throw new TypeError('Bids must be provided as a Map or plain object.');
};

const assertPlayerOrder = (playerOrder) => {
  if (!Array.isArray(playerOrder) || playerOrder.length === 0) {
    throw new Error('playerOrder must be a non-empty array of player identifiers.');
  }
};

const assertPlayerInOrder = (playerOrder, playerId) => {
  if (!playerOrder.includes(playerId)) {
    throw new Error(`Player ${playerId} is not part of the current bidding order.`);
  }
};

const sumBids = (bidsMap, excludePlayerId) => {
  let total = 0;
  bidsMap.forEach((value, playerId) => {
    if (playerId === excludePlayerId) {
      return;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      total += numeric;
    }
  });
  return total;
};

const countExistingBids = (bidsMap, playerOrder, excludePlayerId) =>
  playerOrder.reduce((count, playerId) => {
    if (playerId === excludePlayerId) {
      return count;
    }
    return bidsMap.has(playerId) ? count + 1 : count;
  }, 0);

const createBidRange = (cardCount) => {
  if (!Number.isInteger(cardCount) || cardCount < 0) {
    throw new Error('Card count must be a non-negative integer.');
  }

  return Array.from({ length: cardCount + 1 }, (_, index) => index);
};

const determineLastBidder = ({ playerOrder, playerId, bidsMap }) => {
  const totalOtherPlayers = playerOrder.filter((id) => id !== playerId).length;
  const existing = countExistingBids(bidsMap, playerOrder, playerId);
  return totalOtherPlayers > 0 && existing === totalOtherPlayers;
};

const calculateValidBids = ({
  cardCount,
  playerOrder,
  playerId,
  bids,
  isBlindRound = false,
}) => {
  assertPlayerOrder(playerOrder);
  assertPlayerInOrder(playerOrder, playerId);

  const baseRange = createBidRange(cardCount);
  const bidsMap = normalizeBids(bids);
  bidsMap.delete(playerId);

  const isLastBidder = determineLastBidder({ playerOrder, playerId, bidsMap });
  const restrictionActive = isLastBidder && !isBlindRound;
  const existingBidTotal = sumBids(bidsMap, playerId);

  let restrictedBid = null;
  let validBids = baseRange.slice();

  if (restrictionActive) {
    const candidate = cardCount - existingBidTotal;
    if (baseRange.includes(candidate)) {
      restrictedBid = candidate;
      validBids = baseRange.filter((value) => value !== candidate);
    }

    if (validBids.length === 0) {
      validBids = baseRange.slice();
      restrictedBid = null;
    }
  }

  const metadata = {
    isBlindRound: Boolean(isBlindRound),
    blindReminder: isBlindRound
      ? 'Blind round: players cannot see their own card before bidding.'
      : null,
    existingBidTotal,
    totalPlayers: playerOrder.length,
    lastBidderRestrictionApplied: restrictionActive,
  };

  return {
    validBids,
    restrictedBid,
    isLastBidder,
    metadata,
  };
};

const validateBid = ({
  cardCount,
  bid,
  playerOrder,
  playerId,
  bids,
  isBlindRound = false,
}) => {
  if (!Number.isInteger(cardCount) || cardCount < 0) {
    throw new Error('Card count must be a non-negative integer.');
  }

  if (typeof bid !== 'number' || !Number.isFinite(bid)) {
    return {
      isValid: false,
      reason: 'Bid must be a numeric value.',
      code: 'invalid_type',
      details: {
        cardCount,
        validBids: createBidRange(cardCount),
        restrictedBid: null,
        isLastBidder: false,
        metadata: {
          isBlindRound: Boolean(isBlindRound),
          blindReminder: isBlindRound
            ? 'Blind round: players cannot see their own card before bidding.'
            : null,
          existingBidTotal: sumBids(normalizeBids(bids), playerId),
          totalPlayers: Array.isArray(playerOrder) ? playerOrder.length : 0,
          lastBidderRestrictionApplied: false,
        },
      },
    };
  }

  const intBid = Number.isInteger(bid) ? bid : Math.trunc(bid);
  if (!Number.isInteger(bid)) {
    return {
      isValid: false,
      reason: 'Bid must be an integer value.',
      code: 'invalid_integer',
      details: {
        cardCount,
        validBids: createBidRange(cardCount),
        restrictedBid: null,
        isLastBidder: false,
        metadata: {
          isBlindRound: Boolean(isBlindRound),
          blindReminder: isBlindRound
            ? 'Blind round: players cannot see their own card before bidding.'
            : null,
          existingBidTotal: sumBids(normalizeBids(bids), playerId),
          totalPlayers: Array.isArray(playerOrder) ? playerOrder.length : 0,
          lastBidderRestrictionApplied: false,
        },
      },
    };
  }

  if (intBid < 0 || intBid > cardCount) {
    const baseRange = createBidRange(cardCount);
    return {
      isValid: false,
      reason: `Bid must be between 0 and ${cardCount}.`,
      code: 'out_of_range',
      details: {
        cardCount,
        validBids: baseRange,
        restrictedBid: null,
        isLastBidder: false,
        metadata: {
          isBlindRound: Boolean(isBlindRound),
          blindReminder: isBlindRound
            ? 'Blind round: players cannot see their own card before bidding.'
            : null,
          existingBidTotal: sumBids(normalizeBids(bids), playerId),
          totalPlayers: Array.isArray(playerOrder) ? playerOrder.length : 0,
          lastBidderRestrictionApplied: false,
        },
      },
    };
  }

  const evaluation = calculateValidBids({
    cardCount,
    playerOrder,
    playerId,
    bids,
    isBlindRound,
  });

  const isValid = evaluation.validBids.includes(intBid);
  return {
    isValid,
    reason: isValid
      ? null
      : 'Last bidder restriction: total bids cannot equal the number of tricks.',
    code: isValid ? null : 'last_bidder_restriction',
    details: {
      cardCount,
      validBids: evaluation.validBids,
      restrictedBid: evaluation.restrictedBid,
      isLastBidder: evaluation.isLastBidder,
      metadata: evaluation.metadata,
    },
  };
};

module.exports = {
  createBidRange,
  calculateValidBids,
  validateBid,
};
