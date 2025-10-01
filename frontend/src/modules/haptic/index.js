/**
 * Haptic Feedback Module
 * Provides vibration feedback for mobile devices using the Vibration API
 * Gracefully degrades on unsupported devices
 */

class HapticFeedback {
  constructor() {
    this.isSupported = 'vibrate' in navigator;
    this.isEnabled = true; // Can be toggled by user settings
  }

  /**
   * Enable or disable haptic feedback
   * @param {boolean} enabled - Whether haptic feedback should be enabled
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
  }

  /**
   * Trigger vibration if supported and enabled
   * @param {number|number[]} pattern - Vibration pattern in milliseconds
   */
  vibrate(pattern) {
    if (!this.isSupported || !this.isEnabled) {
      return false;
    }

    try {
      navigator.vibrate(pattern);
      return true;
    } catch (error) {
      console.warn('Haptic feedback failed:', error);
      return false;
    }
  }

  /**
   * Light tap feedback (quick confirmation)
   */
  light() {
    return this.vibrate(10);
  }

  /**
   * Medium tap feedback (action confirmed)
   */
  medium() {
    return this.vibrate(30);
  }

  /**
   * Heavy tap feedback (important event)
   */
  heavy() {
    return this.vibrate(50);
  }

  /**
   * Success pattern (positive outcome)
   */
  success() {
    return this.vibrate([30, 50, 30]);
  }

  /**
   * Error pattern (negative outcome)
   */
  error() {
    return this.vibrate([50, 100, 50, 100, 50]);
  }

  /**
   * Warning pattern (attention needed)
   */
  warning() {
    return this.vibrate([40, 80, 40]);
  }

  /**
   * Card play feedback
   */
  cardPlay() {
    return this.medium();
  }

  /**
   * Trick won feedback
   */
  trickWon() {
    return this.success();
  }

  /**
   * Trick lost feedback
   */
  trickLost() {
    return this.light();
  }

  /**
   * Life lost feedback
   */
  lifeLost() {
    return this.error();
  }

  /**
   * Game over feedback
   */
  gameOver() {
    return this.vibrate([100, 50, 100, 50, 200]);
  }

  /**
   * Timer warning feedback (time running out)
   */
  timerWarning() {
    return this.warning();
  }

  /**
   * Bid submitted feedback
   */
  bidSubmitted() {
    return this.medium();
  }

  /**
   * Room joined feedback
   */
  roomJoined() {
    return this.success();
  }
}

// Singleton instance
const haptic = new HapticFeedback();

export default haptic;
