/**
 * Debug test to capture console output for cards_dealt investigation
 */

import { test, expect } from '@playwright/test';

test.describe('Debug: Cards Dealt Event', () => {
  test('should receive cards_dealt event and show console logs', async ({ page, context }) => {
    const consoleLogs = [];
    const consoleWarnings = [];
    const consoleErrors = [];

    // Capture all console messages
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      
      if (type === 'log') {
        consoleLogs.push(text);
        console.log(`[BROWSER LOG] ${text}`);
      } else if (type === 'warn') {
        consoleWarnings.push(text);
        console.warn(`[BROWSER WARN] ${text}`);
      } else if (type === 'error') {
        consoleErrors.push(text);
        console.error(`[BROWSER ERROR] ${text}`);
      }
    });

    // Navigate to the app
    await page.goto('http://127.0.0.1:4173');
    await page.waitForLoadState('networkidle');

    console.log('\n=== Step 1: Page loaded ===');
    console.log('Console logs so far:', consoleLogs.length);

    // Navigate to room list
    const roomList = page.locator('[data-testid="room-list"]');
    await expect(roomList).toBeVisible({ timeout: 10000 });

    // Join a room
    const rooms = await page.locator('[data-testid="room-card"]').all();
    if (rooms.length > 0) {
      const displayNameInput = page.locator('[data-testid="display-name-input"]');
      await displayNameInput.fill('DebugPlayer1');
      
      const joinButton = rooms[0].locator('[data-testid="join-room"]');
      await joinButton.click();
      
      await page.waitForTimeout(1000);
      console.log('\n=== Step 2: Joined room ===');
      console.log('Console logs:', consoleLogs.length);
    }

    // Open second player in new page
    const player2Page = await context.newPage();
    player2Page.on('console', (msg) => {
      const text = msg.text();
      console.log(`[PLAYER2 LOG] ${text}`);
    });

    await player2Page.goto('http://127.0.0.1:4173');
    await player2Page.waitForLoadState('networkidle');

    const roomList2 = player2Page.locator('[data-testid="room-list"]');
    await expect(roomList2).toBeVisible({ timeout: 10000 });

    const rooms2 = await player2Page.locator('[data-testid="room-card"]').all();
    if (rooms2.length > 0) {
      const displayNameInput2 = player2Page.locator('[data-testid="display-name-input"]');
      await displayNameInput2.fill('DebugPlayer2');
      
      const joinButton2 = rooms2[0].locator('[data-testid="join-room"]');
      await joinButton2.click();
      
      await player2Page.waitForTimeout(1000);
      console.log('\n=== Step 3: Second player joined ===');
    }

    // Start the game
    const startButton = page.locator('[data-testid="start-game"]');
    await expect(startButton).toBeEnabled({ timeout: 5000 });
    await startButton.click();

    console.log('\n=== Step 4: Game started - waiting for cards_dealt event ===');
    
    // Wait a bit for events to process
    await page.waitForTimeout(3000);

    console.log('\n=== Final Console Logs ===');
    console.log('Total logs:', consoleLogs.length);
    console.log('Total warnings:', consoleWarnings.length);
    console.log('Total errors:', consoleErrors.length);

    // Print logs related to GameState
    const gameStateLogs = consoleLogs.filter(log => log.includes('[GameState]'));
    console.log('\n=== GameState Logs ===');
    gameStateLogs.forEach((log, i) => {
      console.log(`${i + 1}. ${log}`);
    });

    const cardsDealtLogs = consoleLogs.filter(log => log.includes('cards_dealt'));
    console.log('\n=== Cards Dealt Logs ===');
    if (cardsDealtLogs.length === 0) {
      console.log('❌ NO cards_dealt logs found!');
    } else {
      cardsDealtLogs.forEach((log, i) => {
        console.log(`${i + 1}. ${log}`);
      });
    }

    // Check warnings
    if (consoleWarnings.length > 0) {
      console.log('\n=== Warnings ===');
      consoleWarnings.forEach((warn, i) => {
        console.log(`${i + 1}. ${warn}`);
      });
    }

    // Check errors
    if (consoleErrors.length > 0) {
      console.log('\n=== Errors ===');
      consoleErrors.forEach((error, i) => {
        console.log(`${i + 1}. ${error}`);
      });
    }

    // Clean up
    await player2Page.close();
    
    // This test always passes - we're just gathering diagnostic info
    expect(true).toBe(true);
  });
});
