import '../../css/scoring.css';
import { registerModule } from '../moduleRegistry.js';

const VIBRATION_PATTERN = [60, 40, 80];

const createTemplate = () => {
  const section = document.createElement('section');
  section.className = 'scoring';
  section.dataset.testid = 'scoring-panel';
  section.hidden = true;

  section.innerHTML = `
    <header class="scoring__header">
      <h2 class="scoring__title">Round results</h2>
      <div class="scoring__meta">
        <span data-testid="scoring-round">Round —</span>
        <span data-testid="scoring-status"></span>
      </div>
    </header>
    <ul class="scoring__list" data-testid="scoring-rows" role="list"></ul>
  `;

  return section;
};

const triggerHaptics = () => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }

  try {
    navigator.vibrate(VIBRATION_PATTERN);
  } catch (error) {
    // ignore vibration failures gracefully
  }
};

const formatLives = (value) => {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value;
};

const formatDelta = (value) => {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (value === 0) {
    return '+0';
  }
  return value > 0 ? `-${value}` : `+${Math.abs(value)}`;
};

const upsertRow = ({ list, playerId }) => {
  const existing = list.querySelector(`[data-player-id="${playerId}"]`);
  if (existing) {
    return existing;
  }

  const item = document.createElement('li');
  item.className = 'scoring__row';
  item.dataset.playerId = playerId;
  item.innerHTML = `
    <div class="scoring__rowHeader">
      <span class="scoring__name" data-testid="scoring-name"></span>
      <span class="scoring__eliminated" data-testid="scoring-eliminated" hidden>Eliminated</span>
    </div>
    <div class="scoring__rowStats">
      <span class="scoring__stat" data-testid="scoring-bid"></span>
      <span class="scoring__stat" data-testid="scoring-actual"></span>
      <span class="scoring__delta scoring__delta--loss" data-testid="scoring-delta"></span>
    </div>
    <div class="scoring__lives" data-testid="scoring-lives">
      <strong data-testid="scoring-lives-value">—</strong>
      <span>lives</span>
    </div>
  `;

  list.append(item);
  return item;
};

const pruneExtraRows = (list, presentIds) => {
  const nodes = Array.from(list.querySelectorAll('[data-player-id]'));
  nodes.forEach((node) => {
    if (!presentIds.has(node.dataset.playerId)) {
      node.remove();
    }
  });
};

