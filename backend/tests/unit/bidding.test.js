'use strict';

const {
  createBidRange,
  calculateValidBids,
  validateBid,
} = require('../../src/modules/gameLogic/bidding');

describe('gameLogic/bidding', () => {
  describe('createBidRange', () => {
    it('returns inclusive range from 0 to card count', () => {
      expect(createBidRange(3)).toEqual([0, 1, 2, 3]);
    });

    it('throws when card count is negative', () => {
      expect(() => createBidRange(-1)).toThrow(/card count/i);
    });
  });

  describe('calculateValidBids', () => {
    const cardCount = 2;
    const playerOrder = ['player-1', 'player-2', 'player-3'];

    it('returns full range for players who are not last bidder', () => {
      const result = calculateValidBids({
        cardCount,
        playerId: 'player-2',
        playerOrder,
        bids: {
          'player-1': 1,
        },
      });

      expect(result.validBids).toEqual([0, 1, 2]);
      expect(result.isLastBidder).toBe(false);
      expect(result.restrictedBid).toBeNull();
    });

    it('excludes restricted value for last bidder so totals avoid matching tricks', () => {
      const result = calculateValidBids({
        cardCount,
        playerId: 'player-3',
        playerOrder,
        bids: new Map([
          ['player-1', 0],
          ['player-2', 1],
        ]),
      });

      expect(result.isLastBidder).toBe(true);
      expect(result.restrictedBid).toBe(1);
      expect(result.validBids).toEqual([0, 2]);
    });

    it('marks blind round metadata when bidding happens during first round', () => {
      const result = calculateValidBids({
        cardCount: 1,
        playerId: 'player-2',
        playerOrder: ['player-1', 'player-2'],
        bids: { 'player-1': 0 },
        isBlindRound: true,
      });

      expect(result.metadata.isBlindRound).toBe(true);
      expect(result.metadata.blindReminder).toMatch(/cannot see/i);
      expect(result.isLastBidder).toBe(true);
      expect(result.restrictedBid).toBeNull();
      expect(result.validBids).toEqual([0, 1]);
      expect(result.metadata.lastBidderRestrictionApplied).toBe(false);
    });
  });

  describe('validateBid', () => {
    const playerOrder = ['player-1', 'player-2'];

    it('accepts bids that fall inside allowed range', () => {
      const outcome = validateBid({
        cardCount: 1,
        bid: 1,
        playerId: 'player-2',
        playerOrder,
        bids: { 'player-1': 1 },
      });

      expect(outcome.isValid).toBe(true);
      expect(outcome.reason).toBeNull();
      expect(outcome.details.restrictedBid).toBe(0);
    });

    it('rejects last-bidder choice that would make totals equal available tricks', () => {
      const outcome = validateBid({
        cardCount: 2,
        bid: 1,
        playerId: 'player-3',
        playerOrder: ['player-1', 'player-2', 'player-3'],
        bids: {
          'player-1': 0,
          'player-2': 1,
        },
      });

      expect(outcome.isValid).toBe(false);
      expect(outcome.reason).toMatch(/total bids cannot equal/i);
      expect(outcome.details.restrictedBid).toBe(1);
      expect(outcome.details.validBids).toEqual([0, 2]);
    });

    it('allows last bidder to match total during blind round', () => {
      const outcome = validateBid({
        cardCount: 1,
        bid: 1,
        playerId: 'player-2',
        playerOrder: ['player-1', 'player-2'],
        bids: {
          'player-1': 0,
        },
        isBlindRound: true,
      });

      expect(outcome.isValid).toBe(true);
      expect(outcome.reason).toBeNull();
      expect(outcome.details.restrictedBid).toBeNull();
      expect(outcome.details.validBids).toEqual([0, 1]);
      expect(outcome.details.metadata.lastBidderRestrictionApplied).toBe(false);
    });
  });
});
