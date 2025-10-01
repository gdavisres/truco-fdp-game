'use strict';

const { GameState } = require('../../src/modules/stateManager');

describe('GameState', () => {
  const playerOrder = ['player-1', 'player-2', 'player-3'];

  const createHands = () =>
    new Map([
      ['player-1', [{ rank: 'A', suit: 'clubs' }]],
      ['player-2', [{ rank: 'K', suit: 'hearts' }]],
      ['player-3', [{ rank: '4', suit: 'spades' }]],
    ]);

  it('initializes in waiting phase with player turn tracking', () => {
    const state = new GameState({ roomId: 'itajuba', playerOrder });

    expect(state.currentPhase).toBe('waiting');
    expect(state.getCurrentPlayer()).toBe('player-1');
    state.advanceTurn();
    expect(state.getCurrentPlayer()).toBe('player-2');

    state.setCurrentPlayer('player-3');
    expect(state.getCurrentPlayer()).toBe('player-3');
    expect(() => state.setCurrentPlayer('unknown')).toThrow(/Player unknown/i);
  });

  it('enforces allowed phase transitions', () => {
    const state = new GameState({ roomId: 'itajuba', playerOrder });

    expect(() => state.setPhase('playing')).toThrow(/Cannot transition/i);

    state.startRound({
      cardCount: 1,
      viraCard: { rank: '7', suit: 'diamonds' },
      manilhaRank: '8',
      hands: createHands(),
    });

    expect(state.currentPhase).toBe('bidding');
    state.setPhase('playing');
    expect(state.currentPhase).toBe('playing');
    state.setPhase('scoring');
    expect(state.currentPhase).toBe('scoring');
    state.setPhase('bidding');
    expect(state.currentPhase).toBe('bidding');
    state.setPhase('playing');
    expect(() => state.setPhase('waiting')).toThrow(/Cannot transition/i);
    state.setPhase('scoring');
    state.advancePhase({ to: 'completed' });
    expect(state.currentPhase).toBe('completed');
  });

  it('creates rounds with blind round visibility rules', () => {
    const state = new GameState({ roomId: 'itajuba', playerOrder });

    state.startRound({
      cardCount: 1,
      viraCard: { rank: '6', suit: 'spades' },
      manilhaRank: '7',
      hands: createHands(),
    });

    const roundOne = state.getCurrentRound();
    expect(roundOne.roundNumber).toBe(1);
    expect(roundOne.isBlindRound).toBe(true);

    const viewForP1 = roundOne.getHandViewForPlayer('player-1');
    expect(viewForP1.self).toEqual([
      expect.objectContaining({
        rank: 'A',
        suit: 'clubs',
        hidden: true,
      }),
    ]);
    expect(Object.keys(viewForP1.others)).toContain('player-2');
    expect(viewForP1.others['player-2']).toHaveLength(1);

    const secondHands = createHands();
    state.startRound({
      cardCount: 2,
      viraCard: { rank: '10', suit: 'clubs' },
      manilhaRank: 'J',
      hands: secondHands,
    });

    const roundTwo = state.getCurrentRound();
    expect(roundTwo.roundNumber).toBe(2);
    expect(roundTwo.isBlindRound).toBe(false);

    const normalView = roundTwo.getHandViewForPlayer('player-1');
    expect(normalView.self).toEqual(secondHands.get('player-1'));
    expect(normalView.others['player-2']).toEqual([{ hidden: true }]);
  });
});
