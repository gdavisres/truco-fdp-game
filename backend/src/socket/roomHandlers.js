'use strict';

const { randomUUID } = require('node:crypto');

const baseLogger = require('../config/logger');
const {
  roomManager: defaultRoomManager,
  RoomManagerError,
  DEFAULT_ROOMS,
} = require('../modules/roomManager');
const {
  stateManager: defaultStateManager,
  GameState,
} = require('../modules/stateManager');
const {
  createDeck,
  shuffleDeck,
  drawVira,
  applyViraToCards,
} = require('../modules/cardEngine');
const { calculateValidBids, validateBid } = require('../modules/gameLogic/bidding');
const {
  validateCardPlay: validateTrickCardPlay,
  createTrickState,
  recordCardPlay,
  resolveTrick,
  removeCardFromHand,
} = require('../modules/gameLogic/tricks');
const { calculateRoundResults, determineNextCardCount } = require('../modules/gameLogic/rounds');
const { buildGameCompletionPayload } = require('../modules/gameLogic/gameCompletion');
const {
  DEFAULT_TURN_TIMER_SECONDS,
  clampTurnTimerSeconds,
  calculateDeadline,
  selectAutoBid,
  selectAutoCard,
} = require('../modules/gameLogic/turnTimer');
const { GameRound } = require('../modules/stateManager/GameState');
const {
  withRateLimit,
  inputValidator,
  antiCheatManager,
  handleSocketDisconnect: handleSecurityDisconnect,
} = require('../modules/security');
const DEFAULT_GAME_TIME_LIMIT_MS = 60 * 60 * 1000;
const GAME_TIMER_TICK_MS = 60 * 1000;
const GAME_TIMER_WARNING_MS = 5 * 60 * 1000;
const ROUND_TRANSITION_DELAY_MS = 200;

const MAX_CHAT_MESSAGE_LENGTH = 200;
const CHAT_HISTORY_LIMIT = 100;
const CHAT_THROTTLE_MS = 750;
const DISCONNECT_AUTO_ACTION_DELAY_MS = 30 * 1000;
const DISCONNECT_AUTO_RECHECK_DELAY_MS = 5 * 1000;
const PENDING_ACTION_TTL_MS = 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 30 * 1000;
const MIN_DISCONNECT_DELAY_MS = 1000;

const configuredTrickDelay = Number(process.env.TRICK_START_DELAY_MS);
const TRICK_START_DELAY_MS = Number.isFinite(configuredTrickDelay) && configuredTrickDelay >= 0
  ? configuredTrickDelay
  : process.env.NODE_ENV === 'test'
    ? 0
    : 10000;

const trickControllers = new Map();

const cloneDeep = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const DISPLAY_NAME_REGEX = /^[A-Za-z0-9 ]{3,20}$/;
const ROOM_IDS = new Set(DEFAULT_ROOMS.map((room) => room.roomId));

const serializeCard = (card) =>
  typeof card?.toJSON === 'function'
    ? card.toJSON()
    : card && typeof card === 'object'
      ? { ...card }
      : card;

const flattenVisibleCards = (view, resolveOwner) => {
  const visible = [];
  if (!view?.others) {
    return visible;
  }

  Object.entries(view.others).forEach(([playerId, cards]) => {
    if (!Array.isArray(cards)) {
      return;
    }

    cards.forEach((card) => {
      const ownerDisplayName =
        typeof resolveOwner === 'function' ? resolveOwner(playerId) : null;
      const payload = { ...serializeCard(card), ownerId: playerId };
      if (ownerDisplayName) {
        payload.ownerDisplayName = ownerDisplayName;
      }
      visible.push(payload);
    });
  });

  return visible;
};

const normalizeDisplayName = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
};

const sanitizeChatText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '';
  }

  if (normalized.length > MAX_CHAT_MESSAGE_LENGTH) {
    return normalized.slice(0, MAX_CHAT_MESSAGE_LENGTH);
  }

  return normalized;
};

const buildChatMessageEntry = ({
  roomId,
  player,
  message,
  type = 'player',
  displayName,
} = {}) => {
  const timestamp = Date.now();
  const entry = {
    messageId: randomUUID(),
    roomId: roomId ?? null,
    playerId: player?.playerId ?? null,
    displayName: displayName ?? player?.displayName ?? null,
    message,
    timestamp,
    type,
    isSpectator: type === 'spectator',
  };

  if (type === 'system') {
    entry.playerId = null;
    entry.isSpectator = false;
  }

  return entry;
};

const mapChatEntryForClient = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  return {
    messageId: entry.messageId ?? randomUUID(),
    playerId: entry.playerId ?? null,
    displayName: entry.displayName ?? null,
    message: entry.message ?? '',
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
    type: entry.type ?? (entry.isSpectator ? 'spectator' : 'player'),
    isSpectator: entry.isSpectator ?? entry.type === 'spectator',
  };
};

const getChatHistory = (room, limit = CHAT_HISTORY_LIMIT) => {
  if (!room) {
    return [];
  }

  const reference = typeof room.toJSON === 'function' ? room.toJSON() : room;
  const log = Array.isArray(reference?.chatLog) ? reference.chatLog : [];
  const slice = limit && Number.isInteger(limit) && limit > 0 ? log.slice(-1 * limit) : [...log];

  return slice
    .map((entry) => mapChatEntryForClient(entry))
    .filter((entry) => entry !== null);
};

const mapPlayerInfo = (player) => {
  if (!player) {
    return null;
  }

  const snapshot = typeof player.toJSON === 'function' ? player.toJSON() : player;

  return {
    playerId: snapshot.playerId,
    displayName: snapshot.displayName,
    lives: snapshot.lives,
    isHost: Boolean(snapshot.isHost),
    isSpectator: Boolean(snapshot.isSpectator),
    connectionStatus: snapshot.connectionStatus ?? 'connected',
  };
};

const mapJoinError = (error) => {
  if (error instanceof RoomManagerError) {
    const mapping = {
      ROOM_FULL: 'room_full',
      ROOM_NOT_FOUND: 'invalid_room',
      ROOM_IN_PROGRESS: 'game_in_progress',
      NAME_TAKEN: 'name_taken',
      DISPLAY_NAME_REQUIRED: 'invalid_name',
      ROOM_ID_REQUIRED: 'invalid_room',
    };

    return {
      error: mapping[error.code] ?? 'invalid_name',
      message: error.message,
    };
  }

  return {
    error: 'invalid_room',
    message: 'Unable to join the requested room',
  };
};

const buildRoomJoinedPayload = (room, player, sessionId, roomManager) => {
  const reference = room && typeof room.toJSON === 'function' ? room.toJSON() : room;
  const playerSnapshot = typeof player.toJSON === 'function' ? player.toJSON() : player;

  const currentPlayers = Array.isArray(reference?.players)
    ? reference.players
        .map((playerId) => roomManager.getPlayer(playerId))
        .filter(Boolean)
        .map(mapPlayerInfo)
    : [];

  const currentSpectators = Array.isArray(reference?.spectators)
    ? reference.spectators
        .map((playerId) => roomManager.getPlayer(playerId))
        .filter(Boolean)
        .map(mapPlayerInfo)
    : [];

  const chatMessages = getChatHistory(room, CHAT_HISTORY_LIMIT);

  return {
    roomId: reference?.roomId ?? null,
    playerId: playerSnapshot.playerId,
    isHost: Boolean(playerSnapshot.isHost),
    isSpectator: Boolean(playerSnapshot.isSpectator),
    currentPlayers,
    spectators: currentSpectators,
    spectatorCount: currentSpectators.length,
    gameState: reference?.gameState ?? null,
    hostSettings: reference?.hostSettings ? { ...reference.hostSettings } : null,
    chatMessages,
    sessionId,
  };
};

const broadcastPlayerJoined = (socket, roomId, player) => {
  const emitter = socket.to(roomId);
  if (emitter && typeof emitter.emit === 'function') {
    const snapshot = mapPlayerInfo(player);
    if (snapshot?.isSpectator) {
      emitter.emit('spectator_joined', {
        spectator: snapshot,
      });
    } else {
      emitter.emit('player_joined', {
        player: snapshot,
      });
    }
  }
};

const broadcastPlayerLeft = (emitter, player, reason) => {
  if (!emitter || typeof emitter.emit !== 'function') {
    return;
  }

  const snapshot = typeof player?.toJSON === 'function' ? player.toJSON() : player;
  const payload = {
    playerId: snapshot?.playerId ?? null,
    reason,
  };

  if (snapshot?.isSpectator) {
    emitter.emit('spectator_left', payload);
  } else {
    emitter.emit('player_left', payload);
  }
};

const appendAndBroadcastChat = ({ room, player, message, type = 'player', displayName, io, stateManager }) => {
  if (!room || !io || !stateManager) {
    return null;
  }

  const entry = buildChatMessageEntry({ roomId: room.roomId, player, message, type, displayName });
  const stored = stateManager.appendRoomChatMessage(room.roomId, entry, {
    limit: CHAT_HISTORY_LIMIT,
  });
  const payload = mapChatEntryForClient(stored ?? entry);

  if (payload) {
    io.to(room.roomId).emit('chat_message_received', payload);
  }

  return payload;
};

const emitHostSettingsUpdate = (io, room) => {
  if (!room || !io) {
    return;
  }

  const reference = typeof room.toJSON === 'function' ? room.toJSON() : room;
  io.to(reference.roomId).emit('host_settings_updated', {
    roomId: reference.roomId,
    hostSettings: { ...reference.hostSettings },
  });
};

const emitSystemChat = ({ room, message, io, stateManager }) => {
  const sanitized = sanitizeChatText(message);
  if (!sanitized) {
    return null;
  }

  return appendAndBroadcastChat({
    room,
    message: sanitized,
    type: 'system',
    displayName: 'System',
    io,
    stateManager,
  });
};

