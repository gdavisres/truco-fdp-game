'use strict';

const { randomUUID } = require('node:crypto');

const baseLogger = require('../../config/logger');
const { stateManager: defaultStateManager } = require('../stateManager');

const MAX_PLAYERS = 10;
const RECONNECTION_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_ROOMS = [
  { roomId: 'itajuba', displayName: 'Itajubá' },
  { roomId: 'piranguinho', displayName: 'Piranguinho' },
  { roomId: 'volta-redonda', displayName: 'Volta Redonda' },
  { roomId: 'xique-xique', displayName: 'Xique-Xique' },
  { roomId: 'campinas', displayName: 'Campinas' },
];

class RoomManagerError extends Error {
  constructor(message, code = 'ROOM_MANAGER_ERROR', metadata = {}) {
    super(message);
    this.name = 'RoomManagerError';
    this.code = code;
    this.metadata = metadata;
  }
}

const normalizeName = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
};

class RoomManager {
  constructor({
    stateManager,
    logger = baseLogger,
    maxPlayers = MAX_PLAYERS,
    reconnectionWindowMs = RECONNECTION_WINDOW_MS,
    defaultRooms = DEFAULT_ROOMS,
  } = {}) {
    if (!stateManager) {
      throw new RoomManagerError('stateManager instance is required', 'STATE_MANAGER_REQUIRED');
    }

    this.stateManager = stateManager;
    this.maxPlayers = maxPlayers;
    this.reconnectionWindowMs = reconnectionWindowMs;
    this.defaultRooms = Array.isArray(defaultRooms) && defaultRooms.length ? defaultRooms : DEFAULT_ROOMS;

    this.logger = typeof logger?.child === 'function' ? logger.child({ module: 'roomManager' }) : logger;

    this.sessionsById = new Map();
    this.playerToSession = new Map();
    this.disconnectedPlayers = new Map();

    this.ensureDefaultRooms();
    this.rehydrateSessionIndex();
    this.cleanupExpiredSessions();
  }

  rehydrateSessionIndex() {
    if (!this.stateManager || typeof this.stateManager.listSessions !== 'function') {
      return;
    }

    const sessions = this.stateManager.listSessions();

    sessions.forEach((session) => {
      if (!session?.sessionId) {
        return;
      }

      const expiresAtMs = session.expiresAt ? new Date(session.expiresAt).getTime() : null;

      const snapshot = {
        sessionId: session.sessionId,
        playerId: session.playerId ?? null,
        roomId: session.roomId ?? null,
        status: session.status ?? 'connected',
        socketId: session.socketId ?? null,
        expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
      };

      this.sessionsById.set(session.sessionId, snapshot);

      if (snapshot.playerId) {
        this.playerToSession.set(snapshot.playerId, session.sessionId);

        if (snapshot.status === 'disconnected' && snapshot.expiresAt) {
          this.disconnectedPlayers.set(snapshot.playerId, {
            roomId: snapshot.roomId,
            sessionId: session.sessionId,
            expiresAt: snapshot.expiresAt,
          });
        }
      }
    });
  }

  ensureDefaultRooms() {
    this.defaultRooms.forEach(({ roomId, displayName }) => {
      if (!this.stateManager.getRoom(roomId)) {
        this.stateManager.upsertRoom({
          roomId,
          displayName,
          status: 'waiting',
          players: [],
          spectators: [],
        });
      }
    });
  }

  getRoom(roomId) {
    return this.stateManager.getRoom(roomId);
  }

  getRoomSnapshot(roomId) {
    const room = this.stateManager.getRoom(roomId);
    return room?.toJSON ? room.toJSON() : room ?? null;
  }

  listRooms() {
    return this.stateManager.listRooms();
  }

  getPlayer(playerId) {
    return this.stateManager.getPlayer(playerId);
  }

  listPlayers() {
    return this.stateManager.listPlayers();
  }

