'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io: createClient } = require('socket.io-client');

const { Card } = require('../../src/modules/cardEngine');

const DEFAULT_ROOM_ID = 'itajuba';

jest.setTimeout(25000);

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
      if (socket.__eventCache?.has(eventName)) {
        socket.__eventCache.delete(eventName);
      }
      if (args.length <= 1) {
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
    }, 200);

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

const createCard = (rank, suit, viraRank) => {
  const card = new Card(rank, suit);
  if (viraRank) {
    card.applyVira(viraRank);
  }
  return card.toJSON();
};

describe('Game completion integration', () => {
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

  const setRoundHands = ({ gameId, hands, viraRank, viraSuit = 'hearts', cardCount = 1 }) => {
    const snapshot = stateManager.getGame(gameId);
    const mutable = JSON.parse(JSON.stringify(snapshot));
    const roundIndex = Math.max(0, (mutable.currentRound ?? 1) - 1);
    const round = mutable.rounds[roundIndex];

    round.cardCount = cardCount;
    round.viraCard = new Card(viraRank, viraSuit).toJSON();
    round.manilhaRank = Card.getManilhaRank(viraRank);
    round.hands = Object.fromEntries(
      Object.entries(hands).map(([playerId, cards]) => [playerId, cards.map((card) => ({ ...card }))]),
    );

    stateManager.setGame(gameId, mutable);

    Object.entries(hands).forEach(([playerId, cards]) => {
      const playerRecord = roomManager.getPlayer(playerId);
      if (!playerRecord) {
        return;
      }
      playerRecord.update({
        hand: cards.map((card) => ({ ...card })),
      });
      stateManager.upsertPlayer(playerRecord);
    });
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-game-completion-'));

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
    stateManager.clear();
    roomManager.ensureDefaultRooms?.();
  });

  afterEach(async () => {
    await closeClients();
    stateManager.clear();
    roomManager.ensureDefaultRooms?.();
  });

  it('completes a game when elimination leaves a single player', async () => {
    const host = addClient(await connectClient(baseUrl));
    await waitForEvent(host, 'connection_status');

    host.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Ana Host' });
    const hostJoined = await waitForEvent(host, 'room_joined');

    const guestOne = addClient(await connectClient(baseUrl));
    await waitForEvent(guestOne, 'connection_status');

    guestOne.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Bruno' });
    const guestOneJoined = await waitForEvent(guestOne, 'room_joined');
    await waitForEvent(host, 'player_joined');

    const guestTwo = addClient(await connectClient(baseUrl));
    await waitForEvent(guestTwo, 'connection_status');

    guestTwo.emit('join_room', { roomId: DEFAULT_ROOM_ID, displayName: 'Carla' });
    const guestTwoJoined = await waitForEvent(guestTwo, 'room_joined');
    await waitForEvent(host, 'player_joined');
    await waitForEvent(guestOne, 'player_joined');

    const room = roomManager.getRoom(DEFAULT_ROOM_ID);
    room.update({
      hostSettings: {
        ...room.hostSettings,
        startingLives: 1,
      },
    });
    stateManager.upsertRoom(room);

    const participants = [hostJoined.playerId, guestOneJoined.playerId, guestTwoJoined.playerId];
    participants.forEach((playerId) => {
      const record = roomManager.getPlayer(playerId);
      record.update({ lives: 1, currentBid: null, isSpectator: false });
      stateManager.upsertPlayer(record);
    });

    const socketByPlayerId = new Map([
      [hostJoined.playerId, host],
      [guestOneJoined.playerId, guestOne],
      [guestTwoJoined.playerId, guestTwo],
    ]);

    host.emit('start_game');

    const gameStarted = await waitForEvent(host, 'game_started');
    expect(gameStarted).toMatchObject({
      gameId: expect.any(String),
      playerOrder: expect.arrayContaining(participants),
    });

    const { gameId, playerOrder } = gameStarted;

    const roundStarted = await waitForEvent(host, 'round_started');
    expect(roundStarted).toMatchObject({ roundNumber: 1, cardCount: 1 });

    const viraRank = 'K';
    const manilhaRank = Card.getManilhaRank(viraRank);
    const hands = {
      [playerOrder[0]]: [createCard('4', 'clubs', viraRank)],
      [playerOrder[1]]: [createCard(manilhaRank, 'hearts', viraRank)],
      [playerOrder[2]]: [createCard('5', 'spades', viraRank)],
    };
    setRoundHands({ gameId, hands, viraRank, cardCount: 1 });

    const cardSpecs = {
      [playerOrder[0]]: { rank: '4', suit: 'clubs' },
      [playerOrder[1]]: { rank: manilhaRank, suit: 'hearts' },
      [playerOrder[2]]: { rank: '5', suit: 'spades' },
    };

    let biddingTurn = await waitForEvent(host, 'bidding_turn');
    expect(biddingTurn.currentPlayer).toBe(playerOrder[0]);
    socketByPlayerId.get(playerOrder[0]).emit('submit_bid', { bid: 1 });
    await waitForEvent(host, 'bid_submitted');

    biddingTurn = await waitForEvent(host, 'bidding_turn');
    expect(biddingTurn.currentPlayer).toBe(playerOrder[1]);
    socketByPlayerId.get(playerOrder[1]).emit('submit_bid', { bid: 1 });
    await waitForEvent(host, 'bid_submitted');

    biddingTurn = await waitForEvent(host, 'bidding_turn');
    expect(biddingTurn.currentPlayer).toBe(playerOrder[2]);
    socketByPlayerId.get(playerOrder[2]).emit('submit_bid', { bid: 1 });
    const finalBid = await waitForEvent(host, 'bid_submitted');
    expect(finalBid.allBids).toBeDefined();

    const trickStarted = await waitForEvent(host, 'trick_started');
    expect(trickStarted.trickNumber).toBe(1);

    const leadIndex = playerOrder.indexOf(trickStarted.leadPlayer);
    const orderedPlayers = playerOrder.map((_, index) => playerOrder[(leadIndex + index) % playerOrder.length]);

    for (const playerId of orderedPlayers) {
      const socket = socketByPlayerId.get(playerId);
      socket.emit('play_card', { card: cardSpecs[playerId] });
      const played = await waitForEvent(host, 'card_played');
      expect(played.playerId).toBe(playerId);
    }

    const trickCompleted = await waitForEvent(host, 'trick_completed');
    expect(trickCompleted).toMatchObject({
      trickNumber: 1,
      winner: playerOrder[1],
      nextTrick: false,
    });

    const roundCompleted = await waitForEvent(host, 'round_completed');
    expect(roundCompleted.eliminatedPlayers).toEqual(expect.arrayContaining([playerOrder[0], playerOrder[2]]));
    expect(roundCompleted.results[playerOrder[0]].livesRemaining).toBe(0);
    expect(roundCompleted.results[playerOrder[2]].livesRemaining).toBe(0);
    expect(roundCompleted.results[playerOrder[1]].livesRemaining).toBe(1);

    const gameCompleted = await waitForEvent(host, 'game_completed');
    expect(gameCompleted).toMatchObject({
      reason: 'victory',
      winner: playerOrder[1],
    });
    expect(gameCompleted.finalStandings[0]).toMatchObject({ playerId: playerOrder[1], livesRemaining: 1 });

    const gameSnapshot = stateManager.getGame(gameId);
    expect(gameSnapshot.currentPhase).toBe('completed');
    expect(gameSnapshot.winner).toBe(playerOrder[1]);
    expect(gameSnapshot.completionReason).toBe('victory');

    const updatedRoom = roomManager.getRoom(DEFAULT_ROOM_ID);
  expect(updatedRoom.status).toBe('waiting');
  expect(updatedRoom.players).toEqual(expect.arrayContaining(participants));
  const spectatorCount = Array.isArray(updatedRoom.spectators) ? updatedRoom.spectators.length : 0;
  expect(spectatorCount).toBe(0);

    participants.forEach((playerId) => {
      const record = roomManager.getPlayer(playerId);
      expect(record.lives).toBe(1);
      expect(record.isSpectator).toBe(false);
    });
  });
});
