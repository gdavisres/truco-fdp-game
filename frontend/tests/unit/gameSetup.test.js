import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../../src/modules/gameUI/gameSetup.js';

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const createNetworkClientStub = () => {
  const listeners = new Map();
  const socketListeners = new Map();

  const ensureListenerSet = (map, key) => {
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    return map.get(key);
  };

  const stub = {
    emit: vi.fn(),
    on(event, handler) {
      const set = ensureListenerSet(listeners, event);
      set.add(handler);
      return () => {
        set.delete(handler);
        if (!set.size) {
          listeners.delete(event);
        }
      };
    },
    once() {
      throw new Error('not implemented in test stub');
    },
    off: vi.fn(),
    trigger(event, payload) {
      const set = listeners.get(event);
      if (!set) {
        return;
      }
      Array.from(set).forEach((handler) => handler(payload));
    },
    getSocket() {
      return socket;
    },
  };

  const socket = {
    on: vi.fn((event, handler) => {
      const set = ensureListenerSet(socketListeners, event);
      set.add(handler);
    }),
    off: vi.fn((event, handler) => {
      const set = socketListeners.get(event);
      if (!set) {
        return;
      }
      set.delete(handler);
      if (!set.size) {
        socketListeners.delete(event);
      }
    }),
    trigger(event, payload) {
      const set = socketListeners.get(event);
      if (!set) {
        return;
      }
      Array.from(set).forEach((handler) => handler(payload));
    },
  };

  stub.__socket = socket;
  return stub;
};

const createContext = () => {
  const appRoot = document.createElement('div');
  appRoot.innerHTML = `
    <section data-testid="module-root"></section>
    <section data-testid="system-messages"></section>
  `;

  const networkClient = createNetworkClientStub();

  return {
    appRoot,
    renderSystemMessage: vi.fn(),
    networkClient,
    state: {},
  };
};

const sampleRoomPayload = ({
  roomId = 'itajuba',
  playerId = 'player-1',
  isHost = true,
  players = [
    {
      playerId: 'player-1',
      displayName: 'Ana Host',
      isHost: true,
      lives: 5,
      connectionStatus: 'connected',
    },
  ],
  spectatorCount = 0,
  gameState = null,
} = {}) => ({
  roomId,
  playerId,
  isHost,
  currentPlayers: players,
  spectatorCount,
  gameState,
  sessionId: 'session-1',
});

describe('gameSetup module', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hostSettings: {
          startingLives: 5,
          turnTimer: 10,
          gameSpeed: 'normal',
          allowSpectatorChat: true,
        },
        spectatorCount: 0,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('hides lobby until player joins a room and renders host settings', async () => {
    const context = createContext();
    document.body.append(context.appRoot);

    await init(context);

    const section = context.appRoot.querySelector('[data-testid="game-setup"]');
    expect(section).not.toBeNull();
    expect(section.hidden).toBe(true);

    context.networkClient.trigger('room_joined', sampleRoomPayload());
    await flushAsync();

    expect(section.hidden).toBe(false);
    expect(section.querySelectorAll('[data-testid="player-item"]').length).toBe(1);

    const settings = section.querySelector('[data-testid="host-settings"]');
    expect(settings.textContent).toMatch(/Starting lives/i);
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/rooms/itajuba'), expect.any(Object));
  });

  it('enables start button for host when minimum players reached', async () => {
    const context = createContext();
    document.body.append(context.appRoot);

    await init(context);

    const section = context.appRoot.querySelector('[data-testid="game-setup"]');
    const payload = sampleRoomPayload({
      players: [
        {
          playerId: 'player-1',
          displayName: 'Ana Host',
          isHost: true,
          lives: 5,
          connectionStatus: 'connected',
        },
        {
          playerId: 'player-2',
          displayName: 'Bruno',
          isHost: false,
          lives: 5,
          connectionStatus: 'connected',
        },
      ],
    });

    context.networkClient.trigger('room_joined', payload);
    context.networkClient.trigger('room_state', payload);
    await flushAsync();

    const startButton = section.querySelector('[data-testid="start-game"]');
    expect(startButton.disabled).toBe(false);
    const hint = section.querySelector('[data-testid="start-hint"]');
    expect(hint.textContent).toMatch(/Tap Start game/i);
  });

  it('keeps start button disabled for non-host players', async () => {
    const context = createContext();
    document.body.append(context.appRoot);

    await init(context);

    const payload = sampleRoomPayload({
      isHost: false,
      playerId: 'player-2',
      players: [
        {
          playerId: 'player-1',
          displayName: 'Ana Host',
          isHost: true,
          lives: 5,
          connectionStatus: 'connected',
        },
        {
          playerId: 'player-2',
          displayName: 'Bruno',
          isHost: false,
          lives: 5,
          connectionStatus: 'connected',
        },
      ],
    });

    context.networkClient.trigger('room_joined', payload);
    context.networkClient.trigger('room_state', payload);
    await flushAsync();

    const section = context.appRoot.querySelector('[data-testid="game-setup"]');
    const startButton = section.querySelector('[data-testid="start-game"]');
    expect(startButton.disabled).toBe(true);
    const hint = section.querySelector('[data-testid="start-hint"]');
    expect(hint.textContent).toMatch(/Waiting for the host/i);
  });

  it('emits start_game event and shows pending state when host starts game', async () => {
    const context = createContext();
    document.body.append(context.appRoot);

    await init(context);

    const payload = sampleRoomPayload({
      players: [
        {
          playerId: 'player-1',
          displayName: 'Ana Host',
          isHost: true,
          lives: 5,
          connectionStatus: 'connected',
        },
        {
          playerId: 'player-2',
          displayName: 'Bruno',
          isHost: false,
          lives: 5,
          connectionStatus: 'connected',
        },
      ],
    });

    context.networkClient.trigger('room_joined', payload);
    context.networkClient.trigger('room_state', payload);
    await flushAsync();

    const section = context.appRoot.querySelector('[data-testid="game-setup"]');
    const startButton = section.querySelector('[data-testid="start-game"]');

    startButton.click();

    expect(context.networkClient.emit).toHaveBeenCalledWith('start_game');
    expect(startButton.disabled).toBe(true);
    expect(startButton.textContent).toMatch(/Starting…/);
    expect(context.renderSystemMessage).toHaveBeenCalledWith('Starting game', expect.any(String));
  });

  it('resets pending state when start_game fails with action error', async () => {
    const context = createContext();
    document.body.append(context.appRoot);

    await init(context);

    const payload = sampleRoomPayload({
      players: [
        {
          playerId: 'player-1',
          displayName: 'Ana Host',
          isHost: true,
          lives: 5,
          connectionStatus: 'connected',
        },
        {
          playerId: 'player-2',
          displayName: 'Bruno',
          isHost: false,
          lives: 5,
          connectionStatus: 'connected',
        },
      ],
    });

    context.networkClient.trigger('room_joined', payload);
    context.networkClient.trigger('room_state', payload);
    await flushAsync();

    const section = context.appRoot.querySelector('[data-testid="game-setup"]');
    const startButton = section.querySelector('[data-testid="start-game"]');

    startButton.click();

    context.networkClient.__socket.trigger('action_error', {
      action: 'start_game',
      message: 'At least two connected players are required to start the game.',
      error: 'insufficient_players',
    });

    expect(startButton.disabled).toBe(false);
    const status = section.querySelector('[data-testid="lobby-status"]');
    expect(status.textContent).toMatch(/At least two connected players/i);
    expect(context.renderSystemMessage).toHaveBeenCalledWith(
      'Game start failed',
      'At least two connected players are required to start the game.',
    );
  });
});
