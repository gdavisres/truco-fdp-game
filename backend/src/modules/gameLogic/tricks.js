'use strict';

const { Card } = require('../cardEngine');

const SUIT_SYMBOLS = {
  clubs: '♣',
  hearts: '♥',
  spades: '♠',
  diamonds: '♦',
};

const toIsoDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const isCardLike = (card) =>
  card && typeof card === 'object' && typeof card.rank === 'string' && typeof card.suit === 'string';

const cloneCard = (card, viraRank) => {
  if (!isCardLike(card)) {
    throw new TypeError('Card must include rank and suit.');
  }

  const clone = { ...card };

  if (!clone.displayName && SUIT_SYMBOLS[clone.suit]) {
    clone.displayName = `${clone.rank}${SUIT_SYMBOLS[clone.suit]}`;
  }

  if (viraRank) {
    try {
      clone.isManilha = Card.isManilhaRank(clone.rank, viraRank);
    } catch (error) {
      clone.isManilha = Boolean(clone.isManilha);
    }

    try {
      clone.strength = Card.calculateStrength(clone.rank, clone.suit, viraRank);
    } catch (error) {
      if (!Number.isFinite(clone.strength)) {
        clone.strength = undefined;
      }
    }
  } else if (clone.isManilha === undefined) {
    clone.isManilha = Boolean(clone.isManilha);
  }

  return clone;
};

const cardEquals = (cardA, cardB) =>
  isCardLike(cardA) &&
  isCardLike(cardB) &&
  cardA.rank === cardB.rank &&
  cardA.suit === cardB.suit;

const getPlayerHand = (round, playerId) => {
  if (!round || typeof round !== 'object') {
    return [];
  }

  const { hands } = round;

  if (hands instanceof Map) {
    return hands.get(playerId) || [];
  }

  if (hands && typeof hands === 'object') {
    return hands[playerId] || [];
  }

  return [];
};

const findCardIndex = (cards, target) => {
  if (!Array.isArray(cards)) {
    return -1;
  }

  return cards.findIndex((card) => cardEquals(card, target));
};

const hasPlayerAlreadyPlayed = (trick, playerId) => {
  if (!trick || typeof trick !== 'object') {
    return false;
  }

  const { cardsPlayed } = trick;

  if (cardsPlayed instanceof Map) {
    return cardsPlayed.has(playerId);
  }

  if (cardsPlayed && typeof cardsPlayed === 'object') {
    return Object.prototype.hasOwnProperty.call(cardsPlayed, playerId);
  }

  return false;
};

const listCardsPlayed = (trick) => {
  if (!trick || typeof trick !== 'object') {
    return [];
  }

  const { cardsPlayed } = trick;

  if (cardsPlayed instanceof Map) {
    return Array.from(cardsPlayed.entries()).map(([playerId, card]) => ({ playerId, card }));
  }

  if (cardsPlayed && typeof cardsPlayed === 'object') {
    return Object.entries(cardsPlayed).map(([playerId, card]) => ({ playerId, card }));
  }

  return [];
};

const validateCardPlay = ({
  round,
  trick,
  playerId,
  card,
  expectedPlayerId = null,
}) => {
  if (!playerId) {
    return {
      isValid: false,
      code: 'missing_player',
      reason: 'Player identity is required to play a card.',
      details: {},
    };
  }

  if (!isCardLike(card)) {
    return {
      isValid: false,
      code: 'invalid_card',
      reason: 'Card must include rank and suit properties.',
      details: {},
    };
  }

  if (expectedPlayerId && expectedPlayerId !== playerId) {
    return {
      isValid: false,
      code: 'not_players_turn',
      reason: "It's not your turn to play a card yet.",
      details: {
        expectedPlayerId,
        playerId,
      },
    };
  }

  if (hasPlayerAlreadyPlayed(trick, playerId)) {
    return {
      isValid: false,
      code: 'card_already_played',
      reason: 'Player has already played a card this trick.',
      details: {
        playerId,
      },
    };
  }

  const hand = getPlayerHand(round, playerId);
  const cardIndex = findCardIndex(hand, card);

  if (cardIndex === -1) {
    return {
      isValid: false,
      code: 'card_not_in_hand',
      reason: 'The selected card is not in the player\'s hand.',
      details: {
        playerId,
        attemptedCard: { ...card },
      },
    };
  }

  return {
    isValid: true,
    code: null,
    reason: null,
    details: {
      playerId,
      cardIndex,
    },
  };
};

const createTrickState = ({
  trickNumber,
  leadPlayer,
  startedAt = new Date(),
} = {}) => {
  if (!Number.isInteger(trickNumber) || trickNumber <= 0) {
    throw new Error('trickNumber must be a positive integer');
  }

  if (!leadPlayer) {
    throw new Error('leadPlayer is required to start a trick');
  }

  return {
    trickNumber,
    leadPlayer,
    cardsPlayed: {},
    playOrder: [],
    cancelledCards: [],
    winner: null,
    currentLeader: null,
    currentWinningCard: null,
    startedAt: toIsoDate(startedAt),
    completedAt: null,
  };
};

