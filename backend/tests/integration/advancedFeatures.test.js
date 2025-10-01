'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io: createClient } = require('socket.io-client');

const DEFAULT_ROOM_ID = 'itajuba';

jest.setTimeout(30000);

const waitForEvent = (socket, eventName, timeoutMs = 6000) => {
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
      if (!args || args.length === 0) {
        resolve(undefined);
        return;
      }
      if (args.length === 1) {
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
    }, 250);

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
      timeout: 6000,
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
    }, 6000);

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

const emitWithAck = (socket, event, payload) =>
  new Promise((resolve) => {
    socket.emit(event, payload, (response) => {
      resolve(response);
    });
  });

const waitForEventMatching = async (socket, eventName, predicate, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() <= deadline) {
    const remaining = Math.max(10, deadline - Date.now());

    try {
      // eslint-disable-next-line no-await-in-loop
      const payload = await waitForEvent(socket, eventName, remaining);
      if (!predicate || predicate(payload)) {
        return payload;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Timed out waiting for ${eventName} matching predicate`);
};

const waitForChatMessage = (socket, predicate, timeoutMs = 6000) =>
  waitForEventMatching(socket, 'chat_message_received', predicate, timeoutMs);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Advanced features integration', () => {
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

  const ensureRoomReset = () => {
    stateManager.clear();
    roomManager.ensureDefaultRooms?.();
  };

  const connectAndJoin = async ({ displayName, spectator = false, auth } = {}) => {
    const socket = addClient(await connectClient(baseUrl, { auth }));
    await waitForEvent(socket, 'connection_status');

    socket.emit('join_room', {
      roomId: DEFAULT_ROOM_ID,
      displayName,
      spectator,
    });

    const joined = await waitForEvent(socket, 'room_joined');
    return { socket, joined };
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-advanced-'));

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
    ensureRoomReset();
  });

  afterEach(async () => {
    await closeClients();
    ensureRoomReset();
  });

  it('allows spectators to join mid-game and stay read-only', async () => {
    const { socket: host, joined: hostJoined } = await connectAndJoin({ displayName: 'Ana Host' });

    const { joined: playerJoined } = await connectAndJoin({ displayName: 'Bruno' });
    await waitForEvent(host, 'player_joined');

    host.emit('start_game');
    const gameStarted = await waitForEvent(host, 'game_started');
    expect(gameStarted).toMatchObject({ gameId: expect.any(String) });

    await waitForEvent(host, 'round_started');
    await waitForEvent(host, 'bidding_turn');

    const { socket: spectator, joined: spectatorJoined } = await connectAndJoin({
      displayName: 'Sofia Spectator',
      spectator: true,
    });

    expect(spectatorJoined.isSpectator).toBe(true);
    expect(spectatorJoined.currentPlayers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: hostJoined.playerId }),
        expect.objectContaining({ playerId: playerJoined.playerId }),
      ]),
    );

    await waitForEvent(host, 'spectator_joined');

    const spectatorState = await waitForEvent(spectator, 'game_state_update');
    expect(spectatorState).toMatchObject({
      yourPlayerId: spectatorJoined.playerId,
      gameState: expect.objectContaining({ currentPhase: expect.any(String) }),
    });

    spectator.emit('submit_bid', { bid: 1 });
    const error = await waitForEvent(spectator, 'action_error');
    expect(error).toMatchObject({ action: 'submit_bid', error: 'invalid_turn' });

    spectator.emit('play_card', { card: { rank: 'A', suit: 'hearts' } });
    const playError = await waitForEvent(spectator, 'action_error');
    expect(['play_card', 'submit_bid']).toContain(playError?.action);
    expect(typeof playError?.error).toBe('string');
  });

  it('enforces spectator chat permissions and broadcasts messages', async () => {
    const { socket: host } = await connectAndJoin({ displayName: 'Host' });
    const { socket: player } = await connectAndJoin({ displayName: 'Player' });
    await waitForEvent(host, 'player_joined');

    const { socket: spectator } = await connectAndJoin({ displayName: 'Spec', spectator: true });
    await waitForEvent(host, 'spectator_joined');

    const disableResponse = await emitWithAck(host, 'update_host_settings', {
      allowSpectatorChat: false,
    });
    expect(disableResponse).toMatchObject({ status: 'ok', hostSettings: { allowSpectatorChat: false } });

    const systemDisable = await waitForChatMessage(host, (message) => message?.type === 'system');
    expect(systemDisable.message).toMatch(/spectator chat disabled/i);
    await waitForChatMessage(player, (message) => message?.type === 'system');

    const spectatorErrorAck = await emitWithAck(spectator, 'chat_message', { message: 'Hello players!' });
    expect(spectatorErrorAck).toMatchObject({ error: 'spectator_chat_disabled' });
    const spectatorError = await waitForEvent(spectator, 'action_error');
    expect(spectatorError).toMatchObject({ action: 'chat_message', error: 'spectator_chat_disabled' });

    const enableResponse = await emitWithAck(host, 'update_host_settings', {
      allowSpectatorChat: true,
    });
    expect(enableResponse).toMatchObject({ status: 'ok', hostSettings: { allowSpectatorChat: true } });

    const systemEnable = await waitForChatMessage(host, (message) => message?.type === 'system');
    expect(systemEnable.message).toMatch(/spectator chat enabled/i);

    const hostChatPromise = waitForChatMessage(
      host,
      (message) => message?.message === 'Back online!' && message?.type === 'spectator',
    );
    const playerChatPromise = waitForChatMessage(
      player,
      (message) => message?.message === 'Back online!' && message?.type === 'spectator',
    );
    const spectatorAck = await emitWithAck(spectator, 'chat_message', { message: 'Back online!' });
    expect(spectatorAck).toMatchObject({ status: 'ok', message: expect.any(Object) });

    const [receivedByHost, receivedByPlayer] = await Promise.all([hostChatPromise, playerChatPromise]);
    expect(receivedByHost).toMatchObject({
      message: 'Back online!',
      type: 'spectator',
    });

    expect(receivedByPlayer).toBeDefined();
  });

  it('recovers players after disconnection during bidding', async () => {
    const { socket: host, joined: hostJoined } = await connectAndJoin({ displayName: 'Dealer' });
    const { socket: guest, joined: guestJoined } = await connectAndJoin({ displayName: 'Challenger' });
    await waitForEvent(host, 'player_joined');

    host.emit('start_game');
    const gameStarted = await waitForEvent(host, 'game_started');
    expect(gameStarted).toMatchObject({ playerOrder: expect.any(Array) });
    await waitForEvent(host, 'round_started');

    const firstTurn = await waitForEvent(host, 'bidding_turn');
    expect(firstTurn).toMatchObject({ currentPlayer: hostJoined.playerId });

    host.emit('submit_bid', { bid: 0 });
    await waitForEvent(host, 'bid_submitted');

    const secondTurn = await waitForEvent(host, 'bidding_turn');
    expect(secondTurn).toMatchObject({ currentPlayer: guestJoined.playerId });

    const guestTimer = await waitForEventMatching(
      guest,
      'turn_timer_update',
      (payload) => payload?.playerId === guestJoined.playerId,
    );
    expect(guestTimer).toMatchObject({ playerId: guestJoined.playerId });

    const guestEngine = guest.io?.engine;
    if (guestEngine && typeof guestEngine.close === 'function') {
      guestEngine.close();
    } else {
      guest.disconnect();
    }

    const playerLeft = await waitForEvent(host, 'player_left');
    expect(playerLeft).toMatchObject({ playerId: guestJoined.playerId, reason: 'disconnected' });

    await delay(50);

    const reconnectSocket = addClient(
      await connectClient(baseUrl, {
        auth: { sessionId: guestJoined.sessionId },
      }),
    );

    const reconnectStatus = await waitForEvent(reconnectSocket, 'connection_status');
    expect(reconnectStatus).toMatchObject({ status: 'reconnected' });

    const reconnectJoined = await waitForEvent(reconnectSocket, 'room_joined');
    expect(reconnectJoined).toMatchObject({ playerId: guestJoined.playerId, isSpectator: false });

    const stateSync = await waitForEvent(reconnectSocket, 'game_state_update');
    expect(stateSync.gameState).toMatchObject({ currentPhase: 'bidding' });

    try {
      const syncEvent = await waitForEvent(reconnectSocket, 'action_sync', 500);
      if (syncEvent) {
        expect(syncEvent).toMatchObject({ status: expect.any(String) });
      }
    } catch (error) {
      // action_sync may not fire if no cached actions exist; ignore timeout
    }

    const playerRejoined = await waitForEvent(host, 'player_joined');
    expect(playerRejoined).toMatchObject({ player: expect.objectContaining({ playerId: guestJoined.playerId }) });

    reconnectSocket.emit('submit_bid', { bid: 1 });
    const guestBid = await waitForEventMatching(
      host,
      'bid_submitted',
      (payload) => payload?.playerId === guestJoined.playerId,
    );
    expect(guestBid).toMatchObject({ playerId: guestJoined.playerId, bid: 1 });

    const trickStarted = await waitForEventMatching(reconnectSocket, 'trick_started', () => true);
    expect(trickStarted).toMatchObject({ trickNumber: expect.any(Number) });

    const followUpTimer = await waitForEventMatching(
      reconnectSocket,
      'turn_timer_update',
      (payload) => Boolean(payload?.playerId),
    );
    expect(followUpTimer).toMatchObject({ playerId: expect.any(String) });
  });
});
