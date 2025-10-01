'use strict';

const request = require('supertest');

const { app } = require('../../src/server');
const { stateManager } = require('../../src/modules/stateManager');

describe('Rooms API contracts', () => {
  beforeAll(async () => {
    await stateManager.init();
  });

  afterAll(async () => {
    await stateManager.stop();
  });

  beforeEach(() => {
    stateManager.clear();
  });

  it('returns a list of all rooms with status metadata', async () => {
    stateManager.upsertRoom({
      roomId: 'itajuba',
      displayName: 'Itajubá',
      status: 'waiting',
      players: ['player-1', 'player-2'],
      spectators: ['spectator-1'],
    });

    stateManager.upsertPlayer({
      playerId: 'player-1',
      displayName: 'Ana',
      roomId: 'itajuba',
      isHost: true,
      lives: 5,
    });

    stateManager.upsertPlayer({
      playerId: 'player-2',
      displayName: 'João',
      roomId: 'itajuba',
      lives: 5,
    });

    stateManager.upsertPlayer({
      playerId: 'spectator-1',
      displayName: 'Lu',
      roomId: 'itajuba',
      isSpectator: true,
    });

    const response = await request(app).get('/api/rooms').expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(5);

    const targetRoom = response.body.find((room) => room.roomId === 'itajuba');

    expect(targetRoom).toMatchObject({
      displayName: 'Itajubá',
      maxPlayers: 10,
      playerCount: 2,
      spectatorCount: 1,
      gameStatus: 'waiting',
      canJoin: true,
    });
  });

  it('returns detailed information for a specific room', async () => {
    stateManager.upsertRoom({
      roomId: 'piranguinho',
      displayName: 'Piranguinho',
      status: 'playing',
      players: ['player-3'],
      spectators: [],
      hostSettings: {
        startingLives: 7,
        turnTimer: 12,
      },
      gameState: {
        currentRound: 3,
        currentPhase: 'playing',
      },
    });

    stateManager.upsertPlayer({
      playerId: 'player-3',
      displayName: 'Marina',
      roomId: 'piranguinho',
      lives: 7,
      connectionStatus: 'connected',
      isHost: true,
    });

    const response = await request(app).get('/api/rooms/piranguinho').expect(200);

    expect(response.body).toMatchObject({
      roomId: 'piranguinho',
      displayName: 'Piranguinho',
      gameStatus: 'playing',
      currentRound: 3,
      gamePhase: 'playing',
      maxPlayers: 10,
      hostSettings: expect.objectContaining({
        startingLives: 7,
        turnTimer: 12,
      }),
    });

    expect(response.body.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: 'player-3',
          displayName: 'Marina',
          lives: 7,
          isHost: true,
          connectionStatus: 'connected',
        }),
      ]),
    );
  });

  it('returns 404 for unknown rooms', async () => {
    await request(app).get('/api/rooms/unknown-room').expect(404);
  });
});
