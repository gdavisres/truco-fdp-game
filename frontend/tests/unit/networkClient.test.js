import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createNetworkClient } from '../../src/modules/networkClient/index.js';

const createMockSocket = () => {
  const listeners = new Map();
  const ioListeners = new Map();

  const socket = {
    id: 'socket-123',
    connected: false,
    recovered: false,
    __listeners: listeners,
    connect: vi.fn(() => {
      socket.connected = true;
      const handler = listeners.get('connect');
      if (handler) {
        handler();
      }
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      const handler = listeners.get('disconnect');
      if (handler) {
        handler('io client disconnect');
      }
    }),
    emit: vi.fn(),
    on: vi.fn((event, handler) => {
      listeners.set(event, handler);
      return socket;
    }),
    removeAllListeners: vi.fn(() => {
      listeners.clear();
    }),
    io: {
      on: vi.fn((event, handler) => {
        ioListeners.set(event, handler);
      }),
      off: vi.fn((event) => {
        ioListeners.delete(event);
      }),
      __listeners: ioListeners,
    },
  };

  return socket;
};

describe('networkClient', () => {
  let storage;
  let mockSocket;
  let ioFactory;

  beforeEach(() => {
    storage = {
      getItem: vi.fn().mockReturnValue('stored-session'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    mockSocket = createMockSocket();
    ioFactory = vi.fn(() => mockSocket);
  });

  it('connects using stored session identifier', () => {
    const statusSpy = vi.fn();

    const client = createNetworkClient({
      url: 'ws://example.test',
      ioFactory,
      storage,
      onStatusChange: statusSpy,
    });

    client.connect();

    expect(ioFactory).toHaveBeenCalledWith('ws://example.test', expect.objectContaining({
      auth: { sessionId: 'stored-session' },
      transports: expect.any(Array),
    }));

    expect(mockSocket.connect).toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith('connecting', expect.objectContaining({ status: 'connecting' }));
  });

  it('resolves joinRoom when server confirms and persists session', async () => {
    storage.getItem.mockReturnValueOnce(null);

    const client = createNetworkClient({
      ioFactory,
      storage,
    });

    client.connect();

    const joinPromise = client.joinRoom({ roomId: ' mesa ', displayName: ' Ada ' });

    expect(mockSocket.emit).toHaveBeenCalledWith('join_room', { roomId: ' mesa '.trim(), displayName: ' Ada '.trim() });

    const payload = {
      roomId: 'mesa',
      sessionId: 'new-session',
      hostId: 'host-1',
      currentPlayers: [],
      maxPlayers: 4,
    };

    mockSocket.__listeners.get('room_joined')(payload);

    const details = await joinPromise;

    const expectedPayload = {
      ...payload,
      chatMessages: [],
    };

    expect(details).toEqual(expectedPayload);
    expect(storage.setItem).toHaveBeenCalledWith(expect.any(String), 'new-session');
    expect(client.getState().currentRoom).toEqual(expectedPayload);
  });

  it('rejects joinRoom when join_error event received', async () => {
    const client = createNetworkClient({ ioFactory, storage });

    client.connect();

    const errorPromise = client.joinRoom({ roomId: 'fails', displayName: 'Bob' }).catch((error) => error);

    const payload = { message: 'Room full', error: 'ROOM_FULL' };
    mockSocket.__listeners.get('join_error')(payload);

    const error = await errorPromise;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Room full');
    expect(error.code).toBe('ROOM_FULL');
  });

  it('leaveRoom resolves when room_left event triggers', async () => {
    const client = createNetworkClient({ ioFactory, storage });

    client.connect();

    const leavePromise = client.leaveRoom('manual');

    expect(mockSocket.emit).toHaveBeenCalledWith('leave_room', { reason: 'manual' });

    mockSocket.__listeners.get('room_left')({ roomId: 'mesa' });

    const payload = await leavePromise;
    expect(payload).toEqual({ roomId: 'mesa' });
  });

  it('re-emits recovery events through the event bus', () => {
    const client = createNetworkClient({ ioFactory, storage });
    const actionSyncHandler = vi.fn();
    const stateUpdateHandler = vi.fn();

    client.on('action_sync', actionSyncHandler);
    client.on('game_state_update', stateUpdateHandler);

    client.connect();

    const actionPayload = { action: 'submit_bid', payload: { bid: 1 } };
    mockSocket.__listeners.get('action_sync')(actionPayload);
    expect(actionSyncHandler).toHaveBeenCalledWith(actionPayload);

    const statePayload = { gameState: { currentPhase: 'playing' } };
    mockSocket.__listeners.get('game_state_update')(statePayload);
    expect(stateUpdateHandler).toHaveBeenCalledWith(statePayload);
  });

  it('destroy cleans listeners and disconnects socket', () => {
    const logger = { warn: vi.fn() };
    const client = createNetworkClient({ ioFactory, storage, logger });

    client.connect();

    client.destroy();

    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
  });
});
