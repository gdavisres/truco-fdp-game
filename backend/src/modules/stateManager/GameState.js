'use strict';

const crypto = require('node:crypto');

const toIsoDate = (value = new Date()) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const inferred = new Date(value);
  if (Number.isNaN(inferred.getTime())) {
    return new Date().toISOString();
  }

  return inferred.toISOString();
};

const DEFAULT_TIME_LIMIT_MS = 60 * 60 * 1000;

const PHASE_GRAPH = {
  waiting: ['bidding'],
  bidding: ['playing', 'completed'],
  playing: ['scoring'],
  scoring: ['bidding', 'completed'],
  completed: [],
};

const validatePhaseTransition = (current, next) => {
  const allowed = PHASE_GRAPH[current];
  if (!allowed || !allowed.includes(next)) {
    throw new Error(`Cannot transition from ${current} to ${next}`);
  }
};

const normalizeHand = (hand) => {
  if (!Array.isArray(hand)) {
    return [];
  }
  return hand.map((card) => ({ ...card }));
};

class GameRound {
  constructor({
    roundNumber,
    cardCount,
    viraCard,
    manilhaRank,
    hands,
    isBlindRound,
    playerOrder,
  }) {
    if (!Number.isInteger(roundNumber) || roundNumber <= 0) {
      throw new Error('GameRound requires a positive roundNumber');
    }
    if (!Number.isInteger(cardCount) || cardCount <= 0) {
      throw new Error('GameRound requires a positive cardCount');
    }

    this.roundNumber = roundNumber;
    this.cardCount = cardCount;
    this.viraCard = viraCard ? { ...viraCard } : null;
    this.manilhaRank = manilhaRank ?? null;
    this.isBlindRound = Boolean(isBlindRound);
    this.startedAt = toIsoDate();
    this.completedAt = null;
    this.playerOrder = Array.isArray(playerOrder) ? [...playerOrder] : [];

    this.hands = new Map();
    if (hands instanceof Map) {
      hands.forEach((hand, playerId) => this.hands.set(playerId, normalizeHand(hand)));
    } else if (hands && typeof hands === 'object') {
      Object.entries(hands).forEach(([playerId, hand]) => {
        this.hands.set(playerId, normalizeHand(hand));
      });
    }

    if (this.hands.size === 0) {
      throw new Error('GameRound requires hands for each active player');
    }

    this.bids = new Map();
    this.tricks = [];
    this.results = new Map();
  }

  getHand(playerId) {
    if (!this.hands.has(playerId)) {
      throw new Error(`Hand not found for player ${playerId}`);
    }
    return normalizeHand(this.hands.get(playerId));
  }

  getHandViewForPlayer(playerId) {
    if (!this.hands.has(playerId)) {
      throw new Error(`Hand not found for player ${playerId}`);
    }

    const selfHand = normalizeHand(this.hands.get(playerId));
    const hiddenSelfHand = selfHand.map((card) => ({ ...card, hidden: true }));

    const view = {
      self: this.isBlindRound ? hiddenSelfHand : selfHand,
      others: {},
    };

    for (const [otherId, otherHand] of this.hands.entries()) {
      if (otherId === playerId) {
        continue;
      }

      if (this.isBlindRound) {
        view.others[otherId] = normalizeHand(otherHand);
      } else {
        view.others[otherId] = Array.from({ length: otherHand.length }, () => ({ hidden: true }));
      }
    }

    return view;
  }

  toJSON() {
    return {
      roundNumber: this.roundNumber,
      cardCount: this.cardCount,
      viraCard: this.viraCard,
      manilhaRank: this.manilhaRank,
      isBlindRound: this.isBlindRound,
      hands: Object.fromEntries(Array.from(this.hands.entries(), ([playerId, hand]) => [playerId, normalizeHand(hand)])),
      bids: Object.fromEntries(this.bids),
      tricks: [...this.tricks],
      results: Object.fromEntries(this.results),
      startedAt: this.startedAt,
      completedAt: this.completedAt,
    };
  }
}