const recordCardPlay = (trick, { playerId, card, playedAt = new Date() }) => {
  if (!trick || typeof trick !== 'object') {
    throw new TypeError('trick state is required');
  }

  if (!isCardLike(card)) {
    throw new TypeError('Card must include rank and suit.');
  }

  const target = trick;
  const normalizedCard = { ...card, playedAt: toIsoDate(playedAt) };

  if (target.cardsPlayed instanceof Map) {
    target.cardsPlayed.set(playerId, normalizedCard);
  } else {
    target.cardsPlayed = target.cardsPlayed || {};
    target.cardsPlayed[playerId] = normalizedCard;
  }

  target.playOrder = Array.isArray(target.playOrder) ? target.playOrder : [];
  if (!target.playOrder.includes(playerId)) {
    target.playOrder.push(playerId);
  }

  return target;
};

const isManilhaCard = (card, viraRank) => {
  if (!isCardLike(card)) {
    return false;
  }

  if (typeof card.isManilha === 'boolean') {
    return card.isManilha;
  }

  if (!viraRank) {
    return false;
  }

  try {
    return Card.isManilhaRank(card.rank, viraRank);
  } catch (error) {
    return false;
  }
};

const groupByRank = (entries) => {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = entry.card.rank;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  });
  return groups;
};

const evaluateWinner = (entries, viraRank, cancelledEntries) => {
  if (entries.length === 0) {
    return null;
  }

  const working = entries
    .map((entry) => ({
      playerId: entry.playerId,
      card: cloneCard(entry.card, viraRank),
      strength: Card.calculateStrength(entry.card.rank, entry.card.suit, viraRank),
    }))
    .sort((a, b) => b.strength - a.strength);

  if (working.length === 0) {
    return null;
  }

  const [top, ...rest] = working;
  const tiedWithTop = rest.filter((entry) => entry.strength === top.strength);

  if (tiedWithTop.length === 0) {
    return top;
  }

  cancelledEntries.push(top, ...tiedWithTop);
  const remaining = rest.filter((entry) => entry.strength < top.strength);
  return evaluateWinner(remaining, viraRank, cancelledEntries);
};

const resolveTrick = ({
  trick,
  viraRank,
}) => {
  if (!trick || typeof trick !== 'object') {
    throw new TypeError('Trick state is required for resolution.');
  }

  const plays = listCardsPlayed(trick);
  if (plays.length === 0) {
    return {
      winner: null,
      winningCard: null,
      cancelledCards: [],
      survivingEntries: [],
      cancelledEntries: [],
    };
  }

  const cancelledEntries = [];
  const groups = groupByRank(plays);
  const survivingEntries = [];

  groups.forEach((entries) => {
    const allManilha = entries.every((entry) => isManilhaCard(entry.card, viraRank));
    if (!allManilha && entries.length >= 2) {
      entries.forEach((entry) => {
        cancelledEntries.push({
          playerId: entry.playerId,
          card: cloneCard(entry.card, viraRank),
        });
      });
      return;
    }

    entries.forEach((entry) => {
      survivingEntries.push({
        playerId: entry.playerId,
        card: cloneCard(entry.card, viraRank),
      });
    });
  });

  const winnerEntry = evaluateWinner(
    survivingEntries.map((entry) => ({
      playerId: entry.playerId,
      card: entry.card,
    })),
    viraRank,
    cancelledEntries,
  );

  const cancelledCards = cancelledEntries.map((entry) => ({ ...entry.card }));

  if (!winnerEntry) {
    return {
      winner: null,
      winningCard: null,
      cancelledCards,
      survivingEntries,
      cancelledEntries,
    };
  }

  return {
    winner: winnerEntry.playerId,
    winningCard: cloneCard(winnerEntry.card, viraRank),
    cancelledCards,
    survivingEntries,
    cancelledEntries,
  };
};

const removeCardFromHand = (hand, card) => {
  if (!Array.isArray(hand)) {
    return { hand: [], removed: null };
  }

  const index = findCardIndex(hand, card);
  if (index === -1) {
    return { hand: [...hand], removed: null };
  }

  const next = hand.slice(0, index).concat(hand.slice(index + 1));
  return {
    hand: next,
    removed: hand[index],
  };
};

module.exports = {
  validateCardPlay,
  createTrickState,
  recordCardPlay,
  resolveTrick,
  removeCardFromHand,
  __testUtils: {
    isCardLike,
    cardEquals,
    getPlayerHand,
    findCardIndex,
  },
};
