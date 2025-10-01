'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createStateManager } = require('../../src/modules/stateManager');
const { createRoomManager, DEFAULT_ROOMS } = require('../../src/modules/roomManager');
const { createRoomSocketHandlers } = require('../../src/socket/roomHandlers');
const { GameState } = require('../../src/modules/stateManager/GameState');
const { Card } = require('../../src/modules/cardEngine');

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

const getEmittedEvents = (io, eventName) =>
  io.emittedRooms
    .flatMap(({ roomId, emitter }) =>
      emitter.emit.mock.calls
        .filter(([name]) => name === eventName)
        .map(([, payload]) => ({ roomId, payload })),
    );

describe('game completion flow', () => {
  let tmpDir;
  let stateManager;
  let roomManager;
  let io;
  let logger;
  let handler;
  const roomId = DEFAULT_ROOMS[0].roomId;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-game-completion-'));
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

    handler = createRoomSocketHandlers({ io, roomManager, stateManager, logger });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await stateManager.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const joinPlayer = (displayName, { socketId = null } = {}) => {
    const result = roomManager.joinRoom({
      roomId,
      displayName,
      socketId,
    });

    return result.player.playerId;
  };

  const ROUND_TRANSITION_DELAY_MS = 200;

  it('deducts lives, eliminates players, and starts a new round when a player is knocked out', () => {
    jest.useFakeTimers();

    const { finalizeRound } = handler.__testHooks;

    const playerA = joinPlayer('Ana');
    const playerB = joinPlayer('Bruno');
    const playerC = joinPlayer('Carla');

    const room = roomManager.getRoom(roomId);
    room.update({
      status: 'playing',
      players: [playerA, playerB, playerC],
      spectators: [],
      hostSettings: {
        ...room.hostSettings,
        startingLives: 3,
      },
      gameState: {
        gameId: 'game-elimination',
        currentRound: 1,
      },
    });
    stateManager.upsertRoom(room);

    [
      { id: playerA, lives: 3 },
      { id: playerB, lives: 3 },
      { id: playerC, lives: 1 },
    ].forEach(({ id, lives }) => {
      const playerRecord = roomManager.getPlayer(id);
      playerRecord.update({ lives, isSpectator: false });
      stateManager.upsertPlayer(playerRecord);
    });

    const hands = new Map([
      [playerA, [{ rank: '4', suit: 'clubs' }]],
      [playerB, [{ rank: '5', suit: 'hearts' }]],
      [playerC, [{ rank: '6', suit: 'spades' }]],
    ]);

    const baseCard = new Card('7', 'diamonds');

    const gameState = new GameState({
      roomId,
      playerOrder: [playerA, playerB, playerC],
      timeLimitMs: 30 * 60 * 1000,
      startedAt: new Date(Date.now() - 60_000),
      gameId: 'game-elimination',
    });

    const round = gameState.startRound({
      cardCount: 1,
      viraCard: baseCard.toJSON(),
      manilhaRank: Card.getManilhaRank(baseCard.rank),
      hands,
    });

    round.bids.set(playerA, 1);
    round.bids.set(playerB, 0);
    round.bids.set(playerC, 1);
    round.tricks.push({ winner: playerA });

    const snapshot = stateManager.setGame(gameState.gameId, gameState);

    finalizeRound({
      room,
      gameState: snapshot,
      roundIndex: 0,
      loggerRef: logger,
    });

    const roundCompleted = getEmittedEvents(io, 'round_completed');
    expect(roundCompleted).toHaveLength(1);
    expect(roundCompleted[0].payload.eliminatedPlayers).toEqual([playerC]);
    expect(roundCompleted[0].payload.results[playerC]).toMatchObject({ livesRemaining: 0 });

    jest.advanceTimersByTime(ROUND_TRANSITION_DELAY_MS);

    const roundStarted = getEmittedEvents(io, 'round_started');
    expect(roundStarted).toHaveLength(1);
    expect(roundStarted[0].payload.roundNumber).toBe(2);

    const updatedRoom = roomManager.getRoom(roomId);
    expect(updatedRoom.players).toEqual(expect.arrayContaining([playerA, playerB]));
    expect(updatedRoom.players).not.toContain(playerC);
    expect(updatedRoom.spectators).toContain(playerC);

    const eliminatedPlayer = roomManager.getPlayer(playerC);
    expect(eliminatedPlayer.isSpectator).toBe(true);
    expect(eliminatedPlayer.lives).toBe(0);

    const savedGame = stateManager.getGame('game-elimination');
    expect(savedGame.currentRound).toBe(2);
    expect(savedGame.currentPhase).toBe('bidding');

    jest.clearAllTimers();
  });

  it('resets lobby state and broadcasts completion payload when completeGame is invoked', () => {
    const { completeGame } = handler.__testHooks;

    const playerA = joinPlayer('Ana');
    const playerB = joinPlayer('Bruno');

    const room = roomManager.getRoom(roomId);
    room.update({
      status: 'playing',
      players: [playerA, playerB],
      spectators: [],
      hostSettings: {
        ...room.hostSettings,
        startingLives: 4,
      },
      gameState: {
        gameId: 'game-finish',
        currentRound: 1,
      },
    });
    stateManager.upsertRoom(room);

    const playerARecord = roomManager.getPlayer(playerA);
    playerARecord.update({ lives: 2, isSpectator: false });
    stateManager.upsertPlayer(playerARecord);

    const playerBRecord = roomManager.getPlayer(playerB);
    playerBRecord.update({ lives: 0, isSpectator: true });
    stateManager.upsertPlayer(playerBRecord);

    const hands = new Map([
      [playerA, [{ rank: '7', suit: 'clubs' }]],
      [playerB, [{ rank: '7', suit: 'hearts' }]],
    ]);

    const baseCard = new Card('5', 'spades');

    const gameState = new GameState({
      roomId,
      playerOrder: [playerA, playerB],
      timeLimitMs: 15 * 60 * 1000,
      startedAt: new Date(Date.now() - 120_000),
      gameId: 'game-finish',
    });

    const round = gameState.startRound({
      cardCount: 1,
      viraCard: baseCard.toJSON(),
      manilhaRank: Card.getManilhaRank(baseCard.rank),
      hands,
    });

    round.bids.set(playerA, 1);
    round.bids.set(playerB, 0);
    round.tricks.push({ winner: playerA });

    const result = completeGame({
      room,
      gameState,
      reason: 'victory',
      loggerRef: logger,
    });

    expect(result.currentPhase).toBe('completed');
    expect(result.endedAt).toEqual(expect.any(String));

    const completionEvents = getEmittedEvents(io, 'game_completed');
    expect(completionEvents).toHaveLength(1);
    expect(completionEvents[0].payload.reason).toBe('victory');
    expect(completionEvents[0].payload.winner).toBe(playerA);

    const timerEvents = getEmittedEvents(io, 'game_timer_update');
    expect(timerEvents).toHaveLength(1);
    expect(timerEvents[0].payload.status).toBe('completed');
    expect(timerEvents[0].payload.remainingMs).toBe(0);

    const updatedRoom = roomManager.getRoom(roomId);
    expect(updatedRoom.status).toBe('waiting');
    expect(updatedRoom.players).toEqual(expect.arrayContaining([playerA, playerB]));
    expect(updatedRoom.spectators).not.toContain(playerA);
    expect(updatedRoom.spectators).not.toContain(playerB);

    const refreshedA = roomManager.getPlayer(playerA);
    const refreshedB = roomManager.getPlayer(playerB);

    expect(refreshedA.lives).toBe(4);
    expect(refreshedB.lives).toBe(4);
    expect(refreshedA.isSpectator).toBe(false);
    expect(refreshedB.isSpectator).toBe(false);
  });

  it('auto-terminates games that exceed the time limit and emits timer updates', () => {
    jest.useFakeTimers();

    const { scheduleGameTimer } = handler.__testHooks;

    const playerA = joinPlayer('Ana');
    const playerB = joinPlayer('Bruno');

    const room = roomManager.getRoom(roomId);
    room.update({
      status: 'playing',
      players: [playerA, playerB],
      spectators: [],
      hostSettings: {
        ...room.hostSettings,
        startingLives: 3,
      },
      gameState: {
        gameId: 'game-timeout',
        currentRound: 1,
      },
    });
    stateManager.upsertRoom(room);

    [playerA, playerB].forEach((id) => {
      const record = roomManager.getPlayer(id);
      record.update({ lives: 3, isSpectator: false });
      stateManager.upsertPlayer(record);
    });

    const hands = new Map([
      [playerA, [{ rank: '4', suit: 'clubs' }]],
      [playerB, [{ rank: '5', suit: 'diamonds' }]],
    ]);

    const baseCard = new Card('6', 'hearts');

    const gameState = new GameState({
      roomId,
      playerOrder: [playerA, playerB],
      timeLimitMs: 200,
      startedAt: new Date(Date.now() - 150),
      gameId: 'game-timeout',
    });

    gameState.startRound({
      cardCount: 1,
      viraCard: baseCard.toJSON(),
      manilhaRank: Card.getManilhaRank(baseCard.rank),
      hands,
    });

    scheduleGameTimer({ room, gameState });

    const initialTimerUpdates = getEmittedEvents(io, 'game_timer_update');
    expect(initialTimerUpdates).toHaveLength(1);
    expect(initialTimerUpdates[0].payload.status).toBe('warning');
    expect(initialTimerUpdates[0].payload.remainingMs).toBeGreaterThanOrEqual(0);

    jest.advanceTimersByTime(250);

    const completionEvents = getEmittedEvents(io, 'game_completed');
    expect(completionEvents).toHaveLength(1);
    expect(completionEvents[0].payload.reason).toBe('timeout');
    expect(completionEvents[0].payload.winner).toBeNull();

    const updatedRoom = roomManager.getRoom(roomId);
    expect(updatedRoom.status).toBe('waiting');

    const clearedTimers = getEmittedEvents(io, 'game_timer_update').filter((event) => event.payload.status === 'completed');
    expect(clearedTimers).toHaveLength(1);

    jest.clearAllTimers();
  });
});
