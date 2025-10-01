import { registerModule } from '../moduleRegistry.js';

const BID_ERROR_LIMIT = 10;
const CHAT_HISTORY_LIMIT = 100;

const createInitialTrickState = () => ({
  number: 0,
  leadPlayer: null,
  cardsPlayed: {},
  winner: null,
  cancelledCards: [],
  currentLeader: null,
  winningCard: null,
  completedAt: null,
});

const normalizeRoundResults = (payload = {}) => {
  const sanitized = {};

  if (payload && typeof payload === 'object' && payload.results) {
    Object.entries(payload.results).forEach(([playerId, entry]) => {
      sanitized[playerId] = {
        bid: Number.isFinite(entry?.bid) ? entry.bid : null,
        actual: Number.isFinite(entry?.actual) ? entry.actual : null,
        livesLost: Number.isFinite(entry?.livesLost) ? entry.livesLost : 0,
        livesRemaining: Number.isFinite(entry?.livesRemaining) ? entry.livesRemaining : null,
      };
    });
  }

  const eliminatedPlayers = Array.isArray(payload?.eliminatedPlayers)
    ? [...payload.eliminatedPlayers]
    : [];

  return {
    roundNumber: Number.isFinite(payload?.roundNumber) ? payload.roundNumber : null,
    results: sanitized,
    eliminatedPlayers,
    receivedAt: Date.now(),
  };
};

const mergeLivesFromResults = (previous = {}, results = {}) => {
  const next = { ...previous };

  Object.entries(results).forEach(([playerId, entry]) => {
    if (Number.isFinite(entry?.livesRemaining)) {
      next[playerId] = entry.livesRemaining;
    }
  });

  return next;
};

const normalizeGameResult = (payload = {}) => {
  const standings = Array.isArray(payload.finalStandings)
    ? payload.finalStandings.map((entry) => ({
        playerId: entry.playerId ?? null,
        displayName: entry.displayName ?? null,
        livesRemaining: Number.isFinite(entry?.livesRemaining) ? entry.livesRemaining : null,
        totalRounds: Number.isFinite(entry?.totalRounds) ? entry.totalRounds : null,
      }))
    : [];

  return {
    winner: payload.winner ?? null,
    standings,
    stats: {
      duration: Number.isFinite(payload?.gameStats?.duration) ? payload.gameStats.duration : null,
      totalRounds: Number.isFinite(payload?.gameStats?.totalRounds) ? payload.gameStats.totalRounds : null,
      totalTricks: Number.isFinite(payload?.gameStats?.totalTricks) ? payload.gameStats.totalTricks : null,
    },
    receivedAt: Date.now(),
  };
};

export const createInitialState = () => ({
  roomId: null,
  playerId: null,
  isHost: false,
  isSpectator: false,
  phase: 'idle',
  round: {
    number: 0,
    cardCount: 0,
    viraCard: null,
    manilhaRank: null,
    isBlindRound: false,
  },
  playerOrder: [],
  currentTurn: null,
  validBids: [],
  restrictedBid: null,
  isLastBidder: false,
  biddingMetadata: null,
  turnEndsAt: null,
  bids: {},
  hand: [],
  visibleCards: [],
  currentTrick: createInitialTrickState(),
  trickHistory: [],
  roundResults: null,
  playerLives: {},
  playerDirectory: {},
  gameResult: null,
  gameTimer: {
    remainingMs: null,
    status: 'idle',
    receivedAt: null,
  },
  hostSettings: {
    allowSpectatorChat: true,
  },
  chat: {
    messages: [],
  },
  pending: {
    bid: null,
    card: null,
  },
  offline: false,
  errors: [],
});

const appendErrorEntry = (errors = [], payload) => {
  const entry = {
    action: payload?.action ?? 'unknown',
    message: payload?.message ?? 'Action failed',
    code: payload?.error ?? null,
    receivedAt: Date.now(),
  };

  const copy = Array.isArray(errors) ? errors.slice(-1 * (BID_ERROR_LIMIT - 1)) : [];
  copy.push(entry);
  return copy;
};

const cloneCard = (card) => (card && typeof card === 'object' ? { ...card } : null);

