/**
 * Tests for Anti-Cheat Module
 */

const { antiCheatManager, CONFIG } = require('../../src/modules/security/antiCheat');

describe('Anti-Cheat Module', () => {
  beforeEach(() => {
    antiCheatManager.reset();
    antiCheatManager.setEnabled(true);
  });

  describe('Action Timing Validation', () => {
    test('should allow normal-paced actions', async () => {
      const playerId = 'player-1';
      
      const result1 = antiCheatManager.validateAction(playerId, 'play_card', {});
      antiCheatManager.recordAction(playerId, 'play_card', true, {});
      expect(result1.allowed).toBe(true);
      
      // Wait a reasonable time
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const result2 = antiCheatManager.validateAction(playerId, 'play_card', {});
      expect(result2.allowed).toBe(true);
      expect(result2.warnings.length).toBe(0);
    });

    test('should warn on suspiciously fast actions', async () => {
      const playerId = 'player-1';
      
      antiCheatManager.validateAction(playerId, 'play_card', {});
      antiCheatManager.recordAction(playerId, 'play_card', true, {});
      
      // Wait less than SUSPICIOUS_FAST_ACTION threshold
      await new Promise(resolve => setTimeout(resolve, CONFIG.SUSPICIOUS_FAST_ACTION - 50));
      
      const result = antiCheatManager.validateAction(playerId, 'play_card', {});
      expect(result.allowed).toBe(true);
      expect(result.warnings.some(w => w.type === 'suspicious_timing')).toBe(true);
    });

    test('should block impossibly fast actions', async () => {
      const playerId = 'player-1';
      
      antiCheatManager.validateAction(playerId, 'play_card', {});
      antiCheatManager.recordAction(playerId, 'play_card', true, {});
      
      // Try action immediately (< IMPOSSIBLE_FAST_ACTION)
      const result = antiCheatManager.validateAction(playerId, 'play_card', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('bot behavior');
    });
  });

  describe('Failure Rate Detection', () => {
    test('should flag players with high failure rates', () => {
      const playerId = 'test-player-failure';
      
      // Record many failures quickly
      for (let i = 0; i < CONFIG.MAX_FAILURES_PER_MINUTE + 1; i++) {
        antiCheatManager.recordAction(playerId, 'play_card', false, {});
      }
      
      const result = antiCheatManager.validateAction(playerId, 'play_card', {});
      expect(result.warnings.some(w => w.type === 'high_failure_rate')).toBe(true);
    });

    test('should track cumulative failures across game', () => {
      const playerId = 'player-1';
      
      // Record failures over time
      for (let i = 0; i < CONFIG.MAX_FAILURES_PER_GAME + 1; i++) {
        antiCheatManager.recordAction(playerId, 'play_card', false, {});
      }
      
      const stats = antiCheatManager.getStats();
      expect(stats.totalFailures).toBeGreaterThanOrEqual(CONFIG.MAX_FAILURES_PER_GAME);
    });
  });

  describe('Card Visibility Verification', () => {
    test('should allow viewing own cards in normal rounds', () => {
      const gameState = {
        currentRound: 2,
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            hand: ['card-1', 'card-2', 'card-3'],
          },
        },
      };

      const result = antiCheatManager.verifyCardVisibility(
        gameState,
        'player-1',
        ['card-1', 'card-2']
      );

      expect(result.valid).toBe(true);
    });

    test('should block viewing other players cards in normal rounds', () => {
      const gameState = {
        currentRound: 2,
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            hand: ['card-1', 'card-2', 'card-3'],
          },
          'player-2': {
            playerId: 'player-2',
            sessionId: 'session-2',
            hand: ['card-4', 'card-5', 'card-6'],
          },
        },
      };

      const result = antiCheatManager.verifyCardVisibility(
        gameState,
        'player-1',
        ['card-4'] // Player 2's card
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Attempted to access');
      expect(result.invalidCards).toContain('card-4');
    });

    test('should allow viewing other players cards in blind round (round 1)', () => {
      const gameState = {
        currentRound: 1, // Blind round
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            hand: ['card-1', 'card-2', 'card-3'],
          },
          'player-2': {
            playerId: 'player-2',
            sessionId: 'session-2',
            hand: ['card-4', 'card-5', 'card-6'],
          },
        },
      };

      const result = antiCheatManager.verifyCardVisibility(
        gameState,
        'player-1',
        ['card-4', 'card-5'] // Player 2's cards
      );

      expect(result.valid).toBe(true);
    });

    test('should block viewing own cards in blind round (round 1)', () => {
      const gameState = {
        currentRound: 1, // Blind round
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            hand: ['card-1', 'card-2', 'card-3'],
          },
        },
      };

      const result = antiCheatManager.verifyCardVisibility(
        gameState,
        'player-1',
        ['card-1'] // Own card
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Attempted to access');
      expect(result.invalidCards).toContain('card-1');
    });
  });

  describe('Game Action Verification', () => {
    test('should allow valid actions during correct phase', () => {
      const gameState = {
        phase: 'bidding',
        currentTurnPlayerId: 'player-1',
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            eliminated: false,
            spectator: false,
          },
        },
      };

      const result = antiCheatManager.verifyGameAction(
        gameState,
        'player-1',
        'submit_bid'
      );

      expect(result.valid).toBe(true);
    });

    test('should reject actions from eliminated players', () => {
      const gameState = {
        phase: 'bidding',
        currentTurnPlayerId: 'player-1',
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            eliminated: true, // Eliminated
            spectator: false,
          },
        },
      };

      const result = antiCheatManager.verifyGameAction(
        gameState,
        'player-1',
        'submit_bid'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Eliminated');
    });

    test('should reject actions from spectators', () => {
      const gameState = {
        phase: 'bidding',
        currentTurnPlayerId: 'player-1',
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            eliminated: false,
            spectator: true, // Spectator
          },
        },
      };

      const result = antiCheatManager.verifyGameAction(
        gameState,
        'player-1',
        'submit_bid'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Spectators');
    });

    test('should reject actions when not players turn', () => {
      const gameState = {
        phase: 'bidding',
        currentTurnPlayerId: 'player-2', // Not player-1
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            eliminated: false,
            spectator: false,
          },
          'player-2': {
            playerId: 'player-2',
            sessionId: 'session-2',
            eliminated: false,
            spectator: false,
          },
        },
      };

      const result = antiCheatManager.verifyGameAction(
        gameState,
        'player-1',
        'submit_bid'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Not your turn');
    });

    test('should reject actions in wrong phase', () => {
      const gameState = {
        phase: 'waiting', // Wrong phase for bidding
        currentTurnPlayerId: 'player-1',
        players: {
          'player-1': {
            playerId: 'player-1',
            sessionId: 'session-1',
            eliminated: false,
            spectator: false,
          },
        },
      };

      const result = antiCheatManager.verifyGameAction(
        gameState,
        'player-1',
        'submit_bid'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cannot submit_bid during');
    });

    test('should validate phase-action combinations', () => {
      const player = {
        playerId: 'player-1',
        sessionId: 'session-1',
        eliminated: false,
        spectator: false,
      };

      // Waiting phase - no actions allowed
      let gameState = {
        phase: 'waiting',
        currentTurnPlayerId: 'player-1',
        players: { 'player-1': player },
      };
      expect(antiCheatManager.verifyGameAction(gameState, 'player-1', 'submit_bid').valid).toBe(false);

      // Bidding phase - only submit_bid allowed
      gameState = {
        phase: 'bidding',
        currentTurnPlayerId: 'player-1',
        players: { 'player-1': player },
      };
      expect(antiCheatManager.verifyGameAction(gameState, 'player-1', 'submit_bid').valid).toBe(true);
      expect(antiCheatManager.verifyGameAction(gameState, 'player-1', 'play_card').valid).toBe(false);

      // Playing phase - only play_card allowed
      gameState = {
        phase: 'playing',
        currentTurnPlayerId: 'player-1',
        players: { 'player-1': player },
      };
      expect(antiCheatManager.verifyGameAction(gameState, 'player-1', 'play_card').valid).toBe(true);
      expect(antiCheatManager.verifyGameAction(gameState, 'player-1', 'submit_bid').valid).toBe(false);

      // Scoring phase - no actions allowed
      gameState = {
        phase: 'scoring',
        currentTurnPlayerId: 'player-1',
        players: { 'player-1': player },
      };
      expect(antiCheatManager.verifyGameAction(gameState, 'player-1', 'submit_bid').valid).toBe(false);
      expect(antiCheatManager.verifyGameAction(gameState, 'player-1', 'play_card').valid).toBe(false);
    });
  });

  describe('Player Management', () => {
    test('should track multiple players independently', () => {
      antiCheatManager.recordAction('player-1', 'play_card', true, {});
      antiCheatManager.recordAction('player-2', 'play_card', true, {});
      
      const stats = antiCheatManager.getStats();
      expect(stats.totalTrackers).toBe(2);
    });

    test('should remove player trackers on disconnect', () => {
      antiCheatManager.recordAction('player-1', 'play_card', true, {});
      expect(antiCheatManager.getStats().totalTrackers).toBe(1);
      
      antiCheatManager.removePlayer('player-1');
      expect(antiCheatManager.getStats().totalTrackers).toBe(0);
    });

    test('should return stats for all tracked players', () => {
      antiCheatManager.recordAction('player-1', 'play_card', true, {});
      antiCheatManager.recordAction('player-1', 'play_card', false, {});
      antiCheatManager.recordAction('player-2', 'submit_bid', true, {});
      
      const stats = antiCheatManager.getStats();
      expect(stats.totalTrackers).toBe(2);
      expect(stats.totalActions).toBe(3);
      expect(stats.totalFailures).toBe(1);
    });
  });

  describe('Enable/Disable Functionality', () => {
    test('should allow all actions when disabled', () => {
      antiCheatManager.setEnabled(false);
      
      const playerId = 'player-1';
      
      // Rapid actions should be allowed when disabled
      antiCheatManager.validateAction(playerId, 'play_card', {});
      const result = antiCheatManager.validateAction(playerId, 'play_card', {});
      
      expect(result.allowed).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    test('should resume validation when re-enabled', () => {
      const playerId = 'player-1';
      
      // Establish a baseline with anti-cheat enabled
      antiCheatManager.setEnabled(true);
      antiCheatManager.validateAction(playerId, 'play_card', {});
      antiCheatManager.recordAction(playerId, 'play_card', true, {});
      
      // Disable temporarily
      antiCheatManager.setEnabled(false);
      const disabledResult = antiCheatManager.validateAction(playerId, 'play_card', {});
      expect(disabledResult.allowed).toBe(true);
      
      // Re-enable and try immediately (should catch fast action based on previous recorded action)
      antiCheatManager.setEnabled(true);
      const result = antiCheatManager.validateAction(playerId, 'play_card', {});
      
      expect(result.allowed).toBe(false); // Too fast compared to last recorded action
    });
  });

  describe('Configuration', () => {
    test('should have reasonable timing thresholds', () => {
      // IMPOSSIBLE should be fastest (block immediately)
      // SUSPICIOUS should be faster than MIN (warn)
      // MIN is the recommended minimum
      expect(CONFIG.IMPOSSIBLE_FAST_ACTION).toBeLessThan(CONFIG.MIN_ACTION_INTERVAL);
      expect(CONFIG.SUSPICIOUS_FAST_ACTION).toBeGreaterThan(CONFIG.MIN_ACTION_INTERVAL);
    });

    test('should have reasonable failure thresholds', () => {
      expect(CONFIG.MAX_FAILURES_PER_MINUTE).toBeGreaterThan(0);
      expect(CONFIG.MAX_FAILURES_PER_GAME).toBeGreaterThan(CONFIG.MAX_FAILURES_PER_MINUTE);
    });
  });
});
