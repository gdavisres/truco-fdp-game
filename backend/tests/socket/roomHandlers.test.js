'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createStateManager } = require('../../src/modules/stateManager');
const { createRoomManager, DEFAULT_ROOMS } = require('../../src/modules/roomManager');
const { createRoomSocketHandlers } = require('../../src/socket/roomHandlers');

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

const createIoStub = () => {
  const io = {
    to: jest.fn(),
    emittedRooms: [],
  };

  io.to.mockImplementation((roomId) => {
    const emitter = {
      emit: jest.fn(),
    };

    io.emittedRooms.push({ roomId, emitter });
    return emitter;
  });

  return io;
};

const createMockSocket = (id, overrides = {}) => {
  const socket = {
    id,
    data: {},
    handshake: { auth: {} },
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    to: jest.fn(),
    on: jest.fn(),
    conn: { transport: { name: 'polling' } },
    handlers: {},
    emittedRooms: [],
    ...overrides,
  };

  socket.to.mockImplementation((roomId) => {
    const emitter = {
      emit: jest.fn(),
    };

    socket.emittedRooms.push({ roomId, emitter });
    return emitter;
  });

  socket.on.mockImplementation((event, handler) => {
    socket.handlers[event] = handler;
    return socket;
  });

  return socket;
};

describe('roomHandlers', () => {
  let tmpDir;
  let stateManager;
  let roomManager;
  let io;
  let logger;
  let connectionHandler;
  const roomId = DEFAULT_ROOMS[0].roomId;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-room-handlers-'));
    logger = createTestLogger();
    io = createIoStub();

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
    });

  connectionHandler = createRoomSocketHandlers({ io, roomManager, stateManager, logger });
  });

  afterEach(async () => {
    jest.useRealTimers();
    connectionHandler?.__testHooks?.stopSessionSweep?.();
    await stateManager.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const connectSocket = async (id = 'socket-1', overrides = {}) => {
    const socket = createMockSocket(id, overrides);
    await connectionHandler(socket);
    return socket;
  };

  it('handles join_room event successfully', async () => {
    const socket = await connectSocket();

    expect(socket.emit).toHaveBeenCalledWith('connection_status', { status: 'connected' });

    await socket.handlers.join_room({ roomId, displayName: 'Ana Maria' });

    expect(socket.join).toHaveBeenCalledWith(roomId);

    const roomJoinedCall = socket.emit.mock.calls.find(([eventName]) => eventName === 'room_joined');
    expect(roomJoinedCall).toBeDefined();

    const [, payload] = roomJoinedCall;
  expect(payload.roomId).toBe(roomId);
  expect(payload.playerId).toEqual(expect.any(String));
  expect(payload.sessionId).toEqual(expect.any(String));
  expect(Array.isArray(payload.currentPlayers)).toBe(true);
  expect(Array.isArray(payload.spectators)).toBe(true);
  expect(payload.currentPlayers).toHaveLength(1);
  expect(payload.spectators).toHaveLength(0);

    expect(socket.data.sessionId).toBe(payload.sessionId);
    expect(socket.data.playerId).toBe(payload.playerId);
    expect(socket.data.roomId).toBe(roomId);

    const broadcast = socket.emittedRooms.find((entry) => entry.roomId === roomId);
    expect(broadcast).toBeDefined();
    expect(broadcast.emitter.emit).toHaveBeenCalledWith(
      'player_joined',
      expect.objectContaining({
        player: expect.objectContaining({
          playerId: payload.playerId,
        }),
      }),
    );
  });

  it('rejects invalid display names when joining', async () => {
    const socket = await connectSocket();

    await socket.handlers.join_room({ roomId, displayName: 'Jo' });

    const joinError = socket.emit.mock.calls.find(([eventName]) => eventName === 'join_error');
    expect(joinError).toBeDefined();
    expect(joinError[1]).toMatchObject({
      error: 'invalid_name',
    });
  });

  it('rejects attempts to join unavailable rooms', async () => {
    const socket = await connectSocket();

    await socket.handlers.join_room({ roomId: 'unknown-room', displayName: 'Valid Name' });

    const joinError = socket.emit.mock.calls.find(([eventName]) => eventName === 'join_error');
    expect(joinError).toBeDefined();
    expect(joinError[1]).toMatchObject({
      error: 'invalid_room',
    });
  });

  it('handles leave_room by removing player and notifying the room', async () => {
    const socket = await connectSocket();
    await socket.handlers.join_room({ roomId, displayName: 'Ana Maria' });

    const playerId = socket.data.playerId;

    await socket.handlers.leave_room();

    expect(socket.leave).toHaveBeenCalledWith(roomId);

    const leftEvent = socket.emit.mock.calls.find(([eventName]) => eventName === 'room_left');
    expect(leftEvent).toBeDefined();
    expect(leftEvent[1]).toBeNull();

    const broadcast = socket.emittedRooms.find((entry) => entry.roomId === roomId && entry.emitter.emit.mock.calls.some(([eventName]) => eventName === 'player_left'));
    expect(broadcast).toBeDefined();

    const player = stateManager.getPlayer(playerId);
    expect(player).toBeNull();
  });

  it('marks players as disconnected on socket disconnect', async () => {
    const socket = await connectSocket();
    await socket.handlers.join_room({ roomId, displayName: 'Ana Maria' });

    const playerId = socket.data.playerId;

    await socket.handlers.disconnect('transport close');

    const player = stateManager.getPlayer(playerId);
    expect(player.connectionStatus).toBe('disconnected');

    const broadcast = socket.emittedRooms.find((entry) =>
      entry.roomId === roomId &&
      entry.emitter.emit.mock.calls.some(([eventName, payload]) => eventName === 'player_left' && payload.reason === 'disconnected'),
    );

    expect(broadcast).toBeDefined();
  });

  it('restores players when connecting with a valid sessionId', async () => {
    const firstSocket = await connectSocket('socket-1');
    await firstSocket.handlers.join_room({ roomId, displayName: 'Ana Maria' });

    const sessionId = firstSocket.data.sessionId;
    const playerId = firstSocket.data.playerId;

    const reconnectSocket = await connectSocket('socket-2', {
      handshake: { auth: { sessionId } },
    });

    const reconnectStatus = reconnectSocket.emit.mock.calls.find(([eventName]) => eventName === 'connection_status');
    expect(reconnectStatus).toBeDefined();
    expect(reconnectStatus[1]).toMatchObject({ status: 'reconnected' });

    const roomJoinedCall = reconnectSocket.emit.mock.calls.find(([eventName]) => eventName === 'room_joined');
    expect(roomJoinedCall).toBeDefined();
    expect(roomJoinedCall[1].playerId).toBe(playerId);
    expect(reconnectSocket.data.sessionId).toBe(sessionId);

    expect(reconnectSocket.join).toHaveBeenCalledWith(roomId);
  });

  it('returns name_taken error when display name already exists', async () => {
    const firstSocket = await connectSocket('socket-1');
    await firstSocket.handlers.join_room({ roomId, displayName: 'Ana Maria' });

    const secondSocket = await connectSocket('socket-2');
    await secondSocket.handlers.join_room({ roomId, displayName: 'Ana Maria' });

    const joinError = secondSocket.emit.mock.calls.find(([eventName]) => eventName === 'join_error');
    expect(joinError).toBeDefined();
    expect(joinError[1]).toMatchObject({
      error: 'name_taken',
    });
  });

  it('broadcasts chat messages to the room and stores them in history', async () => {
    const socket = await connectSocket();
    await socket.handlers.join_room({ roomId, displayName: 'Ana Maria' });

    const ack = jest.fn();
    await socket.handlers.chat_message({ message: '  Hello table  ' }, ack);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        message: expect.objectContaining({ message: 'Hello table' }),
      }),
    );

    const chatEmit = io.emittedRooms
      .filter((entry) => entry.roomId === roomId)
      .flatMap((entry) => entry.emitter.emit.mock.calls)
      .find(([eventName]) => eventName === 'chat_message_received');

    expect(chatEmit).toBeDefined();
    expect(chatEmit[1]).toMatchObject({
      message: 'Hello table',
      playerId: socket.data.playerId,
      type: 'player',
      isSpectator: false,
    });

    const roomSnapshot = stateManager.getRoom(roomId);
    expect(Array.isArray(roomSnapshot.chatLog)).toBe(true);
    expect(roomSnapshot.chatLog).toHaveLength(1);
    expect(roomSnapshot.chatLog[0]).toMatchObject({
      message: 'Hello table',
      playerId: socket.data.playerId,
      type: 'player',
    });
  });

  it('prevents spectator chat when disabled and announces via system message', async () => {
    const hostSocket = await connectSocket('socket-host');
    await hostSocket.handlers.join_room({ roomId, displayName: 'Host Player' });

    const spectatorSocket = await connectSocket('socket-spectator');
    await spectatorSocket.handlers.join_room({ roomId, displayName: 'Spectator Sam', spectator: true });

    const updateAck = jest.fn();
    await hostSocket.handlers.update_host_settings({ allowSpectatorChat: false }, updateAck);

    expect(updateAck).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        hostSettings: expect.objectContaining({ allowSpectatorChat: false }),
      }),
    );

    const systemMessageEmit = io.emittedRooms
      .filter((entry) => entry.roomId === roomId)
      .flatMap((entry) => entry.emitter.emit.mock.calls)
      .find(([eventName, payload]) => eventName === 'chat_message_received' && payload.type === 'system');

    expect(systemMessageEmit).toBeDefined();
    expect(systemMessageEmit[1].message).toMatch(/disabled/i);

    const spectatorAck = jest.fn();
    await spectatorSocket.handlers.chat_message({ message: 'Can anyone hear me?' }, spectatorAck);

    expect(spectatorAck).toHaveBeenCalledWith(expect.objectContaining({ error: 'spectator_chat_disabled' }));

    const actionError = spectatorSocket.emit.mock.calls.find(
      ([eventName, payload]) =>
        eventName === 'action_error' && payload.action === 'chat_message' && payload.error === 'spectator_chat_disabled',
    );
    expect(actionError).toBeDefined();
  });

  it('includes recent chat messages in room_joined payloads', async () => {
    const firstSocket = await connectSocket('socket-1');
    await firstSocket.handlers.join_room({ roomId, displayName: 'Player One' });
    await firstSocket.handlers.chat_message({ message: 'History check' }, jest.fn());

    const newcomer = await connectSocket('socket-2');
    await newcomer.handlers.join_room({ roomId, displayName: 'Player Two' });

    const joinCall = newcomer.emit.mock.calls.find(([eventName]) => eventName === 'room_joined');
    expect(joinCall).toBeDefined();
    expect(Array.isArray(joinCall[1].chatMessages)).toBe(true);
    expect(joinCall[1].chatMessages).toHaveLength(1);
    expect(joinCall[1].chatMessages[0]).toMatchObject({
      message: 'History check',
      type: 'player',
    });
  });
});
