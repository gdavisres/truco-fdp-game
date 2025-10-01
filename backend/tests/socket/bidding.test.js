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

const findEmittedPayloads = (io, eventName) =>
  io.emittedRooms
    .flatMap((entry) => entry.emitter.emit.mock.calls.filter((call) => call[0] === eventName))
    .map((call) => call[1]);

const flushAsync = () => Promise.resolve();

describe('submit_bid socket handler', () => {
  let tmpDir;
  let stateManager;
  let roomManager;
  let io;
  let logger;
  let connectionHandler;
  const roomId = DEFAULT_ROOMS[0].roomId;

  beforeEach(async () => {
    jest.useFakeTimers();

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-bidding-'));
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
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
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

  const startGameForPlayers = async ({ hostSocket, otherSockets = [] }) => {
    const hostId = await joinRoom(hostSocket, 'Host Player');
    const playerIds = [hostId];

    for (let index = 0; index < otherSockets.length; index += 1) {
      const socket = otherSockets[index];
      const name = `Player ${index + 2}`;
      const playerId = await joinRoom(socket, name);
      playerIds.push(playerId);
    }

    await hostSocket.handlers.start_game();
    await flushAsync();

    const roomSnapshot = roomManager.getRoom(roomId).toJSON();
    return {
      playerIds,
      gameId: roomSnapshot.gameState.gameId,
    };
  };

  it('progresses bidding sequence and transitions to playing phase', async () => {
    const hostSocket = await connectSocket('socket-host');
    const socketTwo = await connectSocket('socket-two');
    const socketThree = await connectSocket('socket-three');

    const { playerIds, gameId } = await startGameForPlayers({
      hostSocket,
      otherSockets: [socketTwo, socketThree],
    });

    // host submits bid
    await hostSocket.handlers.submit_bid({ bid: 0 });
    await flushAsync();

    let gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.rounds[0].bids[playerIds[0]]).toBe(0);

    let bidEvents = findEmittedPayloads(io, 'bid_submitted');
    expect(bidEvents.at(-1)).toMatchObject({ playerId: playerIds[0], bid: 0 });

    let turnEvents = findEmittedPayloads(io, 'bidding_turn');
    expect(turnEvents.at(-1)).toMatchObject({ currentPlayer: playerIds[1] });

    // second player
    await socketTwo.handlers.submit_bid({ bid: 1 });
    await flushAsync();

    gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.rounds[0].bids[playerIds[1]]).toBe(1);

    bidEvents = findEmittedPayloads(io, 'bid_submitted');
    expect(bidEvents.at(-1)).toMatchObject({ playerId: playerIds[1], bid: 1 });

    turnEvents = findEmittedPayloads(io, 'bidding_turn');
    expect(turnEvents.at(-1)).toMatchObject({ currentPlayer: playerIds[2] });

    // last player completes bidding
    await socketThree.handlers.submit_bid({ bid: 1 });
    await flushAsync();

    gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.currentPhase).toBe('playing');
    expect(gameSnapshot.rounds[0].bids).toEqual({
      [playerIds[0]]: 0,
      [playerIds[1]]: 1,
      [playerIds[2]]: 1,
    });
    const expectedPlayingPlayer = gameSnapshot.playerOrder?.[gameSnapshot.currentPlayerIndex ?? 0];

    bidEvents = findEmittedPayloads(io, 'bid_submitted');
    const finalBidEvent = bidEvents.at(-1);
    expect(finalBidEvent.playerId).toBe(playerIds[2]);
    expect(finalBidEvent.allBids).toEqual({
      [playerIds[0]]: 0,
      [playerIds[1]]: 1,
      [playerIds[2]]: 1,
    });

    const timerUpdates = findEmittedPayloads(io, 'turn_timer_update');
    const lastBiddingUpdate = [...timerUpdates]
      .reverse()
      .find((payload) => payload?.phase === 'bidding');
    expect(lastBiddingUpdate).toMatchObject({
      phase: 'bidding',
      playerId: playerIds[2],
    });
    expect(Number.isFinite(lastBiddingUpdate.deadline)).toBe(true);

    const lastPlayingUpdate = [...timerUpdates]
      .reverse()
      .find((payload) => payload?.phase === 'playing');
    expect(lastPlayingUpdate).toMatchObject({
      phase: 'playing',
      playerId: expectedPlayingPlayer,
    });
    expect(Number.isFinite(lastPlayingUpdate.deadline)).toBe(true);
    expect(Number.isFinite(lastPlayingUpdate.duration)).toBe(true);
  });

  it('starts the first trick after bids complete in a two-player blind round', async () => {
    const hostSocket = await connectSocket('socket-host');
    const socketTwo = await connectSocket('socket-two');

    const { playerIds, gameId } = await startGameForPlayers({
      hostSocket,
      otherSockets: [socketTwo],
    });

    await hostSocket.handlers.submit_bid({ bid: 0 });
    await flushAsync();

    await socketTwo.handlers.submit_bid({ bid: 0 });
    await flushAsync();

    const gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.currentPhase).toBe('playing');
    expect(gameSnapshot.rounds[0].tricks).toHaveLength(1);

    const trickEvents = findEmittedPayloads(io, 'trick_started');
    expect(trickEvents.length).toBeGreaterThan(0);
    const finalTrickEvent = trickEvents.at(-1);
    expect(finalTrickEvent).toMatchObject({
      trickNumber: 1,
      leadPlayer: playerIds[0],
    });
  });

  it('allows the last bidder to match the total during a blind round', async () => {
    const hostSocket = await connectSocket('socket-host');
    const socketTwo = await connectSocket('socket-two');
    const socketThree = await connectSocket('socket-three');

    const { playerIds } = await startGameForPlayers({
      hostSocket,
      otherSockets: [socketTwo, socketThree],
    });

    await hostSocket.handlers.submit_bid({ bid: 0 });
    await socketTwo.handlers.submit_bid({ bid: 0 });

    await flushAsync();

    await socketThree.handlers.submit_bid({ bid: 1 });

    const errorCall = socketThree.emit.mock.calls.find(([event]) => event === 'action_error');
    expect(errorCall).toBeUndefined();

    await flushAsync();

    const gameSnapshot = stateManager.getGame(roomManager.getRoom(roomId).gameState.gameId);
    expect(gameSnapshot.rounds[0].bids).toEqual({
      [playerIds[0]]: 0,
      [playerIds[1]]: 0,
      [playerIds[2]]: 1,
    });
  });

  it('auto bids when player timer expires', async () => {
    const hostSocket = await connectSocket('socket-host');
    const socketTwo = await connectSocket('socket-two');

    const roomInstance = roomManager.getRoom(roomId);
    roomInstance.update({
      hostSettings: {
        ...roomInstance.hostSettings,
        turnTimer: 5,
      },
    });
    stateManager.upsertRoom(roomInstance);

    const { playerIds, gameId } = await startGameForPlayers({
      hostSocket,
      otherSockets: [socketTwo],
    });

    jest.advanceTimersByTime(5000);
    await flushAsync();

    const autoEvents = findEmittedPayloads(io, 'auto_action');
    expect(autoEvents.at(-1)).toMatchObject({
      playerId: playerIds[0],
      action: 'auto_bid',
      value: 0,
      reason: 'timeout',
    });

    let gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.rounds[0].bids[playerIds[0]]).toBe(0);

  await socketTwo.handlers.submit_bid({ bid: 0 });
    await flushAsync();

    gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.rounds[0].bids[playerIds[1]]).toBe(0);
  });
});
