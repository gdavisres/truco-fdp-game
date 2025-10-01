'use strict';

const SUITS = ['clubs', 'hearts', 'spades', 'diamonds'];
const SUIT_SYMBOLS = {
  clubs: '♣',
  hearts: '♥',
  spades: '♠',
  diamonds: '♦',
};
const SUIT_STRENGTH = {
  clubs: 3,
  hearts: 2,
  spades: 1,
  diamonds: 0,
};

const RANK_ORDER = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3'];

class Card {
  constructor(rank, suit) {
    if (!RANK_ORDER.includes(rank)) {
      throw new Error(`Invalid rank: ${rank}`);
    }
    if (!SUITS.includes(suit)) {
      throw new Error(`Invalid suit: ${suit}`);
    }

    this.rank = rank;
    this.suit = suit;
    this.displayName = `${rank}${SUIT_SYMBOLS[suit]}`;
    this.isManilha = false;
    this.strength = Card.getBaseStrength(rank);
  }

  applyVira(viraRank) {
    if (viraRank === undefined || viraRank === null) {
      this.isManilha = false;
      this.strength = Card.getBaseStrength(this.rank);
      return this;
    }

    if (!RANK_ORDER.includes(viraRank)) {
      throw new Error(`Invalid vira rank: ${viraRank}`);
    }

    this.isManilha = Card.isManilhaRank(this.rank, viraRank);
    this.strength = Card.calculateStrength(this.rank, this.suit, viraRank);
    return this;
  }

  clone() {
    const clone = new Card(this.rank, this.suit);
    clone.isManilha = this.isManilha;
    clone.strength = this.strength;
    return clone;
  }

  toJSON() {
    return {
      rank: this.rank,
      suit: this.suit,
      displayName: this.displayName,
      isManilha: this.isManilha,
      strength: this.strength,
    };
  }

  static getBaseStrength(rank) {
    const index = RANK_ORDER.indexOf(rank);
    if (index === -1) {
      throw new Error(`Invalid rank: ${rank}`);
    }
    return index + 1;
  }

  static getManilhaRank(viraRank) {
    const index = RANK_ORDER.indexOf(viraRank);
    if (index === -1) {
      throw new Error(`Invalid vira rank: ${viraRank}`);
    }
    return RANK_ORDER[(index + 1) % RANK_ORDER.length];
  }

  static isManilhaRank(rank, viraRank) {
    if (!RANK_ORDER.includes(rank)) {
      throw new Error(`Invalid rank: ${rank}`);
    }
    if (!RANK_ORDER.includes(viraRank)) {
      throw new Error(`Invalid vira rank: ${viraRank}`);
    }
    return Card.getManilhaRank(viraRank) === rank;
  }

  static calculateStrength(rank, suit, viraRank) {
    if (!RANK_ORDER.includes(rank)) {
      throw new Error(`Invalid rank: ${rank}`);
    }
    if (!SUITS.includes(suit)) {
      throw new Error(`Invalid suit: ${suit}`);
    }

    const base = Card.getBaseStrength(rank);
    if (!viraRank) {
      return base;
    }

    if (!RANK_ORDER.includes(viraRank)) {
      throw new Error(`Invalid vira rank: ${viraRank}`);
    }

    if (!Card.isManilhaRank(rank, viraRank)) {
      return base;
    }

    return base + 100 + SUIT_STRENGTH[suit];
  }
}

Card.SUITS = SUITS;
Card.RANK_ORDER = RANK_ORDER;
Card.SUIT_STRENGTH = SUIT_STRENGTH;

module.exports = Card;
