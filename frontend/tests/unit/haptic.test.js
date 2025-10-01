import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock navigator.vibrate before importing the module
const mockVibrate = vi.fn(() => true);
Object.defineProperty(navigator, 'vibrate', {
  writable: true,
  configurable: true,
  value: mockVibrate,
});

import haptic from '../../src/modules/haptic/index.js';

describe('Haptic Feedback Module', () => {
  beforeEach(() => {
    // Reset the enabled state and ensure isSupported is true
    haptic.isSupported = true;
    haptic.setEnabled(true);
    mockVibrate.mockClear();
  });

  afterEach(() => {
    mockVibrate.mockClear();
  });

  describe('Basic Functionality', () => {
    it('should detect vibration API support', () => {
      expect(haptic.isSupported).toBe(true);
    });

    it('should allow enabling and disabling haptic feedback', () => {
      haptic.setEnabled(false);
      expect(haptic.isEnabled).toBe(false);
      
      haptic.setEnabled(true);
      expect(haptic.isEnabled).toBe(true);
    });

    it('should not vibrate when disabled', () => {
      haptic.setEnabled(false);
      const result = haptic.light();
      
      expect(result).toBe(false);
      expect(mockVibrate).not.toHaveBeenCalled();
    });
  });

  describe('Vibration Patterns', () => {
    it('should trigger light vibration', () => {
      haptic.light();
      expect(mockVibrate).toHaveBeenCalledWith(10);
    });

    it('should trigger medium vibration', () => {
      haptic.medium();
      expect(mockVibrate).toHaveBeenCalledWith(30);
    });

    it('should trigger heavy vibration', () => {
      haptic.heavy();
      expect(mockVibrate).toHaveBeenCalledWith(50);
    });

    it('should trigger success pattern', () => {
      haptic.success();
      expect(mockVibrate).toHaveBeenCalledWith([30, 50, 30]);
    });

    it('should trigger error pattern', () => {
      haptic.error();
      expect(mockVibrate).toHaveBeenCalledWith([50, 100, 50, 100, 50]);
    });

    it('should trigger warning pattern', () => {
      haptic.warning();
      expect(mockVibrate).toHaveBeenCalledWith([40, 80, 40]);
    });
  });

  describe('Game-Specific Feedback', () => {
    it('should provide card play feedback', () => {
      haptic.cardPlay();
      expect(mockVibrate).toHaveBeenCalledWith(30);
    });

    it('should provide trick won feedback', () => {
      haptic.trickWon();
      expect(mockVibrate).toHaveBeenCalledWith([30, 50, 30]);
    });

    it('should provide trick lost feedback', () => {
      haptic.trickLost();
      expect(mockVibrate).toHaveBeenCalledWith(10);
    });

    it('should provide life lost feedback', () => {
      haptic.lifeLost();
      expect(mockVibrate).toHaveBeenCalledWith([50, 100, 50, 100, 50]);
    });

    it('should provide game over feedback', () => {
      haptic.gameOver();
      expect(mockVibrate).toHaveBeenCalledWith([100, 50, 100, 50, 200]);
    });

    it('should provide timer warning feedback', () => {
      haptic.timerWarning();
      expect(mockVibrate).toHaveBeenCalledWith([40, 80, 40]);
    });

    it('should provide bid submitted feedback', () => {
      haptic.bidSubmitted();
      expect(mockVibrate).toHaveBeenCalledWith(30);
    });

    it('should provide room joined feedback', () => {
      haptic.roomJoined();
      expect(mockVibrate).toHaveBeenCalledWith([30, 50, 30]);
    });
  });

  describe('Error Handling', () => {
    it('should handle vibrate API errors gracefully', () => {
      // Mock vibrate to throw an error
      mockVibrate.mockImplementation(() => {
        throw new Error('Vibration failed');
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const result = haptic.light();
      
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Haptic feedback failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });
});
