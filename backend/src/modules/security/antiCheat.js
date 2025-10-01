/**
 * Anti-Cheat Validation Module
 * 
 * Provides server-side verification that game rules are enforced
 * and players cannot cheat by manipulating client-side data.
 * 
 * Features:
 * - Card visibility verification (players can't see hidden cards)
 * - Action timing validation (prevent impossible fast actions)
 * - Repeated failure detection (flag suspicious behavior)
 * - Game state consistency checks
 * - Suspicious pattern logging
 */

const { randomUUID } = require('crypto');

// Anti-cheat configuration
const CONFIG = {
  // Minimum time between actions (milliseconds)
  MIN_ACTION_INTERVAL: 100, // 100ms minimum between actions (prevents bot spam)
  
  // Maximum failures before flagging
  MAX_FAILURES_PER_MINUTE: 10,
  MAX_FAILURES_PER_GAME: 30,
  
  // Timing thresholds (IMPOSSIBLE < MIN < SUSPICIOUS for escalating severity)
  IMPOSSIBLE_FAST_ACTION: 50, // Actions faster than 50ms are impossible for humans (block)
  SUSPICIOUS_FAST_ACTION: 150, // Actions faster than 150ms are suspicious (warn but allow)
  
  // Pattern detection
  PATTERN_DETECTION_WINDOW: 60000, // 1 minute window for pattern analysis
};

/**
 * Action Tracker
 * Tracks player actions for timing and pattern analysis
 */
class ActionTracker {
  constructor(playerId) {
    this.playerId = playerId;
    this.actions = [];
    this.failures = [];
    this.createdAt = Date.now();
    this.flagged = false;
    this.flagReason = null;
  }

  /**
   * Record an action
   */
  recordAction(actionType, success = true, context = {}) {
    const now = Date.now();
    const action = {
      actionId: randomUUID(),
      actionType,
      timestamp: now,
      success,
      context,
    };
    
    this.actions.push(action);
    
    if (!success) {
      this.failures.push(action);
    }
    
    // Clean up old actions (keep last hour)
    this.cleanup(now);
    
    return action;
  }

  /**
   * Check if action timing is suspicious
   */
  checkTiming(actionType) {
    const now = Date.now();
    const recentActions = this.actions.filter(
      (a) => a.actionType === actionType && now - a.timestamp < CONFIG.PATTERN_DETECTION_WINDOW
    );
    
    if (recentActions.length === 0) {
      return { suspicious: false, timeSinceLastAction: Infinity };
    }
    
    const lastAction = recentActions[recentActions.length - 1];
    const timeSinceLastAction = now - lastAction.timestamp;
    
    if (timeSinceLastAction < CONFIG.IMPOSSIBLE_FAST_ACTION) {
      return {
        suspicious: true,
        severity: 'critical',
        reason: 'impossible_timing',
        timeSinceLastAction,
      };
    }
    
    if (timeSinceLastAction < CONFIG.SUSPICIOUS_FAST_ACTION) {
      return {
        suspicious: true,
        severity: 'warning',
        reason: 'fast_timing',
        timeSinceLastAction,
      };
    }
    
    return {
      suspicious: false,
      timeSinceLastAction,
    };
  }

  /**
   * Check failure rate
   */
  checkFailureRate() {
    const now = Date.now();
    const recentFailures = this.failures.filter(
      (f) => now - f.timestamp < CONFIG.PATTERN_DETECTION_WINDOW
    );
    
    if (recentFailures.length > CONFIG.MAX_FAILURES_PER_MINUTE) {
      return {
        suspicious: true,
        severity: 'severe',
        reason: 'high_failure_rate',
        failureCount: recentFailures.length,
      };
    }
    
    if (this.failures.length > CONFIG.MAX_FAILURES_PER_GAME) {
      return {
        suspicious: true,
        severity: 'warning',
        reason: 'many_failures',
        failureCount: this.failures.length,
      };
    }
    
    return {
      suspicious: false,
      failureCount: recentFailures.length,
    };
  }