const sanitizeCardArray = (cards) =>
  Array.isArray(cards)
    ? cards
        .map((card) => cloneCard(card))
        .filter((card) => card && typeof card.rank === 'string' && typeof card.suit === 'string')
    : [];

const cardsEqual = (left, right) =>
  left &&
  right &&
  typeof left === 'object' &&
  typeof right === 'object' &&
  left.rank === right.rank &&
  left.suit === right.suit;

const removeCardFromHand = (hand = [], target) => {
  if (!Array.isArray(hand) || !target) {
    return { hand: Array.isArray(hand) ? [...hand] : [], removed: null, index: -1 };
  }

  let removed = null;
  let removalIndex = -1;
  const nextHand = [];

  hand.forEach((card, index) => {
    if (removed === null && cardsEqual(card, target)) {
      removed = card;
      removalIndex = index;
      return;
    }

    nextHand.push(card);
  });

  return { hand: nextHand, removed, index: removalIndex };
};

const insertCardIntoHand = (hand = [], card, index) => {
  if (!card) {
    return Array.isArray(hand) ? [...hand] : [];
  }

  const target = Array.isArray(hand) ? [...hand] : [];

  if (Number.isInteger(index) && index >= 0 && index <= target.length) {
    target.splice(index, 0, card);
  } else {
    target.push(card);
  }

  return target;
};

export const createGameStateStore = ({ onChange } = {}) => {
  const state = createInitialState();
  const subscribers = new Set();

  // RAF throttling to prevent excessive DOM updates (30fps max)
  let rafScheduled = false;
  let lastNotify = 0;
  const MIN_NOTIFY_INTERVAL = 1000 / 30; // 30fps

  const notifySubscribers = () => {
    const now = performance.now();
    const elapsed = now - lastNotify;

    // Always notify onChange callback (critical updates)
    if (typeof onChange === 'function') {
      onChange(state);
    }

    // Throttle subscriber notifications (UI updates)
    if (elapsed < MIN_NOTIFY_INTERVAL && subscribers.size > 0) {
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => {
          rafScheduled = false;
          lastNotify = performance.now();
          subscribers.forEach((subscriber) => {
            try {
              subscriber(state);
            } catch (error) {
              setTimeout(() => {
                throw error;
              });
            }
          });
        });
      }
    } else {
      lastNotify = now;
      subscribers.forEach((subscriber) => {
        try {
          subscriber(state);
        } catch (error) {
          setTimeout(() => {
            throw error;
          });
        }
      });
    }
  };

  const notify = notifySubscribers;

  const replaceState = (next) => {
    if (!next || typeof next !== 'object') {
      return;
    }

    Object.keys(state).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(next, key)) {
        delete state[key];
      }
    });

    Object.assign(state, next);
    notify();
  };

  const setState = (update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    if (!patch || typeof patch !== 'object') {
      return;
    }

    Object.assign(state, patch);
    notify();
  };

  const subscribe = (handler) => {
    if (typeof handler !== 'function') {
      throw new TypeError('Subscriber must be a function');
    }

    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  };

  return {
    getState: () => state,
    setState,
    replaceState,
    reset: () => replaceState(createInitialState()),
    subscribe,
  };
};

