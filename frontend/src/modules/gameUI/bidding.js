import '../../css/bidding.css';
import { registerModule } from '../moduleRegistry.js';

const formatSeconds = (value) => {
  if (!Number.isFinite(value) || value < 0) {
    return '—';
  }

  if (value < 10) {
    return `${value.toFixed(1)}s`;
  }

  return `${Math.round(value)}s`;
};

const clampSeconds = (deadline) => {
  if (!deadline || !Number.isFinite(deadline)) {
    return null;
  }

  const remainingMs = deadline - Date.now();
  return Math.max(0, remainingMs) / 1000;
};

const createTemplate = () => {
  const section = document.createElement('section');
  section.className = 'bidding';
  section.dataset.testid = 'bidding-panel';
  section.hidden = true;

  section.innerHTML = `
    <header class="bidding__header">
      <h2 class="bidding__title">Bidding phase</h2>
      <div class="bidding__timer" data-testid="bidding-timer" aria-live="polite">
        <span class="bidding__timerLabel">Time left</span>
        <strong class="bidding__timerValue">—</strong>
      </div>
    </header>
    <p class="bidding__status" data-testid="bidding-status">Waiting for the bidding phase…</p>
    <div class="bidding__content">
      <ul class="bidding__players" data-testid="bidding-players" role="list"></ul>
      <div class="bidding__actions" data-testid="bid-actions">
        <p class="bidding__hint" data-testid="bidding-hint"></p>
        <div class="bidding__options" data-testid="bid-options" role="radiogroup" aria-label="Choose your bid"></div>
        <div class="bidding__restriction" data-testid="restriction-message" hidden></div>
        <p class="bidding__error" data-testid="bidding-error" role="alert" hidden></p>
      </div>
    </div>
  `;

  return section;
};

const ensureSortedNumeric = (values = []) => {
  const list = Array.isArray(values) ? [...values] : [];
  list.sort((a, b) => a - b);
  return list;
};

const getPlayersFromContext = (context) => {
  const currentRoom = context?.state?.currentRoom;
  if (!currentRoom) {
    return [];
  }

  if (Array.isArray(currentRoom.currentPlayers)) {
    return currentRoom.currentPlayers;
  }

  if (Array.isArray(currentRoom.players)) {
    return currentRoom.players;
  }

  const directory = context?.state?.game?.playerDirectory;
  if (directory && typeof directory === 'object') {
    return Object.values(directory);
  }

  return [];
};

const resolvePlayer = (context, playerId) => {
  if (!playerId) {
    return null;
  }

  const players = getPlayersFromContext(context);
  const directMatch = players.find((player) => player?.playerId === playerId);
  if (directMatch) {
    return directMatch;
  }

  const directory = context?.state?.game?.playerDirectory;
  if (directory && typeof directory === 'object' && directory[playerId]) {
    return {
      playerId,
      displayName: directory[playerId].displayName ?? playerId,
      connectionStatus: directory[playerId].connectionStatus ?? 'connected',
    };
  }

  return null;
};

const describePlayer = (context, playerId, selfId) => {
  const record = resolvePlayer(context, playerId);
  const displayName = record?.displayName ?? playerId ?? 'Unknown';
  const connectionStatus = record?.connectionStatus ?? 'connected';
  const isSelf = selfId && playerId === selfId;

  return {
    name: displayName,
    connectionStatus,
    isSelf,
  };
};

const createBidButton = ({ value, disabled, onClick, isRestricted }) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bidding__option';
  button.dataset.testid = 'bid-option';
  button.dataset.value = String(value);
  button.textContent = value;
  button.disabled = disabled;
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', 'false');

  if (isRestricted) {
    button.classList.add('bidding__option--restricted');
    button.disabled = true;
    button.title = 'Restricted by last bidder rule';
  }

  button.addEventListener('click', () => {
    if (typeof onClick === 'function' && !button.disabled) {
      onClick(value, button);
    }
  });

  return button;
};

const clearChildren = (element) => {
  if (!element) {
    return;
  }
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
};

const formatRestrictionMessage = ({ cardCount, restrictedBid }) => {
  if (!Number.isFinite(restrictedBid)) {
    return '';
  }

  return `You cannot choose ${restrictedBid} — last bidder rule prevents total bids matching ${cardCount}.`;
};

const getLatestError = (errors = []) => {
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }
  return errors[errors.length - 1];
};

const shouldDisableBidding = ({ state, isSelfTurn }) => {
  if (!isSelfTurn) {
    return true;
  }

  if (state.offline) {
    return true;
  }

  if (state.pending?.bid) {
    return true;
  }

  if (!Array.isArray(state.validBids) || !state.validBids.length) {
    return true;
  }

  return false;
};

