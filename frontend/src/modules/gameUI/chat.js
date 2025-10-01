import '../../css/chat.css';
import { registerModule } from '../moduleRegistry.js';

const MAX_MESSAGE_LENGTH = 200;

const createTemplate = () => {
  const section = document.createElement('section');
  section.className = 'chat';
  section.dataset.testid = 'chat-panel';
  section.dataset.state = 'collapsed';

  section.innerHTML = `
    <button class="chat__toggle" type="button" data-testid="chat-toggle" aria-expanded="false" aria-controls="chat-body">
      <span class="chat__toggleLabel">Chat</span>
      <span class="chat__indicator" data-testid="chat-indicator" hidden>0</span>
    </button>
    <div class="chat__panel" data-testid="chat-body" id="chat-body" hidden>
      <header class="chat__header">
        <h2 class="chat__title">Table chat</h2>
        <button class="chat__close" data-testid="chat-close" type="button" aria-label="Hide chat">×</button>
      </header>
      <div class="chat__messages" data-testid="chat-messages" role="log" aria-live="polite"></div>
      <footer class="chat__footer">
        <p class="chat__status" data-testid="chat-status" hidden></p>
        <form class="chat__form" data-testid="chat-form" autocomplete="off">
          <label class="visually-hidden" for="chat-input">Chat message</label>
          <div class="chat__inputGroup">
            <input class="chat__input" data-testid="chat-input" id="chat-input" name="chat-input" type="text" maxlength="${MAX_MESSAGE_LENGTH}" placeholder="Say something nice…" autocomplete="off" />
            <button class="chat__send" data-testid="chat-send" type="submit">Send</button>
          </div>
        </form>
        <button class="chat__hostToggle" data-testid="spectator-toggle" type="button" hidden></button>
      </footer>
    </div>
  `;

  return section;
};

const describeChatError = (code) => {
  const map = {
    spectator_chat_disabled: 'Spectator chat is disabled by the host.',
    rate_limited: 'You are sending messages too quickly.',
    invalid_message: `Chat message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`,
    delivery_failure: 'Unable to deliver chat message. Please retry.',
    invalid_state: 'You must join a room before chatting.',
  };

  return map[code] ?? 'Unable to send chat message.';
};

const formatDisplayName = (entry) => {
  if (!entry) {
    return 'Unknown';
  }

  if (entry.type === 'system') {
    return entry.displayName ?? 'System';
  }

  return entry.displayName ?? entry.playerId ?? 'Unknown';
};

const renderMessages = ({
  messagesEl,
  messages,
  selfId,
  onNewMessage,
  collapsed,
  viewState,
}) => {
  if (!messagesEl) {
    return;
  }

  const lastKnownId = viewState.lastMessageId;
  const lastEntry = messages.at(-1) ?? null;

  if (messages.length === messagesEl.childElementCount && lastEntry?.messageId === lastKnownId) {
    return;
  }

  messagesEl.innerHTML = '';

  messages.forEach((entry) => {
    const item = document.createElement('article');
    const type = entry.type ?? (entry.isSpectator ? 'spectator' : 'player');
    item.className = `chat__message chat__message--${type}`;

    const isSelf = selfId && entry.playerId === selfId;
    if (isSelf) {
      item.classList.add('chat__message--self');
    }

    const header = document.createElement('header');
    header.className = 'chat__meta';
    const name = formatDisplayName(entry);
    header.textContent = entry.type === 'system' ? name : `${name}${entry.isSpectator ? ' (spectator)' : ''}`;

    const body = document.createElement('p');
    body.className = 'chat__text';
    body.textContent = entry.message ?? '';

    item.append(header, body);
    messagesEl.append(item);
  });

  const newMessageId = lastEntry?.messageId ?? null;
  const latestPayload = newMessageId && lastEntry?.playerId !== selfId && lastEntry?.type !== 'system' ? lastEntry : null;

  if (latestPayload && newMessageId !== lastKnownId) {
    onNewMessage?.(latestPayload, { collapsed });
  }

  viewState.lastMessageId = newMessageId;

  if (!collapsed) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
};