const applySnapshotToStore = (store, payload, { resetPending = true } = {}) => {
  if (!payload) {
    store.reset();
    return;
  }

  store.setState((prev) => {
    const next = {
      roomId: payload.roomId ?? prev.roomId,
      playerId: payload.playerId ?? prev.playerId,
      isHost: typeof payload.isHost === 'boolean' ? payload.isHost : prev.isHost,
        isSpectator: typeof payload.isSpectator === 'boolean' ? payload.isSpectator : prev.isSpectator,
      offline: false,
    };

    if (Array.isArray(payload?.currentPlayers)) {
      const mergedLives = { ...prev.playerLives };
      const mergedDirectory = { ...prev.playerDirectory };

      payload.currentPlayers.forEach((player) => {
        if (!player?.playerId) {
          return;
        }

        const playerId = player.playerId;

        if (Number.isFinite(player?.lives)) {
          mergedLives[playerId] = player.lives;
        } else if (!Object.prototype.hasOwnProperty.call(mergedLives, playerId)) {
          mergedLives[playerId] = null;
        }

        mergedDirectory[playerId] = {
          ...(mergedDirectory[playerId] || {}),
          playerId,
          displayName: player.displayName ?? mergedDirectory[playerId]?.displayName ?? playerId,
          connectionStatus: player.connectionStatus ?? mergedDirectory[playerId]?.connectionStatus ?? 'connected',
          isHost: Boolean(player.isHost ?? mergedDirectory[playerId]?.isHost),
          isSpectator: Boolean(player.isSpectator ?? mergedDirectory[playerId]?.isSpectator),
        };

        if (Number.isFinite(player?.lives)) {
          mergedDirectory[playerId].lives = player.lives;
        }
      });

      next.playerLives = mergedLives;
      next.playerDirectory = mergedDirectory;
    }

    const snapshot = payload.gameState;
    if (snapshot) {
      next.phase = snapshot.currentPhase ?? prev.phase ?? 'waiting';
      next.playerOrder = Array.isArray(snapshot.playerOrder)
        ? [...snapshot.playerOrder]
        : prev.playerOrder;
      next.currentTurn = snapshot.currentPlayer ?? prev.currentTurn ?? null;
      next.round = {
        number: snapshot.currentRound ?? prev.round.number ?? 0,
        cardCount: snapshot.cardCount ?? prev.round.cardCount ?? 0,
        viraCard: snapshot.viraCard ?? prev.round.viraCard ?? null,
        manilhaRank: snapshot.manilhaRank ?? prev.round.manilhaRank ?? null,
        isBlindRound: snapshot.isBlindRound ?? prev.round.isBlindRound ?? false,
      };

      next.currentTrick = {
        ...prev.currentTrick,
        number: snapshot.trickNumber ?? prev.currentTrick.number ?? 0,
      };

      if (snapshot.bids) {
        next.bids = { ...snapshot.bids };
      }

      if (Array.isArray(snapshot.validBids)) {
        next.validBids = [...snapshot.validBids];
      }

      next.restrictedBid =
        typeof snapshot.restrictedBid === 'number' ? snapshot.restrictedBid : null;
      next.isLastBidder = Boolean(snapshot.isLastBidder);
      next.biddingMetadata = snapshot.biddingMetadata ?? null;

      next.turnEndsAt = typeof snapshot.turnEndsAt === 'number' ? snapshot.turnEndsAt : null;
    } else if (!prev.phase || prev.phase === 'idle') {
      next.phase = 'waiting';
    }

    if (payload.hostSettings && typeof payload.hostSettings === 'object') {
      next.hostSettings = {
        ...prev.hostSettings,
        ...payload.hostSettings,
      };
    }

    if (Array.isArray(payload.chatMessages)) {
      const trimmed = payload.chatMessages.slice(-CHAT_HISTORY_LIMIT).map((entry) => ({ ...entry }));
      next.chat = {
        ...prev.chat,
        messages: trimmed,
      };
    }

    if (resetPending) {
      next.pending = {
        ...prev.pending,
        bid: null,
        card: null,
      };
    }

    return next;
  });
};

const appendChatMessage = (store, payload) => {
  if (!payload) {
    return;
  }

  store.setState((prev) => {
    const existing = Array.isArray(prev.chat?.messages) ? [...prev.chat.messages] : [];
    existing.push({ ...payload });
    const trimmed = existing.slice(-CHAT_HISTORY_LIMIT);

    return {
      chat: {
        ...prev.chat,
        messages: trimmed,
      },
    };
  });
};

const applyHostSettingsUpdate = (store, payload) => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const settings = payload.hostSettings && typeof payload.hostSettings === 'object' ? payload.hostSettings : payload;

  store.setState((prev) => ({
    hostSettings: {
      ...prev.hostSettings,
      ...settings,
    },
  }));
};