const renderRound = ({ state, section, viewState }) => {
  const roundResults = state.roundResults;
  const hasResults = roundResults && roundResults.results && Object.keys(roundResults.results).length > 0;
  section.hidden = !hasResults;
  section.dataset.visible = hasResults ? 'true' : 'false';

  if (!hasResults) {
    return;
  }

  const roundLabel = section.querySelector('[data-testid="scoring-round"]');
  if (roundLabel && Number.isFinite(roundResults.roundNumber)) {
    roundLabel.textContent = `Round ${roundResults.roundNumber}`;
  }

  const statusLabel = section.querySelector('[data-testid="scoring-status"]');
  if (statusLabel) {
    const eliminated = Array.isArray(roundResults.eliminatedPlayers)
      ? roundResults.eliminatedPlayers.length
      : 0;
    statusLabel.textContent = eliminated > 0 ? `${eliminated} eliminated` : 'Next round starting…';
  }

  const list = section.querySelector('[data-testid="scoring-rows"]');
  const order = Array.isArray(state.playerOrder) ? [...state.playerOrder] : [];
  const present = new Set(order);
  Object.keys(roundResults.results).forEach((playerId) => present.add(playerId));

  const contextDirectory = state.playerDirectory || {};
  const eliminatedSet = new Set(roundResults.eliminatedPlayers || []);

  present.forEach((playerId) => {
    const result = roundResults.results[playerId] ?? null;
    const info = contextDirectory[playerId] ?? {};
    const item = upsertRow({ list, playerId });

    const nameEl = item.querySelector('[data-testid="scoring-name"]');
    if (nameEl) {
      nameEl.textContent = info.displayName ?? playerId;
      nameEl.dataset.self = state.playerId === playerId ? 'true' : 'false';

      const existingBadge = nameEl.querySelector('.scoring__badge');
      if (state.playerId === playerId) {
        if (!existingBadge) {
          const badge = document.createElement('span');
          badge.className = 'scoring__badge';
          badge.textContent = 'You';
          nameEl.append(' ', badge);
        }
      } else if (existingBadge) {
        existingBadge.remove();
      }
    }

    const eliminated = eliminatedSet.has(playerId) || info.isSpectator === true;
    item.dataset.eliminated = eliminated ? 'true' : 'false';

    const eliminatedBadge = item.querySelector('[data-testid="scoring-eliminated"]');
    if (eliminatedBadge) {
      eliminatedBadge.hidden = !eliminated;
    }

    const bidEl = item.querySelector('[data-testid="scoring-bid"]');
    if (bidEl) {
      bidEl.textContent = Number.isFinite(result?.bid) ? `Bid ${result.bid}` : 'Bid —';
    }

    const actualEl = item.querySelector('[data-testid="scoring-actual"]');
    if (actualEl) {
      actualEl.textContent = Number.isFinite(result?.actual) ? `Won ${result.actual}` : 'Won —';
    }

    const deltaEl = item.querySelector('[data-testid="scoring-delta"]');
    if (deltaEl) {
      const livesLost = Number.isFinite(result?.livesLost) ? result.livesLost : null;
      deltaEl.textContent = formatDelta(livesLost);
      deltaEl.classList.toggle('scoring__delta--zero', livesLost === 0);
      deltaEl.classList.toggle('scoring__delta--loss', livesLost > 0);
    }

    const livesWrapper = item.querySelector('[data-testid="scoring-lives"]');
    const livesValueEl = item.querySelector('[data-testid="scoring-lives-value"]');
    const livesRemaining = Number.isFinite(result?.livesRemaining)
      ? result.livesRemaining
      : Number.isFinite(info?.lives)
        ? info.lives
        : null;

    if (livesValueEl) {
      const previous = Number.isFinite(Number(item.dataset.lives)) ? Number(item.dataset.lives) : null;
      livesValueEl.textContent = formatLives(livesRemaining);
      item.dataset.lives = Number.isFinite(livesRemaining) ? String(livesRemaining) : '';

      if (Number.isFinite(previous) && Number.isFinite(livesRemaining) && previous !== livesRemaining) {
        item.classList.remove('scoring__row--pulse');
        void item.offsetWidth; // restart animation
        item.classList.add('scoring__row--pulse');
      }
    }

    if (livesWrapper) {
      livesWrapper.dataset.state = Number.isFinite(livesRemaining)
        ? livesRemaining > 0
          ? 'alive'
          : 'empty'
        : 'unknown';
    }
  });

  pruneExtraRows(list, present);

  if (roundResults.receivedAt && viewState.lastResultTimestamp !== roundResults.receivedAt) {
    triggerHaptics();
    viewState.lastResultTimestamp = roundResults.receivedAt;
  }
};

export const init = async (context) => {
  const moduleRoot = context?.appRoot?.querySelector('[data-testid="module-root"]');
  if (!moduleRoot) {
    throw new Error('Scoring module requires a module root container.');
  }

  const store = context?.gameState;
  if (!store || typeof store.subscribe !== 'function') {
    throw new Error('Scoring module requires gameState store in context.');
  }

  const section = createTemplate();
  moduleRoot.append(section);

  const viewState = {
    lastResultTimestamp: null,
  };

  const unsubscribe = store.subscribe((state) => {
    try {
      renderRound({ state, section, viewState });
    } catch (error) {
      console.error('scoring.render_error', error);
    }
  });

  const destroy = () => {
    unsubscribe?.();
    section.remove();
  };

  return {
    destroy,
  };
};

registerModule(() => Promise.resolve({ init }));
