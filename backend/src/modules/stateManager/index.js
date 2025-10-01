'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../../config/environment');
const baseLogger = require('../../config/logger');

const { GameState } = require('./GameState');

const defaultHostSettings = {
  startingLives: 5,
  turnTimer: 10,
  autoKickInactive: true,
  allowSpectatorChat: true,
  gameSpeed: 'normal',
};

const coerceIsoDate = (value, fallback = new Date()) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return fallback.toISOString();
};

class GameRoom {
  constructor({
    roomId,
    displayName,
    status = 'waiting',
    players = [],
    spectators = [],
    gameState = null,
    hostSettings = {},
    createdAt = new Date().toISOString(),
    lastActivity = new Date().toISOString(),
    chatLog = [],
  }) {
    if (!roomId) {
      throw new Error('GameRoom requires a roomId');
    }

    this.roomId = roomId;
    this.displayName = displayName ?? roomId;
    this.status = status;
    this.players = Array.isArray(players) ? [...new Set(players)] : [];
    this.spectators = Array.isArray(spectators) ? [...new Set(spectators)] : [];
    this.gameState = gameState;
    this.hostSettings = { ...defaultHostSettings, ...hostSettings };
    this.createdAt = coerceIsoDate(createdAt);
    this.lastActivity = coerceIsoDate(lastActivity);
    this.chatLog = Array.isArray(chatLog) ? [...chatLog] : [];
  }

  update(patch = {}) {
    if (patch.displayName !== undefined) {
      this.displayName = patch.displayName;
    }

    if (patch.status !== undefined) {
      this.status = patch.status;
    }

    if (Array.isArray(patch.players)) {
      this.players = [...new Set(patch.players)];
    }

    if (Array.isArray(patch.spectators)) {
      this.spectators = [...new Set(patch.spectators)];
    }

    if (patch.gameState !== undefined) {
      this.gameState = patch.gameState;
    }

    if (patch.hostSettings) {
      this.hostSettings = {
        ...this.hostSettings,
        ...patch.hostSettings,
      };
    }

    if (patch.lastActivity) {
      this.lastActivity = coerceIsoDate(patch.lastActivity);
    }

    if (Array.isArray(patch.chatLog)) {
      this.chatLog = [...patch.chatLog];
    }

    return this;
  }

  touch(date = new Date()) {
    this.lastActivity = coerceIsoDate(date);
  }

  appendChatMessage(entry, limit = 100) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const payload = { ...entry };
    this.chatLog.push(payload);

    if (Number.isInteger(limit) && limit > 0 && this.chatLog.length > limit) {
      this.chatLog.splice(0, this.chatLog.length - limit);
    }

    this.touch();
    return payload;
  }

  toJSON() {
    return {
      roomId: this.roomId,
      displayName: this.displayName,
      status: this.status,
      players: [...this.players],
      spectators: [...this.spectators],
      gameState: this.gameState,
      hostSettings: { ...this.hostSettings },
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      chatLog: [...this.chatLog],
    };
  }
}

class Player {
  constructor({
    playerId,
    displayName,
    socketId = null,
    roomId = null,
    lives = defaultHostSettings.startingLives,
    isHost = false,
    isSpectator = false,
    connectionStatus = 'connected',
    hand = [],
    currentBid = null,
    tricksWon = 0,
    joinedAt = new Date().toISOString(),
    lastSeen = new Date().toISOString(),
  }) {
    if (!playerId) {
      throw new Error('Player requires a playerId');
    }

    this.playerId = playerId;
    this.displayName = displayName ?? 'Unknown';
    this.socketId = socketId;
    this.roomId = roomId;
    this.lives = lives;
    this.isHost = Boolean(isHost);
    this.isSpectator = Boolean(isSpectator);
    this.connectionStatus = connectionStatus;
    this.hand = Array.isArray(hand) ? [...hand] : [];
    this.currentBid = currentBid;
    this.tricksWon = tricksWon;
    this.joinedAt = coerceIsoDate(joinedAt);
    this.lastSeen = coerceIsoDate(lastSeen);
  }