const handleBiddingTurn = (store, payload) => {
  if (!payload) {
    return;
  }

  store.setState((prev) => {
    const timeLeft = typeof payload.timeLeft === 'number' ? payload.timeLeft : null;
    const deadline = Number.isFinite(payload.deadline)
      ? payload.deadline
      : timeLeft !== null
        ? Date.now() + timeLeft * 1000
        : null;
    return {
      phase: 'bidding',
      currentTurn: payload.currentPlayer ?? prev.currentTurn ?? null,
      validBids: Array.isArray(payload.validBids) ? [...payload.validBids] : prev.validBids,
      restrictedBid:
        typeof payload.restrictedBid === 'number' ? payload.restrictedBid : null,
      isLastBidder: Boolean(payload.isLastBidder),
      biddingMetadata: payload.metadata ?? null,
      turnEndsAt: deadline,
    };
  });
};

const applyTurnTimerUpdate = (store, payload) => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  store.setState((prev) => {
    const deadline = Number.isFinite(payload.deadline)
      ? payload.deadline
      : prev.turnEndsAt ?? null;
    const patch = {
      turnEndsAt: deadline,
    };

    if (typeof payload.playerId === 'string' && payload.playerId) {
      patch.currentTurn = payload.playerId;
    }

    if (typeof payload.phase === 'string' && payload.phase) {
      patch.phase = payload.phase;
    }

    return patch;
  });
};

const handleBidSubmitted = (store, payload) => {
  if (!payload) {
    return;
  }

  store.setState((prev) => {
    let bids = prev.bids;

    if (payload.allBids && typeof payload.allBids === 'object') {
      bids = { ...payload.allBids };
    } else if (payload.playerId) {
      bids = { ...prev.bids, [payload.playerId]: payload.bid };
    }

    const patch = { bids };

    if (payload.playerId === prev.playerId || payload.allBids) {
      patch.pending = {
        ...prev.pending,
        bid: null,
      };
    }

    if (payload.allBids) {
      patch.validBids = [];
      patch.restrictedBid = null;
      patch.isLastBidder = false;
      patch.turnEndsAt = null;
      patch.currentTurn = null;
    }

    return patch;
  });
};

const handleActionError = (store, payload) => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  if (payload.action === 'submit_bid') {
    store.setState((prev) => {
      const bids = { ...prev.bids };
      if (prev.playerId) {
        delete bids[prev.playerId];
      }

      return {
        pending: {
          ...prev.pending,
          bid: null,
        },
        bids,
        errors: appendErrorEntry(prev.errors, payload),
      };
    });
    return;
  }

  if (payload.action === 'play_card') {
    store.setState((prev) => {
      const pendingCard = prev.pending?.card;
      const restoredHand = insertCardIntoHand(prev.hand, pendingCard?.card, pendingCard?.index);
      const nextCardsPlayed = { ...prev.currentTrick.cardsPlayed };

      if (pendingCard?.card && prev.playerId) {
        delete nextCardsPlayed[prev.playerId];
      }

      return {
        hand: restoredHand,
        currentTrick: {
          ...prev.currentTrick,
          cardsPlayed: nextCardsPlayed,
        },
        pending: {
          ...prev.pending,
          card: null,
        },
        errors: appendErrorEntry(prev.errors, payload),
      };
    });
  }
};

const handleActionSync = (store, payload) => {
  if (!payload || typeof payload !== 'object' || !payload.action) {
    return;
  }

  if (payload.action === 'submit_bid') {
    store.setState((prev) => {
      const nextState = {
        pending: {
          ...prev.pending,
          bid: null,
        },
      };

      const submittedBidRaw = payload?.payload?.bid;
      const submittedBid = Number(submittedBidRaw);
      if (prev.playerId && Number.isFinite(submittedBid)) {
        nextState.bids = {
          ...(prev.bids && typeof prev.bids === 'object' ? prev.bids : {}),
          [prev.playerId]: submittedBid,
        };
      }

      return nextState;
    });
    return;
  }

  if (payload.action === 'play_card') {
    store.setState((prev) => ({
      pending: {
        ...prev.pending,
        card: null,
      },
    }));
  }
};

