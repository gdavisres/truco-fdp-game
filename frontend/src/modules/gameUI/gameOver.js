import '../../css/gameOver.css';
import { registerModule } from '../moduleRegistry.js';

const formatDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '—';
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

const createTemplate = () => {
  const section = document.createElement('section');
  section.className = 'game-over';
  section.dataset.testid = 'game-over-panel';
  section.hidden = true;

  section.innerHTML = `
    <div class="game-over__hero">
      <p class="game-over__subtitle">Game over</p>
      <h2 class="game-over__winner" data-testid="game-over-winner">—</h2>
      <p class="game-over__message" data-testid="game-over-message"></p>
    </div>
    <div class="game-over__stats">
      <div class="game-over__stat">
        <span class="game-over__statLabel">Duration</span>
        <span class="game-over__statValue" data-testid="game-over-duration">—</span>
      </div>
      <div class="game-over__stat">
        <span class="game-over__statLabel">Rounds</span>
        <span class="game-over__statValue" data-testid="game-over-rounds">—</span>
      </div>
      <div class="game-over__stat">
        <span class="game-over__statLabel">Tricks</span>
        <span class="game-over__statValue" data-testid="game-over-tricks">—</span>
      </div>
    </div>
    <ol class="game-over__standings" data-testid="game-over-standings" role="list"></ol>
    <div class="game-over__actions">
      <button type="button" class="game-over__return" data-testid="return-to-lobby">Return to lobby</button>
      <button type="button" class="game-over__share" data-testid="share-results">Share results</button>
      <button type="button" class="game-over__start" data-testid="start-new-game">Start new game</button>
    </div>
  `;

  return section;
};

const renderStandings = ({ list, standings, playerId }) => {
  if (!list) {
    return;
  }

  const present = new Set();

  standings.forEach((entry, index) => {
    const rank = index + 1;
    const playerKey = entry.playerId ?? `ghost-${index}`;
    present.add(playerKey);

    let item = list.querySelector(`[data-player-id="${playerKey}"]`);
    if (!item) {
      item = document.createElement('li');
      item.className = 'game-over__standing';
      item.dataset.playerId = playerKey;
      item.innerHTML = `
        <div class="game-over__standingName" data-testid="standing-name"></div>
        <div class="game-over__standingMeta" data-testid="standing-meta"></div>
        <div class="game-over__standingLives" data-testid="standing-lives"></div>
      `;
      list.append(item);
    }

    item.dataset.rank = String(rank);

    const displayName = entry.displayName ?? entry.playerId ?? 'Unknown player';
    const nameEl = item.querySelector('[data-testid="standing-name"]');
    if (nameEl) {
      nameEl.textContent = displayName;
      if (playerId && entry.playerId === playerId) {
        nameEl.textContent = `${displayName} (You)`;
      }
    }

    const metaEl = item.querySelector('[data-testid="standing-meta"]');
    if (metaEl) {
      metaEl.textContent = `Rank #${rank}`;
    }

    const livesEl = item.querySelector('[data-testid="standing-lives"]');
    if (livesEl) {
      livesEl.textContent = Number.isFinite(entry.livesRemaining)
        ? `${entry.livesRemaining} lives`
        : '—';
    }
  });

  Array.from(list.querySelectorAll('[data-player-id]')).forEach((node) => {
    if (!present.has(node.dataset.playerId)) {
      node.remove();
    }
  });
};

const buildSharePayload = ({ result }) => {
  if (!result) {
    return null;
  }

  const winnerName = result.standings?.find((entry) => entry.playerId === result.winner)?.displayName ?? result.winner;
  const rounds = Number.isFinite(result.stats?.totalRounds) ? result.stats.totalRounds : '—';
  const duration = formatDuration(result.stats?.duration);

  const textLines = [
    winnerName ? `${winnerName} won the Truco FDP match!` : 'Truco FDP game finished!',
    `Rounds played: ${rounds}`,
    `Duration: ${duration}`,
  ];

  return {
    title: 'Truco FDP — Game Results',
    text: textLines.join('\n'),
    url: window.location?.href ?? undefined,
  };
};