  joinRoom({
    roomId,
    displayName,
    socketId = null,
    isSpectator = false,
    sessionId = null,
  } = {}) {
    this.cleanupExpiredSessions();

    const normalizedName = normalizeName(displayName);

    if (!roomId) {
      throw new RoomManagerError('roomId is required to join a room', 'ROOM_ID_REQUIRED');
    }

    if (!normalizedName) {
      throw new RoomManagerError('displayName is required to join a room', 'DISPLAY_NAME_REQUIRED');
    }

    if (sessionId && this.sessionsById.has(sessionId)) {
      return this.handleReconnect({ sessionId, socketId });
    }

    const room = this.stateManager.getRoom(roomId);

    if (!room) {
      throw new RoomManagerError(`Room ${roomId} was not found`, 'ROOM_NOT_FOUND', { roomId });
    }

    if (room.status === 'playing' && !isSpectator) {
      throw new RoomManagerError('Room is currently in play', 'ROOM_IN_PROGRESS', { roomId });
    }

    if (!isSpectator) {
      const playerCount = Array.isArray(room.players) ? room.players.length : 0;
      if (playerCount >= this.maxPlayers) {
        throw new RoomManagerError('Room is full', 'ROOM_FULL', {
          roomId,
          maxPlayers: this.maxPlayers,
        });
      }
    }

    const existingNames = [...(room.players || []), ...(room.spectators || [])]
      .map((playerId) => this.stateManager.getPlayer(playerId))
      .filter(Boolean)
      .map((player) => normalizeName(player.displayName).toLowerCase());

    if (existingNames.includes(normalizedName.toLowerCase())) {
      throw new RoomManagerError('Display name already taken in this room', 'NAME_TAKEN', {
        roomId,
        displayName: normalizedName,
      });
    }

    const now = new Date();
    const playerId = randomUUID();

    const player = this.stateManager.upsertPlayer({
      playerId,
      displayName: normalizedName,
      socketId,
      roomId,
      isSpectator,
      isHost: false,
      connectionStatus: 'connected',
      joinedAt: now.toISOString(),
      lastSeen: now.toISOString(),
    });

    if (isSpectator) {
      const spectators = Array.isArray(room.spectators) ? [...room.spectators] : [];
      if (!spectators.includes(playerId)) {
        spectators.push(playerId);
      }
      room.update({ spectators, lastActivity: now });
    } else {
      const players = Array.isArray(room.players) ? [...room.players] : [];
      if (!players.includes(playerId)) {
        players.push(playerId);
      }
      room.update({ players, lastActivity: now });
    }

    this.stateManager.upsertRoom(room);
    const host = this.assignHost(room);

    const assignedSessionId = sessionId ?? randomUUID();
    const sessionRecord = {
      playerId,
      roomId: room.roomId,
      status: 'connected',
      expiresAt: null,
      socketId,
    };
    this.sessionsById.set(assignedSessionId, sessionRecord);
    this.playerToSession.set(playerId, assignedSessionId);
    this.disconnectedPlayers.delete(playerId);

    const nowIso = now.toISOString();
    if (typeof this.stateManager?.upsertSession === 'function') {
      this.stateManager.upsertSession({
        sessionId: assignedSessionId,
        playerId,
        roomId: room.roomId,
        status: 'connected',
        socketId,
        createdAt: nowIso,
        updatedAt: nowIso,
        expiresAt: null,
        metadata: { lastDisplayName: normalizedName },
      });
    }

    if (host?.playerId === playerId && !player.isHost) {
      player.update({ isHost: true });
      this.stateManager.upsertPlayer(player);
    }

    room.touch(now);
    this.stateManager.upsertRoom(room);

    this.logger.debug('room_manager.player_joined', {
      roomId,
      playerId,
      sessionId: assignedSessionId,
      isSpectator,
    });

    return {
      room: room.toJSON(),
      player: player.toJSON(),
      sessionId: assignedSessionId,
    };
  }

  handleDisconnect({ sessionId = null, playerId = null, reason = 'disconnect', now = Date.now() } = {}) {
    this.cleanupExpiredSessions(now);

    const resolved = this.resolveSessionInfo({ sessionId, playerId });
    const player = this.stateManager.getPlayer(resolved.playerId);
    const room = this.stateManager.getRoom(resolved.roomId);

    if (!player || !room) {
      throw new RoomManagerError('Player session is no longer active', 'PLAYER_NOT_FOUND', {
        playerId: resolved.playerId,
        roomId: resolved.roomId,
      });
    }

    const expiry = now + this.reconnectionWindowMs;
    const expiresAt = new Date(expiry).getTime();

    this.sessionsById.set(resolved.sessionId, {
      playerId: resolved.playerId,
      roomId: resolved.roomId,
      status: 'disconnected',
      expiresAt,
      socketId: null,
    });
    this.playerToSession.set(resolved.playerId, resolved.sessionId);
    this.disconnectedPlayers.set(resolved.playerId, {
      roomId: resolved.roomId,
      sessionId: resolved.sessionId,
      expiresAt,
    });

    if (typeof this.stateManager?.upsertSession === 'function') {
      const nowIso = new Date(now).toISOString();
      this.stateManager.upsertSession({
        sessionId: resolved.sessionId,
        playerId: resolved.playerId,
        roomId: resolved.roomId,
        status: 'disconnected',
        socketId: null,
        updatedAt: nowIso,
        expiresAt: new Date(expiresAt).toISOString(),
        metadata: { lastDisconnectReason: reason },
      });
    }

    player.update({ connectionStatus: 'disconnected', socketId: null });
    player.touch(new Date(now));
    this.stateManager.upsertPlayer(player);

    this.assignHost(room);

    this.logger.info('room_manager.player_disconnected', {
      roomId: resolved.roomId,
      playerId: resolved.playerId,
      sessionId: resolved.sessionId,
      reason,
      expiresAt,
    });

    return {
      room: room.toJSON(),
      player: player.toJSON(),
      expiresAt,
    };
  }

