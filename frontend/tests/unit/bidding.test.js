import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init as initBidding } from '../../src/modules/gameUI/bidding.js';
import { createGameStateStore, createInitialState } from '../../src/modules/gameState/index.js';

const createContext = () => {
  const appRoot = document.createElement('div');
  appRoot.innerHTML = `
    <section data-testid="module-root"></section>
    <section data-testid="system-messages"></section>
  `;

  const store = createGameStateStore();
  store.submitBid = vi.fn((value) => {
    const pending = {
      value,
      submittedAt: Date.now(),
    };
    store.setState({
      bids: {
        ...store.getState().bids,
        [store.getState().playerId]: undefined,
      },
      pending: {
        ...store.getState().pending,
        bid: pending,
      },
    });
  });

  const players = [
    {
      playerId: 'player-1',
      displayName: 'Ana',
      connectionStatus: 'connected',
    },
    {
      playerId: 'player-2',
      displayName: 'Bruno',
      connectionStatus: 'connected',
    },
  ];

  const context = {
    appRoot,
    renderSystemMessage: vi.fn(),
    gameState: store,
    state: {
      currentRoom: {
        roomId: 'itajuba',
        currentPlayers: players,
      },
    },
  };

  return { context, store };
};

const enterBiddingPhase = (store, overrides = {}) => {
  const base = createInitialState();
  store.setState({
    ...base,
    phase: 'bidding',
    roomId: 'itajuba',
    playerId: 'player-1',
    currentTurn: 'player-1',
    round: {
      ...base.round,
      cardCount: 3,
      number: 1,
    },
    validBids: [0, 1, 2, 3],
    bids: {},
    restrictedBid: null,
    isLastBidder: false,
    biddingMetadata: null,
    ...overrides,
  });
};

describe('bidding UI module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders bid options when it is the player turn', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initBidding(context);
    enterBiddingPhase(store);

    const panel = context.appRoot.querySelector('[data-testid="bidding-panel"]');
    expect(panel.hidden).toBe(false);

    const options = panel.querySelectorAll('[data-testid="bid-option"]');
    expect(options.length).toBe(4);
    expect(options[0].textContent).toBe('0');

    options[2].click();
    expect(store.submitBid).toHaveBeenCalledWith(2);
  });

  it('disables bidding controls when waiting for other players', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initBidding(context);
    enterBiddingPhase(store, { currentTurn: 'player-2' });

    const panel = context.appRoot.querySelector('[data-testid="bidding-panel"]');
    const options = panel.querySelectorAll('[data-testid="bid-option"]');
    expect(options.length).toBeGreaterThan(0);
    options.forEach((button) => {
      expect(button.disabled).toBe(true);
    });

    const status = panel.querySelector('[data-testid="bidding-status"]');
    expect(status.textContent).toMatch(/waiting for bruno/i);
  });

  it('shows last bidder restriction message', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initBidding(context);
    enterBiddingPhase(store, {
      isLastBidder: true,
      restrictedBid: 2,
      validBids: [0, 1, 3],
    });

    const restriction = context.appRoot.querySelector('[data-testid="restriction-message"]');
    expect(restriction.hidden).toBe(false);
    expect(restriction.textContent).toMatch(/cannot choose 2/i);

    const options = context.appRoot.querySelectorAll('[data-testid="bid-option"]');
    const restricted = Array.from(options).find((el) => el.dataset.value === '2');
    expect(restricted).not.toBeUndefined();
    expect(restricted.disabled).toBe(true);
    expect(restricted.className).toMatch(/restricted/);
  });

  it('displays latest bid error in the panel', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initBidding(context);
    enterBiddingPhase(store, {
      errors: [
        { action: 'submit_bid', message: 'Bid not allowed', receivedAt: Date.now() },
      ],
    });

    const error = context.appRoot.querySelector('[data-testid="bidding-error"]');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/bid not allowed/i);
  });

  it('updates the timer display with remaining seconds', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    await initBidding(context);
    enterBiddingPhase(store, {
      turnEndsAt: Date.now() + 15000,
    });

    const timer = context.appRoot.querySelector('[data-testid="bidding-timer"]');
    expect(timer.dataset.state).toBe('running');
    const value = timer.querySelector('.bidding__timerValue').textContent;
    expect(value).toMatch(/15/);

    vi.advanceTimersByTime(13000);
    const updated = timer.querySelector('.bidding__timerValue').textContent;
    expect(updated).toMatch(/2/);
  });
});
