'use strict';

const {
  calculateRoundResults,
  determineNextCardCount,
  constants,
} = require('../../src/modules/gameLogic/rounds');

const { DEFAULT_DECK_SIZE, DEFAULT_VIRA_COUNT } = constants;

describe('round completion calculations', () => {
  it('calculates bids, actual tricks, and life loss per player', () => {
    const round = {
      bids: {
        alice: 2,
        bob: 1,
      },
      tricks: [
        { winner: 'alice' },
        { winner: 'bob' },
        { winner: 'alice' },
      ],
    };

    const playerOrder = ['alice', 'bob'];

    const results = calculateRoundResults({ round, playerOrder });

    expect(results.summary).toEqual({
      alice: {
        bid: 2,
        actual: 2,
        livesLost: 0,
      },
      bob: {
        bid: 1,
        actual: 1,
        livesLost: 0,
      },
    });
  });

  it('treats missing or invalid bids as zero and counts trick wins', () => {
    const round = {
      bids: new Map([
        ['alice', 3],
        ['bob', 'invalid'],
      ]),
      tricks: [
        { winner: 'carol' },
        { winner: 'carol' },
        { winner: 'alice' },
        { winner: 'carol' },
      ],
    };

    const playerOrder = ['alice', 'bob', 'carol'];

    const results = calculateRoundResults({ round, playerOrder });

    expect(results.summary).toEqual({
      alice: {
        bid: 3,
        actual: 1,
        livesLost: 2,
      },
      bob: {
        bid: 0,
        actual: 0,
        livesLost: 0,
      },
      carol: {
        bid: 0,
        actual: 3,
        livesLost: 3,
      },
    });
  });
});

describe('card count progression', () => {
  it('increments card count while respecting deck capacity', () => {
    const playerCount = 4;
    const availablePerPlayer = Math.floor((DEFAULT_DECK_SIZE - DEFAULT_VIRA_COUNT) / playerCount);

    const next = determineNextCardCount({ previousCardCount: 1, playerCount });
    expect(next).toBe(2);

    const capped = determineNextCardCount({ previousCardCount: availablePerPlayer, playerCount });
    expect(capped).toBe(availablePerPlayer);
  });

  it('returns previous card count when no active players remain', () => {
    const result = determineNextCardCount({ previousCardCount: 3, playerCount: 0 });
    expect(result).toBe(3);
  });
});
