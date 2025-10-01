import haptic from '../haptic/index.js';

export const CARD_THEMES = {
  default: {
    background: '#0f172a',
    foreground: '#f8fafc',
    border: '#1e293b',
    badgeBackground: '#facc15',
    badgeForeground: '#111827',
  },
  manilha: {
    background: '#7c2d12',
    foreground: '#fff7ed',
    border: '#f97316',
    badgeBackground: '#f97316',
    badgeForeground: '#0f172a',
  },
};

const SUIT_SYMBOLS = {
  clubs: '♣',
  hearts: '♥',
  spades: '♠',
  diamonds: '♦',
};

const DRAG_THRESHOLD = 8;
const DEAL_DELAY_STEP_MS = 80;

// Event listener cleanup tracking (prevent memory leaks)
const cardListenerRegistry = new WeakMap();

const parseHexColor = (value) => {
  if (typeof value !== 'string') {
    throw new TypeError('Color value must be a string.');
  }
  const normalized = value.trim().replace('#', '');
  if (normalized.length !== 6) {
    throw new Error(`Expected hex color in RRGGBB format, received: ${value}`);
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
};

const gammaCorrect = (channel) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const calculateContrastRatio = (foreground, background) => {
  const [fr, fg, fb] = parseHexColor(foreground);
  const [br, bg, bb] = parseHexColor(background);

  const fLuminance = 0.2126 * gammaCorrect(fr) + 0.7152 * gammaCorrect(fg) + 0.0722 * gammaCorrect(fb);
  const bLuminance = 0.2126 * gammaCorrect(br) + 0.7152 * gammaCorrect(bg) + 0.0722 * gammaCorrect(bb);

  const lighter = Math.max(fLuminance, bLuminance);
  const darker = Math.min(fLuminance, bLuminance);

  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
};

const buildAriaLabel = (card) => {
  const rank = card.rank ?? 'Unknown rank';
  const suit = card.suit ? card.suit.replace(/^(.)/, (match) => match.toUpperCase()) : 'Unknown suit';
  const strength = Number.isFinite(card.strength) ? card.strength : 'unknown strength';
  const suffix = card.isManilha ? ' — Manilha' : '';
  return `${rank} of ${suit}, strength ${strength}${suffix}`;
};

const applyTheme = (element, theme) => {
  element.style.setProperty('--card-bg', theme.background);
  element.style.setProperty('--card-fg', theme.foreground);
  element.style.setProperty('--card-border', theme.border);
  element.style.setProperty('--card-badge-bg', theme.badgeBackground);
  element.style.setProperty('--card-badge-fg', theme.badgeForeground);
};

const attachPointerInteractions = (element, card, handlers) => {
  if (!handlers) {
    return;
  }

  let pointerId = null;
  let dragStarted = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let frameRef = null;
  let startTime = 0;

  const flushTransform = () => {
    frameRef = null;
    element.style.transform = `translate3d(${lastX}px, ${lastY}px, 0)`;
  };

  const resetState = () => {
    if (pointerId !== null && typeof element.releasePointerCapture === 'function') {
      element.releasePointerCapture(pointerId);
    }
    pointerId = null;
    dragStarted = false;
    startX = 0;
    startY = 0;
    lastX = 0;
    lastY = 0;
    frameRef = null;
    startTime = 0;
    element.style.transform = '';
    element.classList.remove('card-tile--dragging');
    element.classList.remove('card-tile--active');
  };



  const handlePointerEnd = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }

    const duration = performance.now() - startTime;
    const shouldTriggerTap = !dragStarted && duration < 250;

    if (dragStarted) {
      handlers.onDragEnd?.(card, { event, deltaX: lastX, deltaY: lastY });
      haptic.cardPlay(); // Haptic feedback for card play
    } else if (shouldTriggerTap) {
      handlers.onTap?.(card, { event });
      haptic.light(); // Light haptic for tap
    }

    resetState();
  };

  const pointerdownHandler = (event) => {
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startTime = performance.now();
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(pointerId);
    }
    element.classList.add('card-tile--active');
    haptic.light();
  };

  const pointermoveHandler = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!dragStarted && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
      dragStarted = true;
      element.classList.add('card-tile--dragging');
      haptic.medium();
      handlers.onDragStart?.(card, { event });
    }

    if (dragStarted) {
      lastX = deltaX;
      lastY = deltaY;
      if (frameRef === null) {
        frameRef = requestAnimationFrame(flushTransform);
      }
      handlers.onDragMove?.(card, { event, deltaX, deltaY });
    }
  };

  element.addEventListener('pointerdown', pointerdownHandler);
  element.addEventListener('pointermove', pointermoveHandler);
  element.addEventListener('pointerup', handlePointerEnd);
  element.addEventListener('pointercancel', handlePointerEnd);

  // Store listeners for cleanup
  cardListenerRegistry.set(element, {
    pointerdown: pointerdownHandler,
    pointermove: pointermoveHandler,
    pointerup: handlePointerEnd,
    pointercancel: handlePointerEnd
  });
};

