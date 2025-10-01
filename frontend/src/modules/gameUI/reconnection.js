import '../../css/reconnection.css';
import { registerModule } from '../moduleRegistry.js';

const BASE_RETRY_DELAY_MS = 750;
const MAX_RETRY_DELAY_MS = 4000;
const SUCCESS_FADE_DELAY_MS = 1200;
const COUNTDOWN_INTERVAL_MS = 250;

const clampNumber = (value, { min = 0, max = Number.POSITIVE_INFINITY } = {}) => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const computeRetryDelay = (attempt) => {
  const normalized = clampNumber(attempt ?? 1, { min: 1, max: 8 });
  return clampNumber(BASE_RETRY_DELAY_MS * normalized, {
    min: BASE_RETRY_DELAY_MS,
    max: MAX_RETRY_DELAY_MS,
  });
};

const createTemplate = () => {
  const section = document.createElement('section');
  section.className = 'connection-banner';
  section.dataset.testid = 'connection-banner';
  section.dataset.state = 'hidden';
  section.dataset.variant = 'info';
  section.setAttribute('role', 'status');
  section.setAttribute('aria-live', 'assertive');

  section.innerHTML = `
    <div class="connection-banner__row">
      <span class="connection-banner__icon" aria-hidden="true"></span>
      <div class="connection-banner__content">
        <p class="connection-banner__title" data-testid="connection-title">Connecting…</p>
        <p class="connection-banner__message">
          <span data-testid="connection-detail">Establishing a stable connection…</span>
          <span class="connection-banner__countdown" data-testid="connection-countdown" hidden></span>
        </p>
      </div>
    </div>
    <div class="connection-banner__actions">
      <button class="connection-banner__button" data-testid="connection-action" type="button" hidden>Retry now</button>
      <p class="connection-banner__tips" data-testid="connection-tip" hidden></p>
    </div>
  `;

  return section;
};

const setVisibility = (root, visible) => {
  if (!root) {
    return;
  }

  if (visible) {
    root.dataset.state = 'visible';
  } else {
    root.dataset.state = 'hidden';
  }
};

const setVariant = (root, variant) => {
  if (!root) {
    return;
  }

  const allowed = new Set(['info', 'warning', 'error']);
  root.dataset.variant = allowed.has(variant) ? variant : 'info';
};

const setTitle = (element, text) => {
  if (element) {
    element.textContent = text;
  }
};

const setDetail = (element, text) => {
  if (element) {
    element.textContent = text;
  }
};

const setCountdown = (element, remainingMs) => {
  if (!element) {
    return;
  }

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    element.hidden = true;
    element.textContent = '';
    return;
  }

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  element.hidden = false;
  element.textContent = `Retrying in ${seconds}s`;
};

const setTip = (element, text) => {
  if (!element) {
    return;
  }

  if (text) {
    element.textContent = text;
    element.hidden = false;
  } else {
    element.textContent = '';
    element.hidden = true;
  }
};

const setAction = (button, { label, hidden } = {}) => {
  if (!button) {
    return;
  }

  if (label) {
    button.textContent = label;
  }

  if (hidden) {
    button.hidden = true;
    button.disabled = true;
  } else {
    button.hidden = false;
    button.disabled = false;
  }
};