const createRoomSocketHandlers = ({
  io,
  roomManager = defaultRoomManager,
  stateManager = defaultStateManager,
  logger = baseLogger,
} = {}) => {
  if (!io) {
    throw new Error('Socket.io server instance is required');
  }

  const biddingControllers = new Map();
  const playingControllers = new Map();
  const gameTimers = new Map();
  const chatThrottle = new Map();
  const disconnectAutoControllers = new Map();
  const pendingActions = new Map();
  let sessionSweepInterval = null;

  const getTurnTimerSeconds = (room) => {
    return clampTurnTimerSeconds(room?.hostSettings?.turnTimer, DEFAULT_TURN_TIMER_SECONDS);
  };

  const clearBiddingTimer = (gameId) => {
    if (!gameId || !biddingControllers.has(gameId)) {
      return;
    }

    const controller = biddingControllers.get(gameId);
    clearTimeout(controller?.timer);
    biddingControllers.delete(gameId);
  };

  const clearTrickTimer = (gameId) => {
    if (!gameId || !trickControllers.has(gameId)) {
      return;
    }

    const controller = trickControllers.get(gameId);
    clearTimeout(controller?.timer);
    trickControllers.delete(gameId);
  };

  const clearPlayingTimer = (gameId) => {
    if (!gameId || !playingControllers.has(gameId)) {
      return;
    }

    const controller = playingControllers.get(gameId);
    clearTimeout(controller?.timer);
    playingControllers.delete(gameId);
  };

  const clearGameTimer = (gameId) => {
    const entry = gameTimers.get(gameId);
    if (!entry) {
      return;
    }

    if (entry.timeout) {
      clearTimeout(entry.timeout);
    }

    if (entry.interval) {
      clearInterval(entry.interval);
    }

    gameTimers.delete(gameId);
  };

  const emitTurnTimerUpdate = ({
    roomId,
    gameId,
    playerId = null,
    phase = null,
    deadline = null,
    duration = null,
  }) => {
    if (!roomId || !io?.to) {
      return;
    }

    const payload = {
      roomId,
      gameId: gameId ?? null,
      playerId: playerId ?? null,
      phase: phase ?? null,
      deadline: Number.isFinite(deadline) ? deadline : null,
      duration: Number.isFinite(duration) ? duration : null,
    };

    io.to(roomId).emit('turn_timer_update', payload);
  };

  const emitGameTimerUpdate = ({ roomId, remainingMs, status = 'running' } = {}) => {
    if (!roomId) {
      return;
    }

    const normalizedRemaining = Number.isFinite(remainingMs)
      ? Math.max(0, Math.floor(remainingMs))
      : null;

    io.to(roomId).emit('game_timer_update', {
      remainingMs: normalizedRemaining,
      status,
    });
  };

  const prunePendingActions = () => {
    const now = Date.now();
    pendingActions.forEach((entry, playerId) => {
      if (!entry) {
        pendingActions.delete(playerId);
        return;
      }

      const recordedAt = Number(entry.recordedAt ?? 0);
      if (Number.isFinite(recordedAt) && now - recordedAt > PENDING_ACTION_TTL_MS) {
        pendingActions.delete(playerId);
      }
    });
  };

  const recordCompletedAction = ({ playerId, action, payload, metadata, status = 'completed' }) => {
    if (!playerId || !action) {
      return;
    }

    pendingActions.set(playerId, {
      action,
      payload: payload ?? null,
      metadata: metadata ?? null,
      status,
      recordedAt: Date.now(),
    });

    prunePendingActions();
  };

  const replayCachedActionsForPlayer = (socket, playerId) => {
    if (!socket || !playerId) {
      return;
    }

    const entry = pendingActions.get(playerId);
    if (!entry) {
      return;
    }

    const now = Date.now();
    const recordedAt = Number(entry.recordedAt ?? 0);
    if (Number.isFinite(recordedAt) && now - recordedAt > PENDING_ACTION_TTL_MS) {
      pendingActions.delete(playerId);
      return;
    }

    socket.emit('action_sync', {
      action: entry.action,
      payload: entry.payload,
      metadata: entry.metadata,
      status: entry.status,
      recordedAt: entry.recordedAt,
    });

    pendingActions.delete(playerId);
  };

  const sendPlayerStateSync = ({ socket, room, player }) => {
    if (!socket || !room || !player || player.isSpectator) {
      return false;
    }

    const gameId = room?.gameState?.gameId;
    if (!gameId) {
      return false;
    }

    const snapshot = stateManager.getGame(gameId);
    if (!snapshot) {
      return false;
    }

    socket.emit('game_state_update', {
      gameState: snapshot,
      yourPlayerId: player.playerId,
      lastUpdateTime: Date.now(),
    });

    const biddingController = biddingControllers.get(gameId);
    if (biddingController?.deadline) {
      socket.emit('turn_timer_update', {
        roomId: room.roomId,
        gameId,
        playerId: biddingController.playerId ?? null,
        phase: 'bidding',
        deadline: biddingController.deadline,
        duration: Number.isFinite(biddingController.deadline)
          ? Math.max(0, Math.floor((biddingController.deadline - Date.now()) / 1000))
          : null,
      });
    }

    const playingController = playingControllers.get(gameId);
    if (playingController?.deadline) {
      socket.emit('turn_timer_update', {
        roomId: room.roomId,
        gameId,
        playerId: playingController.playerId ?? null,
        phase: snapshot.currentPhase ?? 'playing',
        deadline: playingController.deadline,
        duration: Number.isFinite(playingController.deadline)
          ? Math.max(0, Math.floor((playingController.deadline - Date.now()) / 1000))
          : null,
      });
    }

    const gameTimer = gameTimers.get(gameId);
    if (gameTimer?.deadline) {
      const remainingMs = Math.max(0, gameTimer.deadline - Date.now());
      socket.emit('game_timer_update', {
        remainingMs,
        status: remainingMs <= 0 ? 'expired' : 'running',
      });
    }

    return true;
  };

  const updateRoomSummary = (room, gameState, currentRound) => {
    const currentPlayer = Array.isArray(gameState?.playerOrder)
      ? gameState.playerOrder[gameState.currentPlayerIndex] ?? null
      : null;

    const summary = {
      gameId: gameState?.gameId ?? null,
      currentRound: gameState?.currentRound ?? 0,
      currentPhase: gameState?.currentPhase ?? 'waiting',
      playerOrder: Array.isArray(gameState?.playerOrder) ? [...gameState.playerOrder] : [],
      currentPlayer,
    };

    if (currentRound) {
      summary.viraCard = currentRound.viraCard ?? null;
      summary.manilhaRank = currentRound.manilhaRank ?? null;
      summary.bids = currentRound.bids ? { ...currentRound.bids } : {};
      const trickCount = Array.isArray(currentRound.tricks) ? currentRound.tricks.length : 0;
      summary.trickNumber = currentRound.activeTrickNumber ?? trickCount;
    }

    room.update({
      gameState: summary,
      lastActivity: new Date().toISOString(),
    });

    stateManager.upsertRoom(room);
  };

  const getRoundIndex = (gameState) => {
    if (!gameState || !Number.isInteger(gameState.currentRound)) {
      return 0;
    }

    return Math.max(0, gameState.currentRound - 1);
  };

  const getCurrentRoundFromState = (gameState) => {
    if (!gameState || !Array.isArray(gameState.rounds)) {
      return null;
    }

    const index = getRoundIndex(gameState);
    return gameState.rounds[index] ?? null;
  };

  const getRoundHand = (round, playerId) => {
    if (!round || !playerId) {
      return [];
    }

    const { hands } = round;

    if (hands instanceof Map) {
      const entry = hands.get(playerId);
      return Array.isArray(entry) ? [...entry] : [];
    }

    if (hands && typeof hands === 'object') {
      const entry = hands[playerId];
      return Array.isArray(entry) ? [...entry] : [];
    }

    return [];
  };

  const setRoundHand = (round, playerId, cards) => {
    if (!round || !playerId) {
      return;
    }

    const normalized = Array.isArray(cards) ? [...cards] : [];

    if (round.hands instanceof Map) {
      round.hands.set(playerId, normalized);
      return;
    }

    if (round.hands && typeof round.hands === 'object') {
      round.hands[playerId] = normalized;
    }
  };

  const normalizeCardInput = (card) => {
    if (!card || typeof card !== 'object') {
      return { rank: null, suit: null };
    }

    const rankValue = typeof card.rank === 'string' ? card.rank.trim().toUpperCase() : null;
    const suitValue = typeof card.suit === 'string' ? card.suit.trim().toLowerCase() : null;

    return {
      rank: rankValue,
      suit: suitValue,
    };
  };

  const getCurrentTrick = (round) => {
    if (!round) {
      return null;
    }

    if (!Array.isArray(round.tricks) || round.tricks.length === 0) {
      return null;
    }

    return round.tricks[round.tricks.length - 1] ?? null;
  };

  const countCardsPlayed = (trick) => {
    if (!trick || !trick.cardsPlayed) {
      return 0;
    }

    if (trick.cardsPlayed instanceof Map) {
      return trick.cardsPlayed.size;
    }

    if (typeof trick.cardsPlayed === 'object') {
      return Object.keys(trick.cardsPlayed).length;
    }

    return 0;
  };

  const serializeCardsPlayed = (cardsPlayed) => {
    if (cardsPlayed instanceof Map) {
      return Object.fromEntries(
        Array.from(cardsPlayed.entries(), ([playerId, card]) => [playerId, serializeCard(card)]),
      );
    }

    if (cardsPlayed && typeof cardsPlayed === 'object') {
      return Object.fromEntries(
        Object.entries(cardsPlayed).map(([playerId, card]) => [playerId, serializeCard(card)]),
      );
    }

    return {};
  };

  const persistGame = ({ room, gameState }) => {
    const savedSnapshot = stateManager.setGame(gameState.gameId, gameState);
    const currentRoundSnapshot = getCurrentRoundFromState(savedSnapshot);
    updateRoomSummary(room, savedSnapshot, currentRoundSnapshot);
    return savedSnapshot;
  };

  const scheduleTrickStart = ({ room, gameState, leadPlayerId = null, loggerRef = logger }) => {
    if (!gameState?.gameId || !room) {
      return;
    }

    clearTrickTimer(gameState.gameId);

    const triggerStart = () => {
      trickControllers.delete(gameState.gameId);

      const latestState = stateManager.getGame(gameState.gameId) ?? gameState;

      startNewTrick({
        room,
        gameState: latestState,
        loggerRef,
        leadPlayerId,
      });
    };

    if (TRICK_START_DELAY_MS === 0) {
      triggerStart();
    } else {
      const timer = setTimeout(triggerStart, TRICK_START_DELAY_MS);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      trickControllers.set(gameState.gameId, {
        timer,
        scheduledAt: Date.now(),
        leadPlayerId,
      });
    }

    if (loggerRef && typeof loggerRef.debug === 'function') {
      loggerRef.debug('trick.start_scheduled', {
        roomId: room.roomId,
        gameId: gameState.gameId,
        delayMs: TRICK_START_DELAY_MS,
        immediate: TRICK_START_DELAY_MS === 0,
        leadPlayerId,
      });
    }
  };

  const completeGame = ({ room, gameState, reason = 'victory', loggerRef = logger }) => {
    if (!room || !gameState) {
      return gameState;
    }

    const referenceState = gameState.currentPhase ? gameState : stateManager.getGame(gameState.gameId) ?? gameState;

    if (referenceState?.currentPhase === 'completed') {
      clearGameTimer(referenceState.gameId);
      clearBiddingTimer(referenceState.gameId);
      clearTrickTimer(referenceState.gameId);
      clearPlayingTimer(referenceState.gameId);
      return referenceState;
    }

    clearGameTimer(referenceState.gameId);
    clearBiddingTimer(referenceState.gameId);
    clearTrickTimer(referenceState.gameId);
    clearPlayingTimer(referenceState.gameId);

    const mutableState = cloneDeep(referenceState);
    mutableState.currentPhase = 'completed';
    mutableState.endedAt = new Date().toISOString();

    const participantSet = new Set(Array.isArray(mutableState.playerOrder) ? mutableState.playerOrder : []);

    if (Array.isArray(mutableState.rounds)) {
      mutableState.rounds.forEach((round) => {
        if (Array.isArray(round?.playerOrder)) {
          round.playerOrder.forEach((playerId) => participantSet.add(playerId));
        }

        if (round?.results && typeof round.results === 'object') {
          Object.keys(round.results).forEach((playerId) => participantSet.add(playerId));
        }
      });
    }

    const currentRoomPlayers = Array.isArray(room.players) ? room.players : [];
    currentRoomPlayers.forEach((playerId) => participantSet.add(playerId));

    const playerPayload = [];
    const lobbyPlayers = new Set();
    const lobbySpectators = new Set();
    const nowIso = new Date().toISOString();
    const startingLives = room.hostSettings?.startingLives ?? 5;

    participantSet.forEach((playerId) => {
      const playerRecord = roomManager.getPlayer(playerId);
      if (!playerRecord) {
        return;
      }

      const livesRemaining = Number.isFinite(playerRecord.lives) ? playerRecord.lives : 0;
      playerPayload.push({
        playerId,
        displayName: playerRecord.displayName ?? playerId,
        livesRemaining,
      });

      playerRecord.update({
        lives: startingLives,
        isSpectator: false,
        hand: [],
        currentBid: null,
        tricksWon: 0,
      });
      playerRecord.touch(nowIso);
      stateManager.upsertPlayer(playerRecord);

      lobbyPlayers.add(playerId);
    });

    const originalSpectators = Array.isArray(room.spectators) ? room.spectators : [];
    originalSpectators.forEach((spectatorId) => {
      if (!participantSet.has(spectatorId)) {
        lobbySpectators.add(spectatorId);
      }
    });

    const payload = buildGameCompletionPayload({
      gameState: mutableState,
      players: playerPayload,
      reason,
    });

    mutableState.winner = payload.winner ?? null;
    mutableState.completionReason = reason;

    const savedSnapshot = persistGame({ room, gameState: mutableState });

    room.update({
      status: 'waiting',
      players: [...lobbyPlayers],
      spectators: [...lobbySpectators],
      lastActivity: nowIso,
    });

    roomManager.assignHost(room);
    stateManager.upsertRoom(room);

    io.to(room.roomId).emit('game_completed', payload);

    emitGameTimerUpdate({
      roomId: room.roomId,
      remainingMs: 0,
      status: 'completed',
    });

    if (loggerRef && typeof loggerRef.info === 'function') {
      loggerRef.info('game.completed', {
        roomId: room.roomId,
        gameId: savedSnapshot?.gameId ?? mutableState.gameId,
        winner: payload.winner,
        reason,
      });
    }

    return savedSnapshot;
  };

  const scheduleGameTimer = ({ room, gameState }) => {
    if (!room || !gameState || !gameState.gameId) {
      return;
    }

    clearGameTimer(gameState.gameId);

    const timeLimitMs = Number.isFinite(gameState.timeLimitMs)
      ? gameState.timeLimitMs
      : DEFAULT_GAME_TIME_LIMIT_MS;
    const startedAt = Date.parse(gameState.startedAt);

    if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0 || Number.isNaN(startedAt)) {
      return;
    }

    const deadline = startedAt + timeLimitMs;
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      completeGame({
        room,
        gameState,
        reason: 'timeout',
        loggerRef: logger,
      });
      return;
    }

    const broadcast = (ms) => {
      emitGameTimerUpdate({
        roomId: room.roomId,
        remainingMs: ms,
        status: ms <= 0 ? 'expired' : ms <= GAME_TIMER_WARNING_MS ? 'warning' : 'running',
      });
    };

    const timeout = setTimeout(() => {
      const latestRoom = roomManager.getRoom(room.roomId) ?? room;
      const latestState = stateManager.getGame(gameState.gameId) ?? gameState;
      clearGameTimer(gameState.gameId);
      broadcast(0);
      completeGame({
        room: latestRoom,
        gameState: latestState,
        reason: 'timeout',
        loggerRef: logger,
      });
    }, remaining);

    if (typeof timeout.unref === 'function') {
      timeout.unref();
    }

    const interval = setInterval(() => {
      const msLeft = deadline - Date.now();
      broadcast(msLeft);

      if (msLeft <= 0) {
        clearGameTimer(gameState.gameId);
      }
    }, GAME_TIMER_TICK_MS);

    if (typeof interval.unref === 'function') {
      interval.unref();
    }

    gameTimers.set(gameState.gameId, {
      roomId: room.roomId,
      deadline,
      interval,
      timeout,
    });

    broadcast(remaining);
  };

  const finalizeRound = ({ room, gameState, roundIndex, loggerRef = logger }) => {
    if (!room || !gameState) {
      return gameState;
    }

    clearTrickTimer(gameState.gameId);

    const mutableState = cloneDeep(gameState);
    const rounds = Array.isArray(mutableState.rounds) ? mutableState.rounds : [];
    const targetRound = rounds[roundIndex];

    if (!targetRound) {
      return gameState;
    }

    const playerOrder = Array.isArray(mutableState.playerOrder) ? [...mutableState.playerOrder] : [];
    const calculated = calculateRoundResults({ round: targetRound, playerOrder });

    targetRound.results = { ...calculated.actuals };
    targetRound.completedAt = new Date().toISOString();

    const resultsPayload = {};
    const eliminatedPlayers = [];
    const now = new Date().toISOString();

    const updatedPlayersList = Array.isArray(room.players) ? [...room.players] : [];
    const spectatorSet = new Set(Array.isArray(room.spectators) ? room.spectators : []);

    playerOrder.forEach((playerId) => {
      const playerRecord = roomManager.getPlayer(playerId);
      if (!playerRecord) {
        return;
      }

      const bid = calculated.bids[playerId] ?? 0;
      const actual = calculated.actuals[playerId] ?? 0;
      const livesLost = calculated.livesLost[playerId] ?? 0;
      const currentLives = Number.isFinite(playerRecord.lives) ? playerRecord.lives : room.hostSettings?.startingLives ?? 5;
      const remainingLives = Math.max(0, currentLives - livesLost);

      playerRecord.update({
        lives: remainingLives,
        currentBid: null,
        hand: [],
      });

      if (remainingLives <= 0) {
        playerRecord.update({
          isSpectator: true,
        });
        eliminatedPlayers.push(playerId);
        const index = updatedPlayersList.indexOf(playerId);
        if (index !== -1) {
          updatedPlayersList.splice(index, 1);
        }
        spectatorSet.add(playerId);
      }

      playerRecord.touch(now);
      stateManager.upsertPlayer(playerRecord);

      resultsPayload[playerId] = {
        bid,
        actual,
        livesLost,
        livesRemaining: remainingLives,
      };
    });

    room.update({
      players: updatedPlayersList,
      spectators: [...spectatorSet],
      lastActivity: now,
    });

    const activePlayers = updatedPlayersList
      .map((playerId) => roomManager.getPlayer(playerId))
      .filter((player) => player && !player.isSpectator && player.connectionStatus === 'connected');

    mutableState.playerOrder = activePlayers.map((player) => player.playerId);
    mutableState.currentPlayerIndex = 0;
    mutableState.currentPhase = 'scoring';

    roomManager.assignHost(room);

    const savedSnapshot = persistGame({ room, gameState: mutableState });

    io.to(room.roomId).emit('round_completed', {
      roundNumber: targetRound.roundNumber ?? roundIndex + 1,
      results: resultsPayload,
      eliminatedPlayers,
    });

    if (mutableState.playerOrder.length <= 1) {
      const reason = mutableState.playerOrder.length === 1 ? 'victory' : 'insufficient_players';
      return completeGame({
        room,
        gameState: savedSnapshot,
        reason,
        loggerRef,
      });
    }

    if (loggerRef && typeof loggerRef.info === 'function') {
      loggerRef.info('round.completed', {
        roomId: room.roomId,
        roundNumber: targetRound.roundNumber ?? roundIndex + 1,
        eliminated: eliminatedPlayers,
      });
    }

    const scheduleNextRound = () => {
      const refreshedRoom = roomManager.getRoom(room.roomId) ?? room;
      const refreshedState = stateManager.getGame(savedSnapshot.gameId) ?? savedSnapshot;

      startNextRound({
        room: refreshedRoom,
        gameState: refreshedState,
        previousRoundCardCount: targetRound.cardCount ?? 1,
        loggerRef,
      });
    };

    const delayMs = Number.isFinite(room?.hostSettings?.roundTransitionDelayMs)
      ? Math.max(0, room.hostSettings.roundTransitionDelayMs)
      : ROUND_TRANSITION_DELAY_MS;

    if (typeof setTimeout === 'function') {
      setTimeout(scheduleNextRound, delayMs);
    } else if (typeof setImmediate === 'function') {
      setImmediate(scheduleNextRound);
    } else {
      scheduleNextRound();
    }

    return savedSnapshot;
  };

  const startNextRound = ({
    room,
    gameState,
    previousRoundCardCount = 1,
    loggerRef = logger,
  }) => {
    if (!room || !gameState) {
      return gameState;
    }

    const activePlayers = getActivePlayers(room);

    if (activePlayers.length < 2) {
      return gameState;
    }

    const nextCardCount = determineNextCardCount({
      previousCardCount: previousRoundCardCount,
      playerCount: activePlayers.length,
    });

    const playerOrder = activePlayers.map((player) => player.playerId);
    const deck = shuffleDeck(createDeck());
    const { viraCard, remainingDeck, manilhaRank } = drawVira(deck);
    const annotatedDeck = applyViraToCards(remainingDeck, viraCard.rank);
    const { hands, remainingDeck: leftover } = dealHands({
      playerOrder,
      deck: annotatedDeck,
      cardCount: nextCardCount,
    });

    const mutableState = cloneDeep(gameState);
    mutableState.rounds = Array.isArray(mutableState.rounds) ? [...mutableState.rounds] : [];

    const roundNumber = mutableState.rounds.length + 1;
    const roundEntity = new GameRound({
      roundNumber,
      cardCount: nextCardCount,
      viraCard: serializeCard(viraCard),
      manilhaRank,
      hands,
      playerOrder,
      isBlindRound: roundNumber === 1,
    });

    const roundSnapshot = roundEntity.toJSON();

    mutableState.rounds.push({
      ...roundSnapshot,
      hands: roundSnapshot.hands,
    });

    mutableState.currentRound = roundNumber;
    mutableState.currentPhase = 'bidding';
    mutableState.playerOrder = playerOrder;
    mutableState.currentPlayerIndex = 0;
    mutableState.metadata = mutableState.metadata || {};
    mutableState.metadata.viraCard = serializeCard(viraCard);
    mutableState.metadata.deck = leftover.map((card) => serializeCard(card));

    const savedSnapshot = persistGame({ room, gameState: mutableState });

    activePlayers.forEach((player) => {
      const playerHand = roundSnapshot.hands[player.playerId] || [];
      player.update({
        hand: playerHand.map((card) => serializeCard(card)),
        currentBid: null,
        tricksWon: 0,
      });
      stateManager.upsertPlayer(player);
    });

    io.to(room.roomId).emit('round_started', {
      roundNumber,
      cardCount: nextCardCount,
      viraCard: serializeCard(viraCard),
      isBlindRound: Boolean(roundEntity.isBlindRound),
    });

    emitHandsToPlayers({
      gameState: savedSnapshot,
      round: roundEntity,
      players: activePlayers,
    });

    scheduleBiddingTurn({ room, gameState: savedSnapshot });

    if (loggerRef && typeof loggerRef.info === 'function') {
      loggerRef.info('round.started', {
        roomId: room.roomId,
        roundNumber,
        cardCount: nextCardCount,
      });
    }

    return savedSnapshot;
  };

  const getLeadPlayer = (gameState) => {
    if (!Array.isArray(gameState?.playerOrder) || !gameState.playerOrder.length) {
      return null;
    }
    const index = gameState.currentPlayerIndex ?? 0;
    return gameState.playerOrder[index] ?? null;
  };

  const findNextPlayerIndex = (gameState, round) => {
    const order = Array.isArray(gameState?.playerOrder) ? gameState.playerOrder : [];
    if (!order.length) {
      return 0;
    }

    const currentIndex = gameState.currentPlayerIndex ?? 0;

    for (let step = 1; step <= order.length; step += 1) {
      const candidateIndex = (currentIndex + step) % order.length;
      const candidateId = order[candidateIndex];
      const hand = getRoundHand(round, candidateId);
      if (hand.length > 0) {
        return candidateIndex;
      }
    }

    return currentIndex;
  };

  const startNewTrick = ({ room, gameState, loggerRef = logger, leadPlayerId = null }) => {
    if (!gameState) {
      return gameState;
    }

    clearTrickTimer(gameState.gameId);

    const mutableState = cloneDeep(gameState);
    const roundIndex = getRoundIndex(mutableState);
    const round = mutableState.rounds?.[roundIndex];

    if (!round) {
      return gameState;
    }

    round.tricks = Array.isArray(round.tricks) ? round.tricks : [];
    const lastTrick = round.tricks[round.tricks.length - 1];

    const resolveLeadPlayer = () => {
      if (leadPlayerId) {
        return leadPlayerId;
      }
      if (lastTrick?.leadPlayer) {
        return lastTrick.leadPlayer;
      }
      return getLeadPlayer(mutableState);
    };

    const syncLeadIndex = (playerId) => {
      if (!playerId || !Array.isArray(mutableState.playerOrder)) {
        return;
      }
      const leadIndex = mutableState.playerOrder.indexOf(playerId);
      if (leadIndex >= 0) {
        mutableState.currentPlayerIndex = leadIndex;
      }
    };

    if (lastTrick && !lastTrick.completedAt) {
      const leadPlayer = resolveLeadPlayer();
      if (!leadPlayer) {
        return gameState;
      }

      syncLeadIndex(leadPlayer);
      round.activeTrickNumber = lastTrick.trickNumber ?? round.activeTrickNumber ?? 1;

      const savedSnapshot = persistGame({ room, gameState: mutableState });

      io.to(room.roomId).emit('trick_started', {
        trickNumber: lastTrick.trickNumber ?? round.activeTrickNumber,
        leadPlayer,
      });

      schedulePlayingTurn({
        room,
        gameState: savedSnapshot,
        playerId: leadPlayer,
      });

      if (loggerRef && typeof loggerRef.debug === 'function') {
        loggerRef.debug('trick.started.resync', {
          roomId: room.roomId,
          gameId: savedSnapshot.gameId,
          trickNumber: lastTrick.trickNumber ?? round.activeTrickNumber,
          leadPlayer,
        });
      }

      return savedSnapshot;
    }

    const leadPlayer = resolveLeadPlayer();
    if (!leadPlayer) {
      return gameState;
    }

    syncLeadIndex(leadPlayer);

    const trickNumber = round.tricks.length + 1;
    const trickState = createTrickState({ trickNumber, leadPlayer });
    round.tricks.push(trickState);
    round.activeTrickNumber = trickNumber;

    const savedSnapshot = persistGame({ room, gameState: mutableState });

    io.to(room.roomId).emit('trick_started', {
      trickNumber,
      leadPlayer,
    });

    schedulePlayingTurn({
      room,
      gameState: savedSnapshot,
      playerId: leadPlayer,
    });

    if (loggerRef && typeof loggerRef.info === 'function') {
      loggerRef.info('trick.started', {
        roomId: room.roomId,
        gameId: savedSnapshot.gameId,
        trickNumber,
        leadPlayer,
      });
    }

    return savedSnapshot;
  };

  const handleBiddingTimeout = ({ gameId, roomId, playerId, validBids }) => {
    clearBiddingTimer(gameId);

    const room = roomManager.getRoom(roomId);
    const snapshot = stateManager.getGame(gameId);

    if (!room || !snapshot) {
      return;
    }

    const roundIndex = Math.max(0, (snapshot.currentRound ?? 1) - 1);
    const round = snapshot.rounds?.[roundIndex];
    if (!round) {
      return;
    }

    if (round.bids && Object.prototype.hasOwnProperty.call(round.bids, playerId)) {
      return;
    }

  const autoBid = selectAutoBid(validBids);

    io.to(roomId).emit('auto_action', {
      playerId,
      action: 'auto_bid',
      value: autoBid,
      reason: 'timeout',
    });

    logger.info('bidding.auto_bid_timeout', {
      roomId,
      gameId,
      playerId,
      bid: autoBid,
    });

    const mutableState = cloneDeep(snapshot);
    const mutableRound = mutableState?.rounds?.[roundIndex];
    if (!mutableRound) {
      return;
    }

    const resultSnapshot = processBidSubmission({
      room,
      gameState: mutableState,
      playerId,
      bid: autoBid,
      isAuto: true,
      loggerRef: logger,
    });

    recordCompletedAction({
      playerId,
      action: 'submit_bid',
      payload: { bid: autoBid },
      metadata: {
        roomId,
        gameId,
        roundNumber: (resultSnapshot ?? mutableState ?? snapshot)?.currentRound ?? null,
        phase: 'bidding',
        auto: true,
        reason: 'timeout',
      },
      status: 'auto',
    });
  };

  const scheduleBiddingTurn = ({ room, gameState }) => {
    if (!gameState || gameState.currentPhase !== 'bidding') {
      return;
    }

    clearBiddingTimer(gameState.gameId);

    const roundIndex = Math.max(0, (gameState.currentRound ?? 1) - 1);
    const round = gameState.rounds?.[roundIndex];
    if (!round) {
      return;
    }

    const currentPlayerId = Array.isArray(gameState.playerOrder)
      ? gameState.playerOrder[gameState.currentPlayerIndex ?? 0]
      : null;

    if (!currentPlayerId) {
      return;
    }

    const bidInfo = calculateValidBids({
      cardCount: round.cardCount ?? 0,
      playerOrder: gameState.playerOrder ?? [],
      playerId: currentPlayerId,
      bids: round.bids ?? {},
      isBlindRound: Boolean(round.isBlindRound),
    });

    const turnTimerSeconds = getTurnTimerSeconds(room);
    const deadline = calculateDeadline(turnTimerSeconds);

    io.to(room.roomId).emit('bidding_turn', {
      currentPlayer: currentPlayerId,
      validBids: bidInfo.validBids,
      restrictedBid: bidInfo.restrictedBid,
      isLastBidder: bidInfo.isLastBidder,
      timeLeft: turnTimerSeconds,
      deadline,
      metadata: bidInfo.metadata,
    });

    emitTurnTimerUpdate({
      roomId: room.roomId,
      gameId: gameState.gameId,
      playerId: currentPlayerId,
      phase: 'bidding',
      deadline,
      duration: turnTimerSeconds,
    });

    const timer = setTimeout(() => {
      biddingControllers.delete(gameState.gameId);
      handleBiddingTimeout({
        gameId: gameState.gameId,
        roomId: room.roomId,
        playerId: currentPlayerId,
        validBids: bidInfo.validBids,
      });
    }, turnTimerSeconds * 1000);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    biddingControllers.set(gameState.gameId, {
      timer,
      deadline,
      playerId: currentPlayerId,
      roomId: room.roomId,
      validBids: bidInfo.validBids,
    });
  };

  const schedulePlayingTurn = ({ room, gameState, playerId }) => {
    if (!gameState?.gameId || !room) {
      return;
    }

    clearPlayingTimer(gameState.gameId);

    if (!playerId) {
      emitTurnTimerUpdate({
        roomId: room.roomId,
        gameId: gameState.gameId,
        playerId: null,
        phase: gameState.currentPhase ?? 'playing',
        deadline: null,
        duration: null,
      });
      return;
    }

    const seconds = getTurnTimerSeconds(room);
    const deadline = calculateDeadline(seconds);

    const timer = setTimeout(() => {
      playingControllers.delete(gameState.gameId);
      handlePlayTimeout({
        gameId: gameState.gameId,
        roomId: room.roomId,
        playerId,
      });
    }, seconds * 1000);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    playingControllers.set(gameState.gameId, {
      timer,
      deadline,
      playerId,
      roomId: room.roomId,
    });

    emitTurnTimerUpdate({
      roomId: room.roomId,
      gameId: gameState.gameId,
      playerId,
      phase: gameState.currentPhase ?? 'playing',
      deadline,
      duration: seconds,
    });
  };

  const processBidSubmission = ({ room, gameState, playerId, bid, isAuto = false, loggerRef = logger }) => {
    if (!gameState) {
      return null;
    }

    clearBiddingTimer(gameState.gameId);

    const roundIndex = Math.max(0, (gameState.currentRound ?? 1) - 1);
    const round = gameState.rounds?.[roundIndex];

    if (!round) {
      return null;
    }

    if (!round.bids || typeof round.bids !== 'object') {
      round.bids = {};
    }

    if (Object.prototype.hasOwnProperty.call(round.bids, playerId)) {
      return null;
    }

    round.bids[playerId] = bid;

    const playerRecord = roomManager.getPlayer(playerId);
    if (playerRecord) {
      playerRecord.update({ currentBid: bid });
      stateManager.upsertPlayer(playerRecord);
    }

    const totalPlayers = Array.isArray(gameState.playerOrder) ? gameState.playerOrder.length : 0;
    const bidsSubmitted = Object.keys(round.bids).length;
    const allBidsSubmitted = totalPlayers > 0 && bidsSubmitted >= totalPlayers;

    if (allBidsSubmitted) {
      gameState.currentPhase = 'playing';
      gameState.currentPlayerIndex = 0;
    } else {
      const nextIndex = ((gameState.currentPlayerIndex ?? 0) + 1) % totalPlayers;
      gameState.currentPlayerIndex = nextIndex;
    }

    const savedSnapshot = stateManager.setGame(gameState.gameId, gameState);
    const currentRoundSnapshot = savedSnapshot?.rounds?.[roundIndex] ?? null;

    updateRoomSummary(room, savedSnapshot, currentRoundSnapshot);

    io.to(room.roomId).emit('bid_submitted', {
      playerId,
      bid,
      ...(allBidsSubmitted ? { allBids: currentRoundSnapshot?.bids ? { ...currentRoundSnapshot.bids } : {} } : {}),
    });

    loggerRef.info('bidding.bid_recorded', {
      roomId: room.roomId,
      gameId: savedSnapshot.gameId,
      playerId,
      bid,
      auto: isAuto,
      bidsSubmitted,
      totalPlayers,
      phase: savedSnapshot.currentPhase,
    });

    if (!allBidsSubmitted) {
      scheduleBiddingTurn({ room, gameState: savedSnapshot });
      return savedSnapshot;
    }

    clearBiddingTimer(savedSnapshot.gameId);
    emitTurnTimerUpdate({
      roomId: room.roomId,
      gameId: savedSnapshot.gameId,
      playerId: null,
      phase: savedSnapshot.currentPhase,
      deadline: null,
      duration: null,
    });
    const snapshotWithTrick = startNewTrick({
      room,
      gameState: savedSnapshot,
      loggerRef,
    });

    return snapshotWithTrick ?? savedSnapshot;
  };

  const handlePlayCard = async (socket, payload, socketLogger, options = {}) => {
    const { isAuto = false } = options ?? {};
    const playerId = socket.data?.playerId;
    const roomId = socket.data?.roomId;
  let cardPayload = normalizeCardInput(payload?.card);

    if (!playerId || !roomId) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'invalid_state',
        message: 'You must join a room before playing a card.',
      });
      return;
    }

    if (!cardPayload.rank || !cardPayload.suit) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'invalid_card',
        message: 'Card payload must include rank and suit.',
      });
      return;
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'invalid_room',
        message: 'Room could not be found.',
      });
      return;
    }

    const gameId = socket.data?.gameId ?? room?.gameState?.gameId;
    if (!gameId) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'game_not_active',
        message: 'No active game found for this room.',
      });
      return;
    }

    const storedGame = stateManager.getGame(gameId);
    if (!storedGame) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'game_not_active',
        message: 'Game state unavailable.',
      });
      return;
    }

    if (storedGame.currentPhase !== 'playing') {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'invalid_phase',
        message: 'Cards can only be played during the playing phase.',
      });
      return;
    }

    clearPlayingTimer(gameId);

    const roundIndex = getRoundIndex(storedGame);
    const storedRound = storedGame.rounds?.[roundIndex];
    if (!storedRound) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'invalid_round',
        message: 'Unable to locate the current round.',
      });
      return;
    }

    const expectedPlayerId = getLeadPlayer(storedGame);
    if (!expectedPlayerId || expectedPlayerId !== playerId) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'invalid_turn',
        message: 'It is not your turn to play a card.',
        currentPlayer: expectedPlayerId,
      });
      return;
    }

  const mutableState = cloneDeep(storedGame);
  const mutableRound = mutableState.rounds?.[roundIndex];
    mutableRound.tricks = Array.isArray(mutableRound.tricks) ? mutableRound.tricks : [];

    let trickState = getCurrentTrick(mutableRound);
    if (!trickState || trickState.completedAt) {
      const fallbackLead = getLeadPlayer(mutableState) ?? playerId;
      const trickNumber = mutableRound.tricks.length + 1;
      trickState = createTrickState({ trickNumber, leadPlayer: fallbackLead });
      mutableRound.tricks.push(trickState);
      mutableRound.activeTrickNumber = trickNumber;
    }

    const currentHand = getRoundHand(mutableRound, playerId);

    if (
      mutableRound.isBlindRound &&
      (!cardPayload.rank || !cardPayload.suit)
    ) {
      const fallbackCard = Array.isArray(currentHand) && currentHand.length > 0 ? currentHand[0] : null;

      if (!fallbackCard) {
        socket.emit('action_error', {
          action: 'play_card',
          error: 'card_not_in_hand',
          message: 'No cards available to play for blind round.',
        });
        return;
      }

      cardPayload = serializeCard(fallbackCard);
    }

    const validation = validateTrickCardPlay({
      round: mutableRound,
      trick: trickState,
      playerId,
      card: cardPayload,
      expectedPlayerId,
    });

    if (!validation.isValid) {
      socket.emit('action_error', {
        action: 'play_card',
        error: validation.code ?? 'invalid_card',
        message: validation.reason ?? 'Card cannot be played at this time.',
        details: validation.details ?? null,
      });
      return;
    }

    const { hand: updatedRoundHand, removed } = removeCardFromHand(currentHand, cardPayload);

    if (!removed) {
      socket.emit('action_error', {
        action: 'play_card',
        error: 'card_not_in_hand',
        message: 'The selected card is not available in your hand.',
      });
      return;
    }

    setRoundHand(mutableRound, playerId, updatedRoundHand);

    const playerRecord = roomManager.getPlayer(playerId);
    if (playerRecord) {
      const { hand: updatedPlayerHand } = removeCardFromHand(playerRecord.hand ?? [], cardPayload);
      playerRecord.update({
        hand: updatedPlayerHand,
      });
      stateManager.upsertPlayer(playerRecord);
    }

    recordCardPlay(trickState, {
      playerId,
      card: removed,
    });

    const viraRank = mutableRound?.viraCard?.rank ?? null;
    const evaluation = resolveTrick({
      trick: trickState,
      viraRank,
    });

    trickState.currentLeader = evaluation.winner ?? null;
    trickState.currentWinningCard = evaluation.winningCard ? { ...evaluation.winningCard } : null;
    trickState.cancelledCards = Array.isArray(evaluation.cancelledCards)
      ? evaluation.cancelledCards.map((card) => ({ ...card }))
      : [];

    mutableRound.activeTrickNumber = trickState.trickNumber;

    const totalPlayers = Array.isArray(mutableState.playerOrder) ? mutableState.playerOrder.length : 0;
    const playedCount = countCardsPlayed(trickState);
    const trickComplete = totalPlayers > 0 && playedCount >= totalPlayers;

    const previousIndex = mutableState.currentPlayerIndex ?? 0;
    let nextPlayerId = null;
    let leadForNextTrick = null;
    let moreTricksPending = false;

    if (!trickComplete) {
      const nextIndex = findNextPlayerIndex(mutableState, mutableRound);
      if (nextIndex !== previousIndex) {
        mutableState.currentPlayerIndex = nextIndex;
        nextPlayerId = mutableState.playerOrder[nextIndex] ?? null;
      }
    } else {
      const resolution = evaluation;

      trickState.winner = resolution.winner ?? null;
      trickState.cancelledCards = Array.isArray(resolution.cancelledCards)
        ? resolution.cancelledCards.map((card) => ({ ...card }))
        : [];
      trickState.winningCard = resolution.winningCard ? { ...resolution.winningCard } : null;
      trickState.completedAt = new Date().toISOString();

      leadForNextTrick = trickState.winner ?? trickState.leadPlayer ?? getLeadPlayer(mutableState);

      if (trickState.winner) {
        const winnerIndex = mutableState.playerOrder.indexOf(trickState.winner);
        if (winnerIndex !== -1) {
          mutableState.currentPlayerIndex = winnerIndex;
        }

        const winnerRecord = roomManager.getPlayer(trickState.winner);
        if (winnerRecord) {
          winnerRecord.update({
            tricksWon: (winnerRecord.tricksWon ?? 0) + 1,
          });
          stateManager.upsertPlayer(winnerRecord);
        }
      } else if (leadForNextTrick) {
        const leadIndex = mutableState.playerOrder.indexOf(leadForNextTrick);
        if (leadIndex !== -1) {
          mutableState.currentPlayerIndex = leadIndex;
        }
      }

      const completedTricks = mutableRound.tricks.filter((entry) => entry.completedAt).length;
      const totalTricksThisRound = Number.isInteger(mutableRound.cardCount) && mutableRound.cardCount > 0
        ? mutableRound.cardCount
        : mutableRound.tricks.length;
      moreTricksPending = completedTricks < totalTricksThisRound;

      if (!moreTricksPending) {
        mutableState.currentPhase = 'scoring';
      }
    }

    const playedCardRecord = (() => {
      if (trickState.cardsPlayed instanceof Map) {
        return serializeCard(trickState.cardsPlayed.get(playerId));
      }
      if (trickState.cardsPlayed && typeof trickState.cardsPlayed === 'object') {
        return serializeCard(trickState.cardsPlayed[playerId]);
      }
      return serializeCard(removed);
    })();

    const savedSnapshot = persistGame({ room, gameState: mutableState });

    recordCompletedAction({
      playerId,
      action: 'play_card',
      payload: { card: playedCardRecord },
      metadata: {
        roomId,
        gameId,
        trickNumber: trickState.trickNumber,
        phase: savedSnapshot.currentPhase ?? 'playing',
        auto: isAuto,
      },
      status: isAuto ? 'auto' : 'completed',
    });

    const leadingCardPayload = evaluation.winningCard ? serializeCard(evaluation.winningCard) : null;
    const cancelledCardsPayload = Array.isArray(evaluation.cancelledCards)
      ? evaluation.cancelledCards.map((card) => serializeCard(card))
      : [];

    io.to(room.roomId).emit('card_played', {
      playerId,
      card: playedCardRecord,
      nextPlayer: trickComplete ? null : nextPlayerId,
      currentLeader: evaluation.winner ?? null,
      winningCard: leadingCardPayload,
      cancelledCards: cancelledCardsPayload,
    });

    socketLogger.info('socket.play_card', {
      roomId,
      gameId,
      playerId,
      trickNumber: trickState.trickNumber,
      trickComplete,
    });

    if (!trickComplete) {
      schedulePlayingTurn({
        room,
        gameState: savedSnapshot,
        playerId: nextPlayerId,
      });
      return;
    }

    const cardsPlayedRecord = serializeCardsPlayed(trickState.cardsPlayed);
    const completedCancelledCards = Array.isArray(trickState.cancelledCards)
      ? trickState.cancelledCards.map((card) => serializeCard(card))
      : [];

    emitTurnTimerUpdate({
      roomId: room.roomId,
      gameId,
      playerId: null,
      phase: savedSnapshot.currentPhase,
      deadline: null,
      duration: null,
    });

    io.to(room.roomId).emit('trick_completed', {
      trickNumber: trickState.trickNumber,
      cardsPlayed: cardsPlayedRecord,
      winner: trickState.winner ?? null,
  cancelledCards: completedCancelledCards,
      nextTrick: moreTricksPending,
    });

    if (moreTricksPending) {
      scheduleTrickStart({
        room,
        gameState: savedSnapshot,
        loggerRef: socketLogger,
        leadPlayerId: leadForNextTrick ?? getLeadPlayer(savedSnapshot),
      });
    } else {
      finalizeRound({
        room,
        gameState: savedSnapshot,
        roundIndex,
        loggerRef: socketLogger,
      });
    }
  };

  function handlePlayTimeout({ gameId, roomId, playerId }) {
    clearPlayingTimer(gameId);

    const room = roomManager.getRoom(roomId);
    const snapshot = stateManager.getGame(gameId);

    if (!room || !snapshot) {
      return;
    }

    if (snapshot.currentPhase !== 'playing') {
      schedulePlayingTurn({ room, gameState: snapshot, playerId: null });
      return;
    }

    const expectedPlayerId = getLeadPlayer(snapshot);
    if (!expectedPlayerId || expectedPlayerId !== playerId) {
      schedulePlayingTurn({ room, gameState: snapshot, playerId: expectedPlayerId ?? null });
      return;
    }

    const roundIndex = getRoundIndex(snapshot);
    const round = snapshot.rounds?.[roundIndex];
    if (!round) {
      schedulePlayingTurn({ room, gameState: snapshot, playerId: expectedPlayerId });
      return;
    }

    const trick = getCurrentTrick(round);
    if (!trick || trick.completedAt) {
      schedulePlayingTurn({ room, gameState: snapshot, playerId: expectedPlayerId });
      return;
    }

    const hand = getRoundHand(round, playerId);
    const autoCard = selectAutoCard({
      hand,
      round,
      trick,
      playerId,
      expectedPlayerId,
      validateCardPlay: validateTrickCardPlay,
    });

    if (!autoCard) {
      schedulePlayingTurn({ room, gameState: snapshot, playerId: expectedPlayerId });
      return;
    }

    const autoLogger = typeof logger.child === 'function' ? logger.child({ scope: 'auto-play' }) : logger;

    io.to(roomId).emit('auto_action', {
      playerId,
      action: 'auto_card',
      value: autoCard,
      reason: 'timeout',
    });

    const autoSocket = {
      data: {
        playerId,
        roomId,
        gameId,
      },
      emit: () => {},
    };

    Promise.resolve(handlePlayCard(autoSocket, { card: autoCard }, autoLogger, { isAuto: true })).catch((error) => {
      autoLogger?.error?.('auto_play_card_failed', {
        roomId,
        gameId,
        playerId,
        error: error?.message ?? error,
      });
    });
  }

  const cancelDisconnectAutoAction = (playerId) => {
    if (!playerId) {
      return;
    }

    const controller = disconnectAutoControllers.get(playerId);
    if (!controller) {
      return;
    }

    if (controller.timer) {
      clearTimeout(controller.timer);
    }

    disconnectAutoControllers.delete(playerId);
  };

  const processDisconnectAutoAction = ({ roomId, playerId }) => {
    const playerRecord = roomManager.getPlayer(playerId);
    if (!playerRecord || playerRecord.connectionStatus === 'connected' || playerRecord.isSpectator) {
      cancelDisconnectAutoAction(playerId);
      return;
    }

    const session = typeof roomManager.getSessionForPlayer === 'function'
      ? roomManager.getSessionForPlayer(playerId)
      : null;
    const now = Date.now();

    if (session?.expiresAt && session.expiresAt <= now) {
      cancelDisconnectAutoAction(playerId);
      return;
    }

    const room = roomManager.getRoom(roomId);
    if (!room?.gameState?.gameId) {
      scheduleDisconnectAutoAction({ roomId, playerId, delayMs: DISCONNECT_AUTO_RECHECK_DELAY_MS });
      return;
    }

    const gameState = stateManager.getGame(room.gameState.gameId);
    if (!gameState) {
      scheduleDisconnectAutoAction({ roomId, playerId, delayMs: DISCONNECT_AUTO_RECHECK_DELAY_MS });
      return;
    }

    if (gameState.currentPhase === 'bidding') {
      const currentPlayerId = Array.isArray(gameState.playerOrder)
        ? gameState.playerOrder[gameState.currentPlayerIndex ?? 0]
        : null;

      if (currentPlayerId !== playerId) {
        scheduleDisconnectAutoAction({ roomId, playerId, delayMs: DISCONNECT_AUTO_RECHECK_DELAY_MS });
        return;
      }

      const roundIndex = getRoundIndex(gameState);
      const round = gameState.rounds?.[roundIndex];

      if (!round) {
        scheduleDisconnectAutoAction({ roomId, playerId, delayMs: DISCONNECT_AUTO_RECHECK_DELAY_MS });
        return;
      }

      const bidInfo = calculateValidBids({
        cardCount: round.cardCount ?? 0,
        playerOrder: gameState.playerOrder ?? [],
        playerId,
        bids: round.bids ?? {},
        isBlindRound: Boolean(round.isBlindRound),
      });

      handleBiddingTimeout({
        gameId: gameState.gameId,
        roomId,
        playerId,
        validBids: bidInfo.validBids,
      });
      return;
    }

    if (gameState.currentPhase === 'playing') {
      const expectedPlayerId = getLeadPlayer(gameState);
      if (expectedPlayerId !== playerId) {
        scheduleDisconnectAutoAction({ roomId, playerId, delayMs: DISCONNECT_AUTO_RECHECK_DELAY_MS });
        return;
      }

      handlePlayTimeout({
        gameId: gameState.gameId,
        roomId,
        playerId,
      });
      return;
    }

    scheduleDisconnectAutoAction({ roomId, playerId, delayMs: DISCONNECT_AUTO_RECHECK_DELAY_MS });
  };

  const scheduleDisconnectAutoAction = ({ roomId, playerId, delayMs = DISCONNECT_AUTO_ACTION_DELAY_MS }) => {
    if (!roomId || !playerId) {
      return;
    }

    const playerRecord = roomManager.getPlayer(playerId);
    if (!playerRecord || playerRecord.connectionStatus === 'connected' || playerRecord.isSpectator) {
      cancelDisconnectAutoAction(playerId);
      return;
    }

    const session = typeof roomManager.getSessionForPlayer === 'function'
      ? roomManager.getSessionForPlayer(playerId)
      : null;

    const now = Date.now();
    let normalizedDelay = delayMs;

    if (session?.expiresAt) {
      const remaining = session.expiresAt - now;
      if (remaining <= 0) {
        cancelDisconnectAutoAction(playerId);
        return;
      }
      normalizedDelay = Math.min(normalizedDelay, remaining);
    }

    normalizedDelay = Math.max(MIN_DISCONNECT_DELAY_MS, normalizedDelay);

    cancelDisconnectAutoAction(playerId);

    const timer = setTimeout(() => {
      disconnectAutoControllers.delete(playerId);
      processDisconnectAutoAction({ roomId, playerId });
    }, normalizedDelay);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    disconnectAutoControllers.set(playerId, {
      timer,
      playerId,
      roomId,
      scheduledAt: now,
      delayMs: normalizedDelay,
    });
  };

  const broadcastExpiredSessions = (expired) => {
    if (!Array.isArray(expired) || expired.length === 0) {
      return;
    }

    expired.forEach((entry) => {
      const roomId = entry?.room?.roomId ?? entry?.roomId;
      const playerSnapshot = entry?.player ?? null;
      const playerId = playerSnapshot?.playerId ?? entry?.playerId;

      if (!roomId || !playerId) {
        return;
      }

      cancelDisconnectAutoAction(playerId);
      pendingActions.delete(playerId);

      const payloadPlayer =
        playerSnapshot ??
        {
          playerId,
          isSpectator: Boolean(entry?.player?.isSpectator ?? entry?.isSpectator),
        };

      broadcastPlayerLeft(io.to(roomId), payloadPlayer, 'disconnected');
    });
  };

  if (!sessionSweepInterval && typeof setInterval === 'function') {
    sessionSweepInterval = setInterval(() => {
      const expired = roomManager.cleanupExpiredSessions();
      if (Array.isArray(expired) && expired.length > 0) {
        broadcastExpiredSessions(expired);
      }
      prunePendingActions();
    }, SESSION_SWEEP_INTERVAL_MS);

    if (sessionSweepInterval && typeof sessionSweepInterval.unref === 'function') {
      sessionSweepInterval.unref();
    }
  }

  const sendSpectatorStateSync = ({ socket, room, player }) => {
    if (!socket || !player?.isSpectator) {
      return false;
    }

    const gameId = room?.gameState?.gameId;
    if (!gameId) {
      return false;
    }

    const snapshot = stateManager.getGame(gameId);
    if (!snapshot) {
      return false;
    }

    socket.emit('game_state_update', {
      gameState: snapshot,
      yourPlayerId: player.playerId,
      lastUpdateTime: Date.now(),
    });

    return true;
  };

  const getActivePlayers = (room) => {
    if (!room) {
      return [];
    }

    const playerIds = Array.isArray(room.players) ? room.players : [];
    return playerIds
      .map((playerId) => roomManager.getPlayer(playerId))
      .filter((player) => player && !player.isSpectator && player.connectionStatus === 'connected');
  };

  const maybeCompleteGameDueToPlayerCount = ({ room, reason = 'insufficient_players', loggerRef = logger }) => {
    if (!room?.gameState?.gameId) {
      return;
    }

    const activePlayers = getActivePlayers(room);
    if (activePlayers.length >= 2) {
      return;
    }

    const playerIds = Array.isArray(room.players) ? [...room.players] : [];
    const reconnectablePlayers = playerIds
      .map((playerId) => roomManager.getPlayer(playerId))
      .filter((player) => {
        if (!player || player.isSpectator) {
          return false;
        }

        if (player.connectionStatus === 'connected') {
          return true;
        }

        if (player.connectionStatus !== 'disconnected') {
          return false;
        }

        if (typeof roomManager.getSessionForPlayer !== 'function') {
          return false;
        }

        const session = roomManager.getSessionForPlayer(player.playerId);
        if (!session) {
          return false;
        }

        if (!session.expiresAt) {
          return true;
        }

        return session.expiresAt > Date.now();
      });

    if (reconnectablePlayers.length >= 2) {
      return;
    }

    const snapshot = stateManager.getGame(room.gameState.gameId);
    if (!snapshot) {
      return;
    }

    completeGame({
      room,
      gameState: snapshot,
      reason,
      loggerRef,
    });
  };

  const dealHands = ({ playerOrder, deck, cardCount }) => {
    const hands = new Map();
    let cursor = 0;

    playerOrder.forEach((playerId) => {
      const slice = deck.slice(cursor, cursor + cardCount);
      hands.set(
        playerId,
        slice.map((card) => serializeCard(card)),
      );
      cursor += cardCount;
    });

    return {
      hands,
      remainingDeck: deck.slice(cursor),
    };
  };

  const emitHandsToPlayers = ({ gameState, round, players }) => {
    const participants = Array.isArray(players) ? players : [];
    const displayNameCache = new Map();

    logger.debug('emitHandsToPlayers called', {
      participantCount: participants.length,
      isBlindRound: round?.isBlindRound,
      gameId: gameState?.gameId,
    });

    participants.forEach((entry) => {
      if (!entry) {
        return;
      }

      const snapshot = typeof entry.toJSON === 'function' ? entry.toJSON() : entry;
      if (!snapshot?.playerId) {
        return;
      }

      const derivedName = snapshot.displayName ?? entry.displayName ?? null;
      if (derivedName) {
        displayNameCache.set(snapshot.playerId, derivedName);
      }
    });

    const resolveDisplayName = (playerId) => {
      if (!playerId) {
        return null;
      }

      if (displayNameCache.has(playerId)) {
        return displayNameCache.get(playerId);
      }

      const playerRecord = roomManager.getPlayer(playerId);
      const name = playerRecord?.displayName ?? null;
      if (name) {
        displayNameCache.set(playerId, name);
      }
      return name;
    };

    participants.forEach((player) => {
      logger.debug('emitHandsToPlayers checking player', {
        playerId: player?.playerId,
        hasSocketId: !!player?.socketId,
        socketId: player?.socketId,
        connectionStatus: player?.connectionStatus,
      });

      if (!player?.socketId) {
        logger.warn('emitHandsToPlayers: player missing socketId', {
          playerId: player?.playerId,
          displayName: player?.displayName,
        });
        return;
      }

      const targetSocket = io.sockets?.sockets?.get(player.socketId);
      if (!targetSocket) {
        logger.warn('emitHandsToPlayers: socket not found', {
          playerId: player?.playerId,
          socketId: player?.socketId,
        });
        return;
      }

      const view = round.getHandViewForPlayer(player.playerId);
      // In blind rounds, send the player's own cards as hidden cards in hand
      const selfCards = view.self;
      const payload = {
        hand: selfCards.map((card) => serializeCard(card)),
      };

      if (round.isBlindRound) {
        const visibleCards = flattenVisibleCards(view, resolveDisplayName);
        logger.debug('emitHandsToPlayers blind round visible cards', {
          playerId: player.playerId,
          visibleCardsCount: visibleCards.length,
        });
        if (visibleCards.length > 0) {
          payload.visibleCards = visibleCards;
        }
      }

      logger.debug('emitHandsToPlayers emitting cards_dealt', {
        playerId: player.playerId,
        handSize: payload.hand?.length,
        hasVisibleCards: !!payload.visibleCards,
        visibleCardsCount: payload.visibleCards?.length || 0,
      });

      targetSocket.emit('cards_dealt', payload);
      
      logger.debug('emitHandsToPlayers cards_dealt emitted', {
        playerId: player.playerId,
      });
      targetSocket.data = targetSocket.data || {};
      targetSocket.data.gameId = gameState.gameId;
    });
  };

  const handleStartGame = async (socket, socketLogger) => {
    const playerId = socket.data?.playerId;
    const roomId = socket.data?.roomId;

    if (!playerId || !roomId) {
      socket.emit('action_error', {
        action: 'start_game',
        error: 'invalid_state',
        message: 'You must join a room before starting a game.',
      });
      return;
    }

    const room = roomManager.getRoom(roomId);

    if (!room) {
      socket.emit('action_error', {
        action: 'start_game',
        error: 'invalid_room',
        message: 'Room could not be found.',
      });
      return;
    }

    if (room.status === 'playing') {
      socket.emit('action_error', {
        action: 'start_game',
        error: 'game_in_progress',
        message: 'A game is already in progress.',
      });
      return;
    }

    const requestingPlayer = roomManager.getPlayer(playerId);
    if (!requestingPlayer?.isHost) {
      socket.emit('action_error', {
        action: 'start_game',
        error: 'not_host',
        message: 'Only the room host can start the game.',
      });
      return;
    }

    const activePlayers = getActivePlayers(room);

    if (activePlayers.length < 2) {
      socket.emit('action_error', {
        action: 'start_game',
        error: 'insufficient_players',
        message: 'At least two connected players are required to start the game.',
      });
      return;
    }

    const playerOrder = activePlayers.map((player) => player.playerId);
    const shuffledDeck = shuffleDeck(createDeck());
    const { viraCard, remainingDeck, manilhaRank } = drawVira(shuffledDeck);
    const annotatedDeck = applyViraToCards(remainingDeck, viraCard.rank);

    const cardCount = 1;
    const { hands, remainingDeck: leftover } = dealHands({
      playerOrder,
      deck: annotatedDeck,
      cardCount,
    });

    const gameState = new GameState({
      roomId: room.roomId,
      playerOrder,
    });

    gameState.metadata.deck = leftover.map((card) => serializeCard(card));
    gameState.metadata.viraCard = serializeCard(viraCard);

    const currentRound = gameState.startRound({
      cardCount,
      viraCard: serializeCard(viraCard),
      manilhaRank,
      hands,
    });

    activePlayers.forEach((player) => {
      const playerHand = hands.get(player.playerId) ?? [];
      player.update({
        hand: playerHand,
        currentBid: null,
        tricksWon: 0,
      });
      stateManager.upsertPlayer(player);
    });

    room.update({
      status: 'playing',
      lastActivity: new Date().toISOString(),
    });

    const savedSnapshot = stateManager.setGame(gameState.gameId, gameState);
    const currentRoundSnapshot = savedSnapshot?.rounds?.[savedSnapshot.currentRound - 1] ?? null;

    updateRoomSummary(room, savedSnapshot, currentRoundSnapshot);

    io.to(room.roomId).emit('game_started', {
      gameId: gameState.gameId,
      playerOrder,
      hostSettings: room.hostSettings,
    });

    io.to(room.roomId).emit('round_started', {
      roundNumber: currentRound.roundNumber,
      cardCount: currentRound.cardCount,
      viraCard: serializeCard(viraCard),
      isBlindRound: currentRound.isBlindRound,
    });

    emitHandsToPlayers({ gameState, round: currentRound, players: activePlayers });

  clearTrickTimer(gameState.gameId);
    scheduleBiddingTurn({ room, gameState: savedSnapshot });
    scheduleGameTimer({ room, gameState: savedSnapshot });

    socketLogger.info('socket.start_game', {
      roomId: room.roomId,
      gameId: gameState.gameId,
      playerCount: playerOrder.length,
    });
  };

  const handleChatMessage = async (socket, payload, socketLogger, ack) => {
    const playerId = socket.data?.playerId;
    const roomId = socket.data?.roomId;

    if (!playerId || !roomId) {
      socket.emit('action_error', {
        action: 'chat_message',
        error: 'invalid_state',
        message: 'You must join a room before chatting.',
      });
      ack?.({ error: 'invalid_state' });
      return;
    }

    const message = sanitizeChatText(payload?.message ?? '');
    if (!message) {
      socket.emit('action_error', {
        action: 'chat_message',
        error: 'invalid_message',
        message: 'Chat message must be between 1 and 200 characters.',
      });
      ack?.({ error: 'invalid_message' });
      return;
    }

    const room = roomManager.getRoom(roomId);
    const player = roomManager.getPlayer(playerId);

    if (!room || !player) {
      socket.emit('action_error', {
        action: 'chat_message',
        error: 'invalid_state',
        message: 'Room session is no longer active.',
      });
      ack?.({ error: 'invalid_state' });
      return;
    }

    if (player.isSpectator && room.hostSettings?.allowSpectatorChat === false) {
      socket.emit('action_error', {
        action: 'chat_message',
        error: 'spectator_chat_disabled',
        message: 'Spectator chat is disabled by the host.',
      });
      ack?.({ error: 'spectator_chat_disabled' });
      return;
    }

    const now = Date.now();
    const lastMessageAt = chatThrottle.get(playerId) ?? 0;
    if (now - lastMessageAt < CHAT_THROTTLE_MS) {
      socket.emit('action_error', {
        action: 'chat_message',
        error: 'rate_limited',
        message: 'You are sending messages too quickly. Please slow down.',
      });
      ack?.({ error: 'rate_limited' });
      return;
    }

    chatThrottle.set(playerId, now);

    const type = player.isSpectator ? 'spectator' : 'player';
    const payloadSent = appendAndBroadcastChat({
      room,
      player,
      message,
      type,
      io,
      stateManager,
    });

    if (!payloadSent) {
      socket.emit('action_error', {
        action: 'chat_message',
        error: 'delivery_failure',
        message: 'Unable to deliver chat message.',
      });
      ack?.({ error: 'delivery_failure' });
      return;
    }

    socketLogger?.debug?.('socket.chat_message', {
      roomId,
      playerId,
      type,
    });

    ack?.({ status: 'ok', message: payloadSent });
  };

  const handleHostSettingsUpdate = async (socket, payload, socketLogger, ack) => {
    const playerId = socket.data?.playerId;
    const roomId = socket.data?.roomId;

    if (!playerId || !roomId) {
      socket.emit('action_error', {
        action: 'update_host_settings',
        error: 'invalid_state',
        message: 'You must join a room before updating settings.',
      });
      ack?.({ error: 'invalid_state' });
      return;
    }

    const room = roomManager.getRoom(roomId);
    const player = roomManager.getPlayer(playerId);

    if (!room || !player) {
      socket.emit('action_error', {
        action: 'update_host_settings',
        error: 'invalid_state',
        message: 'Room session is no longer active.',
      });
      ack?.({ error: 'invalid_state' });
      return;
    }

    if (!player.isHost) {
      socket.emit('action_error', {
        action: 'update_host_settings',
        error: 'not_host',
        message: 'Only the host can update room settings.',
      });
      ack?.({ error: 'not_host' });
      return;
    }

    if (room.status === 'playing') {
      socket.emit('action_error', {
        action: 'update_host_settings',
        error: 'game_in_progress',
        message: 'Settings can only be changed between games.',
      });
      ack?.({ error: 'game_in_progress' });
      return;
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'allowSpectatorChat')) {
      updates.allowSpectatorChat = Boolean(payload.allowSpectatorChat);
    }

    if (!Object.keys(updates).length) {
      ack?.({ status: 'noop' });
      return;
    }

    const previousSettings = room.hostSettings ? { ...room.hostSettings } : {};

    room.update({ hostSettings: updates });
    stateManager.upsertRoom(room);

    emitHostSettingsUpdate(io, room);

    if (
      Object.prototype.hasOwnProperty.call(updates, 'allowSpectatorChat') &&
      updates.allowSpectatorChat !== previousSettings.allowSpectatorChat
    ) {
      emitSystemChat({
        room,
        message: updates.allowSpectatorChat
          ? 'Spectator chat enabled by the host.'
          : 'Spectator chat disabled by the host.',
        io,
        stateManager,
      });
    }

    socketLogger?.info?.('socket.update_host_settings', {
      roomId,
      playerId,
      updates,
    });

    ack?.({ status: 'ok', hostSettings: { ...room.hostSettings } });
  };

  const validateJoinPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        error: {
          error: 'invalid_name',
          message: 'Join payload is required',
        },
      };
    }

    const normalizedRoomId = typeof payload.roomId === 'string' ? payload.roomId.trim() : '';
    const normalizedName = normalizeDisplayName(payload.displayName);

    if (!ROOM_IDS.has(normalizedRoomId)) {
      return {
        valid: false,
        error: {
          error: 'invalid_room',
          message: 'Selected room is not available',
        },
      };
    }

    if (!DISPLAY_NAME_REGEX.test(normalizedName)) {
      return {
        valid: false,
        error: {
          error: 'invalid_name',
          message: 'Display name must be 3-20 characters (letters, numbers, spaces)',
        },
      };
    }

    const requestedRole = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : null;
    const wantsSpectator =
      payload?.spectator === true ||
      payload?.joinAs === 'spectator' ||
      requestedRole === 'spectator';

    return {
      valid: true,
      roomId: normalizedRoomId,
      displayName: normalizedName,
      isSpectator: wantsSpectator,
    };
  };

  const handleJoinRoom = async (socket, payload, socketLogger) => {
    const validation = validateJoinPayload(payload);

    if (!validation.valid) {
      socket.emit('join_error', validation.error);
      return;
    }

    if (socket.data?.roomId && socket.data.roomId !== validation.roomId) {
      await handleLeaveRoom(socket, 'voluntary', socketLogger);
    }

    if (socket.data?.roomId === validation.roomId) {
      socket.emit('join_error', {
        error: 'invalid_room',
        message: 'You are already in this room',
      });
      return;
    }

    try {
      const { room, player, sessionId } = roomManager.joinRoom({
        roomId: validation.roomId,
        displayName: validation.displayName,
        socketId: socket.id,
        isSpectator: Boolean(validation.isSpectator),
      });

      socket.data = socket.data || {};
      socket.data.sessionId = sessionId;
      socket.data.playerId = player.playerId;
      socket.data.roomId = room.roomId;
      socket.data.isSpectator = Boolean(player.isSpectator);

      await socket.join(room.roomId);

      socketLogger.info('socket.join_room_success', {
        roomId: room.roomId,
        playerId: player.playerId,
      });

      const freshRoom = roomManager.getRoom(room.roomId) ?? room;
      const payloadToSend = buildRoomJoinedPayload(freshRoom, player, sessionId, roomManager);

      socket.emit('room_joined', payloadToSend);
      broadcastPlayerJoined(socket, room.roomId, player);

      if (payloadToSend.isSpectator) {
        sendSpectatorStateSync({ socket, room: freshRoom, player });
      }

      broadcastExpiredSessions(roomManager.cleanupExpiredSessions());
    } catch (error) {
      const mapped = mapJoinError(error);
      socketLogger.warn('socket.join_room_failed', {
        roomId: validation.roomId,
        message: error.message,
        code: error.code,
      });
      socket.emit('join_error', mapped);
    }
  };

  const handleSubmitBid = async (socket, payload, socketLogger) => {
    const playerId = socket.data?.playerId;
    const roomId = socket.data?.roomId;
    const bidInput = payload?.bid;

    if (!playerId || !roomId) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'invalid_state',
        message: 'You must join a room before submitting a bid.',
      });
      return;
    }

    if (!Number.isFinite(Number(bidInput))) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'invalid_bid',
        message: 'Bid value must be a number.',
      });
      return;
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'invalid_room',
        message: 'Room no longer exists.',
      });
      return;
    }

    const gameId = socket.data?.gameId ?? room?.gameState?.gameId;
    if (!gameId) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'game_not_active',
        message: 'No active game found for this room.',
      });
      return;
    }

    const storedGame = stateManager.getGame(gameId);
    if (!storedGame) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'game_not_active',
        message: 'Game state unavailable.',
      });
      return;
    }

    if (storedGame.currentPhase !== 'bidding') {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'invalid_phase',
        message: 'Bids can only be submitted during the bidding phase.',
      });
      return;
    }

    const roundIndex = Math.max(0, (storedGame.currentRound ?? 1) - 1);
    const round = storedGame.rounds?.[roundIndex];

    if (!round) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'invalid_round',
        message: 'Unable to locate the current round.',
      });
      return;
    }

    if (round.bids && Object.prototype.hasOwnProperty.call(round.bids, playerId)) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'already_bid',
        message: 'Bid already submitted for this round.',
      });
      return;
    }

    const currentPlayerId = Array.isArray(storedGame.playerOrder)
      ? storedGame.playerOrder[storedGame.currentPlayerIndex ?? 0]
      : null;

    if (currentPlayerId !== playerId) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: 'invalid_turn',
        message: 'It is not your turn to bid.',
        currentPlayer: currentPlayerId,
      });
      return;
    }

    const outcome = validateBid({
      cardCount: round.cardCount ?? 0,
      bid: Number(bidInput),
      playerId,
      playerOrder: storedGame.playerOrder ?? [],
      bids: round.bids ?? {},
      isBlindRound: Boolean(round.isBlindRound),
    });

    if (!outcome.isValid) {
      socket.emit('action_error', {
        action: 'submit_bid',
        error: outcome.code ?? 'invalid_bid',
        message: outcome.reason ?? 'Bid is not valid for this turn.',
        details: outcome.details ?? null,
      });
      return;
    }

    const normalizedBid = Math.trunc(Number(bidInput));
    const mutableState = cloneDeep(storedGame);

    const updatedSnapshot = processBidSubmission({
      room,
      gameState: mutableState,
      playerId,
      bid: normalizedBid,
      loggerRef: socketLogger,
    });

    recordCompletedAction({
      playerId,
      action: 'submit_bid',
      payload: { bid: normalizedBid },
      metadata: {
        roomId,
        gameId,
        roundNumber: (updatedSnapshot ?? storedGame)?.currentRound ?? null,
        phase: 'bidding',
        auto: false,
      },
    });

    socketLogger.info('socket.submit_bid', {
      roomId,
      gameId,
      playerId,
      bid: normalizedBid,
    });
  };

  const handleLeaveRoom = async (socket, reason, socketLogger) => {
    if (!socket.data?.sessionId) {
      socket.emit('room_left', null);
      return;
    }

    try {
      const result = roomManager.leaveRoom({
        sessionId: socket.data.sessionId,
        reason,
      });

      if (result?.room?.roomId && result?.player?.playerId) {
        await socket.leave(result.room.roomId);
        chatThrottle.delete(result.player.playerId);
        broadcastPlayerLeft(
          socket.to(result.room.roomId),
          result.player,
          reason === 'voluntary' ? 'voluntary' : 'disconnected',
        );
        socketLogger.info('socket.leave_room', {
          roomId: result.room.roomId,
          playerId: result.player.playerId,
          reason,
        });

        const activeRoom = roomManager.getRoom(result.room.roomId);
        if (activeRoom) {
          maybeCompleteGameDueToPlayerCount({
            room: activeRoom,
            reason: reason === 'voluntary' ? 'player_left' : 'disconnected',
            loggerRef: socketLogger,
          });
        }
      }
    } catch (error) {
      socketLogger.warn('socket.leave_room_failed', {
        message: error.message,
        code: error.code,
      });
    } finally {
      const leavingPlayerId = socket.data?.playerId;
      socket.emit('room_left', null);
      socket.data.sessionId = null;
      socket.data.playerId = null;
      socket.data.roomId = null;
      if (leavingPlayerId) {
        chatThrottle.delete(leavingPlayerId);
        pendingActions.delete(leavingPlayerId);
        cancelDisconnectAutoAction(leavingPlayerId);
      }
      broadcastExpiredSessions(roomManager.cleanupExpiredSessions());
    }
  };

  const handleDisconnect = async (socket, reason, socketLogger) => {
    if (!socket.data?.sessionId) {
      return;
    }

    try {
      const result = roomManager.handleDisconnect({
        sessionId: socket.data.sessionId,
        reason,
      });

      if (result?.room?.roomId && result?.player?.playerId) {
        broadcastPlayerLeft(socket.to(result.room.roomId), result.player, 'disconnected');
        chatThrottle.delete(result.player.playerId);
        socketLogger.info('socket.player_disconnected', {
          roomId: result.room.roomId,
          playerId: result.player.playerId,
          reason,
          expiresAt: result.expiresAt,
        });

        scheduleDisconnectAutoAction({
          roomId: result.room.roomId,
          playerId: result.player.playerId,
        });

        const activeRoom = roomManager.getRoom(result.room.roomId);
        if (activeRoom) {
          maybeCompleteGameDueToPlayerCount({
            room: activeRoom,
            reason: 'disconnected',
            loggerRef: socketLogger,
          });
        }
      }
    } catch (error) {
      socketLogger.warn('socket.disconnect_without_session', {
        message: error.message,
        code: error.code,
      });
    } finally {
      const disconnectedPlayerId = socket.data?.playerId;
      broadcastExpiredSessions(roomManager.cleanupExpiredSessions());
      if (disconnectedPlayerId) {
        chatThrottle.delete(disconnectedPlayerId);
      }
      // Clean up security trackers
      handleSecurityDisconnect(socket.id, disconnectedPlayerId);
    }
  };

  const handleReconnect = async (socket, sessionId, socketLogger) => {
    try {
      const { room, player, sessionId: resolvedSessionId } = roomManager.handleReconnect({
        sessionId,
        socketId: socket.id,
      });

      cancelDisconnectAutoAction(player.playerId);

      socket.data = socket.data || {};
      socket.data.sessionId = resolvedSessionId;
      socket.data.playerId = player.playerId;
      socket.data.roomId = room.roomId;
  socket.data.isSpectator = Boolean(player.isSpectator);

      await socket.join(room.roomId);

      socket.emit('connection_status', { status: 'reconnected' });

      const freshRoom = roomManager.getRoom(room.roomId) ?? room;
      const payloadToSend = buildRoomJoinedPayload(freshRoom, player, resolvedSessionId, roomManager);

      socket.emit('room_joined', payloadToSend);
      broadcastPlayerJoined(socket, room.roomId, player);

      if (payloadToSend.isSpectator) {
        sendSpectatorStateSync({ socket, room: freshRoom, player });
      } else {
        sendPlayerStateSync({ socket, room: freshRoom, player });
        replayCachedActionsForPlayer(socket, player.playerId);
      }

      socketLogger.info('socket.reconnected', {
        roomId: room.roomId,
        playerId: player.playerId,
      });

      broadcastExpiredSessions(roomManager.cleanupExpiredSessions());
      return true;
    } catch (error) {
      socketLogger.warn('socket.reconnect_failed', {
        message: error.message,
        code: error.code,
      });
      return false;
    }
  };

  const connectionHandler = async (socket) => {
    const socketLogger = typeof logger.child === 'function' ? logger.child({ socketId: socket.id }) : logger;

    socketLogger.info('socket.connected', {
      handshakeTime: socket.handshake?.issued,
      transport: socket.conn?.transport?.name,
    });

    socket.data = socket.data || {};

    broadcastExpiredSessions(roomManager.cleanupExpiredSessions());

    const handshakeSessionId = socket.handshake?.auth?.sessionId;
    let statusSent = false;

    if (handshakeSessionId) {
      const reconnected = await handleReconnect(socket, handshakeSessionId, socketLogger);
      statusSent = reconnected;
    }

    if (!statusSent) {
      socket.emit('connection_status', { status: 'connected' });
    }

    socket.on('join_room', async (payload) => {
      try {
        await handleJoinRoom(socket, payload, socketLogger);
      } catch (error) {
        socketLogger.error('socket.join_room_unexpected_error', {
          message: error.message,
        });
        socket.emit('join_error', {
          error: 'invalid_room',
          message: 'Unexpected error joining room',
        });
      }
    });

    socket.on('leave_room', async () => {
      await handleLeaveRoom(socket, 'voluntary', socketLogger);
    });

    socket.on('start_game', async () => {
      try {
        await handleStartGame(socket, socketLogger);
      } catch (error) {
        socketLogger.error('socket.start_game_unexpected_error', {
          message: error.message,
        });
        socket.emit('action_error', {
          action: 'start_game',
          error: 'internal_error',
          message: 'Unable to start game due to an unexpected error.',
        });
      }
    });

    socket.on('submit_bid', async (payload) => {
      try {
        await handleSubmitBid(socket, payload, socketLogger);
      } catch (error) {
        socketLogger.error('socket.submit_bid_unexpected_error', {
          message: error.message,
        });
        socket.emit('action_error', {
          action: 'submit_bid',
          error: 'internal_error',
          message: 'Unable to submit bid due to an unexpected error.',
        });
      }
    });

    socket.on('play_card', async (payload) => {
      try {
        await handlePlayCard(socket, payload, socketLogger);
      } catch (error) {
        socketLogger.error('socket.play_card_unexpected_error', {
          message: error.message,
        });
        socket.emit('action_error', {
          action: 'play_card',
          error: 'internal_error',
          message: 'Unable to play card due to an unexpected error.',
        });
      }
    });

    socket.on('chat_message', async (payload, ack) => {
      try {
        await handleChatMessage(socket, payload ?? {}, socketLogger, ack);
      } catch (error) {
        socketLogger.error('socket.chat_message_unexpected_error', {
          message: error.message,
        });
        socket.emit('action_error', {
          action: 'chat_message',
          error: 'internal_error',
          message: 'Unable to send chat message due to an unexpected error.',
        });
        ack?.({ error: 'internal_error' });
      }
    });

    socket.on('update_host_settings', async (payload, ack) => {
      try {
        await handleHostSettingsUpdate(socket, payload ?? {}, socketLogger, ack);
      } catch (error) {
        socketLogger.error('socket.update_host_settings_unexpected_error', {
          message: error.message,
        });
        socket.emit('action_error', {
          action: 'update_host_settings',
          error: 'internal_error',
          message: 'Unable to update host settings due to an unexpected error.',
        });
        ack?.({ error: 'internal_error' });
      }
    });

    socket.on('disconnect', async (reason) => {
      await handleDisconnect(socket, reason, socketLogger);
    });

    socket.on('error', (error) => {
      socketLogger.error('socket.error', {
        message: error.message,
      });
    });
  };

  connectionHandler.__testHooks = {
    completeGame: (params) => completeGame(params),
    finalizeRound: (params) => finalizeRound(params),
    scheduleGameTimer: (params) => scheduleGameTimer(params),
    clearGameTimer: (gameId) => clearGameTimer(gameId),
    emitGameTimerUpdate: (params) => emitGameTimerUpdate(params),
    sendSpectatorStateSync: (params) => sendSpectatorStateSync(params),
    clearBiddingTimer: (gameId) => clearBiddingTimer(gameId),
    clearPlayingTimer: (gameId) => clearPlayingTimer(gameId),
    cancelDisconnectAutoAction: (playerId) => cancelDisconnectAutoAction(playerId),
    scheduleDisconnectAutoAction: (params) => scheduleDisconnectAutoAction(params),
    processDisconnectAutoAction: (params) => processDisconnectAutoAction(params),
    getDisconnectController: (playerId) => disconnectAutoControllers.get(playerId) ?? null,
    stopSessionSweep: () => {
      if (sessionSweepInterval) {
        clearInterval(sessionSweepInterval);
        sessionSweepInterval = null;
      }
      disconnectAutoControllers.forEach((controller) => {
        if (controller?.timer) {
          clearTimeout(controller.timer);
        }
      });
      disconnectAutoControllers.clear();
      pendingActions.clear();
    },
  };

  return connectionHandler;
};

const registerRoomHandlers = (io, options = {}) => {
  const handler = createRoomSocketHandlers({ io, ...options });
  io.on('connection', handler);
  return handler;
};

module.exports = {
  createRoomSocketHandlers,
  registerRoomHandlers,
};
