import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init as initReconnection } from '../../src/modules/gameUI/reconnection.js';
import { createGameStateStore } from '../../src/modules/gameState/index.js';

const createNetworkClient = () => {
  const listeners = new Map();
  return {
    connect: vi.fn(),
    on: (event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emitEvent: (event, payload) => {
      if (!listeners.has(event)) {
        return;
      }
      listeners.get(event).forEach((handler) => handler(payload));
    },
  };
};

describe('reconnection UI module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('displays reconnecting banner with countdown during reconnection attempts', async () => {
    const appRoot = document.createElement('div');
    const store = createGameStateStore();
    const networkClient = createNetworkClient();
    document.body.append(appRoot);

    await initReconnection({ appRoot, gameState: store, networkClient });

    networkClient.emitEvent('status', { status: 'reconnecting', attempt: 3 });

    const banner = appRoot.querySelector('[data-testid="connection-banner"]');
    expect(banner.dataset.state).toBe('visible');
    expect(banner.dataset.variant).toBe('warning');

    const title = banner.querySelector('[data-testid="connection-title"]');
    expect(title.textContent).toMatch(/reconnecting/i);

    const countdown = banner.querySelector('[data-testid="connection-countdown"]');
    expect(countdown.hidden).toBe(false);
    expect(countdown.textContent).toMatch(/retrying in/i);

    vi.advanceTimersByTime(1500);
    expect(countdown.textContent).toMatch(/retrying in/i);
  });

  it('hides banner when connection is restored', async () => {
    const appRoot = document.createElement('div');
    const store = createGameStateStore();
    store.setState({ offline: true });
    const networkClient = createNetworkClient();
    document.body.append(appRoot);

    await initReconnection({ appRoot, gameState: store, networkClient });

    networkClient.emitEvent('status', { status: 'reconnecting', attempt: 1 });
    networkClient.emitEvent('status', { status: 'connected' });

    const banner = appRoot.querySelector('[data-testid="connection-banner"]');
    vi.advanceTimersByTime(1500);
    expect(banner.dataset.state).toBe('hidden');
  });

  it('shows offline messaging and allows manual retry', async () => {
    const appRoot = document.createElement('div');
    const store = createGameStateStore();
    const networkClient = createNetworkClient();
    document.body.append(appRoot);

    await initReconnection({ appRoot, gameState: store, networkClient });

    networkClient.emitEvent('status', { status: 'offline' });

    const banner = appRoot.querySelector('[data-testid="connection-banner"]');
    const button = banner.querySelector('[data-testid="connection-action"]');
    const tip = banner.querySelector('[data-testid="connection-tip"]');

    expect(banner.dataset.state).toBe('visible');
    expect(button.hidden).toBe(false);

    store.setState({ offline: true });
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toMatch(/gameplay paused/i);

    button.click();
    expect(networkClient.connect).toHaveBeenCalled();
  });
});
