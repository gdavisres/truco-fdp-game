'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Card } = require('../../src/modules/cardEngine');
const { createStateManager } = require('../../src/modules/stateManager');
const { createRoomManager, DEFAULT_ROOMS } = require('../../src/modules/roomManager');
const { createRoomSocketHandlers } = require('../../src/socket/roomHandlers');

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));
const ROUND_TRANSITION_DELAY_MS = 200;

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

const createCardForPlayer = (rank, suit, viraRank) => {
  const card = new Card(rank, suit);
  if (viraRank) {
    card.applyVira(viraRank);
  }
  return card.toJSON();
};

const createViraCard = (rank, suit) => new Card(rank, suit).toJSON();

describe('play_card socket handler', () => {
  let tmpDir;
  let stateManager;
  let roomManager;
  let io;
  let logger;
  let connectionHandler;
  const roomId = DEFAULT_ROOMS[0].roomId;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-card-play-'));
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

  const overrideHands = ({ gameId, hands, viraRank = '7', cardCount = 1, viraSuit = 'hearts' }) => {
    const gameSnapshot = stateManager.getGame(gameId);
    const mutable = JSON.parse(JSON.stringify(gameSnapshot));
    const roundIndex = Math.max(0, (mutable.currentRound ?? 1) - 1);
    const round = mutable.rounds[roundIndex];

    round.cardCount = cardCount;
    round.viraCard = createViraCard(viraRank, viraSuit);
    round.manilhaRank = Card.getManilhaRank(viraRank);
    round.hands = Object.fromEntries(
      Object.entries(hands).map(([playerId, cards]) => [playerId, cards.map((card) => ({ ...card }))]),
    );

    round.activeTrickNumber = round.activeTrickNumber ?? 1;

    mutable.rounds[roundIndex] = round;
    stateManager.setGame(gameId, mutable);

    Object.entries(hands).forEach(([playerId, cards]) => {
      const playerRecord = roomManager.getPlayer(playerId);
      if (!playerRecord) {
        return;
      }
      playerRecord.update({
        hand: cards.map((card) => ({ ...card })),
        tricksWon: playerRecord.tricksWon ?? 0,
      });
      stateManager.upsertPlayer(playerRecord);
    });
  };

  it('plays cards in order and completes the trick with a winner', async () => {
    const hostSocket = await connectSocket('socket-host');
    const socketTwo = await connectSocket('socket-two');
    const socketThree = await connectSocket('socket-three');

    const { playerIds, gameId } = await startGameForPlayers({
      hostSocket,
      otherSockets: [socketTwo, socketThree],
    });

    // Complete bidding
    await hostSocket.handlers.submit_bid({ bid: 0 });
    await socketTwo.handlers.submit_bid({ bid: 0 });
    await socketThree.handlers.submit_bid({ bid: 0 });
    await flushAsync();

    const viraRank = '7';
    const hands = {
      [playerIds[0]]: [createCardForPlayer('A', 'hearts', viraRank)],
      [playerIds[1]]: [createCardForPlayer('K', 'clubs', viraRank)],
      [playerIds[2]]: [createCardForPlayer('3', 'spades', viraRank)],
    };

    overrideHands({ gameId, hands, viraRank, cardCount: 1 });

    await hostSocket.handlers.play_card({ card: { rank: 'A', suit: 'hearts' } });
    await flushAsync();

    let gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.rounds[0].hands[playerIds[0]]).toHaveLength(0);
    let cardEvents = findEmittedPayloads(io, 'card_played');
    expect(cardEvents.at(-1)).toMatchObject({ playerId: playerIds[0], nextPlayer: playerIds[1] });

    await socketTwo.handlers.play_card({ card: { rank: 'K', suit: 'clubs' } });
    await flushAsync();

    gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.rounds[0].hands[playerIds[1]]).toHaveLength(0);
    cardEvents = findEmittedPayloads(io, 'card_played');
    expect(cardEvents.at(-1)).toMatchObject({ playerId: playerIds[1], nextPlayer: playerIds[2] });

    await socketThree.handlers.play_card({ card: { rank: '3', suit: 'spades' } });
    await flushAsync();

    const snapshotAfterFirstTrick = stateManager.getGame(gameId);
    expect(snapshotAfterFirstTrick.rounds[0].tricks[0].completedAt).toBeTruthy();

    const trickEvents = findEmittedPayloads(io, 'trick_completed');
    expect(trickEvents).toHaveLength(1);
    const [firstTrick] = trickEvents;
    expect(firstTrick.trickNumber).toBe(1);
    expect(firstTrick.winner).toBe(playerIds[2]);
    expect(firstTrick.nextTrick).toBe(false);

    const winnerRecord = roomManager.getPlayer(playerIds[2]);
    expect(winnerRecord.tricksWon).toBe(1);

    expect(snapshotAfterFirstTrick.currentPhase).toBe('scoring');

    await new Promise((resolve) => setTimeout(resolve, ROUND_TRANSITION_DELAY_MS + 20));
  });

  it('auto plays a card when the current player times out', async () => {
    try {
      const hostSocket = await connectSocket('socket-host');
      const socketTwo = await connectSocket('socket-two');

      await hostSocket.handlers.update_host_settings({ turnTimer: 5 });
      await flushAsync();

      const { playerIds, gameId } = await startGameForPlayers({
        hostSocket,
        otherSockets: [socketTwo],
      });

      jest.useFakeTimers();

      await hostSocket.handlers.submit_bid({ bid: 0 });

      await socketTwo.handlers.submit_bid({ bid: 0 });

      const viraRank = '7';
      const hands = {
        [playerIds[0]]: [createCardForPlayer('A', 'hearts', viraRank)],
        [playerIds[1]]: [createCardForPlayer('K', 'clubs', viraRank)],
      };

      overrideHands({ gameId, hands, viraRank, cardCount: 1 });

      jest.advanceTimersByTime(5_100);
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();

      const autoEvents = findEmittedPayloads(io, 'auto_action');
      expect(autoEvents.at(-1)).toMatchObject({
        action: 'auto_card',
        playerId: playerIds[0],
        reason: 'timeout',
      });

      const cardEvents = findEmittedPayloads(io, 'card_played');
      expect(cardEvents.at(-1)).toMatchObject({
        playerId: playerIds[0],
      });

      const gameSnapshot = stateManager.getGame(gameId);
      expect(gameSnapshot.rounds[0].hands[playerIds[0]]).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects card plays that occur out of turn', async () => {
    const hostSocket = await connectSocket('socket-host');
    const socketTwo = await connectSocket('socket-two');
    const socketThree = await connectSocket('socket-three');

    const { playerIds, gameId } = await startGameForPlayers({
      hostSocket,
      otherSockets: [socketTwo, socketThree],
    });

    await hostSocket.handlers.submit_bid({ bid: 0 });
    await socketTwo.handlers.submit_bid({ bid: 0 });
    await socketThree.handlers.submit_bid({ bid: 0 });
    await flushAsync();

    const hands = {
      [playerIds[0]]: [createCardForPlayer('J', 'hearts', '7')],
      [playerIds[1]]: [createCardForPlayer('Q', 'clubs', '7')],
      [playerIds[2]]: [createCardForPlayer('K', 'spades', '7')],
    };

    overrideHands({ gameId, hands, viraRank: '7', cardCount: 1 });

    await socketTwo.handlers.play_card({ card: { rank: 'Q', suit: 'clubs' } });

    const errorCall = socketTwo.emit.mock.calls.find(([event]) => event === 'action_error');
    expect(errorCall).toBeDefined();
    expect(errorCall[1]).toMatchObject({ action: 'play_card', error: 'invalid_turn' });
  });

  it('starts a new trick after completion and uses the winner as the next lead', async () => {
    const hostSocket = await connectSocket('socket-host');
    const socketTwo = await connectSocket('socket-two');
    const socketThree = await connectSocket('socket-three');

    const { playerIds, gameId } = await startGameForPlayers({
      hostSocket,
      otherSockets: [socketTwo, socketThree],
    });

    await hostSocket.handlers.submit_bid({ bid: 0 });
    await socketTwo.handlers.submit_bid({ bid: 0 });
    await socketThree.handlers.submit_bid({ bid: 0 });
    await flushAsync();

    const viraRank = 'Q';
    const hands = {
      [playerIds[0]]: [
        createCardForPlayer('7', 'hearts', viraRank),
        createCardForPlayer('5', 'spades', viraRank),
      ],
      [playerIds[1]]: [
        createCardForPlayer('3', 'clubs', viraRank),
        createCardForPlayer('4', 'diamonds', viraRank),
      ],
      [playerIds[2]]: [
        createCardForPlayer('A', 'spades', viraRank),
        createCardForPlayer('2', 'hearts', viraRank),
      ],
    };

    overrideHands({ gameId, hands, viraRank, cardCount: 2 });
    const prePlaySnapshot = stateManager.getGame(gameId);
    expect(prePlaySnapshot.rounds[0].cardCount).toBe(2);

    // Trick 1
    await hostSocket.handlers.play_card({ card: { rank: '7', suit: 'hearts' } });
    await flushAsync();
    await socketTwo.handlers.play_card({ card: { rank: '3', suit: 'clubs' } });
    await flushAsync();
    await socketThree.handlers.play_card({ card: { rank: 'A', suit: 'spades' } });
    await flushAsync();

    const trickEvents = findEmittedPayloads(io, 'trick_completed');
    expect(trickEvents).toHaveLength(1);
    const [completedTrick] = trickEvents;
    expect(completedTrick.nextTrick).toBe(true);
    expect(completedTrick.winner).toBe(playerIds[1]);

    const trickStartedEvents = findEmittedPayloads(io, 'trick_started');
    expect(trickStartedEvents.at(-1)).toMatchObject({ trickNumber: 2, leadPlayer: playerIds[1] });

    const gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.currentPhase).toBe('playing');
    expect(gameSnapshot.rounds[0].hands[playerIds[1]]).toHaveLength(1);
  });
});
