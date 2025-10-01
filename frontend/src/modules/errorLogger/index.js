/**
 * Error Logger
 * 
 * Logs errors to console and optionally to a remote service.
 * Includes error aggregation and rate limiting.
 */

class ErrorLogger {
  constructor() {
    this.errors = [];
    this.maxErrors = 100; // Keep last 100 errors in memory
    this.errorCounts = new Map(); // Track error frequency
    this.enabled = true;
  }

  /**
   * Log an error
   */
  log(error) {
    if (!this.enabled) return;

    const errorLog = {
      message: error.message,
      stack: error.stack,
      code: error.code,
      metadata: error.metadata || {},
      timestamp: new Date().toISOString(),
      count: 1
    };

    // Track error frequency
    const errorKey = this.getErrorKey(error);
    const existingCount = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, existingCount + 1);
    errorLog.count = existingCount + 1;

    // Add to error history
    this.errors.push(errorLog);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift(); // Remove oldest error
    }

    // Log to console with appropriate level
    const severity = error.metadata?.severity || 'error';
    this.logToConsole(errorLog, severity);

    // TODO: Send to remote logging service in production
    // this.sendToRemote(errorLog);
  }

  /**
   * Generate a unique key for error tracking
   */
  getErrorKey(error) {
    // Use message + first line of stack to identify unique errors
    const stackFirstLine = error.stack?.split('\n')[1] || '';
    return `${error.message}|${stackFirstLine}`;
  }

  /**
   * Log to browser console
   */
  logToConsole(errorLog, severity) {
    const prefix = `[ErrorLogger ${errorLog.timestamp}]`;
    const message = `${prefix} ${errorLog.message}`;
    const data = {
      ...errorLog,
      repeated: errorLog.count > 1 ? `(×${errorLog.count})` : ''
    };

    switch (severity) {
      case 'info':
        console.info(message, data);
        break;
      case 'warning':
        console.warn(message, data);
        break;
      case 'critical':
        console.error(`🚨 CRITICAL: ${message}`, data);
        break;
      default:
        console.error(message, data);
    }
  }

  /**
   * Get all logged errors
   */
  getErrors() {
    return [...this.errors];
  }

  /**
   * Get error statistics
   */
  getStats() {
    const stats = {
      totalErrors: this.errors.length,
      uniqueErrors: this.errorCounts.size,
      topErrors: []
    };

    // Get top 10 most frequent errors
    const sortedErrors = Array.from(this.errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    stats.topErrors = sortedErrors.map(([key, count]) => ({
      error: key.split('|')[0],
      count
    }));

    return stats;
  }

  /**
   * Clear error history
   */
  clear() {
    this.errors = [];
    this.errorCounts.clear();
  }

  /**
   * Enable/disable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Export errors for debugging
   */
  export() {
    return JSON.stringify({
      errors: this.errors,
      stats: this.getStats(),
      timestamp: new Date().toISOString()
    }, null, 2);
  }
}

// Export singleton instance
export const errorLogger = new ErrorLogger();