export const init = async (context) => {
  const moduleRoot = context?.appRoot?.querySelector('[data-testid="module-root"]');
  if (!moduleRoot) {
    throw new Error('Game over module requires a module root container.');
  }

  const store = context?.gameState;
  if (!store || typeof store.subscribe !== 'function') {
    throw new Error('Game over module requires gameState store in context.');
  }

  const section = createTemplate();
  moduleRoot.append(section);

  const winnerEl = section.querySelector('[data-testid="game-over-winner"]');
  const messageEl = section.querySelector('[data-testid="game-over-message"]');
  const durationEl = section.querySelector('[data-testid="game-over-duration"]');
  const roundsEl = section.querySelector('[data-testid="game-over-rounds"]');
  const tricksEl = section.querySelector('[data-testid="game-over-tricks"]');
  const standingsList = section.querySelector('[data-testid="game-over-standings"]');
  const returnButton = section.querySelector('[data-testid="return-to-lobby"]');
  const shareButton = section.querySelector('[data-testid="share-results"]');
  const startButton = section.querySelector('[data-testid="start-new-game"]');

  const handleReturnToLobby = () => {
    context.networkClient?.emit?.('leave_room');
  };

  const handleStartGame = () => {
    context.networkClient?.emit?.('start_game');
  };

  const handleShare = (payload) => {
    const nav = typeof navigator !== 'undefined' ? navigator : null;

    if (nav && typeof nav.share === 'function') {
      nav.share(payload).catch(() => {
        context.renderSystemMessage?.('Share cancelled', 'Unable to share game results.');
      });
      return;
    }

    const summary = payload?.text ?? 'Game complete!';
    if (nav?.clipboard?.writeText) {
      nav.clipboard
        .writeText(summary)
        .then(
          () => context.renderSystemMessage?.('Results copied', 'Game summary copied to clipboard.'),
          () => context.renderSystemMessage?.('Unable to copy', summary),
        );
      return;
    }

    context.renderSystemMessage?.('Share not supported', summary);
  };

  returnButton?.addEventListener('click', handleReturnToLobby);
  const handleShareClick = () => {
    const payload = buildSharePayload({
      roomId: context.state?.currentRoom?.roomId,
      result: store.getState().gameResult,
    });

    if (!payload) {
      context.renderSystemMessage?.('Nothing to share', 'No completed game summary available yet.');
      return;
    }

    handleShare(payload);
  };

  shareButton?.addEventListener('click', handleShareClick);

  startButton?.addEventListener('click', handleStartGame);

  const unsubscribe = store.subscribe((state) => {
    const result = state.gameResult;
    const showPanel = state.phase === 'completed' && result;
    section.hidden = !showPanel;
    section.dataset.visible = showPanel ? 'true' : 'false';

    if (!showPanel) {
      return;
    }

    const winnerName = result.winner
      ? result.standings?.find((entry) => entry.playerId === result.winner)?.displayName ?? result.winner
      : 'No winner';

    if (winnerEl) {
      winnerEl.textContent = winnerName;
    }

    if (messageEl) {
      if (result.reason === 'timeout') {
        messageEl.textContent = 'Time limit reached — match ends in a draw.';
      } else if (result.winner) {
        messageEl.textContent = `${winnerName} outlasted the table.`;
      } else {
        messageEl.textContent = 'Match concluded without a clear winner.';
      }
    }

    if (durationEl) {
      durationEl.textContent = formatDuration(result.stats?.duration);
    }

    if (roundsEl) {
      roundsEl.textContent = Number.isFinite(result.stats?.totalRounds) ? result.stats.totalRounds : '—';
    }

    if (tricksEl) {
      tricksEl.textContent = Number.isFinite(result.stats?.totalTricks) ? result.stats.totalTricks : '—';
    }

    renderStandings({ list: standingsList, standings: result.standings ?? [], playerId: state.playerId });

    const isHost = Boolean(state.isHost);
    if (startButton) {
      startButton.hidden = !isHost;
      startButton.disabled = !isHost;
    }
  });

  const destroy = () => {
    unsubscribe?.();
    returnButton?.removeEventListener('click', handleReturnToLobby);
    shareButton?.removeEventListener('click', handleShareClick);
    startButton?.removeEventListener('click', handleStartGame);
    section.remove();
  };

  return { destroy };
};

registerModule(() => Promise.resolve({ init }));