const applyRoundStart = (store, payload) => {
  if (!payload) {
    return;
  }

  store.setState((prev) => ({
    phase: 'bidding',
    round: {
      number: payload.roundNumber ?? prev.round.number ?? 0,
      cardCount: payload.cardCount ?? prev.round.cardCount ?? 0,
      viraCard: payload.viraCard ?? prev.round.viraCard ?? null,
      manilhaRank: payload.manilhaRank ?? prev.round.manilhaRank ?? null,
      isBlindRound: Boolean(payload.isBlindRound ?? prev.round.isBlindRound),
    },
    currentTurn: payload.currentPlayer ?? null,
    bids: {},
    validBids: [],
    restrictedBid: null,
    isLastBidder: false,
    biddingMetadata: null,
    turnEndsAt: null,
    pending: {
      ...prev.pending,
      bid: null,
      card: null,
    },
    hand: [],
    visibleCards: [],
    currentTrick: createInitialTrickState(),
    trickHistory: [],
    roundResults: null,
  }));
};

const applyStatusChange = (store, payload) => {
  const status = payload?.status;
  if (!status) {
    return;
  }

  if (status === 'offline' || status === 'reconnecting') {
    store.setState({ offline: true });
  } else if (status === 'connected' || status === 'reconnected') {
    store.setState({ offline: false });
  }
};

const handleCardsDealt = (store, payload) => {
  console.log('[GameState] cards_dealt event received:', payload);
  if (!payload) {
    console.warn('[GameState] cards_dealt payload is null/undefined');
    return;
  }

  store.setState((prev) => ({
    hand: sanitizeCardArray(payload.hand),
    visibleCards: sanitizeCardArray(payload.visibleCards),
    pending: {
      ...prev.pending,
      card: null,
    },
  }));
  
  console.log('[GameState] cards dealt -', {
    handSize: payload.hand?.length,
    visibleCardsSize: payload.visibleCards?.length,
  });
};

const handleTrickStarted = (store, payload) => {
  if (!payload) {
    return;
  }

  store.setState((prev) => ({
    phase: 'playing',
    currentTurn: payload.leadPlayer ?? prev.currentTurn ?? null,
    currentTrick: {
      number: payload.trickNumber ?? prev.currentTrick.number ?? 0,
      leadPlayer: payload.leadPlayer ?? null,
      cardsPlayed: {},
      winner: null,
      cancelledCards: [],
      currentLeader: payload.leadPlayer ?? null,
      winningCard: null,
      completedAt: null,
    },
  }));
};

const handleCardPlayed = (store, payload) => {
  if (!payload || !payload.playerId || !payload.card) {
    return;
  }

  store.setState((prev) => {
    const nextCards = { ...prev.currentTrick.cardsPlayed, [payload.playerId]: cloneCard(payload.card) };
    let nextHand = prev.hand;
    let pendingCard = prev.pending?.card ?? null;

    if (payload.playerId === prev.playerId) {
      const removal = removeCardFromHand(prev.hand, payload.card);
      nextHand = removal.hand;
      pendingCard = null;
    }

    let nextVisibleCards = prev.visibleCards;
    if (Array.isArray(prev.visibleCards) && prev.visibleCards.length) {
      nextVisibleCards = prev.visibleCards.filter((card) => {
        if (card?.ownerId !== payload.playerId) {
          return true;
        }
        return !cardsEqual(card, payload.card);
      });
    }

    const leaderId = payload.currentLeader ?? null;
    const nextLeader = leaderId ?? prev.currentTrick.currentLeader ?? null;
    const winningCardFromPayload = payload.winningCard ? cloneCard(payload.winningCard) : null;
    const derivedWinningCard = nextLeader && nextCards[nextLeader] ? cloneCard(nextCards[nextLeader]) : null;
    const nextWinningCard =
      winningCardFromPayload ??
      derivedWinningCard ??
      (nextLeader ? prev.currentTrick.winningCard : null);
    const cancelledCards = Array.isArray(payload.cancelledCards)
      ? sanitizeCardArray(payload.cancelledCards)
      : prev.currentTrick.cancelledCards;

    return {
      hand: nextHand,
      visibleCards: nextVisibleCards,
      currentTurn: payload.nextPlayer ?? null,
      currentTrick: {
        ...prev.currentTrick,
        cardsPlayed: nextCards,
        currentLeader: nextLeader,
        winningCard: nextWinningCard,
        cancelledCards,
      },
      pending: {
        ...prev.pending,
        card: pendingCard,
      },
    };
  });
};

