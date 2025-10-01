'use strict';

const crypto = require('node:crypto');

const cardEngine = require('../../src/modules/cardEngine');
const Card = require('../../src/modules/cardEngine/Card');

describe('cardEngine', () => {
  describe('createDeck', () => {
    it('creates a 52-card deck with unique cards and no manilhas by default', () => {
      const deck = cardEngine.createDeck();

      expect(deck).toHaveLength(52);
      const identifiers = new Set(deck.map((card) => `${card.rank}-${card.suit}`));
      expect(identifiers.size).toBe(52);
      deck.forEach((card) => {
        expect(card.isManilha).toBe(false);
        expect(card.strength).toBe(Card.getBaseStrength(card.rank));
      });
    });
  });

  describe('shuffleDeck', () => {
    it('uses crypto.randomBytes for Fisher-Yates shuffling', () => {
      const deck = cardEngine.createDeck();
      const spy = jest.spyOn(crypto, 'randomBytes');

      const shuffled = cardEngine.shuffleDeck(deck);

      expect(shuffled).toHaveLength(deck.length);
      expect(shuffled).not.toBe(deck);
      expect(shuffled.map((card) => card.displayName)).toEqual(expect.arrayContaining(deck.map((card) => card.displayName)));
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('rejects biased random values to maintain uniform distribution', () => {
  const deck = cardEngine.createDeck().slice(0, 3);
  const values = [Buffer.from([0xff]), Buffer.from([0x02]), Buffer.from([0x01])];
      const stub = jest.fn(() => values.shift() || Buffer.from([0x00]));

      const shuffled = cardEngine.shuffleDeck(deck, { randomBytes: stub });

      expect(shuffled).toHaveLength(deck.length);
      expect(stub).toHaveBeenCalled();
  expect(stub.mock.calls.length).toBeGreaterThanOrEqual(deck.length);
    });

    it('produces diverse first cards across many shuffles', () => {
      const deck = cardEngine.createDeck();
      const iterations = 200;
      const firstCardCounts = new Map();

      for (let i = 0; i < iterations; i += 1) {
        const shuffled = cardEngine.shuffleDeck(deck);
        const first = shuffled[0].displayName;
        firstCardCounts.set(first, (firstCardCounts.get(first) || 0) + 1);
      }

      expect(firstCardCounts.size).toBeGreaterThan(40);
      const maxSeen = Math.max(...firstCardCounts.values());
      expect(maxSeen).toBeLessThanOrEqual(15);
    });
  });

  describe('vira and manilha mechanics', () => {
    it('draws vira card and determines manilha rank', () => {
      const deck = cardEngine.createDeck();
      const shuffled = cardEngine.shuffleDeck(deck);

      const { viraCard, remainingDeck, manilhaRank } = cardEngine.drawVira(shuffled);

      expect(remainingDeck).toHaveLength(shuffled.length - 1);
      expect(remainingDeck.find((card) => card.displayName === viraCard.displayName)).toBeUndefined();
      expect(manilhaRank).toBe(Card.getManilhaRank(viraCard.rank));
    });

    it('applies vira to cards and flags manilhas with suit hierarchy', () => {
      const deck = [new Card('A', 'clubs'), new Card('4', 'clubs'), new Card('4', 'hearts')];
      const updated = cardEngine.applyViraToCards(deck, '3');

      const manilhas = updated.filter((card) => card.isManilha);
      expect(manilhas).toHaveLength(2);
      expect(manilhas[0].rank).toBe('4');
      expect(manilhas[0].strength).toBeGreaterThan(100);

      const clubs = manilhas.find((card) => card.suit === 'clubs');
      const hearts = manilhas.find((card) => card.suit === 'hearts');
      expect(clubs.strength).toBeGreaterThan(hearts.strength);
    });
  });

  describe('compareCards', () => {
    it('compares cards considering manilha rules and suit hierarchy', () => {
      const viraRank = '7';
      const manilhaRank = cardEngine.determineManilhaRank(viraRank);

      const ace = new Card('A', 'spades');
      const manilhaHearts = new Card(manilhaRank, 'hearts');
      const manilhaClubs = new Card(manilhaRank, 'clubs');

      ace.applyVira(viraRank);
      manilhaHearts.applyVira(viraRank);
      manilhaClubs.applyVira(viraRank);

      expect(cardEngine.compareCards(manilhaHearts, ace, viraRank)).toBe(1);
      expect(cardEngine.compareCards(ace, manilhaHearts, viraRank)).toBe(-1);
      expect(cardEngine.compareCards(manilhaClubs, manilhaHearts, viraRank)).toBe(1);
      expect(cardEngine.compareCards(manilhaHearts, manilhaClubs, viraRank)).toBe(-1);

      const nineHearts = new Card('9', 'hearts');
      const nineSpades = new Card('9', 'spades');
      expect(cardEngine.compareCards(nineHearts, nineSpades, viraRank)).toBe(0);
    });
  });

  describe('determineManilhaRank', () => {
    it('returns the next rank with wrap-around for 3 to 4', () => {
      expect(cardEngine.determineManilhaRank('J')).toBe('Q');
      expect(cardEngine.determineManilhaRank('3')).toBe('4');
    });
  });
});
