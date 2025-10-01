import { beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../../src/modules/gameState/index.js';

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const createEventMap = () => new Map();

const createEmitter = (listeners) => ({
  on: vi.fn((event, handler) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(handler);
  }),
  off: vi.fn((event, handler) => {
    const set = listeners.get(event);
    if (!set) {
      return;
    }
    if (handler) {
      set.delete(handler);
    } else {
      set.clear();
    }
    if (!set.size) {
      listeners.delete(event);
    }
  }),
  trigger(event, payload) {
    const set = listeners.get(event);
    if (!set) {
      return;
    }
    Array.from(set).forEach((handler) => handler(payload));
  },
});

const createNetworkClientStub = () => {
  const listeners = createEventMap();
  const emitter = createEmitter(listeners);

  const socketListeners = createEventMap();
  const socketEmitter = createEmitter(socketListeners);

  const networkClient = {
    emit: vi.fn(),
    on: vi.fn((event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
      return () => {
        const set = listeners.get(event);
        if (!set) {
          return;
        }
        set.delete(handler);
        if (!set.size) {
          listeners.delete(event);
        }
      };
    }),
    off: vi.fn((event, handler) => {
      const set = listeners.get(event);
      if (!set) {
        return;
      }
      if (handler) {
        set.delete(handler);
      } else {
        set.clear();
      }
      if (!set.size) {
        listeners.delete(event);
      }
    }),
    once: vi.fn((event, handler) => {
      const dispose = networkClient.on(event, (...args) => {
        dispose();
        handler(...args);
      });
      return dispose;
    }),
    trigger: emitter.trigger,
    getSocket: () => socket,
  };

  const socket = {
    on: socketEmitter.on,
    off: socketEmitter.off,
    trigger: socketEmitter.trigger,
  };

  networkClient.__socket = socket;
  return networkClient;
};

const createContext = () => {
  const networkClient = createNetworkClientStub();
  const state = {};

  return {
    appRoot: document.createElement('div'),
    networkClient,
    socket: networkClient.getSocket(),
    state,
    renderSystemMessage: vi.fn(),
  };
};

