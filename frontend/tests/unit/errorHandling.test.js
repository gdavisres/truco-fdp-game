import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { errorHandler } from '../../src/modules/errorHandler/index.js';
import { errorNotification } from '../../src/modules/errorNotification/index.js';
import { errorLogger } from '../../src/modules/errorLogger/index.js';

describe('Error Handler', () => {
  beforeEach(() => {
    // Initialize error handler
    errorHandler.initialize();
    
    // Mock DOM for notifications
    document.body.innerHTML = '<div id="app"></div>';
    
    // Spy on console methods
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    errorHandler.destroy();
    errorNotification.destroy();
    errorLogger.clear();
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize global error handlers', () => {
      expect(errorHandler.isInitialized).toBe(true);
    });

    it('should not re-initialize if already initialized', () => {
      const initialState = errorHandler.isInitialized;
      errorHandler.initialize();
      expect(errorHandler.isInitialized).toBe(initialState);
    });
  });

  describe('Error Normalization', () => {
    it('should normalize Error objects', () => {
      const error = new Error('Test error');
      const normalized = errorHandler.normalizeError(error);
      
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('Test error');
    });

    it('should normalize string errors', () => {
      const normalized = errorHandler.normalizeError('String error');
      
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('String error');
    });

    it('should normalize object errors', () => {
      const errorObj = { message: 'Object error', code: 'TEST_ERROR' };
      const normalized = errorHandler.normalizeError(errorObj);
      
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('Object error');
      expect(normalized.code).toBe('TEST_ERROR');
    });

    it('should handle null/undefined errors', () => {
      const normalized = errorHandler.normalizeError(null);
      
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('Unknown error occurred');
    });
  });

  describe('Error Classification', () => {
    it('should classify syntax errors as critical', () => {
      const error = new Error('Unexpected token');
      const severity = errorHandler.classifyError(error);
      
      expect(severity).toBe('critical');
    });

    it('should classify network errors as error', () => {
      const error = new Error('Network request failed');
      error.code = 'NETWORK_ERROR';
      const severity = errorHandler.classifyError(error);
      
      expect(severity).toBe('error');
    });

    it('should classify validation errors as warning', () => {
      const error = new Error('Invalid input');
      error.code = 'VALIDATION_ERROR';
      const severity = errorHandler.classifyError(error);
      
      expect(severity).toBe('warning');
    });

    it('should default to error for unknown types', () => {
      const error = new Error('Unknown error type');
      const severity = errorHandler.classifyError(error);
      
      expect(severity).toBe('error');
    });
  });

  describe('User Messages', () => {
    it('should return friendly message for network errors', () => {
      const error = new Error('fetch failed');
      const message = errorHandler.getUserMessage(error);
      
      expect(message).toContain('connect to the server');
    });

    it('should return friendly message for connection lost', () => {
      const error = new Error('connection lost');
      error.code = 'CONNECTION_LOST';
      const message = errorHandler.getUserMessage(error);
      
      expect(message).toContain('Connection to the server was lost');
    });

    it('should return friendly message for timeout errors', () => {
      const error = new Error('Request timeout');
      const message = errorHandler.getUserMessage(error);
      
      expect(message).toContain('too long');
    });

    it('should use original message for validation errors', () => {
      const error = new Error('Email is required');
      error.code = 'VALIDATION_ERROR';
      const message = errorHandler.getUserMessage(error);
      
      expect(message).toBe('Email is required');
    });

    it('should return generic message for unknown errors', () => {
      const error = new Error('Something weird happened');
      const message = errorHandler.getUserMessage(error);
      
      expect(message).toContain('Something went wrong');
    });
  });

  describe('Recovery Actions', () => {
    it('should provide retry action for network errors', () => {
      const error = new Error('Network error');
      const actions = errorHandler.getRecoveryActions(error);
      
      expect(actions.some(a => a.label === 'Retry')).toBe(true);
    });

    it('should provide back navigation for room errors', () => {
      const error = new Error('Room not found');
      const actions = errorHandler.getRecoveryActions(error);
      
      expect(actions.some(a => a.label === 'Back to Rooms')).toBe(true);
    });

    it('should always provide refresh action', () => {
      const error = new Error('Any error');
      const actions = errorHandler.getRecoveryActions(error);
      
      expect(actions.some(a => a.label === 'Refresh Page')).toBe(true);
    });
  });

  describe('Error Callbacks', () => {
    it('should trigger error callbacks', () => {
      const callback = vi.fn();
      errorHandler.onError(callback);
      
      const error = new Error('Test error');
      errorHandler.catch(error);
      
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Test error' }),
        expect.any(String)
      );
    });

    it('should handle callback errors gracefully', () => {
      const badCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      errorHandler.onError(badCallback);
      
      const error = new Error('Test error');
      expect(() => errorHandler.catch(error)).not.toThrow();
    });
  });

  describe('Recovery Strategies', () => {
    it('should register recovery strategies', () => {
      const strategy = vi.fn();
      errorHandler.registerRecovery('TEST_ERROR', strategy);
      
      const error = new Error('Test error');
      error.code = 'TEST_ERROR';
      errorHandler.catch(error);
      
      expect(strategy).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TEST_ERROR' }),
        expect.any(Object)
      );
    });

    it('should handle recovery failures gracefully', () => {
      const badStrategy = vi.fn(() => {
        throw new Error('Recovery failed');
      });
      errorHandler.registerRecovery('TEST_ERROR', badStrategy);
      
      const error = new Error('Test error');
      error.code = 'TEST_ERROR';
      
      expect(() => errorHandler.catch(error)).not.toThrow();
    });
  });
});