class GameState {
  constructor({
    roomId,
    gameId = crypto.randomUUID(),
    playerOrder,
    timeLimitMs = DEFAULT_TIME_LIMIT_MS,
    startedAt = new Date(),
    metadata = {},
  }) {
    if (!roomId) {
      throw new Error('GameState requires a roomId');
    }

    if (!Array.isArray(playerOrder) || playerOrder.length === 0) {
      throw new Error('GameState requires a non-empty playerOrder array');
    }

    this.gameId = gameId;
    this.roomId = roomId;
    this.playerOrder = [...playerOrder];
    this.currentRound = 0;
    this.currentPhase = 'waiting';
    this.currentPlayerIndex = 0;
    this.rounds = [];
    this.startedAt = toIsoDate(startedAt);
    this.endedAt = null;
    this.timeLimitMs = timeLimitMs;
    this.metadata = { ...metadata };
  }

  getCurrentPlayer() {
    return this.playerOrder[this.currentPlayerIndex] ?? null;
  }

  setCurrentPlayer(playerId) {
    const index = this.playerOrder.indexOf(playerId);
    if (index === -1) {
      throw new Error(`Player ${playerId} is not part of this game`);
    }
    this.currentPlayerIndex = index;
    return playerId;
  }

  advanceTurn({ skip = [] } = {}) {
    if (this.playerOrder.length === 0) {
      return null;
    }

    const skipSet = new Set(skip);
    let iterations = 0;

    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
      iterations += 1;
      if (iterations > this.playerOrder.length) {
        break;
      }
    } while (skipSet.has(this.playerOrder[this.currentPlayerIndex]));

    return this.getCurrentPlayer();
  }

  validatePhase(phase) {
    if (!Object.prototype.hasOwnProperty.call(PHASE_GRAPH, phase)) {
      throw new Error(`Unknown phase: ${phase}`);
    }
  }

  setPhase(phase) {
    this.validatePhase(phase);
    if (phase === this.currentPhase) {
      return this.currentPhase;
    }

    validatePhaseTransition(this.currentPhase, phase);
    this.currentPhase = phase;
    if (phase === 'completed') {
      this.endedAt = toIsoDate();
    }

    return this.currentPhase;
  }

  advancePhase({ to } = {}) {
    if (to) {
      return this.setPhase(to);
    }

    const allowed = PHASE_GRAPH[this.currentPhase];
    if (!allowed || allowed.length === 0) {
      return this.currentPhase;
    }

    return this.setPhase(allowed[0]);
  }

  startRound({ cardCount, viraCard, manilhaRank, hands, startingPlayerId }) {
    const roundNumber = this.rounds.length + 1;
    const round = new GameRound({
      roundNumber,
      cardCount,
      viraCard,
      manilhaRank,
      hands,
      playerOrder: this.playerOrder,
      isBlindRound: roundNumber === 1,
    });

    this.rounds.push(round);
    this.currentRound = roundNumber;
    this.currentPhase = 'bidding';

    if (startingPlayerId) {
      this.setCurrentPlayer(startingPlayerId);
    } else {
      this.currentPlayerIndex = 0;
    }

    return round;
  }

  getCurrentRound() {
    if (this.currentRound === 0) {
      return null;
    }

    return this.rounds[this.currentRound - 1] ?? null;
  }

  hasExpiredTimeLimit(reference = Date.now()) {
    if (!Number.isFinite(this.timeLimitMs)) {
      return false;
    }

    const started = new Date(this.startedAt).getTime();
    return reference - started >= this.timeLimitMs;
  }

  toJSON() {
    return {
      gameId: this.gameId,
      roomId: this.roomId,
      playerOrder: [...this.playerOrder],
      currentRound: this.currentRound,
      currentPhase: this.currentPhase,
      currentPlayerIndex: this.currentPlayerIndex,
      rounds: this.rounds.map((round) => round.toJSON()),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      timeLimitMs: this.timeLimitMs,
      metadata: { ...this.metadata },
    };
  }
}

module.exports = {
  GameState,
  GameRound,
};