export const init = async (context) => {
  const moduleRoot = context?.appRoot?.querySelector('[data-testid="module-root"]');
  if (!moduleRoot) {
    throw new Error('Bidding module requires a module root container.');
  }

  const store = context?.gameState;
  if (!store || typeof store.subscribe !== 'function') {
    throw new Error('Bidding module requires gameState store in context.');
  }

  const section = createTemplate();
  moduleRoot.append(section);

  const timerEl = section.querySelector('[data-testid="bidding-timer"]');
  const timerValueEl = section.querySelector('.bidding__timerValue');
  const statusEl = section.querySelector('[data-testid="bidding-status"]');
  const playersEl = section.querySelector('[data-testid="bidding-players"]');
  const optionsEl = section.querySelector('[data-testid="bid-options"]');
  const hintEl = section.querySelector('[data-testid="bidding-hint"]');
  const errorEl = section.querySelector('[data-testid="bidding-error"]');
  const restrictionEl = section.querySelector('[data-testid="restriction-message"]');

  const viewState = {
    countdownInterval: null,
    lastDeadline: null,
    autoActions: new Map(),
    destroyed: false,
  };

  const stopTimer = () => {
    if (viewState.countdownInterval) {
      clearInterval(viewState.countdownInterval);
      viewState.countdownInterval = null;
    }
    viewState.lastDeadline = null;
  };

  const updateTimer = (deadline, { paused } = {}) => {
    if (!timerEl || !timerValueEl) {
      return;
    }

    if (!deadline) {
      timerValueEl.textContent = paused ? 'Paused' : '—';
      timerEl.dataset.state = paused ? 'paused' : 'idle';
      stopTimer();
      return;
    }

    const applyTime = () => {
      const seconds = clampSeconds(deadline);
      const stateName = seconds > 6 ? 'running' : seconds > 3 ? 'warning' : 'critical';
      timerEl.dataset.state = paused ? 'paused' : stateName;
      timerValueEl.textContent = paused ? 'Paused' : formatSeconds(seconds);
    };

    if (viewState.lastDeadline !== deadline) {
      stopTimer();
      viewState.lastDeadline = deadline;
      viewState.countdownInterval = setInterval(() => {
        if (viewState.destroyed) {
          stopTimer();
          return;
        }
        applyTime();
      }, 250);
    }

    applyTime();
  };

  const renderPlayers = (state) => {
    clearChildren(playersEl);

    const order = Array.isArray(state.playerOrder) ? state.playerOrder : [];
    if (!order.length) {
      const placeholder = document.createElement('li');
      placeholder.className = 'bidding__player bidding__player--empty';
      placeholder.textContent = 'Waiting for players…';
      playersEl.append(placeholder);
      return;
    }

    order.forEach((playerId) => {
      const info = describePlayer(context, playerId, state.playerId);
      const item = document.createElement('li');
      item.className = 'bidding__player';
      item.dataset.playerId = playerId;
      item.dataset.connection = info.connectionStatus ?? 'connected';
      if (info.isSelf) {
        item.dataset.self = 'true';
      }
      if (playerId === state.currentTurn) {
        item.dataset.current = 'true';
      }

      const name = document.createElement('span');
      name.className = 'bidding__playerName';
      name.textContent = info.name;
      if (info.isSelf) {
        const mark = document.createElement('span');
        mark.className = 'bidding__playerBadge';
        mark.textContent = 'You';
        name.append(' ', mark);
      }

      const bidBadge = document.createElement('span');
      bidBadge.className = 'bidding__playerBid';
      const committedBid = state.bids ? state.bids[playerId] : undefined;
      const pendingBid = info.isSelf ? state.pending?.bid?.value : null;

      if (Number.isFinite(committedBid)) {
        bidBadge.textContent = committedBid;
        bidBadge.dataset.state = 'committed';
      } else if (info.isSelf && Number.isFinite(pendingBid)) {
        bidBadge.textContent = `${pendingBid}…`;
        bidBadge.dataset.state = 'pending';
      } else {
        bidBadge.textContent = '—';
        bidBadge.dataset.state = 'waiting';
      }

      const auto = viewState.autoActions.get(playerId);
      if (auto?.action === 'auto_bid' && Number.isFinite(auto.value)) {
        bidBadge.textContent = `${auto.value} (auto)`;
        bidBadge.dataset.state = 'auto';
      }

      item.append(name, bidBadge);
      playersEl.append(item);
    });
  };

  const renderOptions = (state) => {
    clearChildren(optionsEl);

    if (!optionsEl) {
      return;
    }

    const bids = ensureSortedNumeric(state.validBids);
    const isSelfTurn = state.playerId && state.playerId === state.currentTurn;
    const disabled = shouldDisableBidding({ state, isSelfTurn });

    bids.forEach((bid) => {
      const button = createBidButton({
        value: bid,
        disabled,
        onClick: (value) => {
          try {
            store.submitBid(value);
          } catch (error) {
            context.renderSystemMessage?.('Bid failed', error?.message ?? 'Unable to submit bid.');
          }
        },
      });

      if (!disabled && isSelfTurn && state.pending?.bid?.value === bid) {
        button.setAttribute('aria-checked', 'true');
        button.classList.add('bidding__option--active');
      }

      if (disabled && state.pending?.bid?.value === bid) {
        button.classList.add('bidding__option--active');
      }

      if (!disabled && state.pending?.bid) {
        button.disabled = true;
      }

      optionsEl.append(button);
    });

    if (state.isLastBidder && Number.isFinite(state.restrictedBid)) {
      const restrictedButton = createBidButton({
        value: state.restrictedBid,
        disabled: true,
        onClick: null,
        isRestricted: true,
      });
      optionsEl.append(restrictedButton);
    }
  };

  const renderRestriction = (state) => {
    if (!restrictionEl) {
      return;
    }

    const showRestriction = state.isLastBidder && Number.isFinite(state.restrictedBid);
    if (!showRestriction) {
      restrictionEl.textContent = '';
      restrictionEl.hidden = true;
      return;
    }

    restrictionEl.textContent = formatRestrictionMessage({
      cardCount: state.round?.cardCount ?? 0,
      restrictedBid: state.restrictedBid,
    });
    restrictionEl.hidden = false;
  };

  const renderHint = (state) => {
    if (!hintEl) {
      return;
    }

    const metadata = state.biddingMetadata ?? {};
    const blindHint = metadata.blindReminder ?? '';
    const totals = Number.isFinite(metadata.existingBidTotal)
      ? `Bids so far: ${metadata.existingBidTotal}`
      : '';

    const parts = [blindHint, totals].filter(Boolean);

    hintEl.textContent = parts.length ? parts.join(' · ') : '';
    hintEl.hidden = parts.length === 0;
  };

  const renderError = (state) => {
    if (!errorEl) {
      return;
    }

    const latest = getLatestError(state.errors);
    if (!latest) {
      errorEl.textContent = '';
      errorEl.hidden = true;
      return;
    }

    errorEl.textContent = latest.message ?? 'Bid failed. Please try again.';
    errorEl.hidden = false;
  };

  const describeStatus = (state) => {
    const isSelfTurn = state.playerId && state.playerId === state.currentTurn;

    if (state.phase !== 'bidding') {
      return 'Waiting for the next bidding round…';
    }

    if (state.offline) {
      return 'Offline — bids will resume when connection returns.';
    }

    if (!isSelfTurn) {
      const info = describePlayer(context, state.currentTurn, state.playerId);
      return info?.name ? `Waiting for ${info.name}…` : 'Waiting for the next player…';
    }

    if (state.pending?.bid) {
      return 'Bid sent — waiting for confirmation…';
    }

    return 'Your turn — choose how many tricks you will win.';
  };

  const renderState = (state) => {
    if (!state || state.phase !== 'bidding') {
      section.hidden = true;
      updateTimer(null);
      return;
    }

    section.hidden = false;
    section.dataset.phase = 'bidding';

    statusEl.textContent = describeStatus(state);

    renderPlayers(state);
    renderOptions(state);
    renderRestriction(state);
    renderHint(state);
    renderError(state);

    const deadline = Number.isFinite(state.turnEndsAt) ? state.turnEndsAt : null;
    updateTimer(deadline, { paused: state.offline });
  };

  const unsubscribe = store.subscribe((nextState) => {
    viewState.autoActions.forEach((entry, playerId) => {
      if (nextState?.bids && Object.prototype.hasOwnProperty.call(nextState.bids, playerId)) {
        viewState.autoActions.delete(playerId);
      }
      if (nextState?.phase !== 'bidding') {
        viewState.autoActions.delete(playerId);
      }
    });
    renderState(nextState);
  });

  renderState(store.getState());

  const socket = context.socket ?? context.networkClient?.getSocket?.();
  const socketHandlers = [];

  if (socket?.on) {
    const autoHandler = (payload) => {
      if (!payload || payload.action !== 'auto_bid') {
        return;
      }
      viewState.autoActions.set(payload.playerId, payload);
      renderState(store.getState());
    };

    socket.on('auto_action', autoHandler);
    socketHandlers.push(() => socket.off?.('auto_action', autoHandler));

    const bidHandler = (payload) => {
      if (payload?.allBids) {
        viewState.autoActions.clear();
      }
    };

    socket.on('bid_submitted', bidHandler);
    socketHandlers.push(() => socket.off?.('bid_submitted', bidHandler));

    const roundHandler = () => {
      viewState.autoActions.clear();
    };

    socket.on('round_started', roundHandler);
    socketHandlers.push(() => socket.off?.('round_started', roundHandler));
  }

  return {
    destroy: () => {
      viewState.destroyed = true;
      stopTimer();
      unsubscribe?.();
      socketHandlers.forEach((dispose) => {
        try {
          dispose();
        } catch (error) {
          // ignore cleanup errors
        }
      });
    },
  };
};

registerModule(async () => ({ init }));