const handleTrickCompleted = (store, payload) => {
  if (!payload) {
    return;
  }

  store.setState((prev) => {
    const cardsPlayed = payload.cardsPlayed && typeof payload.cardsPlayed === 'object'
      ? Object.fromEntries(
          Object.entries(payload.cardsPlayed).map(([playerId, card]) => [playerId, cloneCard(card)]),
        )
      : { ...prev.currentTrick.cardsPlayed };

    const winnerId = payload.winner ?? null;
    const winningCard = winnerId && cardsPlayed[winnerId] ? cloneCard(cardsPlayed[winnerId]) : null;

    const trickResult = {
      number: payload.trickNumber ?? prev.currentTrick.number ?? 0,
      leadPlayer: prev.currentTrick.leadPlayer,
      winner: winnerId,
      currentLeader: winnerId,
      winningCard,
      cardsPlayed,
      cancelledCards: sanitizeCardArray(payload.cancelledCards),
      completedAt: Date.now(),
    };

    const history = [...prev.trickHistory, trickResult];
    if (history.length > 6) {
      history.shift();
    }

    return {
      currentTrick: trickResult,
      trickHistory: history,
      currentTurn: payload.nextTrick ? prev.currentTurn : null,
      phase: payload.nextTrick ? 'playing' : 'scoring',
      pending: {
        ...prev.pending,
        card: null,
      },
    };
  });
};

const handleRoundCompleted = (store, payload) => {
  if (!payload) {
    return;
  }

  const normalized = normalizeRoundResults(payload);

  store.setState((prev) => ({
    phase: 'scoring',
    currentTurn: null,
    validBids: [],
    restrictedBid: null,
    isLastBidder: false,
    biddingMetadata: null,
    turnEndsAt: null,
    roundResults: normalized,
    playerLives: mergeLivesFromResults(prev.playerLives, normalized.results),
    playerDirectory: (() => {
      const directory = { ...prev.playerDirectory };

      Object.entries(normalized.results).forEach(([playerId, entry]) => {
        if (!directory[playerId]) {
          directory[playerId] = {
            playerId,
            displayName: playerId,
            isSpectator: false,
          };
        }

        if (Number.isFinite(entry?.livesRemaining)) {
          directory[playerId] = {
            ...directory[playerId],
            lives: entry.livesRemaining,
          };
        }
      });

      normalized.eliminatedPlayers.forEach((playerId) => {
        if (!directory[playerId]) {
          directory[playerId] = {
            playerId,
            displayName: playerId,
            isSpectator: true,
            lives: 0,
          };
          return;
        }

        directory[playerId] = {
          ...directory[playerId],
          isSpectator: true,
          lives: Number.isFinite(normalized.results[playerId]?.livesRemaining)
            ? normalized.results[playerId].livesRemaining
            : 0,
        };
      });

      return directory;
    })(),
    pending: {
      ...prev.pending,
      bid: null,
      card: null,
    },
  }));
};

const handleGameCompleted = (store, payload) => {
  if (!payload) {
    return;
  }

  const normalized = normalizeGameResult(payload);

  store.setState((prev) => ({
    phase: 'completed',
    currentTurn: null,
    roundResults: null,
    gameResult: normalized,
    playerLives: mergeLivesFromResults(prev.playerLives, Object.fromEntries(normalized.standings.map((entry) => [entry.playerId, { livesRemaining: entry.livesRemaining }]))),
    playerDirectory: (() => {
      const directory = { ...prev.playerDirectory };

      normalized.standings.forEach((entry) => {
        if (!entry.playerId) {
          return;
        }

        directory[entry.playerId] = {
          ...(directory[entry.playerId] || {}),
          playerId: entry.playerId,
          displayName: entry.displayName ?? directory[entry.playerId]?.displayName ?? entry.playerId,
          lives: Number.isFinite(entry.livesRemaining) ? entry.livesRemaining : directory[entry.playerId]?.lives ?? null,
          isSpectator: true,
        };
      });

      if (normalized.winner && directory[normalized.winner]) {
        directory[normalized.winner] = {
          ...directory[normalized.winner],
          isWinner: true,
        };
      }

      return directory;
    })(),
    pending: {
      ...prev.pending,
      bid: null,
      card: null,
    },
    validBids: [],
    restrictedBid: null,
    isLastBidder: false,
    turnEndsAt: null,
    gameTimer: {
      remainingMs: 0,
      status: 'completed',
      receivedAt: Date.now(),
    },
  }));
};

