/**
 * Global Error Handler
 * 
 * Catches and processes unhandled errors throughout the application.
 * Provides user-friendly error notifications and recovery mechanisms.
 */

import { errorNotification } from '../errorNotification/index.js';
import { errorLogger } from '../errorLogger/index.js';

class ErrorHandler {
  constructor() {
    this.isInitialized = false;
    this.errorCallbacks = [];
    this.recoveryStrategies = new Map();
  }

  /**
   * Initialize global error handlers
   * @param {Object} context - Application context (networkClient, gameState, etc.)
   */
  initialize(context = {}) {
    if (this.isInitialized) return;

    this.context = context;

    // Handle synchronous errors
    window.addEventListener('error', (event) => {
      this.handleError(event.error, {
        type: 'uncaught',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
      event.preventDefault(); // Prevent console error
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, {
        type: 'unhandledRejection',
        promise: event.promise
      });
      event.preventDefault(); // Prevent console error
    });

    this.isInitialized = true;
    console.log('[ErrorHandler] Global error handling initialized');
  }

  /**
   * Process and handle an error
   * @param {Error|string} error - The error to handle
   * @param {Object} metadata - Additional error context
   */
  handleError(error, metadata = {}) {
    // Normalize error to Error object
    const normalizedError = this.normalizeError(error);
    
    // Add metadata
    normalizedError.metadata = {
      ...metadata,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Log error
    errorLogger.log(normalizedError);

    // Classify error severity
    const severity = this.classifyError(normalizedError);

    // Get user-friendly message
    const userMessage = this.getUserMessage(normalizedError);

    // Show notification to user
    errorNotification.show({
      severity,
      message: userMessage,
      error: normalizedError,
      actions: this.getRecoveryActions(normalizedError)
    });

    // Trigger callbacks
    this.triggerCallbacks(normalizedError, severity);

    // Attempt recovery
    this.attemptRecovery(normalizedError);
  }

  /**
   * Normalize error to Error object
   */
  normalizeError(error) {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    if (error && typeof error === 'object') {
      const err = new Error(error.message || 'Unknown error');
      Object.assign(err, error);
      return err;
    }

    return new Error('Unknown error occurred');
  }

  /**
   * Classify error severity
   * @returns {'info'|'warning'|'error'|'critical'}
   */
  classifyError(error) {
    const message = error.message?.toLowerCase() || '';
    const stack = error.stack?.toLowerCase() || '';

    // Critical errors (require immediate attention)
    if (
      message.includes('syntaxerror') ||
      message.includes('unexpected token') ||
      message.includes('referenceerror') ||
      message.includes('typeerror') ||
      message.includes('out of memory') ||
      stack.includes('at eval')
    ) {
      return 'critical';
    }

    // Network/connection errors (high priority but recoverable)
    if (
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('fetch') ||
      message.includes('timeout') ||
      message.includes('socket') ||
      error.code === 'NETWORK_ERROR'
    ) {
      return 'error';
    }

    // Validation/user input errors (expected errors)
    if (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('required') ||
      error.code === 'VALIDATION_ERROR'
    ) {
      return 'warning';
    }

    // Default to error
    return 'error';
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(error) {
    const code = error.code;
    const message = error.message?.toLowerCase() || '';

    // Network errors
    if (code === 'NETWORK_ERROR' || message.includes('network') || message.includes('fetch')) {
      return 'Unable to connect to the server. Please check your internet connection and try again.';
    }

    if (code === 'CONNECTION_LOST' || message.includes('connection') || message.includes('socket')) {
      return 'Connection to the server was lost. Attempting to reconnect...';
    }

    if (message.includes('timeout')) {
      return 'The request took too long to complete. Please try again.';
    }

    // Validation errors
    if (code === 'VALIDATION_ERROR' || message.includes('validation') || message.includes('invalid')) {
      return error.message; // Use original message for validation errors
    }

    // State errors
    if (message.includes('room not found')) {
      return 'This game room no longer exists. Please return to the room list.';
    }

    if (message.includes('game not found')) {
      return 'This game session has ended. Please start a new game.';
    }

    if (message.includes('player not found')) {
      return 'Your player session has expired. Please rejoin the room.';
    }

    // Generic fallback
    return 'Something went wrong. Please refresh the page or contact support if the problem persists.';
  }

  /**
   * Get recovery actions for an error
   */
  getRecoveryActions(error) {
    const message = error.message?.toLowerCase() || '';
    const actions = [];

    // Network errors -> retry
    if (message.includes('network') || message.includes('connection') || message.includes('fetch')) {
      actions.push({
        label: 'Retry',
        action: () => {
          if (this.context.networkClient) {
            this.context.networkClient.connect();
          }
        }
      });
    }

    // Room/game errors -> go back
    if (message.includes('room') || message.includes('game')) {
      actions.push({
        label: 'Back to Rooms',
        action: () => {
          window.location.hash = '#rooms';
        }
      });
    }

    // Always offer refresh as last resort
    actions.push({
      label: 'Refresh Page',
      action: () => {
        window.location.reload();
      }
    });

    return actions;
  }

  /**
   * Register a recovery strategy for a specific error type
   */
  registerRecovery(errorCode, strategy) {
    this.recoveryStrategies.set(errorCode, strategy);
  }

  /**
   * Attempt automatic recovery
   */
  attemptRecovery(error) {
    const strategy = this.recoveryStrategies.get(error.code);
    if (strategy) {
      try {
        strategy(error, this.context);
      } catch (recoveryError) {
        console.error('[ErrorHandler] Recovery failed:', recoveryError);
      }
    }
  }

  /**
   * Register an error callback
   */
  onError(callback) {
    this.errorCallbacks.push(callback);
  }

  /**
   * Trigger all error callbacks
   */
  triggerCallbacks(error, severity) {
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error, severity);
      } catch (err) {
        console.error('[ErrorHandler] Callback error:', err);
      }
    });
  }

  /**
   * Manually handle an error (for try-catch blocks)
   */
  catch(error, context = {}) {
    this.handleError(error, { ...context, type: 'caught' });
  }

  /**
   * Destroy error handler
   */
  destroy() {
    // Can't remove global error handlers, but we can stop processing
    this.isInitialized = false;
    this.errorCallbacks = [];
    this.recoveryStrategies.clear();
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();
