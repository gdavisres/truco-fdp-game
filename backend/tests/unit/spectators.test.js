'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createStateManager } = require('../../src/modules/stateManager');
const { createRoomManager, DEFAULT_ROOMS, MAX_PLAYERS } = require('../../src/modules/roomManager');
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

describe('Spectator system', () => {
  let tmpDir;
  let stateManager;
  let roomManager;
  let io;
  let logger;
  let connectionHandler;
  const roomId = DEFAULT_ROOMS[0].roomId;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-spectators-'));
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
    await stateManager.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const connectSocket = async (id = 'socket-spectator', overrides = {}) => {
    const socket = createMockSocket(id, overrides);
    await connectionHandler(socket);
    return socket;
  };

  it('allows spectators to join active games and receives state sync', async () => {
    // Arrange existing player and active game state
    const { player: activePlayer } = roomManager.joinRoom({
      roomId,
      displayName: 'Active Player',
      socketId: 'socket-active',
    });

    const room = roomManager.getRoom(roomId);
    const gameId = 'game-123';

    room.update({
      status: 'playing',
      gameState: {
        gameId,
        currentRound: 1,
        currentPhase: 'playing',
        playerOrder: [activePlayer.playerId],
      },
    });
    stateManager.upsertRoom(room);

    stateManager.setGame(gameId, {
      gameId,
      roomId,
      currentRound: 1,
      currentPhase: 'playing',
      playerOrder: [activePlayer.playerId],
      rounds: [],
    });

    const spectatorSocket = await connectSocket('socket-spectator');

    // Act
    await spectatorSocket.handlers.join_room({ roomId, displayName: 'Watcher', spectator: true });

    // Assert join payload
    const roomJoinedCall = spectatorSocket.emit.mock.calls.find(([event]) => event === 'room_joined');
    expect(roomJoinedCall).toBeDefined();
    const [, payload] = roomJoinedCall;
    expect(payload).toMatchObject({
      roomId,
      playerId: expect.any(String),
      isSpectator: true,
      currentPlayers: expect.any(Array),
      spectators: expect.any(Array),
    });
    expect(payload.currentPlayers).toHaveLength(1);
    expect(payload.spectators.some((entry) => entry.playerId === payload.playerId)).toBe(true);

    // Spectator receives state sync
    const stateUpdateCall = spectatorSocket.emit.mock.calls.find(([event]) => event === 'game_state_update');
    expect(stateUpdateCall).toBeDefined();
    expect(stateUpdateCall[1]).toMatchObject({
      gameState: expect.objectContaining({ gameId }),
      yourPlayerId: payload.playerId,
    });

    // Broadcast announces spectator join only to room
    const spectatorBroadcast = spectatorSocket.emittedRooms.find((entry) => entry.roomId === roomId);
    expect(spectatorBroadcast).toBeDefined();
    expect(spectatorBroadcast.emitter.emit).toHaveBeenCalledWith(
      'spectator_joined',
      expect.objectContaining({
        spectator: expect.objectContaining({
          playerId: payload.playerId,
          isSpectator: true,
        }),
      }),
    );
  });

  it('moves eliminated players to the spectator list after scoring', async () => {
  const { player: playerOne } = roomManager.joinRoom({ roomId, displayName: 'Player One' });
  const { player: playerTwo } = roomManager.joinRoom({ roomId, displayName: 'Player Two' });
  const { player: playerThree } = roomManager.joinRoom({ roomId, displayName: 'Player Three' });

    const initialRoom = roomManager.getRoom(roomId);

    const playerOneRecord = stateManager.getPlayer(playerOne.playerId);
    playerOneRecord.update({ lives: 1 });
    stateManager.upsertPlayer(playerOneRecord);

  const playerTwoRecord = stateManager.getPlayer(playerTwo.playerId);
  playerTwoRecord.update({ lives: 3 });
  stateManager.upsertPlayer(playerTwoRecord);

  const playerThreeRecord = stateManager.getPlayer(playerThree.playerId);
  playerThreeRecord.update({ lives: 3 });
  stateManager.upsertPlayer(playerThreeRecord);

    const gameState = {
      gameId: 'game-elimination',
      roomId,
      currentRound: 1,
      currentPhase: 'playing',
      playerOrder: [playerOne.playerId, playerTwo.playerId, playerThree.playerId],
      rounds: [
        {
          roundNumber: 1,
          cardCount: 1,
          bids: {
            [playerOne.playerId]: 1,
            [playerTwo.playerId]: 1,
            [playerThree.playerId]: 0,
          },
          tricks: [
            {
              trickNumber: 1,
              winner: playerTwo.playerId,
            },
          ],
        },
      ],
    };

    const hooks = connectionHandler.__testHooks;
    hooks.finalizeRound({
      room: initialRoom,
      gameState,
      roundIndex: 0,
      loggerRef: logger,
    });

    const updatedRoom = roomManager.getRoom(roomId);
  expect(updatedRoom.players).not.toContain(playerOne.playerId);
    expect(updatedRoom.spectators).toContain(playerOne.playerId);

    const updatedPlayer = roomManager.getPlayer(playerOne.playerId);
    expect(updatedPlayer.isSpectator).toBe(true);
  });

  it('does not count spectators toward player capacity or host assignment', () => {
    const spectator = roomManager.joinRoom({
      roomId,
      displayName: 'Observer',
      isSpectator: true,
    });

    const room = roomManager.getRoom(roomId);
    expect(room.players).toHaveLength(0);
    expect(room.spectators).toContain(spectator.player.playerId);

    const storedSpectator = stateManager.getPlayer(spectator.player.playerId);
    expect(storedSpectator.isHost).toBe(false);

    // Fill player slots to capacity and ensure additional spectator still allowed
    for (let index = 0; index < MAX_PLAYERS; index += 1) {
      roomManager.joinRoom({
        roomId,
        displayName: `Player ${index}`,
      });
    }

    expect(() =>
      roomManager.joinRoom({
        roomId,
        displayName: 'Last Watcher',
        isSpectator: true,
      }),
    ).not.toThrow();
  });
});
