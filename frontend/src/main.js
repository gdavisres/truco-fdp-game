import './css/main.css';
import './css/cardRenderer.css';
import './css/errorNotification.css';
import { io } from 'socket.io-client';

import { bootstrapModules } from './modules/moduleRegistry.js';
import { createNetworkClient } from './modules/networkClient/index.js';
import { errorHandler } from './modules/errorHandler/index.js';
import './modules/gameState/index.js';
import './modules/gameUI/roomSelection.js';
import './modules/gameUI/gameSetup.js';
import './modules/gameUI/bidding.js';
import './modules/gameUI/gameBoard.js';
import './modules/gameUI/scoring.js';
import './modules/gameUI/gameOver.js';
import './modules/gameUI/chat.js';
import './modules/gameUI/reconnection.js';

// Prefer an explicit socket URL (VITE_SOCKET_URL). Fall back to VITE_API_URL if provided.
// Remove trailing slashes and return `undefined` when not set so the client won't
// accidentally connect to the page origin when the backend is hosted separately.
const _rawSocketUrl = import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_API_URL;
const DEFAULT_SOCKET_URL = _rawSocketUrl ? _rawSocketUrl.replace(/\/+$/, '') : undefined;

// DEBUG: print resolved socket origin so we can verify env injection in the built app
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.debug('[network] DEFAULT_SOCKET_URL ->', DEFAULT_SOCKET_URL);
}

const appRoot = document.getElementById('app');

if (!appRoot) {
  throw new Error('Root container #app not found');
}

const state = {
  connection: {
    status: 'idle',
    attempt: 0,
    reason: null,
    lastError: null,
  },
  sessionId: null,
  currentRoom: null,
};

const connectionMessages = {
  connecting: 'Connecting to game services…',
  connected: 'Connected — waiting for lobby updates…',
  reconnecting: (meta) => `Reconnecting… (attempt ${meta.attempt ?? 0})`,
  offline: 'Offline — retrying when network returns…',
  error: 'Connection error — retrying shortly.',
  disconnected: (meta) =>
    `Disconnected${meta.reason ? ` (${meta.reason})` : ''} — attempting to reconnect…`,
};

function ensureAppShell() {
  appRoot.innerHTML = `
    <main class="app-shell" role="application" aria-live="polite">
      <header class="app-shell__header">
        <h1 class="app-shell__title">Truco FDP</h1>
        <p class="app-shell__status" data-testid="app-status">${connectionMessages.connecting}</p>
        <span class="app-shell__indicator" data-testid="connection-indicator" data-state="connecting" aria-hidden="true"></span>
      </header>
      <section class="app-shell__content" data-testid="module-root" aria-label="Game modules"></section>
      <section aria-label="system messages" data-testid="system-messages"></section>
    </main>
  `;
}

function renderSystemMessage(title, body) {
  const messagesEl = appRoot.querySelector('[data-testid="system-messages"]');
  if (!messagesEl) {
    return;
  }

  const entry = document.createElement('article');
  entry.setAttribute('role', 'status');
  entry.style.margin = '0';
  entry.innerHTML = `
    <h2 style="font-size: 1rem; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.04em;">${title}</h2>
    <p style="margin: 0;">${body}</p>
  `;

  messagesEl.prepend(entry);

  while (messagesEl.childNodes.length > 4) {
    messagesEl.removeChild(messagesEl.lastChild);
  }
}

function applyConnectionState(status, metadata = {}) {
  state.connection = {
    status,
    attempt: metadata.attempt ?? state.connection.attempt,
    reason: metadata.reason ?? null,
    lastError: metadata.error ?? null,
  };

  const statusEl = appRoot.querySelector('[data-testid="app-status"]');
  const indicatorEl = appRoot.querySelector('[data-testid="connection-indicator"]');

  if (statusEl) {
    const descriptor = connectionMessages[status];
    statusEl.textContent =
      typeof descriptor === 'function' ? descriptor(metadata) : descriptor ?? status;
  }

  if (indicatorEl) {
    indicatorEl.dataset.state = status;
  }

  if (metadata.error) {
    renderSystemMessage('Connection issue', metadata.error);
  }
}

function reportClientError(event, source = 'global') {
  const description = event?.reason || event?.message || event?.toString?.() || 'Unknown error';

  renderSystemMessage(`${source} error`, description);
  applyConnectionState('error', { error: description });

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error(`[${source}]`, event);
  }
}

function registerErrorBoundaries(networkClient, gameState) {
  // Initialize global error handler
  errorHandler.initialize({
    networkClient,
    gameState
  });

  // Legacy error boundaries (keep for backwards compatibility)
  window.addEventListener('error', (event) => reportClientError(event, 'window'));
  window.addEventListener('unhandledrejection', (event) => reportClientError(event, 'promise'));
}

function enableTouchOptimizations() {
  let hasTouchInput = false;

  window.addEventListener(
    'touchstart',
    () => {
      if (!hasTouchInput) {
        document.body.classList.add('supports-touch');
        hasTouchInput = true;
      }
    },
    { passive: true },
  );

  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse') {
        document.body.classList.add('supports-pointer');
      }
    },
    { passive: true },
  );
}

function exposeDebugTools(networkClient) {
  if (import.meta.env.DEV) {
    window.trucoDebug = {
      getState: () => ({ ...state }),
      network: networkClient,
      socket: networkClient.getSocket?.(),
      forceReconnect: () => networkClient.connect(),
      goOffline: () => networkClient.disconnect(),
    };
  }
}

async function bootstrap() {
  ensureAppShell();
  enableTouchOptimizations();

  const networkClient = createNetworkClient({
    url: DEFAULT_SOCKET_URL,
    ioFactory: io,
    state,
    onStatusChange: (status, metadata) => applyConnectionState(status, metadata),
    onSystemMessage: (title, message) => renderSystemMessage(title, message),
    logger: console,
  });

  networkClient.on('status', ({ status: statusName, ...metadata }) => {
    if (statusName === 'offline') {
      renderSystemMessage('Offline', 'Waiting for your connection to return…');
    }
    if (statusName === 'error' && metadata.lastError) {
      renderSystemMessage('Connection error', metadata.lastError);
    }
  });

  networkClient.on('room_joined', (payload) => {
    state.currentRoom = payload;
    if (payload?.sessionId) {
      state.sessionId = payload.sessionId;
    }
    renderSystemMessage('Joined room', `You're now in ${payload?.displayName ?? payload?.roomId}.`);
  });

  networkClient.on('room_left', (payload) => {
    state.currentRoom = null;
    renderSystemMessage('Left room', payload?.reason ? `Reason: ${payload.reason}` : 'Returned to lobby.');
  });

  const socket = networkClient.connect();
  exposeDebugTools(networkClient);

  // Get gameState reference for error handler
  const gameState = (await import('./modules/gameState/index.js')).gameState;

  // Initialize error handler with context
  registerErrorBoundaries(networkClient, gameState);

  await bootstrapModules(
    {
      appRoot,
      state,
      socket,
      networkClient,
      renderSystemMessage,
      applyConnectionState,
    },
    (error, namespace) => reportClientError(error, namespace),
  );
}

bootstrap().catch((error) => reportClientError(error, 'bootstrap'));
