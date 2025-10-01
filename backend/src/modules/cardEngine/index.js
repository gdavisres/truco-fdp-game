'use strict';

const crypto = require('node:crypto');

const Card = require('./Card');

const createDeck = () => {
  const deck = [];
  for (const suit of Card.SUITS) {
    for (const rank of Card.RANK_ORDER) {
      deck.push(new Card(rank, suit));
    }
  }
  return deck;
};

const secureRandomInt = (max, randomBytesFn = crypto.randomBytes) => {
  if (max < 0) {
    throw new Error('max must be >= 0');
  }

  if (max === 0) {
    return 0;
  }

  const range = BigInt(max + 1);
  const bitsNeeded = Math.ceil(Math.log2(Number(range)));
  const bytesNeeded = Math.max(1, Math.ceil(bitsNeeded / 8));
  const maxValue = BigInt(1) << BigInt(bytesNeeded * 8);
  const acceptableUpperBound = maxValue - (maxValue % range);

  let value = acceptableUpperBound;
  while (value >= acceptableUpperBound) {
    const buffer = randomBytesFn(bytesNeeded);
    if (!Buffer.isBuffer(buffer) || buffer.length !== bytesNeeded) {
      throw new Error('randomBytesFn must return a Buffer of the requested size');
    }

    value = BigInt(0);
    for (const byte of buffer) {
      value = (value << BigInt(8)) + BigInt(byte);
    }
  }

  return Number(value % range);
};

const shuffleDeck = (inputDeck, { randomBytes = crypto.randomBytes } = {}) => {
  const deck = inputDeck.map((card) => (card instanceof Card ? card.clone() : new Card(card.rank, card.suit)));

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i, randomBytes);
    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }

  return deck;
};

const determineManilhaRank = (viraRank) => Card.getManilhaRank(viraRank);

const drawVira = (deck) => {
  if (!Array.isArray(deck) || deck.length === 0) {
    throw new Error('Cannot draw vira from an empty deck');
  }

  const [first, ...rest] = deck;
  const viraCard = first instanceof Card ? first.clone() : new Card(first.rank, first.suit);
  const remainingDeck = rest.map((card) => (card instanceof Card ? card.clone() : new Card(card.rank, card.suit)));

  return {
    viraCard,
    remainingDeck,
    manilhaRank: determineManilhaRank(viraCard.rank),
  };
};

const applyViraToCards = (cards, viraRank) => {
  if (!Array.isArray(cards)) {
    throw new Error('cards must be an array');
  }

  return cards.map((card) => {
    const instance = card instanceof Card ? card.clone() : new Card(card.rank, card.suit);
    instance.applyVira(viraRank);
    return instance;
  });
};

const compareCards = (cardA, cardB, viraRank) => {
  if (!cardA || !cardB) {
    throw new Error('Two cards are required for comparison');
  }

  const rankA = cardA.rank;
  const suitA = cardA.suit;
  const rankB = cardB.rank;
  const suitB = cardB.suit;

  const strengthA = Card.calculateStrength(rankA, suitA, viraRank);
  const strengthB = Card.calculateStrength(rankB, suitB, viraRank);

  if (strengthA === strengthB) {
    return 0;
  }

  return strengthA > strengthB ? 1 : -1;
};

module.exports = {
  Card,
  createDeck,
  shuffleDeck,
  drawVira,
  determineManilhaRank,
  applyViraToCards,
  compareCards,
  __testUtils: {
    secureRandomInt,
  },
};
