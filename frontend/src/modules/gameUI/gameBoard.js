import '../../css/gameBoard.css';
import { registerModule } from '../moduleRegistry.js';
import { createCardElement } from '../cardRenderer/index.js';

const SUIT_SYMBOLS = {
  clubs: '♣',
  hearts: '♥',
  spades: '♠',
  diamonds: '♦',
};

const clampSeconds = (deadline) => {
  if (!deadline || !Number.isFinite(deadline)) {
    return null;
  }

  const remainingMs = deadline - Date.now();
  return Math.max(0, remainingMs) / 1000;
};

const formatSeconds = (seconds) => {
  if (!Number.isFinite(seconds)) {
    return '—';
  }

  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }

  return `${Math.round(seconds)}s`;
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

const describePlayer = (context, playerId, selfId) => {
  if (!playerId) {
    return {
      name: 'Unknown',
      connectionStatus: 'unknown',
      isSelf: false,
    };
  }

  const players = getPlayersFromContext(context);
  const record = players.find((player) => player?.playerId === playerId);
  const directory = context?.state?.game?.playerDirectory;
  const directoryEntry =
    directory && typeof directory === 'object' ? directory[playerId] ?? null : null;

  return {
    name: record?.displayName ?? directoryEntry?.displayName ?? playerId,
    connectionStatus: record?.connectionStatus ?? directoryEntry?.connectionStatus ?? 'connected',
    isSelf: Boolean(selfId && playerId === selfId),
  };
};

const cardsEqual = (left, right) =>
  left &&
  right &&
  typeof left === 'object' &&
  typeof right === 'object' &&
  left.rank === right.rank &&
  left.suit === right.suit;

const formatCardLabel = (card) => {
  if (!card || typeof card !== 'object') {
    return '—';
  }

  if (typeof card.displayName === 'string' && card.displayName.trim().length) {
    return card.displayName;
  }

  if (typeof card.rank === 'string' && typeof card.suit === 'string') {
    const suitSymbol = SUIT_SYMBOLS[card.suit.toLowerCase()] ?? card.suit.charAt(0).toUpperCase();
    return `${card.rank}${suitSymbol}`;
  }

  return '—';
};

const clearChildren = (element) => {
  if (!element) {
    return;
  }
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
};

const createTemplate = () => {
  const section = document.createElement('section');
  section.className = 'game-board';
  section.dataset.testid = 'game-board';
  section.hidden = true;

  section.innerHTML = `
    <header class="game-board__header">
      <h2 class="game-board__title">Trick play</h2>
      <div class="game-board__meta">
        <span data-testid="board-round">Round —</span>
        <div class="game-board__viraWrapper" data-testid="board-vira-wrapper">
          <span class="game-board__viraLabel" data-testid="board-vira-label">Vira</span>
          <div class="game-board__viraCard" data-testid="board-vira-card"></div>
        </div>
        <span class="game-board__turn" data-testid="board-turn">Waiting…</span>
        <span class="game-board__timer" data-testid="board-timer" aria-live="polite">—</span>
      </div>
    </header>
    <div class="game-board__players" data-testid="board-players" role="list"></div>
    <div class="game-board__table" data-testid="board-table">
      <div class="game-board__trickStatus" data-testid="trick-status">
        <span data-testid="trick-label">Trick —</span>
        <span data-testid="trick-winner"></span>
      </div>
      <div class="game-board__slots" data-testid="trick-slots"></div>
    </div>
    <div class="game-board__hand" data-testid="player-hand">
      <div class="game-board__handHeader">
        <strong>Your hand</strong>
        <span data-testid="hand-status"></span>
      </div>
      <div class="game-board__handCards" data-testid="hand-cards"></div>
      <div class="game-board__visible" data-testid="visible-cards"></div>
    </div>
    <div class="game-board__history" data-testid="trick-history" hidden></div>
  `;

  return section;
};

