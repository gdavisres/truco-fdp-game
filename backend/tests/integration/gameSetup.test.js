'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io: createClient } = require('socket.io-client');

const DEFAULT_ROOM_ID = 'itajuba';

jest.setTimeout(20000);

const waitForEvent = (socket, eventName, timeoutMs = 5000) => {
  if (socket?.__eventCache?.has(eventName)) {
    const cached = socket.__eventCache.get(eventName);
    socket.__eventCache.delete(eventName);
    if (!cached || cached.length === 0) {
      return Promise.resolve(undefined);
    }
    if (cached.length === 1) {
      return Promise.resolve(cached[0]);
    }
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    const handler = (...args) => {
      clearTimeout(timer);
      socket.off(eventName, handler);
      if (socket.__eventCache?.has(eventName)) {
        socket.__eventCache.delete(eventName);
      }
      if (args.length <= 1) {
        resolve(args[0]);
        return;
      }
      resolve(args);
    };

    socket.once(eventName, handler);
  });
};

const disconnectClient = async (socket) => {
  if (!socket) {
    return;
  }

  if (typeof socket.offAny === 'function' && socket.__eventCacheListener) {
    socket.offAny(socket.__eventCacheListener);
    socket.__eventCacheListener = null;
  }

  if (socket.__eventCache) {
    socket.__eventCache.clear();
  }

  await new Promise((resolve) => {
    if (!socket.connected) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      socket.off('disconnect', onDisconnect);
      resolve();
    }, 200);

    const onDisconnect = () => {
      clearTimeout(timer);
      resolve();
    };

    socket.once('disconnect', onDisconnect);

    try {
      socket.disconnect();
    } catch (error) {
      clearTimeout(timer);
      resolve();
    }
  });
};

const connectClient = (baseUrl, options = {}) =>
  new Promise((resolve, reject) => {
    const socket = createClient(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      auth: options.auth,
    });

    socket.__eventCache = new Map();
    socket.__eventCacheListener = (event, ...args) => {
      if (!socket.__eventCache.has(event)) {
        socket.__eventCache.set(event, args);
      }
    };

    if (typeof socket.onAny === 'function') {
      socket.onAny(socket.__eventCacheListener);
    }

    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    const timer = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error('Timed out connecting to server'));
    }, 5000);

    const onConnect = () => {
      clearTimeout(timer);
      cleanup();
      resolve(socket);
    };

    const onError = (error) => {
      clearTimeout(timer);
      cleanup();
      reject(error instanceof Error ? error : new Error(error?.message || 'connect_error'));
    };

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  });

describe('Game setup integration', () => {
  let tmpDir;
  let originalEnv;
  let start;
  let stop;
  let httpServer;
  let baseUrl;
  let stateManager;
  let roomManager;
  const clients = [];

  const addClient = (socket) => {
    clients.push(socket);
    return socket;
  };

  const closeClients = async () => {
    const open = clients.splice(0);
    await Promise.all(open.map((socket) => disconnectClient(socket)));
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-game-setup-'));

    originalEnv = {
      STATE_BASE_DIR: process.env.STATE_BASE_DIR,
      STATE_FILE: process.env.STATE_FILE,
      STATE_SNAPSHOT_INTERVAL_MS: process.env.STATE_SNAPSHOT_INTERVAL_MS,
      PORT: process.env.PORT,
      NODE_ENV: process.env.NODE_ENV,
    };

    process.env.STATE_BASE_DIR = tmpDir;
    process.env.STATE_FILE = path.join(tmpDir, 'state.json');
    process.env.STATE_SNAPSHOT_INTERVAL_MS = '0';
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';

    jest.resetModules();

    ({ start, stop, httpServer } = require('../../src/server'));
    ({ stateManager } = require('../../src/modules/stateManager'));
    ({ roomManager } = require('../../src/modules/roomManager'));

    await start();

    const address = httpServer.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await closeClients();

    try {
      if (httpServer?.listening) {
        await stop();
      } else {
        await stateManager.stop();
      }
    } catch (error) {
      if (!/Server is not running/i.test(error?.message || '')) {
        throw error;
      }
      await stateManager.stop();
    }

    await fs.rm(tmpDir, { recursive: true, force: true });

    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });

    jest.resetModules();
  });

  beforeEach(() => {
    stateManager.clear();
    roomManager.ensureDefaultRooms?.();
  });

  afterEach(async () => {
    await closeClients();
    stateManager.clear();
    roomManager.ensureDefaultRooms?.();
  });

  it('prevents host from starting a game with insufficient players', async () => {
    const host = addClient(await connectClient(baseUrl));
    await waitForEvent(host, 'connection_status');

    host.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Ana Host' });
    await waitForEvent(host, 'room_joined');

    host.emit('start_game');
    const error = await waitForEvent(host, 'action_error');

    expect(error).toMatchObject({
      action: 'start_game',
      error: 'insufficient_players',
      message: expect.stringMatching(/At least two connected players/i),
    });
  });

  it('allows the host to start a game and deals blind round cards', async () => {
    const host = addClient(await connectClient(baseUrl));
    await waitForEvent(host, 'connection_status');

    host.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Ana Host' });
    const hostJoined = await waitForEvent(host, 'room_joined');

    const guest = addClient(await connectClient(baseUrl));
    await waitForEvent(guest, 'connection_status');

    guest.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Bruno Support' });
    await waitForEvent(guest, 'room_joined');
    await waitForEvent(host, 'player_joined');

    host.emit('start_game');

    const gameStarted = await waitForEvent(host, 'game_started');
    expect(gameStarted).toMatchObject({
      gameId: expect.any(String),
      playerOrder: expect.arrayContaining([hostJoined.playerId]),
    });

    const roundStarted = await waitForEvent(host, 'round_started');
    expect(roundStarted).toMatchObject({
      roundNumber: 1,
      cardCount: 1,
      isBlindRound: true,
    });

    const hostDeal = await waitForEvent(host, 'cards_dealt');
    expect(Array.isArray(hostDeal.hand)).toBe(true);
    expect(hostDeal.hand).toHaveLength(0);
    expect(Array.isArray(hostDeal.visibleCards)).toBe(true);
    expect(hostDeal.visibleCards.length).toBeGreaterThanOrEqual(1);

    const guestDeal = await waitForEvent(guest, 'cards_dealt');
    expect(guestDeal.hand).toHaveLength(0);
    expect(Array.isArray(guestDeal.visibleCards)).toBe(true);
    expect(guestDeal.visibleCards.length).toBeGreaterThanOrEqual(1);

    const roomSnapshot = stateManager.getRoom(DEFAULT_ROOM_ID);
    expect(roomSnapshot.status).toBe('playing');
    expect(roomSnapshot.gameState.gameId).toBe(gameStarted.gameId);
  });
});
