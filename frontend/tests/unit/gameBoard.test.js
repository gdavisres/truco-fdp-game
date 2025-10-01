import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../../src/modules/gameUI/gameBoard.js';

const ensurePointerSupport = () => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    globalThis.PointerEvent = class PointerEvent extends Event {
      constructor(type, props = {}) {
        super(type, props);
        Object.assign(this, props);
      }
    };
  }

  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  }

  if (typeof Element.prototype.setPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = () => {};
  }

  if (typeof Element.prototype.releasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = () => {};
  }
};

const createFakeStore = (initialState = {}) => {
  const defaultState = {
    phase: 'setup',
    playerId: null,
    currentTurn: null,
    playerOrder: [],
    offline: false,
    hand: [],
    visibleCards: [],
    turnEndsAt: null,
    pending: { card: null },
    round: { number: 1, cardCount: 0 },
    trickHistory: [],
    currentTrick: {
      number: 0,
      leadPlayer: null,
      winner: null,
      cardsPlayed: {},
      cancelledCards: [],
      currentLeader: null,
      winningCard: null,
    },
  };

  let state = {
    ...defaultState,
    ...initialState,
    round: { ...defaultState.round, ...(initialState.round ?? {}) },
    currentTrick: { ...defaultState.currentTrick, ...(initialState.currentTrick ?? {}) },
    pending: { ...defaultState.pending, ...(initialState.pending ?? {}) },
  };

  const listeners = new Set();

  const store = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    playCard: vi.fn(),
  };

  const setState = (nextState) => {
    state =
      typeof nextState === 'function'
        ? nextState(state)
        : {
            ...state,
            ...nextState,
            round: { ...state.round, ...(nextState.round ?? {}) },
            currentTrick: { ...state.currentTrick, ...(nextState.currentTrick ?? {}) },
            pending: { ...state.pending, ...(nextState.pending ?? {}) },
          };

    listeners.forEach((listener) => listener(state));
  };

  return { store, setState };
};

beforeAll(() => {
  ensurePointerSupport();
});

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe('game board module', () => {
  const setupContext = (storeOverrides) => {
    const appRoot = document.getElementById('app');
    appRoot.innerHTML = '<section data-testid="module-root"></section>';

    const context = {
      appRoot,
      state: {
        currentRoom: {
          currentPlayers: [
            { playerId: 'p1', displayName: 'Alice', connectionStatus: 'connected' },
            { playerId: 'p2', displayName: 'Bruno', connectionStatus: 'connected' },
          ],
        },
      },
      renderSystemMessage: vi.fn(),
      ...storeOverrides,
    };

    return context;
  };

  it('hides the board when no hand is available', async () => {
    const { store } = createFakeStore();
    const context = setupContext({ gameState: store });

    const module = await init(context);
    const section = context.appRoot.querySelector('.game-board');

    expect(section).toBeTruthy();
    expect(section.hidden).toBe(true);

    module.destroy();
  });

  it('renders the player hand and triggers play on tap when it is the player turn', async () => {
    const card = { rank: '4', suit: 'hearts', strength: 5 };
    const { store } = createFakeStore({
      phase: 'playing',
      playerId: 'p1',
      currentTurn: 'p1',
      playerOrder: ['p1', 'p2'],
      hand: [card],
    });

    const context = setupContext({ gameState: store });

    const module = await init(context);
    const cardButton = context.appRoot.querySelector('[data-testid="hand-cards"] .card-tile');

    expect(cardButton).toBeTruthy();
    expect(cardButton.disabled).toBe(false);

    cardButton.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    cardButton.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));

    expect(store.playCard).toHaveBeenCalledTimes(1);
    expect(store.playCard).toHaveBeenCalledWith(card);

    const status = context.appRoot.querySelector('[data-testid="hand-status"]').textContent;
    expect(status).toContain('Select a card');

    module.destroy();
  });

  it('disables the hand when waiting for another player', async () => {
    const { store } = createFakeStore({
      phase: 'playing',
      playerId: 'p1',
      currentTurn: 'p2',
      playerOrder: ['p1', 'p2'],
      hand: [{ rank: 'Q', suit: 'spades', strength: 9 }],
    });

    const context = setupContext({ gameState: store });

    const module = await init(context);
    const cardButton = context.appRoot.querySelector('[data-testid="hand-cards"] .card-tile');

    expect(cardButton.disabled).toBe(true);

    const status = context.appRoot.querySelector('[data-testid="hand-status"]').textContent;
    expect(status).toContain('Waiting for Bruno');

    module.destroy();
  });

  it('shows visible cards and trick history entries', async () => {
    const { store, setState } = createFakeStore({
      phase: 'playing',
      playerId: 'p1',
      currentTurn: 'p2',
      playerOrder: ['p1', 'p2'],
      hand: [{ rank: '2', suit: 'clubs', strength: 1 }],
      visibleCards: [
        { rank: '3', suit: 'hearts', strength: 2, ownerId: 'p2', ownerDisplayName: 'Bruno' },
      ],
      trickHistory: [
        {
          number: 1,
          leadPlayer: 'p1',
          winner: 'p2',
          cardsPlayed: { p1: { rank: '2', suit: 'clubs' }, p2: { rank: '3', suit: 'hearts' } },
          cancelledCards: [],
        },
      ],
    });

    const context = setupContext({ gameState: store });

    const module = await init(context);

    const visible = context.appRoot.querySelector('[data-testid="visible-cards"]');
    expect(visible.hidden).toBe(false);
    expect(visible.textContent).toContain('Bruno');

    const history = context.appRoot.querySelector('[data-testid="trick-history"]').textContent;
    expect(history).toContain('Last trick #1');
    expect(history).toContain('Winner: Bruno');

    setState({ pending: { card: { card: { rank: '2', suit: 'clubs' } } } });
    const status = context.appRoot.querySelector('[data-testid="hand-status"]').textContent;
    expect(status).toContain('Waiting for server');

    module.destroy();
  });
});