  handleReconnect({ sessionId = null, playerId = null, socketId = null, now = Date.now() } = {}) {
    const timestamp = typeof now === 'number' ? now : Date.now();

    const resolved = this.resolveSessionInfo({ sessionId, playerId });
    const session = this.sessionsById.get(resolved.sessionId);

    if (!session) {
      throw new RoomManagerError('Session not found', 'SESSION_NOT_FOUND', {
        sessionId: resolved.sessionId,
        playerId: resolved.playerId,
      });
    }

    if (session.status !== 'disconnected' && session.status !== 'connected') {
      throw new RoomManagerError('Session is not in a reconnectable state', 'SESSION_INVALID_STATE', {
        sessionId: resolved.sessionId,
        status: session.status,
      });
    }

    if (session.expiresAt && session.expiresAt <= timestamp) {
      const removal = this.removePlayerById(session.playerId, {
        sessionId: resolved.sessionId,
        reason: 'expired',
      });

      if (removal) {
        this.logger.warn('room_manager.player_session_expired', {
          roomId: resolved.roomId,
          playerId: resolved.playerId,
          sessionId: resolved.sessionId,
        });
      }

      throw new RoomManagerError('Session has expired', 'SESSION_EXPIRED', {
        sessionId: resolved.sessionId,
        playerId: resolved.playerId,
      });
    }

    const player = this.stateManager.getPlayer(resolved.playerId);
    const room = this.stateManager.getRoom(resolved.roomId);

    if (!player || !room) {
      throw new RoomManagerError('Player session is no longer active', 'PLAYER_NOT_FOUND', {
        playerId: resolved.playerId,
        roomId: resolved.roomId,
      });
    }

    player.update({ connectionStatus: 'connected', socketId: socketId ?? player.socketId });
    player.touch(new Date(timestamp));
    this.stateManager.upsertPlayer(player);

    this.sessionsById.set(resolved.sessionId, {
      playerId: resolved.playerId,
      roomId: resolved.roomId,
      status: 'connected',
      expiresAt: null,
      socketId: socketId ?? player?.socketId ?? null,
    });
    this.playerToSession.set(resolved.playerId, resolved.sessionId);
    this.disconnectedPlayers.delete(resolved.playerId);

    if (typeof this.stateManager?.upsertSession === 'function') {
      const nowIso = new Date(timestamp).toISOString();
      this.stateManager.upsertSession({
        sessionId: resolved.sessionId,
        playerId: resolved.playerId,
        roomId: resolved.roomId,
        status: 'connected',
        socketId: socketId ?? player?.socketId ?? null,
        updatedAt: nowIso,
        expiresAt: null,
        metadata: { lastReconnectedAt: nowIso },
      });
    }

    this.assignHost(room);

    this.cleanupExpiredSessions(timestamp);

    this.logger.info('room_manager.player_reconnected', {
      roomId: resolved.roomId,
      playerId: resolved.playerId,
      sessionId: resolved.sessionId,
    });

    return {
      room: room.toJSON(),
      player: player.toJSON(),
      sessionId: resolved.sessionId,
    };
  }

  leaveRoom({ sessionId = null, playerId = null, reason = 'leave', now = Date.now() } = {}) {
    this.cleanupExpiredSessions(now);

    const resolved = this.resolveSessionInfo({ sessionId, playerId, required: false });

    if (!resolved) {
      throw new RoomManagerError('Active session required to leave room', 'SESSION_REQUIRED');
    }

    const result = this.removePlayerById(resolved.playerId, {
      sessionId: resolved.sessionId,
      reason,
    });

    this.logger.info('room_manager.player_left', {
      roomId: resolved.roomId,
      playerId: resolved.playerId,
      sessionId: resolved.sessionId,
      reason,
    });

    return result;
  }