  /**
   * Flag player as suspicious
   */
  flag(reason) {
    this.flagged = true;
    this.flagReason = reason;
  }

  /**
   * Clean up old actions
   */
  cleanup(now) {
    const maxAge = 60 * 60 * 1000; // 1 hour
    this.actions = this.actions.filter((a) => now - a.timestamp < maxAge);
    this.failures = this.failures.filter((f) => now - f.timestamp < maxAge);
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = Date.now();
    const recentActions = this.actions.filter(
      (a) => now - a.timestamp < CONFIG.PATTERN_DETECTION_WINDOW
    );
    const recentFailures = this.failures.filter(
      (f) => now - f.timestamp < CONFIG.PATTERN_DETECTION_WINDOW
    );
    
    return {
      totalActions: this.actions.length,
      recentActions: recentActions.length,
      totalFailures: this.failures.length,
      recentFailures: recentFailures.length,
      flagged: this.flagged,
      flagReason: this.flagReason,
    };
  }
}

/**
 * Anti-Cheat Manager
 * Manages action tracking and cheat detection for all players
 */
class AntiCheatManager {
  constructor() {
    this.trackers = new Map(); // playerId -> ActionTracker
    this.enabled = true;
  }

  /**
   * Get or create tracker for a player
   */
  getTracker(playerId) {
    if (!this.trackers.has(playerId)) {
      this.trackers.set(playerId, new ActionTracker(playerId));
    }
    return this.trackers.get(playerId);
  }

  /**
   * Validate an action before allowing it
   * @param {string} playerId - Player ID
   * @param {string} actionType - Action type (e.g., 'submit_bid', 'play_card')
   * @param {Object} context - Additional context
   * @returns {Object} - { allowed: boolean, warnings: Array }
   */
  validateAction(playerId, actionType, context = {}) {
    if (!this.enabled) {
      return { allowed: true, warnings: [] };
    }
    
    const tracker = this.getTracker(playerId);
    const warnings = [];
    
    // Check timing
    const timingCheck = tracker.checkTiming(actionType);
    if (timingCheck.suspicious) {
      warnings.push({
        type: 'suspicious_timing',
        severity: timingCheck.severity,
        reason: timingCheck.reason,
        timeSinceLastAction: timingCheck.timeSinceLastAction,
      });
    }
    
    // Check failure rate (always check, regardless of timing)
    const failureCheck = tracker.checkFailureRate();
    if (failureCheck.suspicious) {
      warnings.push({
        type: 'high_failure_rate',
        severity: failureCheck.severity,
        reason: failureCheck.reason,
        failureCount: failureCheck.failureCount,
      });
      
      // Flag but don't block (just log for monitoring)
      if (failureCheck.severity === 'severe') {
        tracker.flag('high_failure_rate');
      }
    }
    
    // Block impossible timing (check after gathering all warnings)
    if (timingCheck.suspicious && timingCheck.severity === 'critical') {
      tracker.recordAction(actionType, false, { ...context, blocked: 'impossible_timing' });
      tracker.flag('impossible_timing');
      
      return {
        allowed: false,
        warnings,
        reason: 'Actions too fast - possible bot behavior',
      };
    }
    
    return {
      allowed: true,
      warnings,
    };
  }

  /**
   * Record action result
   */
  recordAction(playerId, actionType, success, context = {}) {
    const tracker = this.getTracker(playerId);
    return tracker.recordAction(actionType, success, context);
  }