  update(patch = {}) {
    const mergeables = [
      'displayName',
      'socketId',
      'roomId',
      'lives',
      'isHost',
      'isSpectator',
      'connectionStatus',
      'currentBid',
      'tricksWon',
    ];

    mergeables.forEach((key) => {
      if (patch[key] !== undefined) {
        this[key] = patch[key];
      }
    });

    if (Array.isArray(patch.hand)) {
      this.hand = [...patch.hand];
    }

    if (patch.lastSeen) {
      this.lastSeen = coerceIsoDate(patch.lastSeen);
    }

    return this;
  }

  touch(date = new Date()) {
    this.lastSeen = coerceIsoDate(date);
  }

  toJSON() {
    return {
      playerId: this.playerId,
      displayName: this.displayName,
      socketId: this.socketId,
      roomId: this.roomId,
      lives: this.lives,
      isHost: this.isHost,
      isSpectator: this.isSpectator,
      connectionStatus: this.connectionStatus,
      hand: [...this.hand],
      currentBid: this.currentBid,
      tricksWon: this.tricksWon,
      joinedAt: this.joinedAt,
      lastSeen: this.lastSeen,
    };
  }
}

class PlayerSession {
  constructor({
    sessionId,
    playerId,
    roomId,
    status = 'connected',
    socketId = null,
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
    expiresAt = null,
    metadata = {},
  }) {
    if (!sessionId) {
      throw new Error('PlayerSession requires a sessionId');
    }

    this.sessionId = sessionId;
    this.playerId = playerId ?? null;
    this.roomId = roomId ?? null;
    this.status = status;
    this.socketId = socketId;
    this.createdAt = coerceIsoDate(createdAt);
    this.updatedAt = coerceIsoDate(updatedAt);
    this.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
    this.metadata = { ...(metadata || {}) };
  }

  update(patch = {}) {
    const mergeables = ['playerId', 'roomId', 'status', 'socketId'];

    mergeables.forEach((key) => {
      if (patch[key] !== undefined) {
        this[key] = patch[key];
      }
    });

    if (patch.metadata && typeof patch.metadata === 'object') {
      this.metadata = {
        ...this.metadata,
        ...patch.metadata,
      };
    }

    if (patch.createdAt) {
      this.createdAt = coerceIsoDate(patch.createdAt);
    }

    if (patch.updatedAt) {
      this.updatedAt = coerceIsoDate(patch.updatedAt);
    }

    if (patch.expiresAt !== undefined) {
      this.expiresAt = patch.expiresAt ? new Date(patch.expiresAt).toISOString() : null;
    }

    return this;
  }

  touch(date = new Date()) {
    this.updatedAt = coerceIsoDate(date);
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      playerId: this.playerId,
      roomId: this.roomId,
      status: this.status,
      socketId: this.socketId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      expiresAt: this.expiresAt,
      metadata: { ...this.metadata },
    };
  }
}

class StateManager {
  constructor(options = {}) {
    const {
      snapshotPath = config.state.snapshotPath,
      snapshotIntervalMs = config.state.snapshotIntervalMs,
      logger = baseLogger,
      processRef = process,
      bindProcessEvents = true,
    } = options;

    this.rooms = new Map();
    this.players = new Map();
    this.games = new Map();
  this.sessions = new Map();

    this.snapshotPath = snapshotPath;
    this.snapshotDir = path.dirname(snapshotPath);
    this.snapshotIntervalMs = snapshotIntervalMs;

    this.logger = typeof logger?.child === 'function' ? logger.child({ module: 'stateManager' }) : logger;
    this.processRef = processRef;
    this.bindProcessEvents = bindProcessEvents;

    this.timer = null;
    this.pendingWrite = null;
    this.isInitialized = false;
    this.processHandlers = [];
    this.lastPersistDetails = null;
  }

  async init() {
    if (this.isInitialized) {
      return;
    }

    await this.ensureSnapshotDirectory();
    await this.restore();
    this.startSnapshotTimer();
    this.registerProcessHandlers();

    this.isInitialized = true;
  }