  cleanupExpiredSessions(now = Date.now()) {
    const cutoff = typeof now === 'number' ? now : Date.now();
    const removed = [];

    this.disconnectedPlayers.forEach((entry, playerId) => {
      if (entry.expiresAt && entry.expiresAt <= cutoff) {
        const result = this.removePlayerById(playerId, {
          sessionId: entry.sessionId,
          reason: 'expired',
        });

        if (result) {
          removed.push(result);
          this.logger.warn('room_manager.player_session_expired', {
            roomId: entry.roomId,
            playerId,
            sessionId: entry.sessionId,
          });
        } else {
          this.removeSession(playerId, entry.sessionId);
          this.disconnectedPlayers.delete(playerId);
        }
      }
    });

    return removed;
  }

  assignHost(room) {
    if (!room) {
      return null;
    }

    const playerIds = Array.isArray(room.players) ? [...room.players] : [];

    if (playerIds.length === 0) {
      return null;
    }

    const players = playerIds
      .map((playerId) => this.stateManager.getPlayer(playerId))
      .filter((player) => player && !player.isSpectator);

    if (players.length === 0) {
      return null;
    }

    const connected = players.find((player) => player.connectionStatus === 'connected');
    const nextHost = connected ?? players[0];

    players.forEach((player) => {
      const shouldHost = player.playerId === nextHost.playerId;
      if (player.isHost !== shouldHost) {
        player.update({ isHost: shouldHost });
        this.stateManager.upsertPlayer(player);
      }
    });

    return nextHost;
  }

  resolveSessionInfo({ sessionId = null, playerId = null, required = true } = {}) {
    if (sessionId) {
      const session = this.sessionsById.get(sessionId);
      if (!session) {
        throw new RoomManagerError('Session not found', 'SESSION_NOT_FOUND', { sessionId });
      }

      return {
        sessionId,
        playerId: session.playerId,
        roomId: session.roomId,
      };
    }

    if (playerId) {
      const resolvedSessionId = this.playerToSession.get(playerId);
      if (!resolvedSessionId) {
        throw new RoomManagerError('Session not found for player', 'SESSION_NOT_FOUND', { playerId });
      }

      return this.resolveSessionInfo({ sessionId: resolvedSessionId });
    }

    if (required) {
      throw new RoomManagerError('Session identifier is required', 'SESSION_REQUIRED');
    }

    return null;
  }

  removePlayerById(playerId, { sessionId = null, reason = 'leave' } = {}) {
    const player = this.stateManager.getPlayer(playerId);
    if (!player) {
      return null;
    }

    const room = player.roomId ? this.stateManager.getRoom(player.roomId) : null;
    const snapshot = player.toJSON();

    if (room) {
      const isSpectator = Boolean(player.isSpectator);
      if (isSpectator) {
        const spectators = (room.spectators || []).filter((id) => id !== playerId);
        room.update({ spectators });
      } else {
        const players = (room.players || []).filter((id) => id !== playerId);
        room.update({ players });
      }

      room.touch();
      this.stateManager.upsertRoom(room);
      this.assignHost(room);
    }

    this.stateManager.removePlayer(playerId);

    const resolvedSessionId = sessionId ?? this.playerToSession.get(playerId) ?? null;
    if (resolvedSessionId) {
      this.removeSession(playerId, resolvedSessionId);
    }

    this.disconnectedPlayers.delete(playerId);

    return {
      room: room?.toJSON ? room.toJSON() : room,
      player: snapshot,
      reason,
    };
  }

  removeSession(playerId, sessionId) {
    this.sessionsById.delete(sessionId);
    this.playerToSession.delete(playerId);
    if (typeof this.stateManager?.removeSession === 'function') {
      this.stateManager.removeSession(sessionId);
    }
  }

  getSession(sessionId) {
    return this.sessionsById.get(sessionId) ?? null;
  }

  getSessionForPlayer(playerId) {
    const resolvedSessionId = this.playerToSession.get(playerId);
    if (!resolvedSessionId) {
      return null;
    }
    return this.sessionsById.get(resolvedSessionId) ?? null;
  }
}

const createRoomManager = (options = {}) => new RoomManager(options);

const roomManager = new RoomManager({
  stateManager: defaultStateManager,
  logger: baseLogger,
});

module.exports = {
  RoomManager,
  RoomManagerError,
  createRoomManager,
  roomManager,
  DEFAULT_ROOMS,
  MAX_PLAYERS,
  RECONNECTION_WINDOW_MS,
};