  /**
   * Verify card visibility rules
   * Ensures players can only see cards they're allowed to see
   */
  verifyCardVisibility(gameState, playerId, requestedCards) {
    // In Round 1 (Blind Round), players can see others' cards but not their own
    // In other rounds, players can only see their own cards
    
    // Handle both array and object formats for players
    const players = Array.isArray(gameState.players)
      ? gameState.players
      : Object.values(gameState.players);
    
    const player = players.find((p) => p.playerId === playerId);
    if (!player) {
      return {
        valid: false,
        error: 'Player not found',
      };
    }
    
    // Handle both currentRound as number or object with roundNumber property
    const roundNumber = typeof gameState.currentRound === 'number' 
      ? gameState.currentRound 
      : gameState.currentRound?.roundNumber;
    const isBlindRound = roundNumber === 1;
    const allowedCards = [];
    
    if (isBlindRound) {
      // Blind round: can see everyone else's cards, but not your own
      players.forEach((p) => {
        if (p.playerId !== playerId && p.hand) {
          allowedCards.push(...p.hand);
        }
      });
    } else {
      // Normal rounds: can only see your own cards
      if (player.hand) {
        allowedCards.push(...player.hand);
      }
    }
    
    // Check if requested cards are in allowed list
    const allowedCardIds = new Set(allowedCards.map((c) => {
      // Handle both card objects and card ID strings
      if (typeof c === 'string') return c;
      return c.cardId || `${c.suit}-${c.rank}`;
    }));
    const invalidCards = requestedCards.filter(
      (cardId) => !allowedCardIds.has(cardId)
    );
    
    if (invalidCards.length > 0) {
      return {
        valid: false,
        error: 'Attempted to access hidden cards',
        invalidCards,
      };
    }
    
    return {
      valid: true,
    };
  }

  /**
   * Verify game action is valid for current state
   */
  verifyGameAction(gameState, playerId, actionType) {
    // Handle both array and object formats for players
    const players = Array.isArray(gameState.players)
      ? gameState.players
      : Object.values(gameState.players);
    
    const player = players.find((p) => p.playerId === playerId);
    
    if (!player) {
      return {
        valid: false,
        error: 'Player not found in game',
      };
    }
    
    // Eliminated players can't take actions (check both property names)
    if (player.isEliminated || player.eliminated) {
      return {
        valid: false,
        error: 'Eliminated players cannot take actions',
      };
    }
    
    // Spectators can't take actions (check both property names)
    if (player.isSpectator || player.spectator) {
      return {
        valid: false,
        error: 'Spectators cannot take actions',
      };
    }
    
    // Check if it's player's turn (for actions that require turn)
    if (['submit_bid', 'play_card'].includes(actionType)) {
      // Support both property names
      const currentPlayerId = gameState.currentPlayerId || gameState.currentTurnPlayerId;
      if (currentPlayerId !== playerId) {
        return {
          valid: false,
          error: 'Not your turn',
        };
      }
    }
    
    // Verify action matches current game phase (support both property names)
    const phase = gameState.currentPhase || gameState.phase;
    const phaseActions = {
      waiting: [],
      bidding: ['submit_bid'],
      playing: ['play_card'],
      scoring: [],
    };
    
    const allowedActions = phaseActions[phase] || [];
    
    // For game actions (submit_bid, play_card), check phase restrictions
    const gameActions = ['submit_bid', 'play_card'];
    if (gameActions.includes(actionType)) {
      if (!allowedActions.includes(actionType)) {
        return {
          valid: false,
          error: `Cannot ${actionType} during ${phase} phase`,
        };
      }
    }
    
    return {
      valid: true,
    };
  }

  /**
   * Remove tracker when player leaves
   */
  removePlayer(playerId) {
    this.trackers.delete(playerId);
  }

  /**
   * Get statistics for monitoring
   */
  getStats() {
    const stats = {
      totalTrackers: this.trackers.size,
      flaggedPlayers: 0,
      totalActions: 0,
      totalFailures: 0,
    };
    
    this.trackers.forEach((tracker) => {
      const trackerStats = tracker.getStats();
      if (trackerStats.flagged) {
        stats.flaggedPlayers++;
      }
      stats.totalActions += trackerStats.totalActions;
      stats.totalFailures += trackerStats.totalFailures;
    });
    
    return stats;
  }

  /**
   * Enable or disable anti-cheat (for testing)
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Reset all trackers (for testing)
   */
  reset() {
    this.trackers.clear();
  }
}

// Singleton instance
const antiCheatManager = new AntiCheatManager();

module.exports = {
  antiCheatManager,
  ActionTracker, // Export for testing
  CONFIG, // Export for configuration
};
