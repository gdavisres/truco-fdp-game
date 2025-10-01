'use strict';

const Card = require('../../src/modules/cardEngine/Card');

describe('Card', () => {
  it('creates a card with display name and base strength', () => {
    const card = new Card('7', 'hearts');

    expect(card.rank).toBe('7');
    expect(card.suit).toBe('hearts');
    expect(card.displayName).toBe('7♥');
    expect(card.isManilha).toBe(false);
    expect(card.strength).toBe(Card.getBaseStrength('7'));
  });

  it('throws when constructed with invalid rank or suit', () => {
    expect(() => new Card('1', 'hearts')).toThrow(/Invalid rank/i);
    expect(() => new Card('4', 'stars')).toThrow(/Invalid suit/i);
  });

  it('determines the manilha rank based on vira card', () => {
    expect(Card.getManilhaRank('7')).toBe('8');
    expect(Card.getManilhaRank('3')).toBe('4');
  });

  it('detects manilha cards correctly', () => {
    expect(Card.isManilhaRank('8', '7')).toBe(true);
    expect(Card.isManilhaRank('4', '3')).toBe(true);
    expect(Card.isManilhaRank('A', 'K')).toBe(true);
    expect(Card.isManilhaRank('9', 'Q')).toBe(false);
  });

  it('calculates strength with Brazilian Truco ranking', () => {
    const ace = Card.calculateStrength('A', 'spades');
    const two = Card.calculateStrength('2', 'spades');
    const three = Card.calculateStrength('3', 'spades');

    expect(ace).toBeGreaterThan(Card.calculateStrength('K', 'spades'));
    expect(two).toBeGreaterThan(ace);
    expect(three).toBeGreaterThan(two);
  });

  it('applies manilha bonuses based on vira card and suit hierarchy', () => {
    const card = new Card('4', 'clubs');
    card.applyVira('3');

    expect(card.isManilha).toBe(true);
    expect(card.strength).toBeGreaterThan(100);

    const heartsManilha = Card.calculateStrength('4', 'hearts', '3');
    const clubsManilha = Card.calculateStrength('4', 'clubs', '3');
    const diamondsManilha = Card.calculateStrength('4', 'diamonds', '3');

    expect(clubsManilha).toBeGreaterThan(heartsManilha);
    expect(heartsManilha).toBeGreaterThan(diamondsManilha);
  });

  it('removes manilha status when vira changes', () => {
    const card = new Card('Q', 'spades');
    card.applyVira('J');
    expect(card.isManilha).toBe(true);

    card.applyVira('Q');
    expect(card.isManilha).toBe(false);
    expect(card.strength).toBe(Card.getBaseStrength('Q'));
  });
});
