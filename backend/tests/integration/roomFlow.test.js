'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');

const DEFAULT_ROOM_ID = 'itajuba';

jest.setTimeout(20000);

const waitForEvent = (socket, eventName, timeoutMs = 5000) => {
  if (socket?.__eventCache?.has(eventName)) {
    const cachedArgs = socket.__eventCache.get(eventName);
    socket.__eventCache.delete(eventName);

    if (!cachedArgs || cachedArgs.length === 0) {
      return Promise.resolve(undefined);
    }

    if (cachedArgs.length === 1) {
      return Promise.resolve(cachedArgs[0]);
    }

    return Promise.resolve(cachedArgs);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    const handler = (...args) => {
      clearTimeout(timer);
      socket.off(eventName, handler);
      if (args.length === 0) {
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Room flow integration', () => {
  let tmpDir;
  let start;
  let stop;
  let httpServer;
  let stateManager;
  let roomManager;
  let baseUrl;
  let clients;
  let originalEnv;

  const removeClient = (socket) => {
    const index = clients.indexOf(socket);
    if (index !== -1) {
      clients.splice(index, 1);
    }
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
      if (socket.disconnected || !socket.connected) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        socket.off('disconnect', onDisconnect);
        resolve();
      }, 150);

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

    removeClient(socket);
  };

  const closeClients = async () => {
    const openClients = clients.splice(0);
    await Promise.all(openClients.map((socket) => disconnectClient(socket)));
  };

  const connectClient = (options = {}) =>
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
      socket.onAny(socket.__eventCacheListener);

      const timer = setTimeout(() => {
        cleanup();
        socket.disconnect();
        reject(new Error('Timed out connecting to server'));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };

      const onConnect = () => {
        cleanup();
        clients.push(socket);
        resolve(socket);
      };

      const onError = (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(error?.message || 'connect_error'));
      };

      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
    });

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-room-flow-'));

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
    clients = [];
    stateManager.clear();
    if (typeof roomManager?.ensureDefaultRooms === 'function') {
      roomManager.ensureDefaultRooms();
    }
  });

  afterEach(async () => {
    await closeClients();
    stateManager.clear();
    if (typeof roomManager?.ensureDefaultRooms === 'function') {
      roomManager.ensureDefaultRooms();
    }
  });

  it('allows players to join, broadcast presence, and leave rooms', async () => {
    const api = request(baseUrl);

    const listResponse = await api.get('/api/rooms').expect(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body).toHaveLength(5);

    const alice = await connectClient();
    const aliceStatus = await waitForEvent(alice, 'connection_status');
    expect(aliceStatus).toMatchObject({ status: 'connected' });

    const joinedAlicePromise = waitForEvent(alice, 'room_joined');
    alice.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Ana Maria' });
    const aliceJoined = await joinedAlicePromise;

    expect(aliceJoined).toMatchObject({
      roomId: DEFAULT_ROOM_ID,
      playerId: expect.any(String),
      sessionId: expect.any(String),
    });
    expect(aliceJoined.currentPlayers).toHaveLength(1);

    const bob = await connectClient();
    await waitForEvent(bob, 'connection_status');

    const playerJoinedPromise = waitForEvent(alice, 'player_joined');
    const bobJoinedPromise = waitForEvent(bob, 'room_joined');
    bob.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Bruno' });

    const bobJoined = await bobJoinedPromise;
    const playerJoined = await playerJoinedPromise;

    expect(bobJoined.currentPlayers).toHaveLength(2);
    expect(playerJoined).toMatchObject({
      player: expect.objectContaining({
        displayName: 'Bruno',
      }),
    });

    const leftPromise = waitForEvent(alice, 'room_left');
    const broadcastLeftPromise = waitForEvent(bob, 'player_left');
    alice.emit('leave_room');

    await leftPromise;
    const leftPayload = await broadcastLeftPromise;

    expect(leftPayload).toMatchObject({
      playerId: aliceJoined.playerId,
      reason: 'voluntary',
    });

    const updatedRooms = await api.get('/api/rooms').expect(200);
    const targetRoom = updatedRooms.body.find((room) => room.roomId === DEFAULT_ROOM_ID);
    expect(targetRoom).toMatchObject({ playerCount: 1, canJoin: true });
  });

  it('restores sessions when clients reconnect with the same sessionId', async () => {
    const alice = await connectClient();
    await waitForEvent(alice, 'connection_status');

    const joinedAlicePromise = waitForEvent(alice, 'room_joined');
    alice.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Carla' });
    const aliceJoined = await joinedAlicePromise;

    expect(aliceJoined).toMatchObject({
      roomId: DEFAULT_ROOM_ID,
      sessionId: expect.any(String),
    });

    await disconnectClient(alice);

    const reconnecting = await connectClient({ auth: { sessionId: aliceJoined.sessionId } });
    const status = await waitForEvent(reconnecting, 'connection_status');
    expect(status).toMatchObject({ status: 'reconnected' });

    const rejoined = await waitForEvent(reconnecting, 'room_joined');
    expect(rejoined.playerId).toBe(aliceJoined.playerId);
    expect(rejoined.sessionId).toBe(aliceJoined.sessionId);

    const api = request(baseUrl);
    const rooms = await api.get('/api/rooms').expect(200);
    const targetRoom = rooms.body.find((room) => room.roomId === DEFAULT_ROOM_ID);
    expect(targetRoom).toMatchObject({ playerCount: 1 });
  });

  it('includes current players with host metadata when broadcasting room state', async () => {
    const alice = await connectClient();
    await waitForEvent(alice, 'connection_status');

    alice.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Alice Host' });
    const aliceJoined = await waitForEvent(alice, 'room_joined');

    expect(aliceJoined).toMatchObject({
      roomId: DEFAULT_ROOM_ID,
      isHost: true,
      currentPlayers: [
        expect.objectContaining({
          displayName: 'Alice Host',
          isHost: true,
        }),
      ],
    });

    const bob = await connectClient();
    await waitForEvent(bob, 'connection_status');

    const joinedPayload = waitForEvent(bob, 'room_joined');
    const broadcastPayload = waitForEvent(alice, 'player_joined');

    bob.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Bob Support' });

    const bobJoined = await joinedPayload;
    const broadcast = await broadcastPayload;

    expect(bobJoined.currentPlayers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Alice Host', isHost: true }),
        expect.objectContaining({ displayName: 'Bob Support', isHost: false }),
      ]),
    );
    expect(broadcast.player).toMatchObject({ displayName: 'Bob Support', isHost: false });
  });

  it('promotes the next connected player to host when the current host disconnects', async () => {
    const alice = await connectClient();
    await waitForEvent(alice, 'connection_status');

    alice.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Ana Host' });
    const aliceJoined = await waitForEvent(alice, 'room_joined');

    const bob = await connectClient();
    await waitForEvent(bob, 'connection_status');

    bob.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Bruno Second' });
    const bobJoined = await waitForEvent(bob, 'room_joined');
    await waitForEvent(alice, 'player_joined');

    expect(aliceJoined.isHost).toBe(true);
    expect(bobJoined.isHost).toBe(false);

    const disconnectNotice = waitForEvent(bob, 'player_left');
    await disconnectClient(alice);
    const leftPayload = await disconnectNotice;

    expect(leftPayload).toMatchObject({
      playerId: aliceJoined.playerId,
      reason: 'disconnected',
    });

  await delay(100);
    const bobSnapshot = roomManager.getPlayer(bobJoined.playerId);
    expect(bobSnapshot.isHost).toBe(true);

    const api = request(baseUrl);
    const updatedRoom = await api.get('/api/rooms').expect(200);
    const roomEntry = updatedRoom.body.find((room) => room.roomId === DEFAULT_ROOM_ID);
    expect(roomEntry).toMatchObject({ playerCount: 2, canJoin: true });

    const aliceSnapshot = roomManager.getPlayer(aliceJoined.playerId);
    expect(aliceSnapshot.connectionStatus).toBe('disconnected');
  });

  it('rejects invalid join payloads with descriptive errors', async () => {
    const invalidRoomClient = await connectClient();
    await waitForEvent(invalidRoomClient, 'connection_status');

    const errorPromise = waitForEvent(invalidRoomClient, 'join_error');
    invalidRoomClient.emit('join_room', { roomId: 'unknown-room', displayName: 'Tester' });
    const error = await errorPromise;

    expect(error).toMatchObject({
      error: 'invalid_room',
    });

    await disconnectClient(invalidRoomClient);

    const invalidNameClient = await connectClient();
    await waitForEvent(invalidNameClient, 'connection_status');

    const shortNamePromise = waitForEvent(invalidNameClient, 'join_error');
    invalidNameClient.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Hi' });
    const shortNameError = await shortNamePromise;
    expect(shortNameError).toMatchObject({
      error: 'invalid_name',
    });

    await disconnectClient(invalidNameClient);
  });

  it('prevents duplicate display names in a room and surfaces join errors', async () => {
    const alice = await connectClient();
    await waitForEvent(alice, 'connection_status');
    alice.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Duplicate' });
    await waitForEvent(alice, 'room_joined');

    const bob = await connectClient();
    await waitForEvent(bob, 'connection_status');

    const joinErrorPromise = waitForEvent(bob, 'join_error');
    bob.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Duplicate' });
    const joinError = await joinErrorPromise;

    expect(joinError).toMatchObject({
      error: 'name_taken',
    });
  });
});