export const init = async (context) => {
  const appRoot = context?.appRoot;
  if (!appRoot) {
    throw new Error('Reconnection module requires an app root container.');
  }

  const networkClient = context?.networkClient;
  if (!networkClient || typeof networkClient.on !== 'function') {
    throw new Error('Reconnection module requires a network client that supports event subscriptions.');
  }

  const store = context?.gameState;
  if (!store || typeof store.subscribe !== 'function') {
    throw new Error('Reconnection module requires access to the shared gameState store.');
  }

  const banner = createTemplate();
  appRoot.append(banner);

  const titleEl = banner.querySelector('[data-testid="connection-title"]');
  const detailEl = banner.querySelector('[data-testid="connection-detail"]');
  const countdownEl = banner.querySelector('[data-testid="connection-countdown"]');
  const actionButton = banner.querySelector('[data-testid="connection-action"]');
  const tipEl = banner.querySelector('[data-testid="connection-tip"]');

  const viewState = {
    status: 'connected',
    offline: false,
    dismissTimer: null,
    countdownTimer: null,
    countdownTarget: null,
  };

  const clearDismissTimer = () => {
    if (viewState.dismissTimer) {
      clearTimeout(viewState.dismissTimer);
      viewState.dismissTimer = null;
    }
  };

  const clearCountdown = () => {
    if (viewState.countdownTimer) {
      clearInterval(viewState.countdownTimer);
      viewState.countdownTimer = null;
    }
    viewState.countdownTarget = null;
    setCountdown(countdownEl, 0);
  };

  const scheduleCountdown = (durationMs) => {
    clearCountdown();
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return;
    }

    viewState.countdownTarget = Date.now() + durationMs;
    setCountdown(countdownEl, durationMs);

    viewState.countdownTimer = setInterval(() => {
      const remaining = viewState.countdownTarget - Date.now();
      if (remaining <= 0) {
        clearCountdown();
        setCountdown(countdownEl, 0);
        return;
      }
      setCountdown(countdownEl, remaining);
    }, COUNTDOWN_INTERVAL_MS);
  };

  const hideBanner = () => {
    clearDismissTimer();
    clearCountdown();
    setVisibility(banner, false);
  };

  const showBanner = (variant, title, detail) => {
    clearDismissTimer();
    setVariant(banner, variant);
    setTitle(titleEl, title);
    setDetail(detailEl, detail);
    setVisibility(banner, true);
  };

  const handleStatusChange = ({ status, attempt, reason, lastError, error } = {}) => {
    viewState.status = status;

    switch (status) {
      case 'connected':
      case 'reconnected': {
        if (viewState.offline) {
          showBanner('info', 'Reconnected', 'Syncing your game state…');
          setAction(actionButton, { hidden: true });
          clearCountdown();
          clearDismissTimer();
          viewState.dismissTimer = setTimeout(() => {
            hideBanner();
          }, SUCCESS_FADE_DELAY_MS);
        } else {
          hideBanner();
        }
        break;
      }
      case 'connecting': {
        showBanner('info', 'Connecting…', 'Establishing a stable connection…');
        setAction(actionButton, { hidden: true });
        clearCountdown();
        break;
      }
      case 'reconnecting': {
        const currentAttempt = clampNumber(attempt ?? 1, { min: 1, max: 8 });
        showBanner('warning', 'Reconnecting…', `Attempt ${currentAttempt}. Hold tight while we restore your seat.`);
        setAction(actionButton, { label: 'Retry now', hidden: false });
        scheduleCountdown(computeRetryDelay(currentAttempt));
        break;
      }
      case 'disconnected': {
        const detail = reason ? `Disconnected (${reason}). Attempting to reconnect…` : 'Disconnected. Attempting to reconnect…';
        showBanner('error', 'Connection lost', detail);
        setAction(actionButton, { label: 'Reconnect now', hidden: false });
        scheduleCountdown(computeRetryDelay(attempt ?? 1));
        break;
      }
      case 'offline': {
        showBanner('error', 'Offline', 'Waiting for your network connection to return…');
        setAction(actionButton, { label: 'Try again', hidden: false });
        clearCountdown();
        break;
      }
      case 'error': {
        const description = lastError || error || 'Unexpected socket error encountered.';
        showBanner('error', 'Connection issue', description);
        setAction(actionButton, { label: 'Retry', hidden: false });
        clearCountdown();
        break;
      }
      default: {
        hideBanner();
        break;
      }
    }
  };

  const handleOfflineHint = (state) => {
    viewState.offline = Boolean(state?.offline);
    if (viewState.offline) {
      setTip(tipEl, 'Gameplay paused while we reconnect you to the table.');
    } else {
      setTip(tipEl, '');
      if (viewState.status === 'connected' || viewState.status === 'reconnected') {
        hideBanner();
      }
    }
  };

  const unsubscribes = [];

  const subscribeNetwork = (event, handler) => {
    const dispose = networkClient.on(event, handler);
    if (typeof dispose === 'function') {
      unsubscribes.push(dispose);
    }
  };

  const cleanup = () => {
    clearDismissTimer();
    clearCountdown();
    unsubscribes.splice(0).forEach((dispose) => {
      try {
        dispose();
      } catch (error) {
        // ignore cleanup errors
      }
    });
    storeUnsubscribe?.();
    actionButton?.removeEventListener('click', handleActionClick);
    try {
      banner.remove();
    } catch (error) {
      // ignore DOM removal errors
    }
  };

  const handleActionClick = () => {
    try {
      if (typeof networkClient.connect === 'function') {
        networkClient.connect();
      }
      showBanner('info', 'Reconnecting…', 'Trying to restore your seat right away.');
      setAction(actionButton, { hidden: true });
      clearCountdown();
    } catch (error) {
      showBanner('error', 'Retry failed', error?.message ?? 'Unable to restart connection.');
      setAction(actionButton, { label: 'Retry again', hidden: false });
    }
  };

  actionButton?.addEventListener('click', handleActionClick);

  const storeUnsubscribe = store.subscribe((state) => handleOfflineHint(state));
  handleOfflineHint(store.getState());

  subscribeNetwork('status', handleStatusChange);
  subscribeNetwork('reconnect_attempt', ({ attempt }) => {
    if (viewState.status === 'reconnecting') {
      scheduleCountdown(computeRetryDelay(attempt ?? 1));
      setDetail(detailEl, `Attempt ${clampNumber(attempt ?? 1, { min: 1, max: 8 })}. Hold tight while we restore your seat.`);
    }
  });
  subscribeNetwork('network_offline', () => {
    handleStatusChange({ status: 'offline' });
  });
  subscribeNetwork('connection_status', (payload = {}) => {
    if (payload.status) {
      handleStatusChange(payload);
    }
  });

  return {
    destroy: cleanup,
  };
};

registerModule(async () => ({ init }));