  async stop() {
    this.stopSnapshotTimer();
    this.unregisterProcessHandlers();
    this.isInitialized = false;
    await this.persist('shutdown');
  }

  async ensureSnapshotDirectory() {
    await fs.mkdir(this.snapshotDir, { recursive: true });
  }

  startSnapshotTimer() {
    if (!Number.isFinite(this.snapshotIntervalMs) || this.snapshotIntervalMs <= 0) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      this.persist('interval').catch((error) => {
        this.logger.error('state.snapshot_failed', { message: error.message });
      });
    }, this.snapshotIntervalMs);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stopSnapshotTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  registerProcessHandlers() {
    if (!this.bindProcessEvents || typeof this.processRef?.on !== 'function') {
      return;
    }

    const register = (event, reason) => {
      const handler = () => {
        this.persist(reason).catch((error) => {
          this.logger.error('state.persist_on_signal_failed', {
            reason,
            message: error.message,
          });
        });
      };

      this.processHandlers.push({ event, handler });
      this.processRef.on(event, handler);
    };

    register('beforeExit', 'beforeExit');
    register('SIGINT', 'sigint');
    register('SIGTERM', 'sigterm');
  }

  unregisterProcessHandlers() {
    const remover =
      typeof this.processRef?.off === 'function'
        ? this.processRef.off.bind(this.processRef)
        : typeof this.processRef?.removeListener === 'function'
          ? this.processRef.removeListener.bind(this.processRef)
          : null;

    if (!remover) {
      this.processHandlers = [];
      return;
    }

    this.processHandlers.forEach(({ event, handler }) => remover(event, handler));
    this.processHandlers = [];
  }

  getSnapshotPayload() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      rooms: Array.from(this.rooms.values()).map((room) => room.toJSON()),
      players: Array.from(this.players.values()).map((player) => player.toJSON()),
      games: Array.from(this.games.entries()).map(([gameId, state]) => ({ gameId, state })),
      sessions: Array.from(this.sessions.values()).map((session) => session.toJSON()),
      metadata: {
        lastPersist: this.lastPersistDetails,
      },
    };
  }

  async persist(reason = 'manual') {
    if (this.pendingWrite) {
      await this.pendingWrite.catch(() => undefined);
    }

    const promise = this.writeSnapshot(reason)
      .catch((error) => {
        this.logger.error('state.persist_failed', { reason, message: error.message });
        throw error;
      })
      .finally(() => {
        if (this.pendingWrite === promise) {
          this.pendingWrite = null;
        }
      });

    this.pendingWrite = promise;
    return promise;
  }

  async writeSnapshot(reason) {
    await this.ensureSnapshotDirectory();
    const payload = this.getSnapshotPayload();
    const tempPath = `${this.snapshotPath}.${Date.now()}.tmp`;
    const data = JSON.stringify(payload, null, 2);

    await fs.writeFile(tempPath, data, 'utf8');
    await fs.rm(this.snapshotPath, { force: true });

    try {
      await fs.rename(tempPath, this.snapshotPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.writeFile(this.snapshotPath, data, 'utf8');
      } else {
        throw error;
      }
    } finally {
      await fs.rm(tempPath, { force: true });
    }

    this.lastPersistDetails = {
      reason,
      savedAt: payload.savedAt,
    };

    this.logger.debug('state.persisted', {
      reason,
      path: this.snapshotPath,
      rooms: this.rooms.size,
      players: this.players.size,
    });

    return payload;
  }

  async restore() {
    // Skip state restoration in test mode to start with clean state
    if (config.app.nodeEnv === 'test') {
      this.logger.info('state.restore_skipped', { reason: 'test_mode' });
      return;
    }

    try {
      const raw = await fs.readFile(this.snapshotPath, 'utf8');
      const parsed = JSON.parse(raw);

      this.rooms.clear();
      this.players.clear();
      this.games.clear();

      if (Array.isArray(parsed.rooms)) {
        parsed.rooms.forEach((room) => {
          const instance = new GameRoom(room);
          this.rooms.set(instance.roomId, instance);
        });
      }

      if (Array.isArray(parsed.players)) {
        parsed.players.forEach((player) => {
          const instance = new Player(player);
          this.players.set(instance.playerId, instance);
        });
      }

      if (Array.isArray(parsed.games)) {
        parsed.games.forEach(({ gameId, state }) => {
          if (gameId) {
            this.games.set(gameId, state);
          }
        });
      }

      if (Array.isArray(parsed.sessions)) {
        parsed.sessions.forEach((session) => {
          const instance = new PlayerSession(session);
          this.sessions.set(instance.sessionId, instance);
        });
      }

      this.lastPersistDetails = parsed.metadata?.lastPersist ?? null;

      this.logger.info('state.restored', {
        rooms: this.rooms.size,
        players: this.players.size,
        games: this.games.size,
        sessions: this.sessions.size,
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.debug('state.restore_skipped', { reason: 'snapshot_missing' });
        return;
      }

      this.logger.error('state.restore_failed', { message: error.message });
      throw error;
    }
  }

  upsertRoom(roomInput) {
    const reference = roomInput instanceof GameRoom ? roomInput : new GameRoom(roomInput);
    const existing = this.rooms.get(reference.roomId);

    if (existing) {
      existing.update(reference.toJSON());
      existing.touch();
      return existing;
    }

    reference.touch();
    this.rooms.set(reference.roomId, reference);
    return reference;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) ?? null;
  }

  listRooms() {
    return Array.from(this.rooms.values()).map((room) => room.toJSON());
  }

  removeRoom(roomId) {
    return this.rooms.delete(roomId);
  }

  upsertPlayer(playerInput) {
    const reference = playerInput instanceof Player ? playerInput : new Player(playerInput);
    const existing = this.players.get(reference.playerId);

    if (existing) {
      existing.update(reference.toJSON());
      existing.touch();
      return existing;
    }

    reference.touch();
    this.players.set(reference.playerId, reference);
    return reference;
  }

  getPlayer(playerId) {
    return this.players.get(playerId) ?? null;
  }

  listPlayers() {
    return Array.from(this.players.values()).map((player) => player.toJSON());
  }

  removePlayer(playerId) {
    return this.players.delete(playerId);
  }

  upsertSession(sessionInput) {
    const reference = sessionInput instanceof PlayerSession ? sessionInput : new PlayerSession(sessionInput);
    const existing = this.sessions.get(reference.sessionId);

    if (existing) {
      existing.update(reference.toJSON());
      existing.touch();
      return existing;
    }

    reference.touch();
    this.sessions.set(reference.sessionId, reference);
    return reference;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) ?? null;
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => session.toJSON());
  }

  removeSession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  setGame(gameId, state) {
    if (!gameId) {
      throw new Error('setGame requires a gameId');
    }

    const payload = state instanceof GameState ? state.toJSON() : { ...state };
    const snapshot = {
      ...payload,
      updatedAt: coerceIsoDate(payload?.updatedAt || new Date()),
    };

    this.games.set(gameId, snapshot);
    return snapshot;
  }

  getGame(gameId) {
    return this.games.get(gameId) ?? null;
  }

  removeGame(gameId) {
    return this.games.delete(gameId);
  }

  exportState() {
    return this.getSnapshotPayload();
  }

  clear() {
    this.rooms.clear();
    this.players.clear();
    this.games.clear();
    this.sessions.clear();
  }

  appendRoomChatMessage(roomId, entry, { limit = 100 } = {}) {
    const room = this.getRoom(roomId);
    if (!room) {
      return null;
    }

    const message = room.appendChatMessage(entry, limit);
    this.rooms.set(roomId, room);
    return message;
  }
}
const createStateManager = (options = {}) => new StateManager(options);

const stateManager = new StateManager({
  snapshotPath: config.state.snapshotPath,
  snapshotIntervalMs: config.state.snapshotIntervalMs,
  logger: baseLogger,
  processRef: process,
  bindProcessEvents: true,
});

module.exports = {
  StateManager,
  GameRoom,
  Player,
  GameState,
  PlayerSession,
  createStateManager,
  stateManager,
};
