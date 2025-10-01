import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init as initScoring } from '../../src/modules/gameUI/scoring.js';
import { createGameStateStore, createInitialState } from '../../src/modules/gameState/index.js';

const createContext = () => {
  const appRoot = document.createElement('div');
  appRoot.innerHTML = `
    <section data-testid="module-root"></section>
    <section data-testid="system-messages"></section>
  `;

  const store = createGameStateStore();

  const context = {
    appRoot,
    gameState: store,
    state: {
      currentRoom: {
        roomId: 'itajuba',
        currentPlayers: [],
      },
    },
  };

  return { context, store };
};

const enterScoringPhase = (store, overrides = {}) => {
  const base = createInitialState();
  store.setState({
    ...base,
    phase: 'scoring',
    roomId: 'itajuba',
    playerId: 'player-1',
    playerOrder: ['player-1', 'player-2'],
    playerDirectory: {
      'player-1': { playerId: 'player-1', displayName: 'Ana', lives: 3 },
      'player-2': { playerId: 'player-2', displayName: 'Bruno', lives: 2 },
    },
    roundResults: {
      roundNumber: 3,
      results: {
        'player-1': { bid: 2, actual: 1, livesLost: 1, livesRemaining: 2 },
        'player-2': { bid: 1, actual: 1, livesLost: 0, livesRemaining: 2 },
      },
      eliminatedPlayers: [],
      receivedAt: Date.now(),
    },
    ...overrides,
  });
};

describe('scoring UI module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        vibrate: vi.fn(() => true),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
    delete globalThis.navigator;
  });

  it('renders round results with bids, actual tricks, and lives remaining', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initScoring(context);
    enterScoringPhase(store);

    const panel = context.appRoot.querySelector('[data-testid="scoring-panel"]');
    expect(panel.hidden).toBe(false);

    const rows = panel.querySelectorAll('[data-player-id]');
    expect(rows.length).toBe(2);

    const anaRow = panel.querySelector('[data-player-id="player-1"]');
    expect(anaRow.querySelector('[data-testid="scoring-bid"]').textContent).toMatch(/bid 2/i);
    expect(anaRow.querySelector('[data-testid="scoring-actual"]').textContent).toMatch(/won 1/i);
    expect(anaRow.querySelector('[data-testid="scoring-lives-value"]').textContent).toBe('2');
  });

  it('marks eliminated players and avoids duplicate rows', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initScoring(context);
    enterScoringPhase(store, {
      roundResults: {
        roundNumber: 4,
        results: {
          'player-1': { bid: 0, actual: 0, livesLost: 0, livesRemaining: 2 },
          'player-2': { bid: 1, actual: 0, livesLost: 1, livesRemaining: 0 },
        },
        eliminatedPlayers: ['player-2'],
        receivedAt: Date.now(),
      },
    });

    const eliminatedRow = context.appRoot.querySelector('[data-player-id="player-2"]');
    expect(eliminatedRow.dataset.eliminated).toBe('true');
    expect(eliminatedRow.querySelector('[data-testid="scoring-eliminated"]').hidden).toBe(false);

    // trigger another update to ensure rows are reused
    store.setState((prev) => ({
      roundResults: {
        ...prev.roundResults,
        receivedAt: Date.now() + 1000,
      },
    }));

    const rows = context.appRoot.querySelectorAll('[data-player-id]');
    expect(rows.length).toBe(2);
  });

  it('triggers haptic feedback when new round results arrive', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initScoring(context);
    enterScoringPhase(store);

    expect(globalThis.navigator.vibrate).toHaveBeenCalledTimes(1);

    // subsequent identical payload should not vibrate again
    store.setState((prev) => ({ roundResults: { ...prev.roundResults } }));
    expect(globalThis.navigator.vibrate).toHaveBeenCalledTimes(1);

    // new payload triggers again
    store.setState((prev) => ({
      roundResults: {
        ...prev.roundResults,
        receivedAt: prev.roundResults.receivedAt + 5000,
      },
    }));

    expect(globalThis.navigator.vibrate).toHaveBeenCalledTimes(2);
  });
});