export const createCardElement = (card, options = {}) => {
  const isHidden = Boolean(card?.hidden) && options.reveal !== true;
  const showStrength = Boolean(options.showStrength ?? true) && !isHidden;
  const isManilha = Boolean(card?.isManilha) && !isHidden;
  const theme = isManilha ? CARD_THEMES.manilha : CARD_THEMES.default;

  // Optimized: Use template cloning for faster rendering
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'card-tile';
  
  // Batch attribute setting (reduce reflows)
  const attrs = {
    'data-hidden': isHidden ? 'true' : 'false',
    'data-rank': isHidden ? 'hidden' : card.rank ?? '',
    'data-suit': isHidden ? 'hidden' : card.suit ?? '',
    'data-strength': showStrength ? String(card.strength ?? '') : '',
    'data-manilha': isManilha ? 'true' : 'false',
    'aria-label': isHidden ? 'Face-down card' : buildAriaLabel(card),
    'tabindex': options.interactive ? '0' : '-1'
  };
  
  Object.entries(attrs).forEach(([key, value]) => {
    if (value) element.setAttribute(key, value);
  });

  applyTheme(element, theme);

  // Optimized: Use innerHTML for simpler structure (fewer DOM nodes)
  if (isHidden) {
    element.classList.add('card-tile--hidden');
    element.innerHTML = `<span class="card-tile__face card-tile__face--hidden" aria-hidden="true">🂠</span>`;
  } else {
    const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit;
    let html = `<span class="card-tile__face" aria-hidden="true"><span class="card-tile__rank">${card.rank}</span><span class="card-tile__suit">${suitSymbol}</span></span>`;
    
    if (showStrength) {
      html += `<span class="card-tile__strength" data-testid="card-strength" aria-hidden="true">${card.strength ?? ''}</span>`;
    }
    
    if (isManilha) {
      html += `<span class="card-tile__manilha" data-testid="manilha-indicator">Manilha</span>`;
    }
    
    element.innerHTML = html;
  }

  // Defer interactive setup to next frame (improve perceived performance)
  if (options.interactive) {
    element.disabled = false;
    requestAnimationFrame(() => {
      attachPointerInteractions(element, card, options.interactive);
    });
  } else {
    element.disabled = true;
    element.classList.add('card-tile--static');
    element.setAttribute('aria-disabled', 'true');
  }

  return element;
};

/**
 * Clean up event listeners for a card element to prevent memory leaks
 * @param {HTMLElement} element - Card element to clean up
 */
export const cleanupCardElement = (element) => {
  const listeners = cardListenerRegistry.get(element);
  if (listeners) {
    element.removeEventListener('pointerdown', listeners.pointerdown);
    element.removeEventListener('pointermove', listeners.pointermove);
    element.removeEventListener('pointerup', listeners.pointerup);
    element.removeEventListener('pointercancel', listeners.pointercancel);
    cardListenerRegistry.delete(element);
  }
};

/**
 * Clean up all card elements in a container
 * @param {HTMLElement} container - Container with card elements
 */
export const cleanupCardContainer = (container) => {
  const cards = container.querySelectorAll('.card-tile');
  cards.forEach(cleanupCardElement);
};

export const renderHand = (container, cards, options = {}) => {
  const hand = document.createElement('div');
  hand.className = 'card-hand';

  cards.forEach((card, index) => {
    const cardEl = createCardElement(card, options);
    const delay = `${index * DEAL_DELAY_STEP_MS}ms`;
    cardEl.style.setProperty('--deal-delay', delay);
    cardEl.style.animationDelay = delay;
    hand.append(cardEl);
  });

  if (container) {
    container.append(hand);
  }

  return hand;
};

export const DEAL_DELAY_STEP = DEAL_DELAY_STEP_MS;