const handleGameTimerUpdate = (store, payload) => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const remainingMs = Number.isFinite(payload.remainingMs) ? Math.max(0, payload.remainingMs) : null;

  store.setState((prev) => ({
    gameTimer: {
      remainingMs,
      status: typeof payload.status === 'string' ? payload.status : prev.gameTimer?.status ?? 'idle',
      receivedAt: Date.now(),
    },
  }));
};

export const init = async (context) => {
  if (!context || !context.networkClient) {
    throw new Error('GameState module requires networkClient in context');
  }

  context.state = context.state ?? {};

  const store = createGameStateStore({
    onChange: (nextState) => {
      context.state.game = nextState;
    },
  });

  context.state.game = store.getState();
  context.gameState = store;

  const networkClient = context.networkClient;
  const socket = context.socket ?? networkClient.getSocket?.();

  console.log('[GameState] Module initialized', {
    hasSocket: !!socket,
    socketType: typeof socket,
    hasSocketOn: socket && typeof socket.on === 'function',
    socketConnected: socket?.connected,
    socketId: socket?.id,
  });

  store.submitBid = (value) => {
    const current = store.getState();

    if (!Number.isInteger(value) && typeof value !== 'number') {
      throw new TypeError('Bid must be a number');
    }

    if (current.phase !== 'bidding') {
      throw new Error('Cannot submit bid outside bidding phase');
    }

    if (!current.playerId) {
      throw new Error('Player identity unknown');
    }

    if (current.currentTurn !== current.playerId) {
      throw new Error('It is not your turn to bid');
    }

    if (!Array.isArray(current.validBids) || !current.validBids.includes(value)) {
      throw new Error('Bid value not allowed');
    }

    if (typeof networkClient.emit !== 'function') {
      throw new Error('Network client cannot emit events');
    }

    store.setState((prev) => ({
      bids: {
        ...prev.bids,
        [prev.playerId]: value,
      },
      pending: {
        ...prev.pending,
        bid: {
          value,
          submittedAt: Date.now(),
          optimistic: true,
        },
      },
    }));

    networkClient.emit('submit_bid', { bid: value });
  };

  store.playCard = (card) => {
    const current = store.getState();

    if (!card || typeof card.rank !== 'string' || typeof card.suit !== 'string') {
      throw new TypeError('Card must include rank and suit');
    }

    if (current.phase !== 'playing') {
      throw new Error('Cannot play card outside playing phase');
    }

    if (!current.playerId) {
      throw new Error('Player identity unknown');
    }

    if (current.currentTurn !== current.playerId) {
      throw new Error("It isn't your turn to play a card");
    }

    if (current.pending?.card) {
      throw new Error('Card play already pending confirmation');
    }

    if (typeof networkClient.emit !== 'function') {
      throw new Error('Network client cannot emit events');
    }

    const { hand, removed, index } = (() => {
      const result = removeCardFromHand(current.hand, card);
      if (!result.removed) {
        throw new Error('Card not available in hand');
      }
      return result;
    })();

    const optimisticCard = cloneCard(removed);

    store.setState((prev) => ({
      hand,
      currentTrick: {
        ...prev.currentTrick,
        cardsPlayed: {
          ...prev.currentTrick.cardsPlayed,
          [prev.playerId]: optimisticCard,
        },
      },
      pending: {
        ...prev.pending,
        card: {
          card: optimisticCard,
          index,
          submittedAt: Date.now(),
          optimistic: true,
        },
      },
    }));

    networkClient.emit('play_card', {
      card: {
        rank: String(optimisticCard.rank),
        suit: String(optimisticCard.suit),
      },
    });
  };

  const disposers = [];
  const socketHandlers = [];
  const pendingSubscriptions = [];
  let subscriptionsApplied = false;

  const subscribeClient = (event, handler) => {
    if (typeof networkClient.on !== 'function') {
      return;
    }

    const dispose = networkClient.on(event, handler);
    if (typeof dispose === 'function') {
      disposers.push(dispose);
    }
  };

  const applySocketSubscriptions = () => {
    if (subscriptionsApplied || !socket) {
      return;
    }

    console.log('[GameState] Applying socket subscriptions', {
      pendingCount: pendingSubscriptions.length,
      socketConnected: socket.connected,
      socketId: socket.id,
    });

    pendingSubscriptions.forEach(({ event, handler }) => {
      socket.on(event, handler);
      socketHandlers.push(() => {
        if (typeof socket.off === 'function') {
          socket.off(event, handler);
        }
      });
    });

    subscriptionsApplied = true;
    pendingSubscriptions.length = 0;
    
    console.log('[GameState] All socket subscriptions applied');
  };

  const subscribeSocket = (event, handler) => {
    if (!socket) {
      console.warn(`[GameState] Cannot subscribe to '${event}' - socket is null`);
      return;
    }

    if (typeof socket.on !== 'function') {
      console.warn(`[GameState] Cannot subscribe to '${event}' - socket.on is not a function`);
      return;
    }

    console.log(`[GameState] Queuing subscription for socket event '${event}'`);
    
    // Queue the subscription instead of applying immediately
    pendingSubscriptions.push({ event, handler });
  };

  subscribeClient('room_joined', (payload) => applySnapshotToStore(store, payload, { resetPending: true }));
  subscribeClient('room_state', (payload) => applySnapshotToStore(store, payload, { resetPending: false }));
  subscribeClient('room_left', () => store.reset());
  subscribeClient('status', (payload) => applyStatusChange(store, payload));
  subscribeClient('chat_message_received', (payload) => appendChatMessage(store, payload));
  subscribeClient('host_settings_updated', (payload) => applyHostSettingsUpdate(store, payload));

  subscribeSocket('connection_status', (payload) => applyStatusChange(store, payload));
  subscribeSocket('bidding_turn', (payload) => handleBiddingTurn(store, payload));
  subscribeSocket('bid_submitted', (payload) => handleBidSubmitted(store, payload));
  subscribeSocket('action_error', (payload) => handleActionError(store, payload));
  subscribeSocket('round_started', (payload) => applyRoundStart(store, payload));
  subscribeSocket('cards_dealt', (payload) => handleCardsDealt(store, payload));
  subscribeSocket('trick_started', (payload) => handleTrickStarted(store, payload));
  subscribeSocket('card_played', (payload) => handleCardPlayed(store, payload));
  subscribeSocket('trick_completed', (payload) => handleTrickCompleted(store, payload));
  subscribeSocket('round_completed', (payload) => handleRoundCompleted(store, payload));
  subscribeSocket('game_completed', (payload) => handleGameCompleted(store, payload));
  subscribeSocket('game_timer_update', (payload) => handleGameTimerUpdate(store, payload));
  subscribeSocket('chat_message_received', (payload) => appendChatMessage(store, payload));
  subscribeSocket('host_settings_updated', (payload) => applyHostSettingsUpdate(store, payload));
  subscribeSocket('turn_timer_update', (payload) => applyTurnTimerUpdate(store, payload));
  subscribeSocket('action_sync', (payload) => handleActionSync(store, payload));
  subscribeSocket('game_state_update', (payload) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    applySnapshotToStore(
      store,
      {
        roomId: payload.gameState?.roomId,
        playerId: payload.yourPlayerId,
        gameState: payload.gameState,
      },
      { resetPending: false },
    );
  });

  // Apply subscriptions immediately if socket is already connected
  if (socket && socket.connected) {
    console.log('[GameState] Socket already connected, applying subscriptions immediately');
    applySocketSubscriptions();
  } else if (socket) {
    // Wait for socket to connect before applying subscriptions
    console.log('[GameState] Socket not yet connected, waiting for connect event');
    socket.once('connect', () => {
      console.log('[GameState] Socket connected event received, applying pending subscriptions');
      applySocketSubscriptions();
    });
  }

  return {
    destroy: () => {
      disposers.splice(0).forEach((dispose) => {
        try {
          dispose();
        } catch (error) {
          // ignore cleanup errors
        }
      });

      socketHandlers.splice(0).forEach((cleanup) => {
        try {
          cleanup();
        } catch (error) {
          // ignore cleanup errors
        }
      });
    },
  };
};

registerModule(async () => ({ init }));
