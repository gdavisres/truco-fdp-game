import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../../src/modules/gameUI/roomSelection.js';

const createContext = () => {
  const appRoot = document.createElement('div');
  appRoot.innerHTML = `
    <section data-testid="module-root"></section>
    <section data-testid="system-messages"></section>
  `;

  return {
    appRoot,
    socket: {
      emit: vi.fn(),
    },
    state: {},
    renderSystemMessage: vi.fn(),
    applyConnectionState: vi.fn(),
  };
};

describe('roomSelection module', () => {
  const mockRooms = [
    {
      roomId: 'itajuba',
      displayName: 'Itajubá',
      playerCount: 2,
      spectatorCount: 1,
      maxPlayers: 10,
      gameStatus: 'waiting',
      canJoin: true,
    },
    {
      roomId: 'piranguinho',
      displayName: 'Piranguinho',
      playerCount: 10,
      spectatorCount: 0,
      maxPlayers: 10,
      gameStatus: 'playing',
      canJoin: false,
    },
  ];

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRooms,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders room list and form controls', async () => {
    const context = createContext();
    document.body.appendChild(context.appRoot);

    await init(context);

    const list = context.appRoot.querySelector('[data-testid="room-list"]');
    const nameInput = context.appRoot.querySelector('input[name="displayName"]');

    expect(list.children.length).toBe(mockRooms.length);
    expect(nameInput).not.toBeNull();
  });

  it('validates player name and shows errors', async () => {
    const context = createContext();
    document.body.appendChild(context.appRoot);

    await init(context);

    const nameInput = context.appRoot.querySelector('input[name="displayName"]');
    const errorEl = context.appRoot.querySelector('[data-testid="name-error"]');
    const submitButton = context.appRoot.querySelector('[data-testid="join-button"]');

    nameInput.value = 'ab';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(errorEl.hidden).toBe(false);
    expect(submitButton.disabled).toBe(true);

    nameInput.value = 'Ana';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(errorEl.hidden).toBe(true);
  });

  it('requires room selection before enabling submit', async () => {
    const context = createContext();
    document.body.appendChild(context.appRoot);

    await init(context);

    const nameInput = context.appRoot.querySelector('input[name="displayName"]');
    const submitButton = context.appRoot.querySelector('[data-testid="join-button"]');
    const firstRoomButton = context.appRoot.querySelector('button[data-room-id]');

    nameInput.value = 'Carlos';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(submitButton.disabled).toBe(true);

    firstRoomButton.dispatchEvent(new Event('click', { bubbles: true }));

    expect(submitButton.disabled).toBe(false);
  });

  it('shows error message when rooms cannot be loaded', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const context = createContext();
    document.body.appendChild(context.appRoot);

    await init(context);

    const statusEl = context.appRoot.querySelector('[data-testid="room-status"]');
    expect(statusEl.textContent).toMatch(/Unable to load rooms/i);
    expect(context.renderSystemMessage).toHaveBeenCalled();
  });
});
