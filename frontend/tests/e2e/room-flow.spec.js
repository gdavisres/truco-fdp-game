import { test, expect, devices } from '@playwright/test';
import process from 'node:process';

const waitForLobby = async (page) => {
  await page.goto('/');
  await page.getByText('Pick a room to join:').first().waitFor();
};

const selectRoom = async (page, roomId = 'campinas') => {
  const roomButton = page.locator(`[data-room-id="${roomId}"]`);
  await roomButton.first().click();
  return roomButton;
};

const uniqueName = (prefix) =>
  `${prefix}${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 900 + 100)}`;

test.describe('Room lobby experience', () => {
  test('mobile players can join using touch interactions', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['Pixel 5'],
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    });

    const page = await context.newPage();
    await waitForLobby(page);

    await page.evaluate(() => {
      document.body.dispatchEvent(new Event('touchstart', { bubbles: true }));
    });

    await expect(page.locator('body')).toHaveClass(/supports-touch/);

  const displayName = uniqueName('MobileUser');
  await page.getByPlaceholder('Enter your nickname').fill(displayName);
  await selectRoom(page);
  const joinButton = page.getByTestId('join-button');
  await expect(joinButton).toBeEnabled();
  await joinButton.tap();

    await expect(page.getByRole('heading', { name: 'Joined room' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Joined lobby' })).toBeVisible();

    await context.close();
  });

  test('prevents duplicate display names within the same room', async ({ browser }) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';

    const primaryContext = await browser.newContext({ baseURL });
    const primaryPage = await primaryContext.newPage();
    await waitForLobby(primaryPage);
  const duplicateName = uniqueName('Duplicate');
  await primaryPage.getByPlaceholder('Enter your nickname').fill(duplicateName);
  await selectRoom(primaryPage);
  const primaryJoin = primaryPage.getByTestId('join-button');
  await expect(primaryJoin).toBeEnabled();
  await primaryJoin.click();
    await expect(primaryPage.getByRole('heading', { name: 'Joined room' })).toBeVisible();

    const secondaryContext = await browser.newContext({ baseURL });
    const secondPage = await secondaryContext.newPage();
    await waitForLobby(secondPage);
  await secondPage.getByPlaceholder('Enter your nickname').fill(duplicateName);
    await selectRoom(secondPage);
  const secondJoin = secondPage.getByTestId('join-button');
  await expect(secondJoin).toBeEnabled();
  await secondJoin.click();

    const errorMessage = secondPage.getByTestId('name-error');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('already taken');

    await secondaryContext.close();
    await primaryContext.close();
  });

  test('surfaces offline status and recovers after connectivity returns', async ({ page }) => {
    await waitForLobby(page);
  const reconnectName = uniqueName('Reconnect');
  await page.getByPlaceholder('Enter your nickname').fill(reconnectName);
    await selectRoom(page, 'itajuba');
  const joinButton = page.getByTestId('join-button');
  await expect(joinButton).toBeEnabled();
  await joinButton.click();
    await expect(page.getByRole('heading', { name: 'Joined room' })).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.getByRole('heading', { name: 'Offline' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="connection-indicator"]')).toHaveAttribute('data-state', 'offline', {
      timeout: 15_000,
    });

    await page.context().setOffline(false);
    await expect(page.locator('[data-testid="connection-indicator"]')).toHaveAttribute('data-state', 'connected', {
      timeout: 20_000,
    });
  });
});