describe('gameState module', () => {
  let context;

  beforeEach(async () => {
    context = createContext();
    await init(context);
  });

  it('exposes store and reflects room join snapshots', async () => {
    const store = context.gameState;
    const updates = [];
    const unsubscribe = store.subscribe((next) => updates.push(next));

    context.networkClient.trigger('room_joined', {
      roomId: 'itajuba',
      playerId: 'player-1',
      isHost: true,
      gameState: {
        currentPhase: 'bidding',
        currentRound: 2,
        playerOrder: ['player-1', 'player-2'],
        manilhaRank: '7',
      },
    });

    await flushAsync();

    const state = store.getState();
    expect(state.roomId).toBe('itajuba');
    expect(state.playerId).toBe('player-1');
    expect(state.phase).toBe('bidding');
    expect(state.round.number).toBe(2);
    expect(state.playerOrder).toEqual(['player-1', 'player-2']);
    expect(context.state.game.roomId).toBe('itajuba');
    expect(updates.at(-1)).toMatchObject({ roomId: 'itajuba', phase: 'bidding' });

    unsubscribe();
  });

  it('validates turn before submitting bid and clears pending on server ack', async () => {
    const store = context.gameState;

    context.networkClient.trigger('room_joined', {
      roomId: 'itajuba',
      playerId: 'player-1',
      isHost: true,
      gameState: {
        currentPhase: 'bidding',
        currentRound: 1,
      },
    });

    context.socket.trigger('bidding_turn', {
      currentPlayer: 'player-1',
      validBids: [0, 1, 2],
      timeLeft: 15,
    });

    store.submitBid(1);

    expect(context.networkClient.emit).toHaveBeenCalledWith('submit_bid', { bid: 1 });
    expect(store.getState().pending.bid.value).toBe(1);
    expect(store.getState().restrictedBid).toBeNull();
    expect(store.getState().isLastBidder).toBe(false);

    expect(() => store.submitBid(3)).toThrow(/not allowed/i);

    context.socket.trigger('bid_submitted', {
      playerId: 'player-1',
      bid: 1,
      allBids: {
        'player-1': 1,
        'player-2': 0,
      },
    });

    const state = store.getState();
    expect(state.pending.bid).toBeNull();
    expect(state.bids).toMatchObject({ 'player-1': 1, 'player-2': 0 });
    expect(state.validBids).toEqual([]);
    expect(state.restrictedBid).toBeNull();
    expect(state.currentTurn).toBeNull();
  });

  it('tracks offline state while keeping optimistic bid until confirmation', () => {
    const store = context.gameState;

    context.networkClient.trigger('room_joined', {
      roomId: 'itajuba',
      playerId: 'player-1',
      gameState: {
        currentPhase: 'bidding',
        currentRound: 1,
      },
    });

    context.socket.trigger('bidding_turn', {
      currentPlayer: 'player-1',
      validBids: [0, 1],
      timeLeft: 9,
    });

    store.submitBid(1);

    context.networkClient.trigger('status', { status: 'offline', reason: 'network_offline' });
    expect(store.getState().offline).toBe(true);

    context.networkClient.trigger('status', { status: 'reconnecting', attempt: 2 });
    expect(store.getState().offline).toBe(true);

    context.networkClient.trigger('status', { status: 'connected' });
    expect(store.getState().offline).toBe(false);
    expect(store.getState().pending.bid.value).toBe(1);
  });

  it('rolls back optimistic bid when server rejects action', () => {
    const store = context.gameState;

    context.networkClient.trigger('room_joined', {
      roomId: 'itajuba',
      playerId: 'player-1',
      gameState: {
        currentPhase: 'bidding',
        currentRound: 1,
      },
    });

    context.socket.trigger('bidding_turn', {
      currentPlayer: 'player-1',
      validBids: [0, 1],
      timeLeft: 12,
    });

    store.submitBid(1);

    context.socket.trigger('action_error', {
      action: 'submit_bid',
      error: 'invalid_bid',
      message: 'Bid not allowed',
    });

    const state = store.getState();
    expect(state.pending.bid).toBeNull();
    expect(state.bids['player-1']).toBeUndefined();
    expect(state.errors.at(-1)).toMatchObject({ action: 'submit_bid', message: 'Bid not allowed' });
  });

  it('updates hand when cards are dealt and allows optimistic card play', () => {
    const store = context.gameState;

    context.networkClient.trigger('room_joined', {
      roomId: 'itajuba',
      playerId: 'player-1',
      gameState: {
        currentPhase: 'playing',
        currentRound: 1,
        currentPlayer: 'player-1',
      },
    });

    context.socket.trigger('cards_dealt', {
      hand: [
        { rank: 'A', suit: 'hearts', strength: 11 },
        { rank: 'K', suit: 'clubs', strength: 10 },
      ],
      visibleCards: [{ rank: '7', suit: 'diamonds', ownerId: 'player-2' }],
    });

    expect(store.getState().hand).toHaveLength(2);
    expect(store.getState().visibleCards).toHaveLength(1);

    store.setState({ phase: 'playing', currentTurn: 'player-1' });
    store.playCard({ rank: 'A', suit: 'hearts' });

    expect(context.networkClient.emit).toHaveBeenCalledWith('play_card', {
      card: { rank: 'A', suit: 'hearts' },
    });
    expect(store.getState().hand).toHaveLength(1);
    expect(store.getState().pending.card.card).toMatchObject({ rank: 'A', suit: 'hearts' });

    context.socket.trigger('card_played', {
      playerId: 'player-1',
      card: { rank: 'A', suit: 'hearts', strength: 11 },
      nextPlayer: 'player-2',
    });

    expect(store.getState().pending.card).toBeNull();
    expect(store.getState().currentTurn).toBe('player-2');
    expect(store.getState().currentTrick.cardsPlayed['player-1']).toMatchObject({ rank: 'A', suit: 'hearts' });
  });

  it('restores optimistic card when server rejects play', () => {
    const store = context.gameState;

    context.networkClient.trigger('room_joined', {
      roomId: 'itajuba',
      playerId: 'player-1',
      gameState: {
        currentPhase: 'playing',
        currentRound: 1,
        currentPlayer: 'player-1',
      },
    });

    store.setState({
      phase: 'playing',
      currentTurn: 'player-1',
      hand: [
        { rank: 'J', suit: 'hearts', strength: 8 },
        { rank: 'Q', suit: 'spades', strength: 9 },
      ],
    });

    store.playCard({ rank: 'J', suit: 'hearts' });

    context.socket.trigger('action_error', {
      action: 'play_card',
      error: 'invalid_turn',
      message: 'Not your turn',
    });

    const state = store.getState();
    expect(state.hand).toHaveLength(2);
    expect(state.pending.card).toBeNull();
    expect(state.currentTrick.cardsPlayed['player-1']).toBeUndefined();
    expect(state.errors.at(-1)).toMatchObject({ action: 'play_card', message: 'Not your turn' });
  });

  it('clears pending actions when sync events arrive after reconnect', () => {
    const store = context.gameState;

    context.networkClient.trigger('room_joined', {
      roomId: 'itajuba',
      playerId: 'player-1',
      gameState: {
        currentPhase: 'bidding',
        currentRound: 1,
      },
    });

    context.socket.trigger('bidding_turn', {
      currentPlayer: 'player-1',
      validBids: [0, 1, 2],
      timeLeft: 12,
    });

    store.submitBid(2);
    expect(store.getState().pending.bid.value).toBe(2);

    context.socket.trigger('action_sync', {
      action: 'submit_bid',
      payload: { bid: 2 },
    });

    const afterBidSync = store.getState();
    expect(afterBidSync.pending.bid).toBeNull();
    expect(afterBidSync.bids['player-1']).toBe(2);

    store.setState({
      phase: 'playing',
      currentTurn: 'player-1',
      hand: [
        { rank: '4', suit: 'diamonds' },
        { rank: '5', suit: 'clubs' },
      ],
      playerId: 'player-1',
    });

    store.playCard({ rank: '4', suit: 'diamonds' });
    expect(store.getState().pending.card).not.toBeNull();

    context.socket.trigger('action_sync', {
      action: 'play_card',
      payload: { card: { rank: '4', suit: 'diamonds' } },
    });

    expect(store.getState().pending.card).toBeNull();
  });

  it('records trick completion history', () => {
    const store = context.gameState;

    store.setState({
      playerId: 'player-1',
      phase: 'playing',
      currentTurn: 'player-2',
      currentTrick: {
        number: 1,
        leadPlayer: 'player-3',
        cardsPlayed: {
          'player-1': { rank: '5', suit: 'clubs' },
          'player-2': { rank: '7', suit: 'diamonds' },
          'player-3': { rank: '4', suit: 'hearts' },
        },
        winner: null,
        cancelledCards: [],
      },
    });

    context.socket.trigger('trick_completed', {
      trickNumber: 1,
      cardsPlayed: {
        'player-1': { rank: '5', suit: 'clubs' },
        'player-2': { rank: '7', suit: 'diamonds' },
        'player-3': { rank: '4', suit: 'hearts' },
      },
      winner: 'player-2',
      cancelledCards: [],
      nextTrick: false,
    });

    const state = store.getState();
    expect(state.phase).toBe('scoring');
    expect(state.currentTrick.winner).toBe('player-2');
    expect(state.trickHistory.at(-1).winner).toBe('player-2');
  });

  it('appends chat messages from socket events and enforces history limit', () => {
    const store = context.gameState;

    const firstMessage = {
      messageId: 'msg-1',
      playerId: 'p1',
      displayName: 'Alice',
      message: 'Olá!',
      timestamp: Date.now(),
      type: 'player',
    };

    context.socket.trigger('chat_message_received', firstMessage);

    expect(store.getState().chat.messages).toHaveLength(1);
    expect(store.getState().chat.messages[0]).toMatchObject(firstMessage);

    for (let index = 0; index < 150; index += 1) {
      context.socket.trigger('chat_message_received', {
        messageId: `msg-${index + 2}`,
        playerId: `p${index + 2}`,
        message: `Message ${index}`,
        timestamp: Date.now() + index,
        type: 'player',
      });
    }

    expect(store.getState().chat.messages).toHaveLength(100);
  expect(store.getState().chat.messages[0].messageId).toBe('msg-52');
  });

  it('updates host settings from network events', () => {
    const store = context.gameState;
    expect(store.getState().hostSettings.allowSpectatorChat).toBe(true);

    context.networkClient.trigger('host_settings_updated', {
      roomId: 'itajuba',
      hostSettings: {
        allowSpectatorChat: false,
        turnTimer: 15,
      },
    });

    expect(store.getState().hostSettings).toMatchObject({
      allowSpectatorChat: false,
      turnTimer: 15,
    });
  });
});
