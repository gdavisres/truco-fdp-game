import '../../css/roomSelection.css';
import { registerModule } from '../moduleRegistry.js';

// Use build-time Vite variable for API base if provided (Netlify). Remove trailing slash.
const API_BASE = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, '') : '';
const ROOM_ENDPOINT = API_BASE ? `${API_BASE}/api/rooms` : '/api/rooms';
const NAME_PATTERN = /^[A-Za-zÀ-ÿ0-9 ]{3,20}$/u;

const createTemplate = () => `
  <section class="room-selection" data-testid="room-selection">
    <h2 class="room-selection__heading">Choose a room</h2>
    <form class="room-selection__form" data-testid="name-form" novalidate>
      <label class="room-selection__field">
        <span class="room-selection__label">Display name</span>
        <input
          class="room-selection__input"
          type="text"
          name="displayName"
          autocomplete="name"
          required
          minlength="3"
          maxlength="20"
          placeholder="Enter your nickname"
          inputmode="text"
          aria-describedby="player-name-hint"
        />
      </label>
      <button class="room-selection__submit" data-testid="join-button" type="submit" disabled>
        Continue
      </button>
      <p id="player-name-hint" class="room-selection__error" data-testid="name-error" hidden>
        Enter 3-20 letters or numbers.
      </p>
    </form>
    <p class="room-selection__status" data-testid="room-status">Loading rooms…</p>
    <ul class="room-selection__list" data-testid="room-list" role="list"></ul>
  </section>
`;

const validateName = (value) => {
  if (!value || value.trim().length < 3) {
    return {
      valid: false,
      message: 'Name must be at least 3 characters long.',
    };
  }

  if (!NAME_PATTERN.test(value.trim())) {
    return {
      valid: false,
      message: 'Use only letters, numbers, and spaces (max 20 characters).',
    };
  }

  return { valid: true };
};

const createRoomBadge = (room) => {
  const playerCount = room.playerCount ?? 0;
  const badge = document.createElement('span');
  badge.className = 'room-selection__badge';
  badge.textContent = `${playerCount}/10 players`;
  return badge;
};

const describeRoomStatus = (room) => {
  const status = room.gameStatus ?? 'waiting';
  if (status === 'playing') {
    return 'In progress';
  }

  if (status === 'paused') {
    return 'Paused';
  }

  return 'Waiting for players';
};

const renderRooms = ({ listEl, rooms, state, updateSubmitState }) => {
  listEl.innerHTML = '';

  if (!rooms.length) {
    const empty = document.createElement('li');
    empty.className = 'room-selection__item';
    empty.textContent = 'No rooms available right now. Please try again soon.';
    listEl.appendChild(empty);
    updateSubmitState();
    return;
  }

  rooms.forEach((room) => {
    const item = document.createElement('li');
    item.className = 'room-selection__item';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.roomId = room.roomId;
    button.className = 'room-selection__roomButton';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('data-selected', 'false');

    const details = document.createElement('div');
    details.className = 'room-selection__roomDetails';
    details.innerHTML = `
      <strong>${room.displayName}</strong>
      <span class="room-selection__roomMeta">
        <span>${describeRoomStatus(room)}</span>
        <span>${room.canJoin ? 'Open' : 'Full'}</span>
      </span>
    `;

    const badge = createRoomBadge(room);

    button.append(details, badge);
    item.appendChild(button);
    listEl.appendChild(item);
  });

  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-room-id]');
    if (!button) {
      return;
    }

    const { roomId } = button.dataset;
    const selectedRoom = rooms.find((entry) => entry.roomId === roomId);
    if (!selectedRoom) {
      return;
    }

    state.selectedRoom = selectedRoom;

    listEl.querySelectorAll('button[data-room-id]').forEach((node) => {
      const isSelected = node.dataset.roomId === roomId;
      node.dataset.selected = String(isSelected);
      node.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });

    updateSubmitState();
  });
};

const showNameError = (errorEl, message = '') => {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }

  errorEl.hidden = false;
  errorEl.textContent = message;
};

