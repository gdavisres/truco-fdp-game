import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init as initChat } from '../../src/modules/gameUI/chat.js';
import { createGameStateStore } from '../../src/modules/gameState/index.js';

const createContext = () => {
  const appRoot = document.createElement('div');
  appRoot.innerHTML = `
    <section data-testid="module-root"></section>
    <section data-testid="system-messages"></section>
  `;

  const store = createGameStateStore();
  store.setState({
    playerId: 'player-1',
    isSpectator: false,
    isHost: false,
    chat: { messages: [] },
    hostSettings: { allowSpectatorChat: true },
  });

  const listeners = new Map();

  const networkClient = {
    emit: vi.fn((event, payload, ack) => {
      if (typeof ack === 'function') {
        ack({ status: 'ok', message: { ...payload, messageId: 'message-123', playerId: 'player-1' } });
      }
    }),
    on: vi.fn((event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    }),
    emitEvent: (event, payload) => {
      if (!listeners.has(event)) {
        return;
      }
      listeners.get(event).forEach((handler) => handler(payload));
    },
  };

  const context = {
    appRoot,
    gameState: store,
    networkClient,
    renderSystemMessage: vi.fn(),
  };

  return { context, store, networkClient };
};

const addChatMessage = (store, message) => {
  store.setState((prev) => ({
    chat: {
      ...prev.chat,
      messages: [...(prev.chat?.messages ?? []), message],
    },
  }));
};

describe('chat UI module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows unread indicator when collapsed and new message arrives', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    const module = await initChat(context);
    expect(module).toBeTruthy();

    const indicator = context.appRoot.querySelector('[data-testid="chat-indicator"]');
    expect(indicator.hidden).toBe(true);

    addChatMessage(store, {
      messageId: 'm-1',
      playerId: 'player-2',
      displayName: 'Rival',
      message: 'Olá!',
      timestamp: Date.now(),
    });

    expect(indicator.hidden).toBe(false);
    expect(indicator.textContent).toBe('1');

    const toggle = context.appRoot.querySelector('[data-testid="chat-toggle"]');
    toggle.click();

    expect(indicator.hidden).toBe(true);
    const messages = context.appRoot.querySelectorAll('.chat__message');
    expect(messages).toHaveLength(1);
    expect(messages[0].textContent).toMatch(/olá/i);

    module.destroy();
  });

  it('disables input and shows status when offline', async () => {
    const { context, store } = createContext();
    document.body.append(context.appRoot);

    const module = await initChat(context);
    store.setState({ offline: true });

    const input = context.appRoot.querySelector('[data-testid="chat-input"]');
    const status = context.appRoot.querySelector('[data-testid="chat-status"]');

    expect(input.disabled).toBe(true);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toMatch(/offline/i);

    module.destroy();
  });

  it('emits chat_message events and clears input on success', async () => {
    const { context, store, networkClient } = createContext();
    document.body.append(context.appRoot);

    await initChat(context);
    store.setState({ offline: false });

    const input = context.appRoot.querySelector('[data-testid="chat-input"]');
    const form = context.appRoot.querySelector('[data-testid="chat-form"]');

    input.value = 'Hello table';
    form.dispatchEvent(new Event('submit'));

    expect(networkClient.emit).toHaveBeenCalledWith(
      'chat_message',
      { message: 'Hello table' },
      expect.any(Function),
    );

    expect(input.value).toBe('');
  });

  it('shows status message when ack responds with error', async () => {
    const { context, networkClient } = createContext();
    document.body.append(context.appRoot);

    networkClient.emit.mockImplementationOnce((event, payload, ack) => {
      ack?.({ error: 'rate_limited' });
    });

    await initChat(context);

    const input = context.appRoot.querySelector('[data-testid="chat-input"]');
    const form = context.appRoot.querySelector('[data-testid="chat-form"]');

    input.value = 'Too fast';
    form.dispatchEvent(new Event('submit'));

    const status = context.appRoot.querySelector('[data-testid="chat-status"]');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toMatch(/too quickly/i);
    expect(context.renderSystemMessage).toHaveBeenCalledWith(
      'Chat message failed',
      expect.stringMatching(/too quickly/i),
    );
  });

  it('allows the host to toggle spectator chat permissions', async () => {
    const { context, store, networkClient } = createContext();
    store.setState({ isHost: true });
    document.body.append(context.appRoot);

    await initChat(context);

    const toggle = context.appRoot.querySelector('[data-testid="spectator-toggle"]');
    expect(toggle.hidden).toBe(false);
    expect(toggle.disabled).toBe(false);

    toggle.click();

    expect(networkClient.emit).toHaveBeenCalledWith(
      'update_host_settings',
      { allowSpectatorChat: false },
      expect.any(Function),
    );
  });
});
