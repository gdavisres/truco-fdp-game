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
  const sockets = new Map();
  const io = {
    to: jest.fn((roomId) => {
      const emitter = {
        emit: jest.fn(),
      };
      io.emittedRooms.push({ roomId, emitter });
      return emitter;
    }),
    sockets: {
      sockets,
    },
    emittedRooms: [],
  };

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
    conn: { transport: { name: 'websocket' } },
    handlers: {},
    ...overrides,
  };

  socket.to.mockImplementation((roomId) => {
    const emitter = {
      emit: jest.fn(),
    };
    socket.emittedRooms = socket.emittedRooms || [];
    socket.emittedRooms.push({ roomId, emitter });
    return emitter;
  });

  socket.on.mockImplementation((event, handler) => {
    socket.handlers[event] = handler;
    return socket;
  });

  return socket;
};

describe('start_game socket handler', () => {
  let tmpDir;
  let stateManager;
  let roomManager;
  let io;
  let logger;
  let connectionHandler;
  const roomId = DEFAULT_ROOMS[0].roomId;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-game-start-'));
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
    await stateManager.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const connectSocket = async (id, overrides = {}) => {
    const socket = createMockSocket(id, overrides);
    await connectionHandler(socket);
    io.sockets.sockets.set(socket.id, socket);
    return socket;
  };

  const joinRoom = async (socket, displayName) => {
    await socket.handlers.join_room({ roomId, displayName });
    return socket.data.playerId;
  };

  it('allows host to start game and deals cards with blind round visibility', async () => {
    const hostSocket = await connectSocket('socket-host');
    const hostPlayerId = await joinRoom(hostSocket, 'Host Player');

    const socketTwo = await connectSocket('socket-two');
    const playerTwoId = await joinRoom(socketTwo, 'Player Two');

    const socketThree = await connectSocket('socket-three');
    await joinRoom(socketThree, 'Player Three');

    await hostSocket.handlers.start_game();

    const gameStartedCall = io.emittedRooms
      .flatMap((entry) => entry.emitter.emit.mock.calls.map((call) => ({ roomId: entry.roomId, call })))
      .find(({ call }) => call[0] === 'game_started');

    expect(gameStartedCall).toBeDefined();
    const startedPayload = gameStartedCall.call[1];
    expect(startedPayload.gameId).toEqual(expect.any(String));
    expect(startedPayload.playerOrder).toEqual(expect.arrayContaining([hostPlayerId, playerTwoId]));

    const roundStartedCall = io.emittedRooms
      .flatMap((entry) => entry.emitter.emit.mock.calls.map((call) => ({ roomId: entry.roomId, call })))
      .find(({ call }) => call[0] === 'round_started');
    expect(roundStartedCall).toBeDefined();
    expect(roundStartedCall.call[1]).toMatchObject({ roundNumber: 1, cardCount: 1, isBlindRound: true });

    const hostDeal = hostSocket.emit.mock.calls.find(([event]) => event === 'cards_dealt');
    expect(hostDeal).toBeDefined();
    // In blind rounds, hand contains hidden cards (cards with hidden: true)
    expect(Array.isArray(hostDeal[1].hand)).toBe(true);
    expect(hostDeal[1].hand.length).toBe(1); // Round 1 has 1 card
    expect(hostDeal[1].hand[0].hidden).toBe(true); // Card should be marked as hidden
    expect(Array.isArray(hostDeal[1].visibleCards)).toBe(true);
    expect(hostDeal[1].visibleCards.length).toBeGreaterThanOrEqual(2);
    expect(
      hostDeal[1].visibleCards.every(
        (card) => typeof card.ownerDisplayName === 'string' && card.ownerDisplayName.length > 0,
      ),
    ).toBe(true);

    const secondDeal = socketTwo.emit.mock.calls.find(([event]) => event === 'cards_dealt');
    expect(secondDeal).toBeDefined();
    // In blind rounds, hand contains hidden cards (cards with hidden: true)
    expect(Array.isArray(secondDeal[1].hand)).toBe(true);
    expect(secondDeal[1].hand.length).toBe(1); // Round 1 has 1 card
    expect(secondDeal[1].hand[0].hidden).toBe(true); // Card should be marked as hidden
    expect(Array.isArray(secondDeal[1].visibleCards)).toBe(true);
    expect(secondDeal[1].visibleCards.length).toBeGreaterThanOrEqual(2);
    expect(
      secondDeal[1].visibleCards.every(
        (card) => typeof card.ownerDisplayName === 'string' && card.ownerDisplayName.length > 0,
      ),
    ).toBe(true);

    const room = stateManager.getRoom(roomId);
    expect(room.status).toBe('playing');
    expect(room.gameState.gameId).toBe(startedPayload.gameId);

    const gameRecord = stateManager.getGame(startedPayload.gameId);
    expect(gameRecord).not.toBeNull();
    expect(gameRecord.currentRound).toBe(1);
  });

  it('prevents non-host players from starting the game', async () => {
    const hostSocket = await connectSocket('socket-host');
    await joinRoom(hostSocket, 'Host Player');

    const otherSocket = await connectSocket('socket-two');
    await joinRoom(otherSocket, 'Player Two');

    await otherSocket.handlers.start_game();

    const errorCall = otherSocket.emit.mock.calls.find(([event]) => event === 'action_error');
    expect(errorCall).toBeDefined();
    expect(errorCall[1]).toMatchObject({ action: 'start_game', error: 'not_host' });
  });
});