const fetchRooms = async (statusEl) => {
  statusEl.textContent = 'Loading rooms…';

  const response = await fetch(ROOM_ENDPOINT, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to load rooms (${response.status})`);
  }

  const data = await response.json();
  statusEl.textContent = 'Pick a room to join:';
  return data;
};

export const init = async (context) => {
  const moduleRoot = context.appRoot?.querySelector('[data-testid="module-root"]');

  if (!moduleRoot) {
    throw new Error('Room selection module requires a module root container.');
  }

  moduleRoot.innerHTML = createTemplate();

  const section = moduleRoot.querySelector('[data-testid="room-selection"]');
  const form = moduleRoot.querySelector('[data-testid="name-form"]');
  const nameInput = moduleRoot.querySelector('input[name="displayName"]');
  const errorEl = moduleRoot.querySelector('[data-testid="name-error"]');
  const submitButton = moduleRoot.querySelector('[data-testid="join-button"]');
  const listEl = moduleRoot.querySelector('[data-testid="room-list"]');
  const statusEl = moduleRoot.querySelector('[data-testid="room-status"]');

  const state = {
    rooms: [],
    selectedRoom: null,
    isLoading: false,
    playerName: '',
    isNameValid: false,
  };

  const updateSubmitState = () => {
    submitButton.disabled = !state.isNameValid || !state.selectedRoom || state.isLoading;
  };

  const handleNameInput = (event) => {
    const value = event.target.value;
    state.playerName = value;
    const validation = validateName(value);

    state.isNameValid = validation.valid;
    showNameError(errorEl, validation.valid ? '' : validation.message);
    updateSubmitState();
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const validation = validateName(state.playerName);
    if (!validation.valid) {
      showNameError(errorEl, validation.message);
      updateSubmitState();
      return;
    }

    if (!state.selectedRoom) {
      showNameError(errorEl, 'Choose a room before continuing.');
      updateSubmitState();
      return;
    }

    showNameError(errorEl, '');

    const networkClient = context.networkClient;

    context.renderSystemMessage(
      'Joining room',
      `Attempting to join ${state.selectedRoom.displayName} as ${state.playerName}.`,
    );

    if (!networkClient) {
      context.renderSystemMessage(
        'Network unavailable',
        'No network client configured yet. Please try again shortly.',
      );
      return;
    }

    const roomId = state.selectedRoom.roomId;

    state.isLoading = true;
    updateSubmitState();

    networkClient
      .joinRoom({ roomId, displayName: state.playerName })
      .then((details) => {
        if (!details) {
          return;
        }

        context.renderSystemMessage(
          'Joined lobby',
          `You're in ${details.displayName ?? details.roomId}. Waiting for players…`,
        );
      })
      .catch((error) => {
        const message = error?.message ?? 'Unable to join room. Please try again.';
        showNameError(errorEl, message);
        context.renderSystemMessage('Join failed', message);
      })
      .finally(() => {
        state.isLoading = false;
        updateSubmitState();
      });
  };

  let alive = true;

  const hydrateRooms = async () => {
    try {
      state.isLoading = true;
      updateSubmitState();
      const rooms = await fetchRooms(statusEl);
      if (!alive) {
        return;
      }
      state.rooms = rooms;
      renderRooms({ listEl, rooms, state, updateSubmitState });
      statusEl.textContent = 'Pick a room to join:';
    } catch (error) {
      statusEl.textContent = 'Unable to load rooms. Tap to retry.';
      context.renderSystemMessage('Room list error', error.message);
      listEl.innerHTML = '';
    } finally {
      state.isLoading = false;
      updateSubmitState();
    }
  };

  nameInput.addEventListener('input', handleNameInput);
  form.addEventListener('submit', handleSubmit);
  statusEl.addEventListener('click', () => hydrateRooms());

  await hydrateRooms();

  return {
    destroy: () => {
      alive = false;
      nameInput.removeEventListener('input', handleNameInput);
      form.removeEventListener('submit', handleSubmit);
      statusEl.replaceWith(statusEl.cloneNode(true));
      if (section?.parentElement) {
        section.parentElement.removeChild(section);
      }
    },
  };
};

registerModule(async () => ({ init }));