const renderPlayers = (context, element, state) => {
  if (!element) {
    return;
  }

  clearChildren(element);

  const order = Array.isArray(state.playerOrder) ? state.playerOrder : [];
  if (!order.length) {
    return;
  }

  order.forEach((playerId) => {
    const info = describePlayer(context, playerId, state.playerId);
    const item = document.createElement('article');
    item.className = 'game-board__player';
    item.dataset.playerId = playerId;
    item.dataset.turn = state.currentTurn === playerId ? 'true' : 'false';
    item.dataset.self = info.isSelf ? 'true' : 'false';

    const nameRow = document.createElement('div');
    nameRow.className = 'game-board__playerName';
    nameRow.textContent = info.name;

    if (info.isSelf) {
      const badge = document.createElement('span');
      badge.className = 'game-board__playerBadge';
      badge.textContent = 'You';
      nameRow.appendChild(badge);
    }

    const status = document.createElement('span');
    status.className = 'game-board__playerStatus';
    status.dataset.status = info.connectionStatus ?? 'connected';
    status.textContent = info.connectionStatus === 'connected' ? 'Ready' : info.connectionStatus;

    item.append(nameRow, status);
    element.append(item);
  });
};

const createSlot = ({
  player,
  card,
  isWinner,
  isCancelled,
  isLeader,
  isWinningCard,
}) => {
  const slot = document.createElement('div');
  slot.className = 'game-board__slot';
  slot.dataset.playerId = player?.id ?? '';
  slot.dataset.hasCard = card ? 'true' : 'false';
  slot.dataset.winner = isWinner ? 'true' : 'false';
  slot.dataset.cancelled = isCancelled ? 'true' : 'false';
  slot.dataset.leading = card && isLeader ? 'true' : 'false';

  const label = document.createElement('span');
  label.className = 'game-board__slotLabel';
  label.textContent = player?.name ?? '—';

  const cardShell = document.createElement('div');
  cardShell.className = 'game-board__cardShell';

  if (card) {
    const cardElement = createCardElement(card, {
      interactive: false,
      showStrength: false,
      reveal: true,
    });

    if (isWinningCard) {
      cardElement.classList.add('card-tile--leading');
    }

    cardShell.append(cardElement);
  } else {
    const placeholder = document.createElement('span');
    placeholder.style.opacity = '0.5';
    placeholder.textContent = 'Waiting';
    cardShell.append(placeholder);
  }

  slot.append(label, cardShell);
  return slot;
};

const renderTrick = (context, element, state) => {
  if (!element) {
    console.warn('[GameBoard] renderTrick called with null element');
    return;
  }

  console.log('[GameBoard] renderTrick called:', {
    trickNumber: state.currentTrick?.number,
    cardsPlayed: state.currentTrick?.cardsPlayed,
    cardsPlayedKeys: state.currentTrick?.cardsPlayed ? Object.keys(state.currentTrick.cardsPlayed) : [],
    playerOrder: state.playerOrder,
  });

  const statusEl = element.parentElement?.querySelector('[data-testid="trick-status"]');
  if (statusEl) {
    const labelEl = statusEl.querySelector('[data-testid="trick-label"]');
    const winnerEl = statusEl.querySelector('[data-testid="trick-winner"]');
    if (labelEl) {
      labelEl.textContent = `Trick ${state.currentTrick.number || '—'}`;
    }
    if (winnerEl) {
      if (state.currentTrick.winner) {
        const info = describePlayer(context, state.currentTrick.winner, state.playerId);
        winnerEl.textContent = `Winner: ${info.name}`;
      } else {
        winnerEl.textContent = '';
      }
    }
  }

  clearChildren(element);

  const order = Array.isArray(state.playerOrder) ? state.playerOrder : [];
  const cancelled = Array.isArray(state.currentTrick.cancelledCards)
    ? state.currentTrick.cancelledCards
    : [];
  const currentLeader = state.currentTrick.currentLeader ?? null;
  const winningCard = state.currentTrick.winningCard ?? null;

  const isCancelledCard = (card) => cancelled.some((entry) => cardsEqual(entry, card));

  order.forEach((playerId) => {
    const info = describePlayer(context, playerId, state.playerId);
    const card = state.currentTrick.cardsPlayed?.[playerId] ?? null;
    console.log('[GameBoard] Creating slot for player:', {
      playerId,
      playerName: info.name,
      hasCard: !!card,
      card: card,
    });
    const isLeader = currentLeader === playerId;
    const isWinningCard = card && winningCard ? cardsEqual(card, winningCard) : false;
    const slot = createSlot({
      player: { id: playerId, name: info.name },
      card,
      isWinner: state.currentTrick.winner === playerId,
      isCancelled: Boolean(card && isCancelledCard(card)),
      isLeader,
      isWinningCard,
    });
    element.append(slot);
  });

  console.log('[GameBoard] renderTrick complete, element children:', element.children.length);
};

