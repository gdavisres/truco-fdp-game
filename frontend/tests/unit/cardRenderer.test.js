import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CARD_THEMES,
  calculateContrastRatio,
  createCardElement,
  renderHand,
} from '../../src/modules/cardRenderer/index.js';

const baseCard = {
  rank: 'A',
  suit: 'spades',
  displayName: 'A♠',
  strength: 11,
  isManilha: false,
};

describe('cardRenderer module', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="board"></div>';
  });

  it('creates accessible card elements with metadata and strength badge', () => {
    const cardEl = createCardElement(baseCard);

    expect(cardEl.classList.contains('card-tile')).toBe(true);
    expect(cardEl.getAttribute('aria-label')).toMatch(/A of spades/i);
    expect(cardEl.dataset.rank).toBe('A');
    expect(cardEl.dataset.suit).toBe('spades');
    expect(cardEl.dataset.strength).toBe('11');

    const strengthEl = cardEl.querySelector('[data-testid="card-strength"]');
    expect(strengthEl).not.toBeNull();
    expect(strengthEl.textContent).toBe('11');
  });

  it('renders hidden cards face down without exposing strength', () => {
    const cardEl = createCardElement({ ...baseCard, hidden: true });

    expect(cardEl.classList.contains('card-tile--hidden')).toBe(true);
    expect(cardEl.getAttribute('data-rank')).toBe('hidden');
    expect(cardEl.querySelector('.card-tile__backLabel')).not.toBeNull();
    expect(cardEl.querySelector('[data-testid="card-strength"]')).toBeNull();
  });

  it('marks manilha cards with a visual badge', () => {
    const card = { ...baseCard, rank: '4', suit: 'clubs', isManilha: true, strength: 120 };
    const cardEl = createCardElement(card);

    expect(cardEl.dataset.manilha).toBe('true');
    const badge = cardEl.querySelector('[data-testid="manilha-indicator"]');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toMatch(/manilha/i);
  });

  it('wires tap and drag interactions when enabled', () => {
    if (typeof window.PointerEvent === 'undefined') {
      window.PointerEvent = class PointerEvent extends window.MouseEvent {
        constructor(type, props) {
          super(type, props);
          this.pointerId = props?.pointerId ?? 1;
          this.pointerType = props?.pointerType ?? 'touch';
        }
      };
    }

    const handlers = {
      onTap: vi.fn(),
      onDragStart: vi.fn(),
      onDragMove: vi.fn(),
      onDragEnd: vi.fn(),
    };

    const cardEl = createCardElement(baseCard, { interactive: handlers });
    document.body.appendChild(cardEl);

    cardEl.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        pointerId: 1,
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );

    cardEl.dispatchEvent(
      new window.PointerEvent('pointerup', {
        pointerId: 1,
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(handlers.onTap).toHaveBeenCalledTimes(1);

    const dragEl = createCardElement(baseCard, { interactive: handlers });
    document.body.appendChild(dragEl);

    dragEl.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        pointerId: 2,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );

    dragEl.dispatchEvent(
      new window.PointerEvent('pointermove', {
        pointerId: 2,
        bubbles: true,
        clientX: 40,
        clientY: 20,
      }),
    );

    dragEl.dispatchEvent(
      new window.PointerEvent('pointerup', {
        pointerId: 2,
        bubbles: true,
        clientX: 40,
        clientY: 20,
      }),
    );

    expect(handlers.onDragStart).toHaveBeenCalled();
    expect(handlers.onDragMove).toHaveBeenCalled();
    expect(handlers.onDragEnd).toHaveBeenCalled();
  });

  it('renders card hands with sequential dealing delays', () => {
    const container = document.getElementById('board');
    const cards = [
      baseCard,
      { ...baseCard, rank: 'K', suit: 'hearts', displayName: 'K♥', strength: 10 },
      { ...baseCard, rank: '4', suit: 'clubs', displayName: '4♣', isManilha: true, strength: 120 },
    ];

    const hand = renderHand(container, cards, { interactive: false });

    expect(hand.classList.contains('card-hand')).toBe(true);
    const renderedCards = hand.querySelectorAll('.card-tile');
    expect(renderedCards).toHaveLength(cards.length);
    expect(renderedCards[1].style.getPropertyValue('--deal-delay')).toBe('80ms');
    expect(renderedCards[2].style.getPropertyValue('--deal-delay')).toBe('160ms');
  });

  it('ensures theme colors respect WCAG AA contrast requirements', () => {
    for (const theme of Object.values(CARD_THEMES)) {
      expect(calculateContrastRatio(theme.background, theme.foreground)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(theme.badgeBackground, theme.badgeForeground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
