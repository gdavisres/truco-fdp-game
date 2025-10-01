/**
 * Error Notification System
 * 
 * Displays user-friendly error notifications with recovery actions.
 */

class ErrorNotification {
  constructor() {
    this.container = null;
    this.notifications = [];
    this.nextId = 1;
  }

  /**
   * Initialize the notification system
   */
  initialize() {
    if (this.container) return;

    // Create notification container
    this.container = document.createElement('div');
    this.container.className = 'error-notifications';
    this.container.setAttribute('role', 'alert');
    this.container.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.container);
  }

  /**
   * Show an error notification
   * @param {Object} options
   * @param {'info'|'warning'|'error'|'critical'} options.severity
   * @param {string} options.message - User-friendly message
   * @param {Error} options.error - Original error object
   * @param {Array} options.actions - Recovery actions
   * @param {number} options.duration - Auto-hide duration (0 = manual dismiss only)
   */
  show({ severity = 'error', message, error, actions = [], duration = 0 }) {
    this.initialize();

    const id = this.nextId++;
    const notification = {
      id,
      severity,
      message,
      error,
      actions,
      timestamp: Date.now()
    };

    this.notifications.push(notification);

    const element = this.createNotificationElement(notification);
    this.container.appendChild(element);

    // Auto-hide for non-critical errors
    if (duration > 0 || (severity === 'info' || severity === 'warning')) {
      const hideDelay = duration || (severity === 'info' ? 3000 : 5000);
      setTimeout(() => this.hide(id), hideDelay);
    }

    return id;
  }

  /**
   * Create notification DOM element
   */
  createNotificationElement(notification) {
    const { id, severity, message, actions } = notification;

    const element = document.createElement('div');
    element.className = `error-notification error-notification--${severity}`;
    element.setAttribute('data-notification-id', id);

    // Icon
    const icon = document.createElement('div');
    icon.className = 'error-notification__icon';
    icon.innerHTML = this.getIcon(severity);
    element.appendChild(icon);

    // Content
    const content = document.createElement('div');
    content.className = 'error-notification__content';

    const messageEl = document.createElement('div');
    messageEl.className = 'error-notification__message';
    messageEl.textContent = message;
    content.appendChild(messageEl);

    // Actions
    if (actions.length > 0) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'error-notification__actions';

      actions.forEach(action => {
        const button = document.createElement('button');
        button.className = 'error-notification__action';
        button.textContent = action.label;
        button.onclick = () => {
          action.action();
          this.hide(id);
        };
        actionsEl.appendChild(button);
      });

      content.appendChild(actionsEl);
    }

    element.appendChild(content);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'error-notification__close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.onclick = () => this.hide(id);
    element.appendChild(closeBtn);

    return element;
  }

  /**
   * Get icon HTML for severity level
   */
  getIcon(severity) {
    const icons = {
      info: '&#9432;', // ℹ
      warning: '&#9888;', // ⚠
      error: '&#10008;', // ✖
      critical: '&#128165;' // 💥
    };
    return icons[severity] || icons.error;
  }

  /**
   * Hide a notification
   */
  hide(id) {
    const element = this.container?.querySelector(`[data-notification-id="${id}"]`);
    if (!element) return;

    element.classList.add('error-notification--hiding');
    
    setTimeout(() => {
      element.remove();
      this.notifications = this.notifications.filter(n => n.id !== id);
    }, 300);
  }

  /**
   * Hide all notifications
   */
  hideAll() {
    this.notifications.forEach(n => this.hide(n.id));
  }

  /**
   * Show success message (convenience method)
   */
  success(message, duration = 3000) {
    return this.show({
      severity: 'info',
      message,
      duration
    });
  }

  /**
   * Show warning message (convenience method)
   */
  warning(message, duration = 5000) {
    return this.show({
      severity: 'warning',
      message,
      duration
    });
  }

  /**
   * Show error message (convenience method)
   */
  error(message, actions = []) {
    return this.show({
      severity: 'error',
      message,
      actions
    });
  }

  /**
   * Destroy notification system
   */
  destroy() {
    this.hideAll();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}

// Export singleton instance
export const errorNotification = new ErrorNotification();