const renderVisibleCards = (context, container, state) => {
  if (!container) {
    return;
  }

  clearChildren(container);
  const visibleCards = Array.isArray(state.visibleCards) ? state.visibleCards : [];
  if (!visibleCards.length) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const label = document.createElement('div');
  label.textContent = 'Visible cards:';
  label.style.fontSize = '0.8rem';
  label.style.color = '#94a3b8';
  container.append(label);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.gap = '8px';

  visibleCards.forEach((card) => {
  const cardEl = createCardElement(card, { interactive: false, showStrength: false });
    cardEl.style.minWidth = '72px';
    const owner = document.createElement('span');
    owner.style.fontSize = '0.65rem';
    owner.style.marginTop = '4px';
    owner.style.display = 'block';
    owner.style.color = '#cbd5f5';
    const ownerInfo = card.ownerDisplayName
      ? card.ownerDisplayName
      : card.ownerId
        ? describePlayer(context, card.ownerId, state.playerId).name
        : 'Unknown';
    owner.textContent = ownerInfo;
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.append(cardEl, owner);
    row.append(wrapper);
  });

  container.append(row);
};

const renderHand = (context, container, state, handlePlay) => {
  if (!container) {
    return;
  }

  clearChildren(container);
  const hand = Array.isArray(state.hand) ? state.hand : [];
  const canPlay =
    state.phase === 'playing' &&
    state.playerId &&
    state.playerId === state.currentTurn &&
    !state.pending?.card &&
    !state.offline;

  hand.forEach((card) => {
    const handlers = canPlay
      ? {
          onTap: () => handlePlay(card),
          onDragEnd: (_, meta = {}) => {
            if (typeof meta.deltaY === 'number' && meta.deltaY < -80) {
              handlePlay(card);
            }
          },
        }
      : null;

    const cardElement = createCardElement(card, {
      interactive: handlers,
      showStrength: false,
    });

    if (!canPlay) {
      cardElement.disabled = true;
      cardElement.setAttribute('aria-disabled', 'true');
    }

    if (state.pending?.card && cardsEqual(state.pending.card.card, card)) {
      cardElement.classList.add('card-tile--pending');
    }

    container.append(cardElement);
  });
};

const renderHistory = (context, container, state) => {
  if (!container) {
    return;
  }

  const history = Array.isArray(state.trickHistory) ? state.trickHistory : [];
  if (!history.length) {
    container.hidden = true;
    container.textContent = '';
    return;
  }

  container.hidden = false;
  const lastTrick = history[history.length - 1];
  const parts = [];

  if (lastTrick.number) {
    parts.push(`Last trick #${lastTrick.number}`);
  }

  if (lastTrick.winner) {
    const info = describePlayer(context, lastTrick.winner, state.playerId);
    parts.push(`Winner: ${info.name}`);
  }

  if (Array.isArray(lastTrick.cancelledCards) && lastTrick.cancelledCards.length) {
    parts.push(`Cancelled: ${lastTrick.cancelledCards.length}`);
  }

  container.textContent = parts.join(' · ');
};

