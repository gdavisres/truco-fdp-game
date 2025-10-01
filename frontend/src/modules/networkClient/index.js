import { io } from 'socket.io-client';

const STORAGE_KEY = 'truco.sessionId';
const DEFAULT_SOCKET_OPTIONS = {
  transports: ['websocket', 'polling'],
  timeout: 10_000,
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 750,
  reconnectionDelayMax: 4_000,
  withCredentials: true,
  path: '/socket.io',
  query: {
    client: 'frontend',
  },
};

const CHAT_HISTORY_LIMIT = 100;

const createEventBus = () => {
  const listeners = new Map();

  const on = (event, handler) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }

    listeners.get(event).add(handler);
    return () => off(event, handler);
  };

  const off = (event, handler) => {
    const set = listeners.get(event);
    if (!set) {
      return;
    }

    set.delete(handler);

    if (!set.size) {
      listeners.delete(event);
    }
  };

  const once = (event, handler) => {
    const wrapper = (...args) => {
      off(event, wrapper);
      handler(...args);
    };

    on(event, wrapper);
    return () => off(event, wrapper);
  };

  const emit = (event, payload) => {
    const set = listeners.get(event);
    if (!set) {
      return;
    }

    for (const listener of set) {
      try {
        listener(payload);
      } catch (error) {
        setTimeout(() => {
          throw error;
        });
      }
    }
  };

  const clear = () => {
    listeners.clear();
  };

  return { on, off, once, emit, clear };
};

const readSessionId = (storage) => {
  try {
    return storage?.getItem?.(STORAGE_KEY) ?? null;
  } catch (error) {
    return null;
  }
};

const writeSessionId = (storage, value) => {
  try {
    if (!storage?.setItem) {
      return;
    }

    if (value) {
      storage.setItem(STORAGE_KEY, value);
    }
  } catch (error) {
    // ignore storage errors (e.g. private mode)
  }
};

const removeSessionId = (storage) => {
  try {
    storage?.removeItem?.(STORAGE_KEY);
  } catch (error) {
    // ignore
  }
};

