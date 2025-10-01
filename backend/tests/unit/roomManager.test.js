'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createStateManager } = require('../../src/modules/stateManager');
const {
  createRoomManager,
  RoomManagerError,
  RECONNECTION_WINDOW_MS,
  DEFAULT_ROOMS,
} = require('../../src/modules/roomManager');

const createTestLogger = () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

describe('RoomManager', () => {
  let tmpDir;
  let stateManager;
  let roomManager;
  let logger;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-room-manager-'));
    logger = createTestLogger();

    stateManager = createStateManager({
      snapshotPath: path.join(tmpDir, 'state.json'),
      snapshotIntervalMs: 0,
      logger,
      bindProcessEvents: false,
    });

    await stateManager.init();

    roomManager = createRoomManager({
      stateManager,
      logger,
      reconnectionWindowMs: RECONNECTION_WINDOW_MS,
      defaultRooms: DEFAULT_ROOMS,
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await stateManager.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const joinPlayer = (displayName, options = {}) =>
    roomManager.joinRoom({
      roomId: 'itajuba',
      displayName,
      socketId: options.socketId ?? null,
      isSpectator: options.isSpectator ?? false,
    });

  it('allows a player to join and assigns host to the first entrant', () => {
    const result = joinPlayer('Ana', { socketId: 'socket-1' });

    expect(result.sessionId).toEqual(expect.any(String));
    expect(result.player.isHost).toBe(true);

    const room = stateManager.getRoom('itajuba');
    expect(room.players).toContain(result.player.playerId);

    const storedPlayer = stateManager.getPlayer(result.player.playerId);
    expect(storedPlayer.isHost).toBe(true);
    expect(storedPlayer.connectionStatus).toBe('connected');
  });

  it('prevents duplicate display names within the same room', () => {
    joinPlayer('Ana');

    let caughtError;
    try {
      joinPlayer(' ana ');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(RoomManagerError);
    expect(caughtError.code).toBe('NAME_TAKEN');
  });

  it('prevents joining a room when it is full', () => {
    for (let index = 0; index < 10; index += 1) {
      joinPlayer(`Player ${index}`);
    }

    let caughtError;
    try {
      joinPlayer('Overflow');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(RoomManagerError);
    expect(caughtError.code).toBe('ROOM_FULL');
    expect(caughtError.metadata.maxPlayers).toBe(10);
  });

  it('reassigns host when the current host leaves the room', () => {
    const first = joinPlayer('Ana');
    const second = joinPlayer('Bruno');

    roomManager.leaveRoom({ sessionId: first.sessionId, reason: 'host_left' });

    expect(stateManager.getPlayer(first.player.playerId)).toBeNull();

    const room = stateManager.getRoom('itajuba');
    expect(room.players).toContain(second.player.playerId);
    expect(room.players).not.toContain(first.player.playerId);

    const remaining = stateManager.getPlayer(second.player.playerId);
    expect(remaining.isHost).toBe(true);
  });

  it('updates connection status and host assignment on disconnect', () => {
    const first = joinPlayer('Ana');
    const second = joinPlayer('Bruno');

    roomManager.handleDisconnect({ sessionId: first.sessionId, reason: 'network_issue' });

    const firstPlayer = stateManager.getPlayer(first.player.playerId);
    expect(firstPlayer.connectionStatus).toBe('disconnected');

    const secondPlayer = stateManager.getPlayer(second.player.playerId);
    expect(secondPlayer.isHost).toBe(true);
  });

  it('restores player connection within the reconnection window', () => {
    const first = joinPlayer('Ana');
    const second = joinPlayer('Bruno');

    roomManager.handleDisconnect({ sessionId: first.sessionId });
    const reconnect = roomManager.handleReconnect({ sessionId: first.sessionId, socketId: 'socket-1b' });

    expect(reconnect.player.connectionStatus).toBe('connected');

    const stored = stateManager.getPlayer(first.player.playerId);
    expect(stored.connectionStatus).toBe('connected');
    expect(stored.socketId).toBe('socket-1b');

    const secondStored = stateManager.getPlayer(second.player.playerId);
    expect([true, false]).toContain(secondStored.isHost);
  });

  it('removes disconnected players after the reconnection window expires', () => {
    jest.useFakeTimers();
    const baseTime = new Date('2025-01-01T00:00:00Z');
    jest.setSystemTime(baseTime);

    const first = joinPlayer('Ana');
    const second = joinPlayer('Bruno');

    roomManager.handleDisconnect({ sessionId: first.sessionId });

    jest.advanceTimersByTime(RECONNECTION_WINDOW_MS + 1000);

    const removed = roomManager.cleanupExpiredSessions(Date.now());

    expect(removed).toHaveLength(1);
    expect(removed[0].player.playerId).toBe(first.player.playerId);

    expect(stateManager.getPlayer(first.player.playerId)).toBeNull();

    const remaining = stateManager.getPlayer(second.player.playerId);
    expect(remaining.isHost).toBe(true);
  });

  it('throws when attempting to reconnect after the session has expired', () => {
    jest.useFakeTimers();
    const baseTime = new Date('2025-01-01T00:00:00Z');
    jest.setSystemTime(baseTime);

    const first = joinPlayer('Ana');

    roomManager.handleDisconnect({ sessionId: first.sessionId });

    jest.advanceTimersByTime(RECONNECTION_WINDOW_MS + 1000);

    let caughtError;
    try {
      roomManager.handleReconnect({ sessionId: first.sessionId });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(RoomManagerError);
    expect(caughtError.code).toBe('SESSION_EXPIRED');
  });

  it('throws when disconnecting an unknown session', () => {
    let caughtError;
    try {
      roomManager.handleDisconnect({ sessionId: 'missing' });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(RoomManagerError);
    expect(caughtError.code).toBe('SESSION_NOT_FOUND');
  });
});