const renderMeta = (section, state, context) => {
  const roundEl = section.querySelector('[data-testid="board-round"]');
  if (roundEl) {
    roundEl.textContent = `Round ${state.round.number || '—'} · ${state.round.cardCount || 0} card${
      state.round.cardCount === 1 ? '' : 's'
    }`;
  }

  const viraWrapper = section.querySelector('[data-testid="board-vira-wrapper"]');
  const viraLabel = section.querySelector('[data-testid="board-vira-label"]');
  const viraCardSlot = section.querySelector('[data-testid="board-vira-card"]');
  if (viraWrapper && viraLabel && viraCardSlot) {
    const viraCard = state.round?.viraCard ?? null;
    const manilhaRank = state.round?.manilhaRank ?? null;

    clearChildren(viraCardSlot);

    if (viraCard) {
      // Show only the manilha rank since the card is already visible
      viraLabel.textContent = manilhaRank ? `Manilha: ${manilhaRank}` : 'Vira';
      const cardElement = createCardElement(viraCard, {
        interactive: false,
        reveal: true,
        showStrength: false,
      });
      cardElement.disabled = true;
      cardElement.setAttribute('aria-disabled', 'true');
      viraCardSlot.append(cardElement);
      viraWrapper.hidden = false;
    } else {
      viraLabel.textContent = 'Vira —';
      const placeholder = document.createElement('span');
      placeholder.className = 'game-board__viraPlaceholder';
      placeholder.textContent = '—';
      viraCardSlot.append(placeholder);
      viraWrapper.hidden = false;
    }
  }

  const turnEl = section.querySelector('[data-testid="board-turn"]');
  const handStatusEl = section.querySelector('[data-testid="hand-status"]');
  if (turnEl) {
    if (state.currentTurn) {
      const info = describePlayer(context, state.currentTurn, state.playerId);
      turnEl.textContent = info.isSelf ? 'Your move' : `${info.name}'s move`;

      if (handStatusEl && !(state.pending?.card || state.offline)) {
        handStatusEl.textContent = info.isSelf
          ? 'Select a card to play'
          : `Waiting for ${info.name}`;
      }
    } else if (state.phase === 'scoring') {
      turnEl.textContent = 'Waiting for scoring…';
      if (handStatusEl && !state.pending?.card) {
        handStatusEl.textContent = 'Scoring in progress';
      }
    } else {
      turnEl.textContent = 'Waiting for next trick…';
      if (handStatusEl && !state.pending?.card) {
        handStatusEl.textContent = '';
      }
    }
  }

  const timerEl = section.querySelector('[data-testid="board-timer"]');
  if (timerEl) {
    const seconds = clampSeconds(state.turnEndsAt);
    timerEl.textContent = formatSeconds(seconds);
  }
  if (handStatusEl) {
    if (state.offline) {
      handStatusEl.textContent = 'Offline';
    } else if (state.pending?.card) {
      handStatusEl.textContent = 'Waiting for server…';
    }
  }
};

export const init = async (context) => {
  const moduleRoot = context?.appRoot?.querySelector('[data-testid="module-root"]');
  if (!moduleRoot) {
    throw new Error('Game board module requires a module root container.');
  }

  const store = context?.gameState;
  if (!store || typeof store.subscribe !== 'function') {
    throw new Error('Game board module requires gameState store in context.');
  }

  const section = createTemplate();
  moduleRoot.append(section);

  const playersEl = section.querySelector('[data-testid="board-players"]');
  const slotsEl = section.querySelector('[data-testid="trick-slots"]');
  const handEl = section.querySelector('[data-testid="hand-cards"]');
  const visibleEl = section.querySelector('[data-testid="visible-cards"]');
  const historyEl = section.querySelector('[data-testid="trick-history"]');
  const timerEl = section.querySelector('[data-testid="board-timer"]');

  // Timer update interval
  let timerInterval = null;
  const startTimerInterval = () => {
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    timerInterval = setInterval(() => {
      const state = store.getState();
      if (timerEl && state.turnEndsAt) {
        const seconds = clampSeconds(state.turnEndsAt);
        timerEl.textContent = formatSeconds(seconds);
      }
    }, 100); // Update every 100ms for smooth countdown
  };

  const render = (state) => {
    const shouldShow =
      state.phase === 'bidding' ||
      state.phase === 'playing' ||
      state.phase === 'scoring' ||
      (Array.isArray(state.hand) && state.hand.length > 0) ||
      (Array.isArray(state.visibleCards) && state.visibleCards.length > 0);

    section.hidden = !shouldShow;
    if (section.hidden) {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      return;
    }

    // Start timer interval if we have a deadline
    if (state.turnEndsAt && !timerInterval) {
      startTimerInterval();
    } else if (!state.turnEndsAt && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    console.log('[GameBoard] render called, state:', {
      phase: state.phase,
      playerOrder: state.playerOrder,
      currentTrick: state.currentTrick,
      handSize: state.hand?.length,
    });

    renderMeta(section, state, context);
    renderPlayers(context, playersEl, state);
    renderTrick(context, slotsEl, state);
    renderHand(context, handEl, state, (card) => {
      try {
        store.playCard(card);
      } catch (error) {
        context.renderSystemMessage?.('Play failed', error?.message ?? 'Unable to play card.');
      }
    });
    renderVisibleCards(context, visibleEl, state);
    renderHistory(context, historyEl, state);
  };

  const unsubscribe = store.subscribe((next) => render(next));
  render(store.getState());

  return {
    destroy: () => {
      if (timerInterval) {
        clearInterval(timerInterval);
      }
      unsubscribe?.();
      section.remove();
    },
  };
};

registerModule(async () => ({ init }));
