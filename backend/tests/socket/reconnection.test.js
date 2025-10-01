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

const roomId = DEFAULT_ROOMS[0].roomId;

describe('socket reconnection handling', () => {
  let tmpDir;
  let logger;
  let io;
  let stateManager;
  let roomManager;
  let connectionHandler;

  const connectSocket = async (id, overrides = {}) => {
    const socket = createMockSocket(id, overrides);
    await connectionHandler(socket);
    return socket;
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-reconnect-'));
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

  it('replays state and last action after reconnecting', async () => {
    const hostSocket = await connectSocket('host');
    await hostSocket.handlers.join_room({ roomId, displayName: 'Host Player' });

    const guestSocket = await connectSocket('guest');
    await guestSocket.handlers.join_room({ roomId, displayName: 'Guest Player' });

    await hostSocket.handlers.start_game();
    await Promise.resolve();

  const activeRoom = roomManager.getRoom(roomId);
  const gameId = activeRoom?.gameState?.gameId;
  expect(gameId).toBeDefined();

  const gameState = stateManager.getGame(gameId);
    expect(gameState).toBeTruthy();

    const hostPlayerId = hostSocket.data.playerId;
    expect(gameState.playerOrder[gameState.currentPlayerIndex]).toBe(hostPlayerId);

    await hostSocket.handlers.submit_bid({ bid: 0 });

    const sessionId = hostSocket.data.sessionId;

    await hostSocket.handlers.disconnect('transport close');

    const reconnectSocket = await connectSocket('host-reconnect', {
      handshake: { auth: { sessionId } },
    });

    const stateUpdateCall = reconnectSocket.emit.mock.calls.find(([eventName]) => eventName === 'game_state_update');
    expect(stateUpdateCall).toBeDefined();
    expect(stateUpdateCall[1]).toMatchObject({
      yourPlayerId: hostPlayerId,
      gameState: expect.objectContaining({ gameId }),
    });

    const actionSyncCall = reconnectSocket.emit.mock.calls.find(([eventName]) => eventName === 'action_sync');
    expect(actionSyncCall).toBeDefined();
    expect(actionSyncCall[1]).toMatchObject({
      action: 'submit_bid',
      payload: { bid: 0 },
      metadata: expect.objectContaining({
        roomId,
        gameId,
        auto: false,
      }),
    });
  });

  it('performs auto action after disconnect timeout when timers are cleared', async () => {
    jest.useFakeTimers();

    const hostSocket = await connectSocket('host');
    await hostSocket.handlers.join_room({ roomId, displayName: 'Host Player' });

    const guestSocket = await connectSocket('guest');
    await guestSocket.handlers.join_room({ roomId, displayName: 'Guest Player' });

    await hostSocket.handlers.start_game();
    await Promise.resolve();

  const activeRoom = roomManager.getRoom(roomId);
  const gameId = activeRoom?.gameState?.gameId;
  expect(gameId).toBeDefined();

  connectionHandler.__testHooks.clearBiddingTimer(gameId);

    const hostPlayerId = hostSocket.data.playerId;

    await hostSocket.handlers.disconnect('transport close');

    const disconnectController = connectionHandler.__testHooks.getDisconnectController(hostPlayerId);
    expect(disconnectController).toBeDefined();
    expect(disconnectController.delayMs).toBeGreaterThanOrEqual(30_000);

  connectionHandler.__testHooks.cancelDisconnectAutoAction(hostPlayerId);
  connectionHandler.__testHooks.processDisconnectAutoAction({ roomId, playerId: hostPlayerId });

    const autoActionEmit = io.emittedRooms
      .filter((entry) => entry.roomId === roomId)
      .flatMap((entry) => entry.emitter.emit.mock.calls)
      .find(([eventName]) => eventName === 'auto_action');

    expect(autoActionEmit).toBeDefined();
    expect(autoActionEmit[1]).toMatchObject({
      playerId: hostPlayerId,
      action: 'auto_bid',
      reason: 'timeout',
    });
  });
});
