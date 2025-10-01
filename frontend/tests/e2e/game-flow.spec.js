import { test, expect } from '@playwright/test';
import process from 'node:process';

const waitForLobby = async (page) => {
  await page.goto('/');
  await page.getByText('Pick a room to join:').first().waitFor();
};

const uniqueName = (prefix) => `${prefix}${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 900 + 100)}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const joinRoom = async (page, { displayName, roomId = 'auto' }) => {
  await waitForLobby(page);

  let targetRoomId = roomId;

  if (roomId === 'auto') {
    const rooms = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/rooms', {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          return [];
        }
        return await response.json();
      } catch (error) {
        console.warn('Unable to load rooms for E2E test', error);
        return [];
      }
    });

    targetRoomId = rooms.find((room) => room.canJoin && room.playerCount === 0)?.roomId
      ?? rooms.find((room) => room.canJoin)?.roomId
      ?? rooms[0]?.roomId
      ?? 'itajuba';
  }

  const nameField = page.getByPlaceholder('Enter your nickname');
  await nameField.fill(displayName);

  const roomButton = page.locator(`[data-room-id="${targetRoomId}"]`).first();
  await roomButton.click();

  const joinButton = page.getByTestId('join-button');
  await expect(joinButton).toBeEnabled();
  await joinButton.click();

  await expect(page.getByRole('heading', { name: 'Joined room' })).toBeVisible();
  return { roomId: targetRoomId };
};

const waitForBidOpportunity = async (participants, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const entry of participants) {
      const locator = entry.page.locator('[data-testid="bid-option"]:not([disabled])');
      if (await locator.count()) {
        return { ...entry, locator: locator.first() };
      }
    }
    await sleep(100);
  }
  throw new Error('No bidding opportunity became available in time');
};

const performBid = async ({ page, locator }) => {
  const valueAttr = await locator.getAttribute('data-value');
  await locator.click();
  await expect(page.locator('[data-testid="bid-option"]:not([disabled])')).toHaveCount(0, { timeout: 6_000 });
  return Number.parseInt(valueAttr ?? 'NaN', 10);
};

const waitForCardOpportunity = async (participants, { timeout = 20_000, scoreboard } = {}) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (scoreboard && (await scoreboard.isVisible())) {
      return null;
    }

    for (const entry of participants) {
      const locator = entry.page.locator('[data-testid="player-hand"] .card-tile:not([disabled])');
      if (await locator.count()) {
        return { ...entry, locator: locator.first() };
      }
    }
    await sleep(100);
  }
  throw new Error('No playable card became available in time');
};

const playCard = async ({ locator }) => {
  const rank = await locator.getAttribute('data-rank');
  const suit = await locator.getAttribute('data-suit');
  await locator.click();
  return { rank, suit };
};

const toTrimmedText = async (locator) => (await locator.textContent())?.trim();

test.describe('Head-to-head game flow', () => {
  test('runs from lobby through bidding, play, and scoring', async ({ browser }) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';

    const hostContext = await browser.newContext({ baseURL });
    const guestContext = await browser.newContext({ baseURL });

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const hostName = uniqueName('Host');
    const guestName = uniqueName('Guest');

    try {
  const { roomId } = await joinRoom(hostPage, { displayName: hostName });
  await joinRoom(guestPage, { displayName: guestName, roomId });

  const playerList = hostPage.locator('[data-testid="player-list"]');
  await expect(playerList).toContainText(hostName);
  await expect(playerList).toContainText(guestName);

      const startButton = hostPage.getByTestId('start-game');
      await expect(startButton).toBeEnabled({ timeout: 10_000 });
      await startButton.click();

      await hostPage.waitForSelector('[data-testid="bidding-panel"]:not([hidden])', { timeout: 15_000 });

      const participants = [
        { role: 'host', name: hostName, page: hostPage },
        { role: 'guest', name: guestName, page: guestPage },
      ];

      const bids = [];
      for (let i = 0; i < participants.length; i += 1) {
        const bidder = await waitForBidOpportunity(participants);
        const value = await performBid(bidder);
        bids.push({ role: bidder.role, value });
      }

      await hostPage.waitForSelector('[data-testid="game-board"]:not([hidden])', { timeout: 15_000 });
      await guestPage.waitForSelector('[data-testid="game-board"]:not([hidden])', { timeout: 15_000 });

      await hostPage.waitForFunction(
        () => document.querySelectorAll('[data-testid="hand-cards"] .card-tile').length > 0,
        { timeout: 15_000 },
      );

      const handCount = await hostPage.locator('[data-testid="hand-cards"] .card-tile').count();
      const expectedPlays = Math.max(1, handCount) * participants.length;

      const plays = [];
      const hostScoringPanel = hostPage.locator('[data-testid="scoring-panel"]');

      for (let turn = 0; turn < expectedPlays; turn += 1) {
        const actor = await waitForCardOpportunity(participants, { scoreboard: hostScoringPanel });
        if (!actor) {
          break;
        }
        const card = await playCard(actor);
        plays.push({ role: actor.role, card });

        if (await hostScoringPanel.isVisible()) {
          break;
        }
      }

      await expect(hostScoringPanel).toBeVisible({ timeout: 15_000 });
      await expect(hostScoringPanel.locator('[data-testid="scoring-round"]')).toHaveText(/Round \d+/);

      const rows = hostScoringPanel.locator('[data-testid="scoring-rows"] li');
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: hostName })).toHaveCount(1);
      await expect(rows.filter({ hasText: guestName })).toHaveCount(1);

      const statusText = await toTrimmedText(hostScoringPanel.locator('[data-testid="scoring-status"]'));
      expect(statusText && statusText.length).toBeTruthy();

      const guestScoringPanel = guestPage.locator('[data-testid="scoring-panel"]');
      await expect(guestScoringPanel).toBeVisible({ timeout: 15_000 });

      // Confirm the next round starts by showing bidding again.
      await hostPage.waitForSelector('[data-testid="bidding-panel"]:not([hidden])', { timeout: 20_000 });

      // Basic sanity on recorded actions to aid debugging when flaky.
  expect(bids.length).toBeGreaterThanOrEqual(2);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
