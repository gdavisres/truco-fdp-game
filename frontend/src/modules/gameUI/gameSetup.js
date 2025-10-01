import '../../css/gameSetup.css';
import { registerModule } from '../moduleRegistry.js';

const MINIMUM_PLAYERS = 2;
const ROOM_DETAILS_ENDPOINT = (roomId) => `/api/rooms/${encodeURIComponent(roomId)}`;

const CONNECTION_LABELS = {
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

const formatPlural = (value, singular, plural) => {
  const count = Number.isFinite(value) ? value : 0;
  return `${count} ${count === 1 ? singular : plural}`;
};

const describeConnection = (status) => CONNECTION_LABELS[status] ?? 'Unknown';

const sortPlayers = (players = []) => {
  const copy = Array.from(players);
  copy.sort((a, b) => {
    if (a.isHost !== b.isHost) {
      return a.isHost ? -1 : 1;
    }
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  });
  return copy;
};

const createTemplate = () => {
  const section = document.createElement('section');
  section.className = 'game-setup';
  section.setAttribute('data-testid', 'game-setup');
  section.hidden = true;

  section.innerHTML = `
    <header class="game-setup__header">
      <h2 class="game-setup__title">Game lobby</h2>
      <span class="game-setup__badge" data-testid="player-count">0 players</span>
    </header>
    <p class="game-setup__status" data-testid="lobby-status">Join a room to set up the next game.</p>
    <ul class="game-setup__playerList" data-testid="player-list" role="list"></ul>
    <div class="game-setup__actions">
      <button class="game-setup__start" data-testid="start-game" type="button" disabled>Start game</button>
      <p class="game-setup__hint" data-testid="start-hint">Waiting for players…</p>
    </div>
    <section class="game-setup__settings">
      <h3 class="game-setup__settingsTitle">Host settings</h3>
      <dl class="game-setup__settingsGrid" data-testid="host-settings"></dl>
    </section>
  `;

  return section;
};

const createPlayerEntry = ({ player, isSelf }) => {
  const item = document.createElement('li');
  item.className = 'game-setup__player';
  item.setAttribute('data-testid', 'player-item');

  if (player.isHost) {
    item.dataset.role = isSelf ? 'self host' : 'host';
  } else if (isSelf) {
    item.dataset.role = 'self';
  }

  const name = document.createElement('span');
  name.className = 'game-setup__playerName';
  name.textContent = player.displayName ?? 'Unknown player';

  const meta = document.createElement('span');
  meta.className = 'game-setup__playerMeta';

  const status = document.createElement('span');
  status.className = 'game-setup__playerStatus';
  status.dataset.state = player.connectionStatus ?? 'connected';
  status.textContent = describeConnection(player.connectionStatus);

  meta.append(status);

  if (player.lives !== undefined && player.lives !== null) {
    const lives = document.createElement('span');
    lives.textContent = `${player.lives} lives`;
    meta.append(lives);
  }

  item.append(name, meta);
  return item;
};

const renderHostSettings = ({ hostSettings, container }) => {
  container.innerHTML = '';

  if (!hostSettings) {
    const placeholder = document.createElement('p');
    placeholder.textContent = 'Loading host preferences…';
    placeholder.style.margin = '0';
    placeholder.style.fontSize = '0.9rem';
    placeholder.style.color = 'rgba(148, 163, 184, 0.85)';
    container.append(placeholder);
    return;
  }

  const entries = [
    {
      label: 'Starting lives',
      value: hostSettings.startingLives ?? '—',
    },
    {
      label: 'Turn timer',
      value: hostSettings.turnTimer ? `${hostSettings.turnTimer}s per turn` : '—',
    },
    {
      label: 'Game speed',
      value: hostSettings.gameSpeed ? hostSettings.gameSpeed.replace(/^(.)/, (m) => m.toUpperCase()) : 'Normal',
    },
    {
      label: 'Spectator chat',
      value: hostSettings.allowSpectatorChat === false ? 'Disabled' : 'Enabled',
    },
  ];

  entries.forEach(({ label, value }) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    container.append(dt, dd);
  });
};

const getActivePlayers = (players = []) => players.filter((player) => !player.isSpectator);

const shouldDisableStart = ({ isHost, isStarting, players, gameActive }) => {
  if (!isHost || isStarting || gameActive) {
    return true;
  }

  return getActivePlayers(players).length < MINIMUM_PLAYERS;
};

