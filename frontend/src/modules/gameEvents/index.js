/**
 * Game Events with Haptic Feedback
 * Integrates haptic feedback with game state changes
 */

import haptic from '../haptic/index.js';

/**
 * Initialize game event listeners with haptic feedback
 * @param {Object} networkClient - The network client instance
 */
export const initializeGameHaptics = (networkClient) => {
  // Room events
  networkClient.on('room_joined', () => {
    haptic.roomJoined();
  });

  // Game state events
  networkClient.on('game_state_update', (payload) => {
    const { phase, event } = payload || {};

    // Handle different game phases and events
    if (event === 'trick_complete') {
      const isWinner = payload.trickWinner === payload.currentPlayerId;
      if (isWinner) {
        haptic.trickWon();
      } else {
        haptic.trickLost();
      }
    }

    if (event === 'round_complete') {
      // Check if player lost lives
      const livesLost = payload.livesLost || 0;
      if (livesLost > 0) {
        haptic.lifeLost();
      }
    }

    if (event === 'player_eliminated' || phase === 'completed') {
      const isCurrentPlayer = payload.eliminatedPlayerId === payload.currentPlayerId;
      if (isCurrentPlayer) {
        haptic.gameOver();
      }
    }

    if (phase === 'bidding' && event === 'bid_submitted') {
      haptic.bidSubmitted();
    }
  });

  // Timer warnings
  networkClient.on('turn_timer_update', (payload) => {
    const { timeRemaining } = payload || {};
    
    // Warning haptic at 5 seconds remaining
    if (timeRemaining && timeRemaining <= 5 && timeRemaining > 4) {
      haptic.timerWarning();
    }
  });

  // Action sync events
  networkClient.on('action_sync', (payload) => {
    const { action } = payload || {};
    
    if (action === 'card_played') {
      haptic.light();
    }
  });
};

/**
 * Enable or disable haptic feedback
 * @param {boolean} enabled - Whether haptic feedback should be enabled
 */
export const setHapticEnabled = (enabled) => {
  haptic.setEnabled(enabled);
};

/**
 * Check if haptic feedback is supported
 * @returns {boolean} - Whether haptic feedback is supported
 */
export const isHapticSupported = () => {
  return haptic.isSupported;
};
