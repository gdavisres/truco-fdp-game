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
  card.applyVira(viraRank);
  return card.toJSON();
};

describe('Core gameplay integration', () => {
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-game-flow-'));

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

  it('runs bidding through trick resolution with manilha winning after cancellations', async () => {
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

    host.emit('start_game');

    const gameStarted = await waitForEvent(host, 'game_started');
    expect(gameStarted).toMatchObject({
      gameId: expect.any(String),
      playerOrder: expect.arrayContaining([
        hostJoined.playerId,
        guestOneJoined.playerId,
        guestTwoJoined.playerId,
      ]),
    });

    const { gameId, playerOrder } = gameStarted;

    const roundStarted = await waitForEvent(host, 'round_started');
    expect(roundStarted).toMatchObject({
      roundNumber: 1,
      cardCount: 1,
      isBlindRound: true,
    });

    const hostDeal = await waitForEvent(host, 'cards_dealt');
    const guestOneDeal = await waitForEvent(guestOne, 'cards_dealt');
    const guestTwoDeal = await waitForEvent(guestTwo, 'cards_dealt');

    [hostDeal, guestOneDeal, guestTwoDeal].forEach((deal) => {
      expect(Array.isArray(deal.hand) && deal.hand.length === 0).toBe(true);
      expect(Array.isArray(deal.visibleCards) && deal.visibleCards.length > 0).toBe(true);
    });

    // Complete bidding sequence: 0, 1, 1 (valid last-bidder restriction)
    const initialTurn = await waitForEvent(host, 'bidding_turn');
    expect(initialTurn).toMatchObject({ currentPlayer: hostJoined.playerId });
    host.emit('submit_bid', { bid: 0 });
    const hostBid = await waitForEvent(host, 'bid_submitted');
    expect(hostBid).toMatchObject({ playerId: hostJoined.playerId, bid: 0 });

    const secondTurn = await waitForEvent(host, 'bidding_turn');
    expect(secondTurn).toMatchObject({ currentPlayer: guestOneJoined.playerId });
    guestOne.emit('submit_bid', { bid: 1 });
    await waitForEvent(host, 'bid_submitted');

    const thirdTurn = await waitForEvent(host, 'bidding_turn');
    expect(thirdTurn).toMatchObject({ currentPlayer: guestTwoJoined.playerId });

    let snapshotAfterBid = stateManager.getGame(gameId);
    let bidRoundIndex = Math.max(0, (snapshotAfterBid.currentRound ?? 1) - 1);
    const roundAfterSecondBid = snapshotAfterBid?.rounds?.[bidRoundIndex];
    expect(roundAfterSecondBid).toBeTruthy();
    expect(roundAfterSecondBid.bids).toMatchObject({
      [hostJoined.playerId]: 0,
      [guestOneJoined.playerId]: 1,
    });

    guestTwo.emit('submit_bid', { bid: 1 });
    const guestTwoBid = await waitForEvent(host, 'bid_submitted');
    expect(guestTwoBid).toMatchObject({ playerId: guestTwoJoined.playerId, bid: 1 });

    const trickStarted = await waitForEvent(host, 'trick_started');
    expect(trickStarted).toMatchObject({ leadPlayer: expect.any(String) });

    snapshotAfterBid = stateManager.getGame(gameId);
    bidRoundIndex = Math.max(0, (snapshotAfterBid.currentRound ?? 1) - 1);
    expect(snapshotAfterBid.rounds?.[bidRoundIndex]?.bids).toEqual({
      [hostJoined.playerId]: 0,
      [guestOneJoined.playerId]: 1,
      [guestTwoJoined.playerId]: 1,
    });

    const roomSnapshot = stateManager.getRoom(DEFAULT_ROOM_ID);
    expect(roomSnapshot?.gameState?.currentPhase).toBe('playing');
    const viraRank = 'K';
    const manilhaRank = Card.getManilhaRank(viraRank);

    const hands = {
      [playerOrder[0]]: [createCard('7', 'spades', viraRank)],
      [playerOrder[1]]: [createCard('7', 'diamonds', viraRank)],
      [playerOrder[2]]: [createCard(manilhaRank, 'clubs', viraRank)],
    };

    setRoundHands({ gameId, hands, viraRank, viraSuit: 'hearts', cardCount: 1 });

  const leadPlayer = trickStarted.leadPlayer ?? roundStarted.leadPlayer ?? playerOrder[0];

    const leadSocket =
      leadPlayer === hostJoined.playerId
        ? host
        : leadPlayer === guestOneJoined.playerId
          ? guestOne
          : guestTwo;

    const secondSocket =
      playerOrder[1] === hostJoined.playerId
        ? host
        : playerOrder[1] === guestOneJoined.playerId
          ? guestOne
          : guestTwo;

    const thirdSocket =
      playerOrder[2] === hostJoined.playerId
        ? host
        : playerOrder[2] === guestOneJoined.playerId
          ? guestOne
          : guestTwo;

    leadSocket.emit('play_card', { card: { rank: '7', suit: 'spades' } });
    const firstPlay = await waitForEvent(host, 'card_played');
    expect(firstPlay).toMatchObject({
      playerId: leadPlayer,
      nextPlayer: playerOrder[1],
    });

    secondSocket.emit('play_card', { card: { rank: '7', suit: 'diamonds' } });
    const secondPlay = await waitForEvent(host, 'card_played');
    expect(secondPlay).toMatchObject({
      playerId: playerOrder[1],
      nextPlayer: playerOrder[2],
    });

    thirdSocket.emit('play_card', { card: { rank: manilhaRank, suit: 'clubs' } });
    const trickCompleted = await waitForEvent(host, 'trick_completed');

    expect(trickCompleted).toMatchObject({
      trickNumber: 1,
      winner: playerOrder[2],
      nextTrick: false,
    });

    expect(Array.isArray(trickCompleted.cancelledCards)).toBe(true);
    expect(trickCompleted.cancelledCards).toHaveLength(2);
    trickCompleted.cancelledCards.forEach((card) => {
      expect(card.rank).toBe('7');
    });

    expect(trickCompleted.cardsPlayed[playerOrder[2]].isManilha).toBe(true);
    expect(trickCompleted.cardsPlayed[playerOrder[2]].rank).toBe(manilhaRank);

    const finalSnapshot = stateManager.getGame(gameId);
    const roundIndex = Math.max(0, (finalSnapshot.currentRound ?? 1) - 1);
    const trickRecord = finalSnapshot.rounds[roundIndex].tricks[0];

    expect(finalSnapshot.currentPhase).toBe('scoring');
    expect(finalSnapshot.rounds[roundIndex].manilhaRank).toBe(manilhaRank);
    expect(trickRecord.cancelledCards).toHaveLength(2);
    expect(trickRecord.winner).toBe(playerOrder[2]);
    expect(trickRecord.cardsPlayed[playerOrder[2]].isManilha).toBe(true);
  });
});