export const init = async (context) => {
  const moduleRoot = context?.appRoot?.querySelector('[data-testid="module-root"]');
  if (!moduleRoot) {
    throw new Error('Chat module requires a module root container.');
  }

  const store = context?.gameState;
  if (!store || typeof store.subscribe !== 'function') {
    throw new Error('Chat module requires a gameState store.');
  }

  const networkClient = context?.networkClient;
  if (!networkClient || typeof networkClient.emit !== 'function') {
    throw new Error('Chat module requires a networkClient with emit support.');
  }

  const section = createTemplate();
  moduleRoot.append(section);

  const toggleButton = section.querySelector('[data-testid="chat-toggle"]');
  const panel = section.querySelector('[data-testid="chat-body"]');
  const closeButton = section.querySelector('[data-testid="chat-close"]');
  const messagesEl = section.querySelector('[data-testid="chat-messages"]');
  const statusEl = section.querySelector('[data-testid="chat-status"]');
  const form = section.querySelector('[data-testid="chat-form"]');
  const inputEl = section.querySelector('[data-testid="chat-input"]');
  const sendButton = section.querySelector('[data-testid="chat-send"]');
  const spectatorToggle = section.querySelector('[data-testid="spectator-toggle"]');
  const indicatorEl = section.querySelector('[data-testid="chat-indicator"]');

  const viewState = {
    collapsed: true,
    unreadCount: 0,
    lastMessageId: null,
    notifiedMessageId: null,
    sending: false,
    updatingHostSettings: false,
  };

  const updateIndicator = () => {
    if (!indicatorEl || !toggleButton) {
      return;
    }

    const showIndicator = viewState.collapsed && viewState.unreadCount > 0;
    if (showIndicator) {
      indicatorEl.hidden = false;
      indicatorEl.textContent = viewState.unreadCount > 9 ? '9+' : String(viewState.unreadCount);
    } else {
      indicatorEl.hidden = true;
      indicatorEl.textContent = '';
    }

    toggleButton.setAttribute('aria-expanded', viewState.collapsed ? 'false' : 'true');
  };

  const setCollapsed = (collapsed) => {
    viewState.collapsed = collapsed;
    if (panel) {
      panel.hidden = collapsed;
    }

    section.dataset.state = collapsed ? 'collapsed' : 'open';

    if (!collapsed) {
      viewState.unreadCount = 0;
      updateIndicator();
      if (messagesEl) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } else {
      updateIndicator();
    }
  };

  const updateStatusMessage = (message) => {
    if (!statusEl) {
      return;
    }

    if (message) {
      statusEl.textContent = message;
      statusEl.hidden = false;
    } else {
      statusEl.textContent = '';
      statusEl.hidden = true;
    }
  };

  const refreshSendState = (state) => {
    if (!inputEl || !sendButton) {
      return;
    }

    const spectatorAllowed = state.hostSettings?.allowSpectatorChat !== false;
    const isSpectator = Boolean(state.isSpectator);
    const offline = Boolean(state.offline);
    const canSend = !viewState.sending && !offline && (!isSpectator || spectatorAllowed);

    inputEl.disabled = !canSend;
    sendButton.disabled = !canSend || !inputEl.value.trim();

    if (!spectatorAllowed && isSpectator) {
      updateStatusMessage('Spectator chat disabled by host.');
    } else if (offline) {
      updateStatusMessage('Offline — messages paused.');
    } else {
      updateStatusMessage('');
    }

    if (spectatorToggle) {
      if (state.isHost) {
        spectatorToggle.hidden = false;
        spectatorToggle.textContent = spectatorAllowed ? 'Disable spectator chat' : 'Allow spectator chat';
        const phase = state.phase ?? 'idle';
        const canModify = phase === 'waiting' || phase === 'idle';
        spectatorToggle.disabled = viewState.updatingHostSettings || !canModify;
      } else {
        spectatorToggle.hidden = true;
      }
    }
  };

  const handleNewMessage = (entry, { collapsed }) => {
    if (!collapsed) {
      return;
    }

    if (entry.messageId && entry.messageId !== viewState.notifiedMessageId) {
      viewState.unreadCount = Math.min(99, viewState.unreadCount + 1);
      viewState.notifiedMessageId = entry.messageId;
      updateIndicator();
    }
  };

  const renderState = (state) => {
    const messages = Array.isArray(state.chat?.messages) ? state.chat.messages : [];
    renderMessages({
      messagesEl,
      messages,
      selfId: state.playerId,
      onNewMessage: handleNewMessage,
      collapsed: viewState.collapsed,
      viewState,
    });

    refreshSendState(state);
  };

  const unsubscribe = store.subscribe(renderState);
  renderState(store.getState());
  updateIndicator();

  const sendChatMessage = (value) => {
    const trimmed = value.trim();
    if (!trimmed || viewState.sending) {
      return;
    }

    viewState.sending = true;
    refreshSendState(store.getState());

    const ack = (response) => {
      viewState.sending = false;
      refreshSendState(store.getState());

      if (response?.error) {
        const message = describeChatError(response.error);
        updateStatusMessage(message);
        context.renderSystemMessage?.('Chat message failed', message);
        return;
      }

      if (inputEl) {
        inputEl.value = '';
      }
      refreshSendState(store.getState());
    };

    try {
      networkClient.emit('chat_message', { message: trimmed }, ack);
    } catch (error) {
      viewState.sending = false;
      refreshSendState(store.getState());
      const message = error?.message ?? 'Unable to send chat message.';
      updateStatusMessage(message);
      context.renderSystemMessage?.('Chat error', message);
    }
  };

  const toggleSpectatorChat = () => {
    if (!spectatorToggle || viewState.updatingHostSettings) {
      return;
    }

    const state = store.getState();
    const spectatorAllowed = state.hostSettings?.allowSpectatorChat !== false;

    viewState.updatingHostSettings = true;
    refreshSendState(state);

    const ack = (response) => {
      viewState.updatingHostSettings = false;
      refreshSendState(store.getState());

      if (response?.error) {
        const message = describeChatError(response.error);
        updateStatusMessage(message);
        context.renderSystemMessage?.('Host setting update failed', message);
      }
    };

    try {
      networkClient.emit('update_host_settings', { allowSpectatorChat: !spectatorAllowed }, ack);
    } catch (error) {
      viewState.updatingHostSettings = false;
      const message = error?.message ?? 'Unable to update spectator chat preference.';
      updateStatusMessage(message);
      context.renderSystemMessage?.('Host setting update failed', message);
    }
  };

  const handleToggleClick = () => {
    setCollapsed(!viewState.collapsed);
  };

  const handleCloseClick = () => setCollapsed(true);
  const handleInputChange = () => refreshSendState(store.getState());
  const handleFormSubmit = (event) => {
    event.preventDefault();
    if (!inputEl) {
      return;
    }
    sendChatMessage(inputEl.value);
  };

  toggleButton?.addEventListener('click', handleToggleClick);
  closeButton?.addEventListener('click', handleCloseClick);
  inputEl?.addEventListener('input', handleInputChange);
  form?.addEventListener('submit', handleFormSubmit);

  spectatorToggle?.addEventListener('click', toggleSpectatorChat);

  return {
    destroy: () => {
      unsubscribe?.();
      toggleButton?.removeEventListener('click', handleToggleClick);
      closeButton?.removeEventListener('click', handleCloseClick);
      form?.removeEventListener('submit', handleFormSubmit);
      spectatorToggle?.removeEventListener('click', toggleSpectatorChat);
      inputEl?.removeEventListener('input', handleInputChange);

      try {
        section.remove();
      } catch (error) {
        // ignore removal errors
      }
    },
  };
};

registerModule(async () => ({ init }));
