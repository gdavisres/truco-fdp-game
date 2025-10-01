'use strict';

const {
  validateCardPlay,
  createTrickState,
  recordCardPlay,
  resolveTrick,
  removeCardFromHand,
} = require('../../src/modules/gameLogic/tricks');

const createRound = (handsByPlayer) => ({
  hands: new Map(Object.entries(handsByPlayer)),
});

describe('gameLogic/tricks', () => {
  describe('validateCardPlay', () => {
    const round = createRound({
      'player-1': [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
      ],
      'player-2': [
        { rank: '9', suit: 'clubs' },
      ],
    });

    it('accepts plays when card is in hand and turn matches', () => {
      const result = validateCardPlay({
        round,
        trick: createTrickState({ trickNumber: 1, leadPlayer: 'player-1' }),
        playerId: 'player-1',
        expectedPlayerId: 'player-1',
        card: { rank: 'A', suit: 'spades' },
      });

      expect(result.isValid).toBe(true);
      expect(result.code).toBeNull();
    });

    it('rejects plays for cards not in the player hand', () => {
      const result = validateCardPlay({
        round,
        trick: createTrickState({ trickNumber: 1, leadPlayer: 'player-1' }),
        playerId: 'player-1',
        card: { rank: '3', suit: 'diamonds' },
      });

      expect(result.isValid).toBe(false);
      expect(result.code).toBe('card_not_in_hand');
    });

    it('rejects plays when attempting out of turn', () => {
      const result = validateCardPlay({
        round,
        trick: createTrickState({ trickNumber: 1, leadPlayer: 'player-1' }),
        playerId: 'player-2',
        expectedPlayerId: 'player-1',
        card: { rank: '9', suit: 'clubs' },
      });

      expect(result.isValid).toBe(false);
      expect(result.code).toBe('not_players_turn');
    });

    it('rejects plays when player already contributed to trick', () => {
      const trick = createTrickState({ trickNumber: 1, leadPlayer: 'player-1' });
      recordCardPlay(trick, {
        playerId: 'player-2',
        card: { rank: '9', suit: 'clubs' },
      });

      const result = validateCardPlay({
        round,
        trick,
        playerId: 'player-2',
        card: { rank: '9', suit: 'clubs' },
      });

      expect(result.isValid).toBe(false);
      expect(result.code).toBe('card_already_played');
    });
  });

  describe('resolveTrick', () => {
    it('cancels matching ranks and selects highest remaining card', () => {
      const trick = createTrickState({ trickNumber: 1, leadPlayer: 'player-1' });
      recordCardPlay(trick, {
        playerId: 'player-1',
        card: { rank: 'A', suit: 'hearts' },
      });
      recordCardPlay(trick, {
        playerId: 'player-2',
        card: { rank: 'A', suit: 'clubs' },
      });
      recordCardPlay(trick, {
        playerId: 'player-3',
        card: { rank: '3', suit: 'spades' },
      });

      const result = resolveTrick({ trick, viraRank: '4' });

      expect(result.winner).toBe('player-3');
      expect(result.cancelledCards).toHaveLength(2);
      expect(result.cancelledCards.map((card) => card.rank)).toEqual(['A', 'A']);
    });

    it('preserves manilha contests and respects suit hierarchy', () => {
      const trick = createTrickState({ trickNumber: 1, leadPlayer: 'player-1' });
      recordCardPlay(trick, {
        playerId: 'player-1',
        card: { rank: 'Q', suit: 'diamonds' },
      });
      recordCardPlay(trick, {
        playerId: 'player-2',
        card: { rank: 'Q', suit: 'clubs' },
      });
      recordCardPlay(trick, {
        playerId: 'player-3',
        card: { rank: '3', suit: 'hearts' },
      });

      const result = resolveTrick({ trick, viraRank: 'J' });

      expect(result.winner).toBe('player-2');
      expect(result.cancelledCards).toHaveLength(0);
      expect(result.winningCard.suit).toBe('clubs');
      expect(result.winningCard.isManilha).toBe(true);
    });

    it('returns null winner when all cards cancel out', () => {
      const trick = createTrickState({ trickNumber: 1, leadPlayer: 'player-1' });
      recordCardPlay(trick, {
        playerId: 'player-1',
        card: { rank: 'K', suit: 'hearts' },
      });
      recordCardPlay(trick, {
        playerId: 'player-2',
        card: { rank: 'K', suit: 'clubs' },
      });
      recordCardPlay(trick, {
        playerId: 'player-3',
        card: { rank: 'K', suit: 'spades' },
      });

      const result = resolveTrick({ trick, viraRank: '4' });

      expect(result.winner).toBeNull();
      expect(result.cancelledCards).toHaveLength(3);
    });
  });

  describe('removeCardFromHand', () => {
    it('removes a matching card and returns updated hand', () => {
      const hand = [
        { rank: 'A', suit: 'spades' },
        { rank: '7', suit: 'hearts' },
      ];

      const { hand: updated, removed } = removeCardFromHand(hand, { rank: 'A', suit: 'spades' });

      expect(updated).toHaveLength(1);
      expect(updated[0].rank).toBe('7');
      expect(removed.rank).toBe('A');
      expect(hand).toHaveLength(2);
    });

    it('returns original hand when card not found', () => {
      const hand = [
        { rank: 'A', suit: 'spades' },
      ];

      const { hand: updated, removed } = removeCardFromHand(hand, { rank: '3', suit: 'hearts' });

      expect(updated).toHaveLength(1);
      expect(updated[0].rank).toBe('A');
      expect(removed).toBeNull();
    });
  });
});