const createLobbyController = ({
  section,
  statusEl,
  playerListEl,
  startButton,
  startHintEl,
  playerCountBadge,
  hostSettingsEl,
  context,
}) => {
  const state = {
    roomId: null,
    playerId: null,
    isHost: false,
    players: [],
    spectatorCount: 0,
    isStarting: false,
    gameActive: false,
    hostSettings: null,
    hostSettingsRequestFor: null,
  };

  const updatePlayerBadge = () => {
    const activeCount = getActivePlayers(state.players).length;
    const spectators = Number.isFinite(state.spectatorCount) ? state.spectatorCount : 0;
    const badgeText = spectators > 0
      ? `${formatPlural(activeCount, 'player', 'players')} · ${formatPlural(spectators, 'spectator', 'spectators')}`
      : formatPlural(activeCount, 'player', 'players');
    playerCountBadge.textContent = badgeText;
  };

  const updatePlayerList = () => {
    playerListEl.innerHTML = '';

    if (!state.players.length) {
      const empty = document.createElement('li');
      empty.className = 'game-setup__player';
      empty.textContent = 'Waiting for players to join this lobby…';
      playerListEl.append(empty);
      return;
    }

    const sorted = sortPlayers(state.players);
    sorted.forEach((player) => {
      const item = createPlayerEntry({
        player,
        isSelf: state.playerId === player.playerId,
      });
      playerListEl.append(item);
    });
  };

  const updateHint = () => {
    if (!state.roomId) {
      startHintEl.textContent = 'Join a room to configure the next game.';
      return;
    }

    if (!state.isHost) {
      startHintEl.textContent = state.gameActive ? 'Game in progress… watch the action!' : 'Waiting for the host to start the game.';
      return;
    }

    if (state.gameActive) {
      startHintEl.textContent = 'A game is already running.';
      return;
    }

    if (getActivePlayers(state.players).length < MINIMUM_PLAYERS) {
      startHintEl.textContent = 'Need at least 2 connected players to start.';
      return;
    }

    startHintEl.textContent = state.isStarting ? 'Starting game… shuffling cards.' : 'Tap Start game when everyone is ready.';
  };

  const updateStatus = (message) => {
    if (message) {
      statusEl.textContent = message;
      return;
    }

    if (!state.roomId) {
      statusEl.textContent = 'Join a room to set up the next game.';
      return;
    }

    if (state.gameActive) {
      statusEl.textContent = 'Game in progress — good luck!';
      return;
    }

    if (state.isHost) {
      statusEl.textContent = getActivePlayers(state.players).length < MINIMUM_PLAYERS
        ? 'Waiting for more players to join…'
        : 'Ready to start when the table is set.';
      return;
    }

    statusEl.textContent = 'Hang tight — the host will start the game soon.';
  };

  const updateStartButton = () => {
    const shouldDisable = shouldDisableStart(state);
    startButton.disabled = shouldDisable;
    startButton.textContent = state.isStarting ? 'Starting…' : 'Start game';
  };

  const updateHostSettings = () => {
    renderHostSettings({ hostSettings: state.hostSettings, container: hostSettingsEl });
  };

  const updateVisibility = () => {
    section.hidden = !state.roomId;
  };

  const updateAll = () => {
    updateVisibility();
    updatePlayerList();
    updatePlayerBadge();
    updateStartButton();
    updateHint();
    updateStatus();
    updateHostSettings();
  };

  const loadRoomDetails = async (roomId) => {
    if (!roomId || typeof fetch !== 'function') {
      return;
    }

    if (state.hostSettingsRequestFor === roomId) {
      return;
    }

    state.hostSettingsRequestFor = roomId;

    try {
      const response = await fetch(ROOM_DETAILS_ENDPOINT(roomId), {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Unable to load room configuration (${response.status})`);
      }

      const details = await response.json();
      if (state.roomId !== roomId) {
        return;
      }

      state.hostSettings = details?.hostSettings ?? null;
      state.spectatorCount = details?.spectatorCount ?? 0;
      updateHostSettings();
      updatePlayerBadge();
    } catch (error) {
      context.renderSystemMessage?.('Lobby info unavailable', error.message ?? 'Unable to load host settings.');
      state.hostSettings = null;
      updateHostSettings();
    }
  };

  const applyRoomSnapshot = (payload, { fetchDetails = false } = {}) => {
    if (!payload) {
      state.roomId = null;
      state.isHost = false;
      state.players = [];
      state.hostSettings = null;
      state.gameActive = false;
      state.isStarting = false;
      updateAll();
      return;
    }

    state.roomId = payload.roomId ?? state.roomId;
    state.playerId = payload.playerId ?? state.playerId;
    state.isHost = payload.isHost ?? state.isHost;
    state.players = Array.isArray(payload.currentPlayers) ? payload.currentPlayers : state.players;
    state.spectatorCount = Number.isFinite(payload.spectatorCount) ? payload.spectatorCount : state.spectatorCount;

    if (payload.gameState) {
      const phase = payload.gameState.currentPhase;
      state.gameActive = phase && phase !== 'completed';
    }

    if (fetchDetails && state.roomId) {
      loadRoomDetails(state.roomId);
    }

    updateAll();
  };

  return {
    state,
    updateStatus,
    updateAll,
    updateStartButton,
    applyRoomSnapshot,
    loadRoomDetails,
  };
};

export const init = async (context) => {
  const moduleRoot = context.appRoot?.querySelector('[data-testid="module-root"]');
  if (!moduleRoot) {
    throw new Error('Game setup module requires a module root container.');
  }

  const section = createTemplate();
  moduleRoot.append(section);

  const statusEl = section.querySelector('[data-testid="lobby-status"]');
  const playerListEl = section.querySelector('[data-testid="player-list"]');
  const startButton = section.querySelector('[data-testid="start-game"]');
  const startHintEl = section.querySelector('[data-testid="start-hint"]');
  const playerCountBadge = section.querySelector('[data-testid="player-count"]');
  const hostSettingsEl = section.querySelector('[data-testid="host-settings"]');

  const lobby = createLobbyController({
    section,
    statusEl,
    playerListEl,
    startButton,
    startHintEl,
    playerCountBadge,
    hostSettingsEl,
    context,
  });

  const disposers = [];
  const socketHandlers = [];

  const networkClient = context.networkClient;

  const subscribe = (event, handler) => {
    if (!networkClient?.on) {
      return;
    }

    const dispose = networkClient.on(event, handler);
    if (typeof dispose === 'function') {
      disposers.push(dispose);
    }
  };

  const socket = typeof networkClient?.getSocket === 'function' ? networkClient.getSocket() : null;

  const attachSocket = (event, handler) => {
    if (!socket?.on) {
      return;
    }

    socket.on(event, handler);
    socketHandlers.push({ event, handler });
  };

  const startGame = () => {
    if (startButton.disabled || !networkClient?.emit) {
      return;
    }

    lobby.state.isStarting = true;
    lobby.updateAll();
    context.renderSystemMessage?.('Starting game', 'Shuffling deck and dealing cards…');

    try {
      networkClient.emit('start_game');
    } catch (error) {
      lobby.state.isStarting = false;
      lobby.updateAll();
      context.renderSystemMessage?.('Unable to start game', error.message ?? 'Unknown error occurred.');
    }
  };

  startButton.addEventListener('click', startGame);

  subscribe('room_joined', (payload) => {
    lobby.state.isStarting = false;
    lobby.applyRoomSnapshot(payload, { fetchDetails: true });
  });

  subscribe('room_state', (payload) => {
    lobby.applyRoomSnapshot(payload);
  });

  subscribe('room_left', () => {
    lobby.applyRoomSnapshot(null);
  });

  subscribe('player_joined', () => {
    lobby.state.isStarting = false;
  });

  attachSocket('action_error', (payload) => {
    if (payload?.action !== 'start_game') {
      return;
    }

    lobby.state.isStarting = false;
    lobby.updateAll();
    const message = payload?.message ?? 'Unable to start game.';
    lobby.updateStatus(message);
    context.renderSystemMessage?.('Game start failed', message);
  });

  attachSocket('game_started', () => {
    lobby.state.isStarting = false;
    lobby.state.gameActive = true;
    lobby.updateAll();
    lobby.updateStatus('Game in progress — good luck!');
  });

  attachSocket('round_started', (payload) => {
    lobby.state.gameActive = true;
    const message = payload?.roundNumber ? `Round ${payload.roundNumber} is underway.` : 'Round started.';
    lobby.updateStatus(message);
    lobby.updateStartButton();
  });

  // Hydrate immediately if already in a room
  if (context.state?.currentRoom) {
    lobby.applyRoomSnapshot(context.state.currentRoom, { fetchDetails: true });
  }

  return {
    destroy: () => {
      startButton.removeEventListener('click', startGame);
      disposers.forEach((dispose) => {
        try {
          dispose();
        } catch (error) {
          // ignore cleanup errors
        }
      });
      socketHandlers.forEach(({ event, handler }) => {
        try {
          socket?.off?.(event, handler);
        } catch (error) {
          // noop
        }
      });
      if (section.parentElement) {
        section.parentElement.removeChild(section);
      }
    },
  };
};

registerModule(async () => ({ init }));
