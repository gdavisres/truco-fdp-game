'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { StateManager, GameRoom, Player } = require('../../src/modules/stateManager');

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

const createFakeProcess = () => {
  const handlers = new Map();

  return {
    on: jest.fn((event, handler) => {
      const list = handlers.get(event) || [];
      list.push(handler);
      handlers.set(event, list);
    }),
    off: jest.fn((event, handler) => {
      const list = handlers.get(event) || [];
      handlers.set(
        event,
        list.filter((fn) => fn !== handler),
      );
    }),
    removeListener: jest.fn((event, handler) => {
      const list = handlers.get(event) || [];
      handlers.set(
        event,
        list.filter((fn) => fn !== handler),
      );
    }),
    emit: (event, ...args) => {
      const list = handlers.get(event) || [];
      list.forEach((handler) => handler(...args));
    },
  };
};

describe('StateManager', () => {
  let tmpDir;
  let snapshotPath;
  let logger;
  let fakeProcess;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truco-state-'));
    snapshotPath = path.join(tmpDir, 'state.json');
    logger = createTestLogger();
    fakeProcess = createFakeProcess();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('initializes with empty collections and registers process handlers', async () => {
    const manager = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 0,
      logger,
      processRef: fakeProcess,
    });

    await manager.init();

    expect(manager.rooms).toBeInstanceOf(Map);
    expect(manager.players).toBeInstanceOf(Map);
    expect(manager.games).toBeInstanceOf(Map);
    expect(manager.rooms.size).toBe(0);
    expect(manager.players.size).toBe(0);
    expect(fakeProcess.on).toHaveBeenCalledTimes(3);
  });

  it('persists rooms and players to disk and restores them on init', async () => {
    const manager = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 0,
      logger,
      processRef: fakeProcess,
    });

    await manager.init();

    manager.upsertRoom(
      new GameRoom({
        roomId: 'itajuba',
        displayName: 'Itajubá',
        players: ['player-1'],
      }),
    );

    manager.upsertPlayer(
      new Player({
        playerId: 'player-1',
        displayName: 'Ana',
        roomId: 'itajuba',
      }),
    );

    manager.setGame('game-1', { roomId: 'itajuba', round: 1 });

    await manager.persist('test-suite');

    const files = await fs.readdir(tmpDir);
    expect(files).toContain('state.json');
    expect(files.find((name) => name.endsWith('.tmp'))).toBeUndefined();

    const restored = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 0,
      logger,
      processRef: createFakeProcess(),
    });

    await restored.init();

    const room = restored.getRoom('itajuba');
    const player = restored.getPlayer('player-1');
    const game = restored.getGame('game-1');

    expect(room).not.toBeNull();
    expect(room.displayName).toBe('Itajubá');
    expect(room.players).toContain('player-1');
    expect(player).not.toBeNull();
    expect(player.displayName).toBe('Ana');
    expect(player.roomId).toBe('itajuba');
    expect(game).toMatchObject({ roomId: 'itajuba', round: 1 });
  });

  it('persists player sessions and restores them on init', async () => {
    const manager = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 0,
      logger,
      processRef: fakeProcess,
    });

    await manager.init();

    const expiresAt = new Date(Date.now() + 60000).toISOString();

    manager.upsertSession({
      sessionId: 'session-1',
      playerId: 'player-1',
      roomId: 'itajuba',
      status: 'disconnected',
      socketId: 'socket-1',
      expiresAt,
    });

    await manager.persist('test-suite');

    const restored = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 0,
      logger,
      processRef: createFakeProcess(),
    });

    await restored.init();

    const sessions = restored.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'session-1',
      playerId: 'player-1',
      roomId: 'itajuba',
      status: 'disconnected',
      socketId: 'socket-1',
    });

    const session = restored.getSession('session-1');
    expect(session).not.toBeNull();
    expect(session.expiresAt).toBe(expiresAt);
  });

  it('runs periodic snapshots based on configured interval', async () => {
    jest.useFakeTimers();

    const manager = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 25,
      logger,
      processRef: fakeProcess,
    });

    const persistSpy = jest.spyOn(manager, 'persist');
    await manager.init();

    jest.advanceTimersByTime(80);
    await Promise.resolve();

    expect(persistSpy).toHaveBeenCalled();

    await manager.stop();
    persistSpy.mockRestore();
  });

  it('saves state when shutdown signals are received', async () => {
    const manager = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 0,
      logger,
      processRef: fakeProcess,
    });

    const persistSpy = jest.spyOn(manager, 'persist');
    await manager.init();

    fakeProcess.emit('SIGINT');
    fakeProcess.emit('SIGTERM');

    expect(persistSpy).toHaveBeenCalledWith('sigint');
    expect(persistSpy).toHaveBeenCalledWith('sigterm');

    await manager.stop();
    persistSpy.mockRestore();
  });

  it('removes process handlers when stopped', async () => {
    const manager = new StateManager({
      snapshotPath,
      snapshotIntervalMs: 0,
      logger,
      processRef: fakeProcess,
    });

    await manager.init();
    await manager.stop();

    expect(fakeProcess.off).toHaveBeenCalledTimes(3);
  });
});