export const createNetworkClient = ({
  url,
  ioFactory = io,
  storage = typeof window !== 'undefined' ? window.localStorage : undefined,
  onStatusChange,
  onSystemMessage,
  state,
  logger,
} = {}) => {
  const eventBus = createEventBus();
  const networkState = {
    connection: {
      status: 'idle',
      attempt: 0,
      reason: null,
      lastError: null,
    },
    currentRoom: null,
    sessionId: null,
  };

  let socket = null;
  let onlineHandler = null;
  let offlineHandler = null;
  let destroyed = false;

  const setConnectionState = (status, metadata = {}) => {
    if (destroyed) {
      return;
    }

    const nextState = {
      status,
      attempt: metadata.attempt ?? 0,
      reason: metadata.reason ?? null,
      lastError: metadata.error ?? null,
    };

    networkState.connection = nextState;

    if (state) {
      state.connection = nextState;
    }

    if (typeof onStatusChange === 'function') {
      onStatusChange(status, nextState);
    }

    eventBus.emit('status', { ...nextState });
  };

  const emitSystemMessage = (title, body) => {
    if (typeof onSystemMessage === 'function') {
      onSystemMessage(title, body);
    }
  };

  const updateSessionId = (value) => {
    networkState.sessionId = value;
    if (state) {
      state.sessionId = value;
    }

    if (value) {
      writeSessionId(storage, value);
    }
  };

  const ensureSessionLoaded = () => {
    if (!networkState.sessionId) {
      updateSessionId(readSessionId(storage));
    }
  };

  const cloneChatMessage = (entry) => {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    return { ...entry };
  };

  const normalizeChatMessages = (messages, limit = CHAT_HISTORY_LIMIT) => {
    if (!Array.isArray(messages)) {
      return [];
    }

    const slice = limit && Number.isInteger(limit) && limit > 0 ? messages.slice(-1 * limit) : [...messages];
    return slice.map((entry) => cloneChatMessage(entry)).filter(Boolean);
  };

  const updateCurrentRoom = (room) => {
    if (!room) {
      networkState.currentRoom = null;
      eventBus.emit('room_state', null);
      return;
    }

    const normalized = {
      ...room,
      chatMessages: normalizeChatMessages(room.chatMessages),
    };

    if (room.hostSettings && typeof room.hostSettings === 'object') {
      normalized.hostSettings = { ...room.hostSettings };
    }

    networkState.currentRoom = normalized;
    eventBus.emit('room_state', normalized);
  };

  const updatePlayers = (producer) => {
    if (!networkState.currentRoom) {
      return;
    }

    const existingPlayers = Array.isArray(networkState.currentRoom.currentPlayers)
      ? [...networkState.currentRoom.currentPlayers]
      : [];
    const nextPlayers = producer(existingPlayers);
    updateCurrentRoom({
      ...networkState.currentRoom,
      currentPlayers: nextPlayers,
    });
  };

  const appendChatMessageToRoom = (message) => {
    if (!networkState.currentRoom) {
      return;
    }

    const existing = Array.isArray(networkState.currentRoom.chatMessages)
      ? [...networkState.currentRoom.chatMessages]
      : [];

    existing.push(message);
    const normalized = normalizeChatMessages(existing);

    updateCurrentRoom({
      ...networkState.currentRoom,
      chatMessages: normalized,
    });
  };

  const mergeHostSettings = (partial) => {
    if (!networkState.currentRoom || !partial) {
      return;
    }

    const currentSettings =
      networkState.currentRoom.hostSettings && typeof networkState.currentRoom.hostSettings === 'object'
        ? networkState.currentRoom.hostSettings
        : {};

    updateCurrentRoom({
      ...networkState.currentRoom,
      hostSettings: { ...currentSettings, ...partial },
    });
  };

  const bindSocketEvents = () => {
    if (!socket) {
      return;
    }

    socket.on('connect', () => {
      setConnectionState('connected', { attempt: 0, reason: null, error: null });
      eventBus.emit('connected', { socketId: socket.id, recovered: socket.recovered ?? false });
    });

    socket.on('disconnect', (reason) => {
      setConnectionState('disconnected', { reason });
      eventBus.emit('disconnected', { reason });
    });

    socket.on('connect_error', (error) => {
      const message = error?.message ?? 'Connection error';
      setConnectionState('error', { error: message });
      emitSystemMessage('Connection issue', message);
      eventBus.emit('connect_error', error);
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setConnectionState('reconnecting', { attempt });
      eventBus.emit('reconnect_attempt', { attempt });
    });

    socket.io.on('reconnect_failed', () => {
      setConnectionState('offline', { reason: 'reconnect_failed' });
      emitSystemMessage('Connection lost', 'Unable to reconnect automatically. Waiting for network…');
      eventBus.emit('reconnect_failed');
    });

    socket.on('connection_status', (payload = {}) => {
      const status = payload.status ?? 'connected';
      setConnectionState(status, payload);
      eventBus.emit('connection_status', payload);
    });

    socket.on('room_joined', (payload) => {
      if (!payload) {
        return;
      }

      if (payload.sessionId) {
        updateSessionId(payload.sessionId);
      }

      const normalizedPayload = {
        ...payload,
        chatMessages: normalizeChatMessages(payload.chatMessages),
      };

      if (payload.hostSettings && typeof payload.hostSettings === 'object') {
        normalizedPayload.hostSettings = { ...payload.hostSettings };
      }

      updateCurrentRoom(normalizedPayload);
      eventBus.emit('room_joined', normalizedPayload);
    });

    socket.on('room_left', (payload) => {
      updateCurrentRoom(null);
      eventBus.emit('room_left', payload);
    });

    socket.on('join_error', (payload) => {
      emitSystemMessage('Join failed', payload?.message ?? 'Unable to join room.');
      eventBus.emit('join_error', payload);
    });

    socket.on('player_joined', (payload) => {
      if (!payload?.player) {
        return;
      }

      updatePlayers((players) => {
        const next = players.filter((entry) => entry.playerId !== payload.player.playerId);
        next.push(payload.player);
        return next;
      });

      eventBus.emit('player_joined', payload.player);
    });

    socket.on('player_left', (payload) => {
      updatePlayers((players) => players.filter((entry) => entry.playerId !== payload?.playerId));
      eventBus.emit('player_left', payload);
    });

    socket.on('chat_message_received', (payload) => {
      if (payload) {
        appendChatMessageToRoom(payload);
      }
      eventBus.emit('chat_message_received', payload);
    });

    socket.on('host_settings_updated', (payload) => {
      if (payload?.roomId && networkState.currentRoom?.roomId === payload.roomId) {
        mergeHostSettings(payload.hostSettings ?? {});
      }
      eventBus.emit('host_settings_updated', payload);
    });

    socket.on('turn_timer_update', (payload) => {
      eventBus.emit('turn_timer_update', payload);
    });

    socket.on('game_timer_update', (payload) => {
      eventBus.emit('game_timer_update', payload);
    });

    socket.on('game_state_update', (payload) => {
      eventBus.emit('game_state_update', payload);
    });

    socket.on('action_sync', (payload) => {
      eventBus.emit('action_sync', payload);
    });
  };

  const initConnectivityListeners = () => {
    if (typeof window === 'undefined') {
      return;
    }

    offlineHandler = () => {
      setConnectionState('offline', { reason: 'network_offline' });
      eventBus.emit('network_offline');
    };

    onlineHandler = () => {
      eventBus.emit('network_online');
      if (socket && !socket.connected) {
        setConnectionState('connecting', { attempt: 0, reason: null });
        socket.connect();
      } else {
        setConnectionState('connected', { attempt: 0, reason: null });
      }
    };

    window.addEventListener('offline', offlineHandler, { passive: true });
    window.addEventListener('online', onlineHandler, { passive: true });
  };

  const removeConnectivityListeners = () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (offlineHandler) {
      window.removeEventListener('offline', offlineHandler);
      offlineHandler = null;
    }

    if (onlineHandler) {
      window.removeEventListener('online', onlineHandler);
      onlineHandler = null;
    }
  };

  const connect = () => {
    if (destroyed) {
      throw new Error('Network client has been destroyed.');
    }

    ensureSessionLoaded();

    if (socket) {
      setConnectionState('connecting', { attempt: 0, reason: null });
      socket.connect();
      return socket;
    }

    const options = {
      ...DEFAULT_SOCKET_OPTIONS,
    };

    if (networkState.sessionId) {
      options.auth = { sessionId: networkState.sessionId };
    }

    if (url) {
      socket = ioFactory(url, options);
    } else {
      socket = ioFactory(undefined, options);
    }

    bindSocketEvents();
    initConnectivityListeners();

    setConnectionState('connecting', { attempt: 0, reason: null });
    socket.connect();
    return socket;
  };

  const disconnect = (clearSession = false) => {
    if (clearSession) {
      updateSessionId(null);
      removeSessionId(storage);
    }

    if (socket) {
      socket.disconnect();
    }
  };

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    removeConnectivityListeners();
    eventBus.clear();

    if (socket) {
      try {
        socket.removeAllListeners?.();
        socket.io?.off?.('reconnect_attempt');
        socket.io?.off?.('reconnect_failed');
      } catch (error) {
        logger?.warn?.('network.destroy_warning', { message: error.message });
      }

      socket.disconnect();
      socket = null;
    }
  };

  const emit = (event, payload, ack) => {
    if (!socket) {
      throw new Error('Socket connection not established. Call connect() first.');
    }

    socket.emit(event, payload, ack);
  };

  const joinRoom = ({ roomId, displayName }) => {
    if (!socket) {
      throw new Error('Socket connection not established. Call connect() first.');
    }

    const payload = {
      roomId: roomId?.trim?.() ?? roomId,
      displayName: displayName?.trim?.() ?? displayName,
    };

    return new Promise((resolve, reject) => {
      const disposeSuccess = eventBus.once('room_joined', (details) => {
        cleanup();
        resolve(details);
      });

      const disposeError = eventBus.once('join_error', (details) => {
        cleanup();
        const error = new Error(details?.message ?? 'Unable to join room');
        if (details?.error) {
          error.code = details.error;
        }
        reject(error);
      });

      const cleanup = () => {
        disposeSuccess();
        disposeError();
      };

      try {
        socket.emit('join_room', payload);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  };

  const leaveRoom = (reason = 'voluntary') => {
    if (!socket) {
      throw new Error('Socket connection not established. Call connect() first.');
    }

    return new Promise((resolve) => {
      const dispose = eventBus.once('room_left', (payload) => {
        dispose();
        resolve(payload);
      });

      socket.emit('leave_room', { reason });
    });
  };

  const getState = () => ({
    connection: { ...networkState.connection },
    currentRoom: networkState.currentRoom
      ? {
          ...networkState.currentRoom,
          chatMessages: Array.isArray(networkState.currentRoom.chatMessages)
            ? [...networkState.currentRoom.chatMessages]
            : [],
          hostSettings:
            networkState.currentRoom.hostSettings && typeof networkState.currentRoom.hostSettings === 'object'
              ? { ...networkState.currentRoom.hostSettings }
              : undefined,
        }
      : null,
    sessionId: networkState.sessionId,
  });

  const getSocket = () => socket;

  return {
    connect,
    disconnect,
    destroy,
    emit,
    joinRoom,
    leaveRoom,
    on: eventBus.on,
    off: eventBus.off,
    once: eventBus.once,
    getState,
    getSocket,
  };
};

export default createNetworkClient;
