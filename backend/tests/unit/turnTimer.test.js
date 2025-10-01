'use strict';

const {
  MIN_TURN_TIMER_SECONDS,
  MAX_TURN_TIMER_SECONDS,
  DEFAULT_TURN_TIMER_SECONDS,
  clampTurnTimerSeconds,
  calculateDeadline,
  getTimeLeftSeconds,
  selectAutoBid,
  selectAutoCard,
} = require('../../src/modules/gameLogic/turnTimer');

const createRoundFixture = () => ({
  hands: {
    alpha: [
      { rank: '4', suit: 'clubs' },
      { rank: 'J', suit: 'hearts' },
      { rank: '7', suit: 'spades' },
    ],
  },
});

const createTrickFixture = () => ({
  trickNumber: 1,
  leadPlayer: 'alpha',
  cardsPlayed: {},
});

describe('turnTimer module', () => {
  describe('clampTurnTimerSeconds', () => {
    it('returns fallback for non-numeric values', () => {
      expect(clampTurnTimerSeconds('abc')).toBe(DEFAULT_TURN_TIMER_SECONDS);
    });

    it('rounds down and clamps within bounds', () => {
      expect(clampTurnTimerSeconds(4.9)).toBe(MIN_TURN_TIMER_SECONDS);
      expect(clampTurnTimerSeconds(12.8)).toBe(12);
      expect(clampTurnTimerSeconds(45)).toBe(MAX_TURN_TIMER_SECONDS);
    });
  });

  describe('calculateDeadline', () => {
    it('returns null for invalid durations', () => {
      expect(calculateDeadline(-1)).toBeNull();
      expect(calculateDeadline('foo')).toBeNull();
    });

    it('returns expected timestamp for valid duration', () => {
      const now = 1_000;
      expect(calculateDeadline(5, now)).toBe(6_000);
    });
  });

  describe('getTimeLeftSeconds', () => {
    it('returns zero when deadline elapsed or invalid', () => {
      expect(getTimeLeftSeconds(undefined)).toBe(0);
      expect(getTimeLeftSeconds(900, 1_000)).toBe(0);
    });

    it('rounds up remaining seconds', () => {
      expect(getTimeLeftSeconds(10_000, 8_501)).toBe(2);
      expect(getTimeLeftSeconds(10_000, 8_000)).toBe(2);
    });
  });

  describe('selectAutoBid', () => {
    it('returns first available bid when list provided', () => {
      expect(selectAutoBid([3, 4, 5])).toBe(3);
    });

    it('falls back to zero when list invalid or empty', () => {
      expect(selectAutoBid()).toBe(0);
      expect(selectAutoBid([])).toBe(0);
    });
  });

  describe('selectAutoCard', () => {
    const validator = jest.fn((payload) => ({ isValid: payload.card.rank !== '7' }));

    beforeEach(() => {
      validator.mockClear();
    });

    it('returns null when hand empty', () => {
      expect(selectAutoCard({ hand: [], validateCardPlay: validator })).toBeNull();
    });

    it('returns first valid card according to validator', () => {
      const round = createRoundFixture();
      const trick = createTrickFixture();
      const card = selectAutoCard({
        hand: round.hands.alpha,
        round,
        trick,
        playerId: 'alpha',
        expectedPlayerId: 'alpha',
        validateCardPlay: validator,
      });

      expect(card).toEqual({ rank: '4', suit: 'clubs' });
      expect(validator).toHaveBeenCalled();
    });

    it('falls back to first card when validator rejects all', () => {
      const round = createRoundFixture();
      const trick = createTrickFixture();
      const card = selectAutoCard({
        hand: round.hands.alpha,
        round,
        trick,
        playerId: 'alpha',
        expectedPlayerId: 'alpha',
        validateCardPlay: () => ({ isValid: false }),
      });

      expect(card).toEqual({ rank: '4', suit: 'clubs' });
    });
  });
});