describe('Error Notification', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    errorNotification.initialize();
  });

  afterEach(() => {
    errorNotification.destroy();
  });

  describe('Notification Display', () => {
    it('should create notification element', () => {
      errorNotification.show({
        severity: 'error',
        message: 'Test error'
      });
      
      const notification = document.querySelector('.error-notification');
      expect(notification).toBeTruthy();
      expect(notification.textContent).toContain('Test error');
    });

    it('should apply correct severity class', () => {
      errorNotification.show({
        severity: 'warning',
        message: 'Test warning'
      });
      
      const notification = document.querySelector('.error-notification');
      expect(notification.classList.contains('error-notification--warning')).toBe(true);
    });

    it('should display action buttons', () => {
      errorNotification.show({
        severity: 'error',
        message: 'Test error',
        actions: [
          { label: 'Retry', action: vi.fn() },
          { label: 'Cancel', action: vi.fn() }
        ]
      });
      
      const buttons = document.querySelectorAll('.error-notification__action');
      expect(buttons.length).toBe(2);
      expect(buttons[0].textContent).toBe('Retry');
      expect(buttons[1].textContent).toBe('Cancel');
    });

    it('should call action callback when clicked', () => {
      const action = vi.fn();
      errorNotification.show({
        severity: 'error',
        message: 'Test error',
        actions: [{ label: 'Retry', action }]
      });
      
      const button = document.querySelector('.error-notification__action');
      button.click();
      
      expect(action).toHaveBeenCalled();
    });

    it('should hide notification when close button clicked', () => {
      errorNotification.show({
        severity: 'error',
        message: 'Test error'
      });
      
      const closeBtn = document.querySelector('.error-notification__close');
      closeBtn.click();
      
      // Wait for animation
      setTimeout(() => {
        const notification = document.querySelector('.error-notification');
        expect(notification).toBeFalsy();
      }, 400);
    });
  });

  describe('Auto-hide', () => {
    it('should auto-hide info messages', (done) => {
      errorNotification.show({
        severity: 'info',
        message: 'Test info',
        duration: 100
      });
      
      setTimeout(() => {
        const notification = document.querySelector('.error-notification');
        expect(notification).toBeFalsy();
        done();
      }, 500);
    });

    it('should not auto-hide critical errors', (done) => {
      errorNotification.show({
        severity: 'critical',
        message: 'Critical error'
      });
      
      setTimeout(() => {
        const notification = document.querySelector('.error-notification');
        expect(notification).toBeTruthy();
        done();
      }, 200);
    });
  });

  describe('Convenience Methods', () => {
    it('should show success message', () => {
      errorNotification.success('Success message');
      
      const notification = document.querySelector('.error-notification--info');
      expect(notification).toBeTruthy();
    });

    it('should show warning message', () => {
      errorNotification.warning('Warning message');
      
      const notification = document.querySelector('.error-notification--warning');
      expect(notification).toBeTruthy();
    });

    it('should show error message', () => {
      errorNotification.error('Error message');
      
      const notification = document.querySelector('.error-notification--error');
      expect(notification).toBeTruthy();
    });
  });
});

describe('Error Logger', () => {
  beforeEach(() => {
    errorLogger.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Error Logging', () => {
    it('should log errors', () => {
      const error = new Error('Test error');
      error.metadata = { severity: 'error' };
      
      errorLogger.log(error);
      
      const errors = errorLogger.getErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Test error');
    });

    it('should track error frequency', () => {
      const error = new Error('Repeated error');
      error.metadata = { severity: 'error' };
      
      errorLogger.log(error);
      errorLogger.log(error);
      errorLogger.log(error);
      
      const errors = errorLogger.getErrors();
      expect(errors[errors.length - 1].count).toBe(3);
    });

    it('should limit error history', () => {
      errorLogger.maxErrors = 5;
      
      for (let i = 0; i < 10; i++) {
        const error = new Error(`Error ${i}`);
        error.metadata = { severity: 'error' };
        errorLogger.log(error);
      }
      
      const errors = errorLogger.getErrors();
      expect(errors.length).toBe(5);
      expect(errors[0].message).toBe('Error 5');
    });
  });

  describe('Error Statistics', () => {
    it('should provide error statistics', () => {
      for (let i = 0; i < 3; i++) {
        const error = new Error('Error A');
        error.metadata = { severity: 'error' };
        errorLogger.log(error);
      }
      
      const error = new Error('Error B');
      error.metadata = { severity: 'error' };
      errorLogger.log(error);
      
      const stats = errorLogger.getStats();
      expect(stats.totalErrors).toBe(4);
      expect(stats.uniqueErrors).toBe(2);
      expect(stats.topErrors[0].count).toBe(3);
    });
  });

  describe('Error Export', () => {
    it('should export errors as JSON', () => {
      const error = new Error('Test error');
      error.metadata = { severity: 'error' };
      errorLogger.log(error);
      
      const exported = errorLogger.export();
      const data = JSON.parse(exported);
      
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].message).toBe('Test error');
      expect(data.stats).toBeDefined();
    });
  });

  describe('Enable/Disable', () => {
    it('should respect enabled flag', () => {
      errorLogger.setEnabled(false);
      
      const error = new Error('Test error');
      error.metadata = { severity: 'error' };
      errorLogger.log(error);
      
      expect(errorLogger.getErrors().length).toBe(0);
      
      errorLogger.setEnabled(true);
    });
  });
});
