import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init as initGameOver } from '../../src/modules/gameUI/gameOver.js';
import { createGameStateStore, createInitialState } from '../../src/modules/gameState/index.js';

const setupContext = () => {
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
        displayName: 'Itajubá Lobby',
      },
    },
    networkClient: {
      emit: vi.fn(),
    },
    renderSystemMessage: vi.fn(),
  };

  return { context, store };
};

const enterCompletedPhase = (store, overrides = {}) => {
  const base = {
    ...createInitialState(),
    phase: 'completed',
    playerId: 'player-2',
    isHost: false,
    gameResult: {
      winner: 'player-1',
      standings: [
        { playerId: 'player-1', displayName: 'Ana', livesRemaining: 3 },
        { playerId: 'player-2', displayName: 'Bruno', livesRemaining: 0 },
      ],
      stats: {
        duration: 19_500,
        totalRounds: 7,
        totalTricks: 21,
      },
      receivedAt: Date.now(),
    },
  };

  store.replaceState({ ...base, ...overrides });
};

describe('game over UI module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: vi.fn(() => Promise.resolve()),
        clipboard: {
          writeText: vi.fn(() => Promise.resolve()),
        },
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

  it('remains hidden until game is completed', async () => {
    const { context } = setupContext();
    document.body.append(context.appRoot);

    await initGameOver(context);

    const panel = context.appRoot.querySelector('[data-testid="game-over-panel"]');
    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(true);
  });

  it('renders winner, stats, and standings when game completes', async () => {
    const { context, store } = setupContext();
    document.body.append(context.appRoot);

    await initGameOver(context);
    enterCompletedPhase(store, { isHost: true, playerId: 'player-1' });

    const panel = context.appRoot.querySelector('[data-testid="game-over-panel"]');
    expect(panel.hidden).toBe(false);
    expect(panel.dataset.visible).toBe('true');

    expect(panel.querySelector('[data-testid="game-over-winner"]').textContent).toBe('Ana');
    expect(panel.querySelector('[data-testid="game-over-message"]').textContent).toMatch(/outlasted/i);
  expect(panel.querySelector('[data-testid="game-over-duration"]').textContent).toBe('19s');
    expect(panel.querySelector('[data-testid="game-over-rounds"]').textContent).toBe('7');
    expect(panel.querySelector('[data-testid="game-over-tricks"]').textContent).toBe('21');

    const standings = panel.querySelectorAll('[data-testid="standing-name"]');
    expect(standings).toHaveLength(2);
    expect(standings[0].textContent).toContain('Ana');
    expect(standings[1].textContent).toContain('Bruno');

    const startButton = panel.querySelector('[data-testid="start-new-game"]');
    expect(startButton.hidden).toBe(false);
    expect(startButton.disabled).toBe(false);
  });

  it('hides start button for non-hosts and triggers share workflow', async () => {
    const { context, store } = setupContext();
    document.body.append(context.appRoot);

    await initGameOver(context);
    enterCompletedPhase(store, { isHost: false });

    const panel = context.appRoot.querySelector('[data-testid="game-over-panel"]');
    const startButton = panel.querySelector('[data-testid="start-new-game"]');
    expect(startButton.hidden).toBe(true);
    expect(startButton.disabled).toBe(true);

    const shareButton = panel.querySelector('[data-testid="share-results"]');
    shareButton.click();

    expect(navigator.share).toHaveBeenCalledTimes(1);
    const sharePayload = navigator.share.mock.calls[0][0];
    expect(sharePayload.text).toMatch(/won the Truco FDP match/i);
    expect(sharePayload.text).toMatch(/Rounds played: 7/);
  });

  it('falls back to clipboard copy when share is unavailable', async () => {
    const { context, store } = setupContext();
    document.body.append(context.appRoot);

    navigator.share = undefined;

    await initGameOver(context);
    enterCompletedPhase(store);

    const shareButton = context.appRoot.querySelector('[data-testid="share-results"]');
    shareButton.click();

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(context.renderSystemMessage).toHaveBeenCalledWith(
        'Results copied',
        expect.stringContaining('Game summary copied'),
      );
    });
  });
});
