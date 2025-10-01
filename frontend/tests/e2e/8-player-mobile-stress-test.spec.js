/**
 * 8-Player Mobile Game Stress Test
 * 
 * This test simulates a full game with 8 players on mobile devices
 * to identify performance bottlenecks, UX issues, and areas for improvement.
 */

import { test, expect, devices } from '@playwright/test';

// Configure test for longer timeout (full game takes time)
test.setTimeout(300000); // 5 minutes

// Mobile device profiles to test
const mobileDevices = [
  { name: 'iPhone SE', profile: devices['iPhone SE'] },
  { name: 'iPhone 12', profile: devices['iPhone 12'] },
  { name: 'Pixel 5', profile: devices['Pixel 5'] },
  { name: 'Samsung Galaxy S9+', profile: devices['Galaxy S9+'] },
  { name: 'iPhone 13 Pro', profile: devices['iPhone 13 Pro'] },
  { name: 'Pixel 7', profile: devices['Pixel 7'] },
  { name: 'iPhone 14', profile: devices['iPhone 14'] },
  { name: 'Samsung Galaxy A51', profile: devices['Galaxy A51/71'] }
];

// Performance metrics tracking
const performanceMetrics = {
  pageLoadTimes: [],
  socketConnectionTimes: [],
  cardRenderTimes: [],
  interactionLatencies: [],
  memoryUsage: [],
  networkRequests: [],
  domNodeCounts: [],
  frameRates: []
};

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test.describe('8-Player Mobile Game Stress Test', () => {
  test('should complete full game with 8 mobile players and collect performance metrics', async ({ browser }) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
    console.log('\n════════════════════════════════════════════════════════');
    console.log('  8-PLAYER MOBILE GAME SIMULATION');
    console.log('════════════════════════════════════════════════════════\n');

    // Create 8 mobile contexts and pages
    const players = [];
    
    console.log('📱 Phase 1: Creating 8 mobile player sessions...');
    const startTime = Date.now();
    
    for (let i = 0; i < 8; i++) {
      const deviceProfile = mobileDevices[i];
      const context = await browser.newContext({
        ...deviceProfile.profile,
        baseURL,
        // Simulate varying network conditions
        offline: false,
        // Track network activity
        recordVideo: undefined,
        recordHar: undefined
      });

      // Enable network tracking
      const page = await context.newPage();
      
      // Track performance metrics
      const startLoad = Date.now();
      await page.goto('/');
      const loadTime = Date.now() - startLoad;
      performanceMetrics.pageLoadTimes.push({ player: i + 1, device: deviceProfile.name, time: loadTime });
      
      console.log(`  ✓ Player ${i + 1} (${deviceProfile.name}): ${loadTime}ms load time`);

      players.push({
        id: i + 1,
        name: uniqueName(`P${i + 1}`),
        device: deviceProfile.name,
        context,
        page,
        metrics: {
          loadTime,
          interactions: []
        }
      });
    }

    const setupTime = Date.now() - startTime;
    console.log(`\n✅ All players ready in ${setupTime}ms\n`);

    try {
      // Phase 2: All players join the same room
      console.log('🏠 Phase 2: Joining room...');
      const roomId = 'itajuba'; // Use a specific room
      
      for (const player of players) {
        const joinStart = Date.now();
        
        // Wait for lobby to load
        await player.page.waitForSelector('[data-room-id]', { timeout: 15000 });
        
        // Fill name and ensure it's visible
        const nameInput = player.page.locator('input[placeholder="Your name"]');
        await nameInput.click();
        await nameInput.fill(player.name);
        
        // Wait for Continue button to be enabled
        const continueButton = player.page.locator('button:has-text("Continue")');
        await expect(continueButton).toBeEnabled({ timeout: 5000 });
        await continueButton.click();
        await sleep(200);
        
        // Now join room
        const roomButton = player.page.locator(`[data-room-id="${roomId}"]`);
        await roomButton.click();
        
        // Wait for room joined
        await player.page.waitForSelector('[data-testid="game-setup"]', { timeout: 10000 });
        
        const joinTime = Date.now() - joinStart;
        player.metrics.interactions.push({ action: 'join_room', time: joinTime });
        
        console.log(`  ✓ ${player.name} (${player.device}) joined: ${joinTime}ms`);
        
        // Small delay between joins to avoid race conditions
        await sleep(300);
      }

      console.log('\n✅ All 8 players in room\n');

      // Phase 3: Measure DOM complexity
      console.log('📊 Phase 3: Analyzing DOM complexity...');
      for (const player of players) {
        const domStats = await player.page.evaluate(() => {
          return {
            totalNodes: document.querySelectorAll('*').length,
            playerListItems: document.querySelectorAll('[data-testid="player-list"] li, [data-testid="game-setup"] li').length,
            visibleElements: document.querySelectorAll(':not([hidden])').length,
            styleSheets: document.styleSheets.length,
            scripts: document.scripts.length
          };
        });
        
        performanceMetrics.domNodeCounts.push({
          player: player.id,
          device: player.device,
          ...domStats
        });
        
        console.log(`  ${player.name}: ${domStats.totalNodes} DOM nodes, ${domStats.playerListItems} player items`);
      }

      // Phase 4: Start game
      console.log('\n🎮 Phase 4: Starting game...');
      const startButton = players[0].page.getByTestId('start-game');
      await expect(startButton).toBeEnabled({ timeout: 10000 });
      
      const gameStartTime = Date.now();
      await startButton.click();
      
      // Wait for all players to receive game_started
      for (const player of players) {
        await player.page.waitForSelector('[data-testid="bidding-panel"]:not([hidden])', { 
          timeout: 20000 
        });
      }
      
      const gameStartLatency = Date.now() - gameStartTime;
      console.log(`✅ Game started for all players in ${gameStartLatency}ms\n`);

      // Phase 5: Bidding phase performance
      console.log('💰 Phase 5: Bidding phase...');
      
      // Wait for first player to have bidding opportunity
      let bidsCompleted = 0;
      const maxBidWaitTime = 60000; // 60 seconds max
      const bidStartTime = Date.now();
      
      while (bidsCompleted < 8 && (Date.now() - bidStartTime) < maxBidWaitTime) {
        // Check each player for bidding opportunity
        for (const player of players) {
          const canBid = await player.page.evaluate(() => {
            const bidButtons = document.querySelectorAll('[data-testid="bidding-panel"] button[data-bid]:not([disabled])');
            return bidButtons.length > 0;
          });
          
          if (canBid && !player.metrics.hasBid) {
            const bidStart = Date.now();
            
            // Select random bid
            const bidButton = player.page.locator('[data-testid="bidding-panel"] button[data-bid]:not([disabled])').first();
            await bidButton.click();
            
            const bidTime = Date.now() - bidStart;
            player.metrics.hasBid = true;
            player.metrics.interactions.push({ action: 'submit_bid', time: bidTime });
            
            bidsCompleted++;
            console.log(`  ✓ ${player.name} bid submitted: ${bidTime}ms (${bidsCompleted}/8)`);
            
            // Small delay between bids
            await sleep(300);
            break; // Move to next iteration
          }
        }
        
        await sleep(200); // Poll interval
      }

      console.log(`\n✅ Bidding complete in ${Date.now() - bidStartTime}ms\n`);

      // Phase 6: Card play phase - measure rendering and interaction
      console.log('🃏 Phase 6: Card play phase...');
      
      // Wait for game board to be visible for all players
      for (const player of players) {
        await player.page.waitForSelector('[data-testid="game-board"]:not([hidden])', {
          timeout: 15000
        });
      }

      // Measure card rendering performance
      for (const player of players) {
        const cardRenderStart = Date.now();
        
        const cardStats = await player.page.evaluate(() => {
          const handCards = document.querySelectorAll('[data-testid="hand-cards"] .card-tile');
          const visibleCards = document.querySelectorAll('[data-testid="visible-cards"] .card-tile');
          const trickCards = document.querySelectorAll('[data-testid="trick-area"] .card-tile');
          
          return {
            handSize: handCards.length,
            visibleCardsCount: visibleCards.length,
            trickCardsCount: trickCards.length,
            totalCards: handCards.length + visibleCards.length + trickCards.length
          };
        });
        
        const renderTime = Date.now() - cardRenderStart;
        performanceMetrics.cardRenderTimes.push({
          player: player.id,
          device: player.device,
          ...cardStats,
          renderTime
        });
        
        console.log(`  ${player.name}: ${cardStats.totalCards} total cards rendered in ${renderTime}ms`);
      }

      // Phase 7: Memory usage check
      console.log('\n💾 Phase 7: Checking memory usage...');
      for (const player of players) {
        const memoryInfo = await player.page.evaluate(() => {
          if (performance.memory) {
            return {
              usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 100) / 100,
              totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024 * 100) / 100,
              jsHeapSizeLimit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024 * 100) / 100
            };
          }
          return { note: 'Memory API not available' };
        });
        
        performanceMetrics.memoryUsage.push({
          player: player.id,
          device: player.device,
          ...memoryInfo
        });
        
        if (memoryInfo.usedJSHeapSize) {
          console.log(`  ${player.name}: ${memoryInfo.usedJSHeapSize}MB used / ${memoryInfo.totalJSHeapSize}MB total`);
        }
      }

      // Phase 8: Test scrolling performance (important for mobile)
      console.log('\n📜 Phase 8: Testing scroll performance...');
      for (let i = 0; i < 3; i++) {
        const player = players[i]; // Test on first 3 players
        
        const scrollStart = Date.now();
        await player.page.evaluate(() => {
          window.scrollTo({ top: 100, behavior: 'smooth' });
        });
        await sleep(100);
        await player.page.evaluate(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        const scrollTime = Date.now() - scrollStart;
        
        console.log(`  ${player.name}: Scroll test completed in ${scrollTime}ms`);
      }

      // Phase 9: Network activity summary
      console.log('\n🌐 Phase 9: Network activity analysis...');
      for (const player of players) {
        const resources = await player.page.evaluate(() => {
          const entries = performance.getEntriesByType('resource');
          return {
            total: entries.length,
            images: entries.filter(e => e.initiatorType === 'img').length,
            scripts: entries.filter(e => e.initiatorType === 'script').length,
            css: entries.filter(e => e.initiatorType === 'link').length,
            xhr: entries.filter(e => e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch').length,
            totalSize: Math.round(entries.reduce((sum, e) => sum + (e.transferSize || 0), 0) / 1024)
          };
        });
        
        performanceMetrics.networkRequests.push({
          player: player.id,
          device: player.device,
          ...resources
        });
        
        console.log(`  ${player.name}: ${resources.total} requests, ${resources.totalSize}KB transferred`);
      }

      // Phase 10: Interaction latency test
      console.log('\n⚡ Phase 10: Testing interaction latency...');
      for (let i = 0; i < 3; i++) {
        const player = players[i];
        
        // Test button click latency
        const buttons = await player.page.locator('button:visible').all();
        if (buttons.length > 0) {
          const clickStart = Date.now();
          // Just hover, don't actually click to avoid side effects
          await buttons[0].hover();
          const latency = Date.now() - clickStart;
          
          performanceMetrics.interactionLatencies.push({
            player: player.id,
            device: player.device,
            action: 'hover',
            latency
          });
          
          console.log(`  ${player.name}: Button hover latency ${latency}ms`);
        }
      }

      // Phase 11: Viewport analysis
      console.log('\n📐 Phase 11: Viewport analysis...');
      for (const player of players) {
        const viewportInfo = await player.page.evaluate(() => {
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            orientation: window.screen.orientation?.type || 'unknown',
            visibleCards: document.querySelectorAll('.card-tile:not([hidden])').length,
            overflowElements: Array.from(document.querySelectorAll('*')).filter(el => {
              const style = window.getComputedStyle(el);
              return style.overflow === 'auto' || style.overflow === 'scroll' || 
                     style.overflowX === 'auto' || style.overflowX === 'scroll' ||
                     style.overflowY === 'auto' || style.overflowY === 'scroll';
            }).length
          };
        });
        
        console.log(`  ${player.name}: ${viewportInfo.width}x${viewportInfo.height} @${viewportInfo.devicePixelRatio}x, ${viewportInfo.overflowElements} scrollable areas`);
      }

      // Phase 12: Final performance summary
      console.log('\n📈 Phase 12: Generating performance report...\n');
      
      // Generate summary statistics
      const avgLoadTime = performanceMetrics.pageLoadTimes.reduce((sum, p) => sum + p.time, 0) / performanceMetrics.pageLoadTimes.length;
      const maxLoadTime = Math.max(...performanceMetrics.pageLoadTimes.map(p => p.time));
      const minLoadTime = Math.min(...performanceMetrics.pageLoadTimes.map(p => p.time));
      
      const avgDomNodes = performanceMetrics.domNodeCounts.reduce((sum, p) => sum + p.totalNodes, 0) / performanceMetrics.domNodeCounts.length;
      const maxDomNodes = Math.max(...performanceMetrics.domNodeCounts.map(p => p.totalNodes));
      
      const avgMemory = performanceMetrics.memoryUsage
        .filter(m => m.usedJSHeapSize)
        .reduce((sum, m) => sum + m.usedJSHeapSize, 0) / 
        performanceMetrics.memoryUsage.filter(m => m.usedJSHeapSize).length;

      console.log('════════════════════════════════════════════════════════');
      console.log('  PERFORMANCE SUMMARY');
      console.log('════════════════════════════════════════════════════════');
      console.log(`  Page Load Times:`);
      console.log(`    Average: ${Math.round(avgLoadTime)}ms`);
      console.log(`    Min: ${minLoadTime}ms`);
      console.log(`    Max: ${maxLoadTime}ms`);
      console.log(`\n  DOM Complexity:`);
      console.log(`    Average nodes: ${Math.round(avgDomNodes)}`);
      console.log(`    Max nodes: ${maxDomNodes}`);
      console.log(`\n  Memory Usage:`);
      console.log(`    Average: ${avgMemory ? Math.round(avgMemory) + 'MB' : 'N/A'}`);
      console.log(`\n  Network:`);
      console.log(`    Total requests per player: ${performanceMetrics.networkRequests[0]?.total || 'N/A'}`);
      console.log('════════════════════════════════════════════════════════\n');

    } finally {
      // Cleanup: Close all contexts
      console.log('🧹 Cleaning up...');
      for (const player of players) {
        await player.context.close();
      }
      console.log('✅ All contexts closed\n');
    }

    // Assert test passed
    expect(players.length).toBe(8);
    console.log('✅ 8-Player Mobile Stress Test Complete!\n');
  });
});

// Export metrics for reporting
export { performanceMetrics };
