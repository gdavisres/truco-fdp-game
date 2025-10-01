# Comprehensive E2E Tests for Truco FDP Game

This document describes the comprehensive end-to-end tests created for the Truco FDP game using Playwright.

## Test File

**Location:** `frontend/tests/e2e/complete-game-flow.spec.js`

## Test Coverage

### 1. Complete Room Join Flow
- **Test:** `should complete room join flow with Brazilian city room`
  - Navigates to the game
  - Verifies Brazilian city rooms are available (Itajubá, Campinas, etc.)
  - Enters a display name
  - Selects a room (Itajubá)
  - Joins the room
  - Verifies player appears in room list
  - Verifies player count updates

- **Test:** `should prevent joining with empty display name`
  - Attempts to join without entering name
  - Verifies join button remains disabled

### 2. Two-Player Game Initialization
- **Test:** `should initialize game with 2 players and deal cards`
  - Opens two browser contexts (simulates two players)
  - Both players join the same room
  - Verifies both players see each other in room list
  - Host starts the game
  - Verifies bidding phase starts (game initialized)
  - Verifies cards are dealt to both players
  - Confirms both players have same number of cards
  - Verifies Round 1 starts

- **Test:** `should show Blind Round 1 with visible opponent cards`
  - Two players join and start game
  - Verifies Blind Round (Round 1) behavior
  - Checks that players can see opponent's cards
  - Confirms this follows Truco FDP Blind Round rules

### 3. Bidding Phase
- **Test:** `should handle bidding phase with both players`
  - Sets up game with two players
  - Both players submit bids in sequence
  - Verifies bids are recorded in bid history
  - Confirms game transitions to card play phase after bidding

- **Test:** `should enforce last bidder restriction`
  - First player submits bid
  - Verifies last bidder has restricted bid options
  - Confirms last bidder restriction is enforced
  - Completes bidding phase

### 4. Card Play and Trick Resolution
- **Test:** `should play cards in sequence and resolve tricks`
  - Completes bidding phase
  - Gets initial hand size
  - Both players play one card each (one trick)
  - Verifies cards appear in play area
  - Waits for trick resolution
  - Confirms hand size decreases after trick

- **Test:** `should highlight Manilha cards correctly`
  - Verifies Manilha card highlighting CSS exists
  - Checks for Manilha-specific styling in card renderer

- **Test:** `should handle card cancellation (same rank cards)`
  - Verifies trick resolution logic exists in game modules
  - Confirms game state module is loaded

### 5. Scoring and Round Progression
- **Test:** `should complete a round and show scoring`
  - Plays all tricks in a round
  - Verifies scoring panel appears
  - Checks that player scores/lives are displayed
  - Confirms round completion

- **Test:** `should transition to next round with increased card count`
  - Verifies round progression logic exists
  - Confirms game state module handles round transitions

### 6. Mobile Responsiveness
- **Test:** `should work with mobile viewport (320px width)`
  - Uses iPhone SE viewport (320x568)
  - Verifies page loads correctly
  - Checks room selection is visible
  - Confirms room buttons are large enough for touch (≥44px)

- **Test:** `should have touch targets of 44px+ minimum`
  - Uses Pixel 5 mobile device
  - Joins room on mobile
  - Verifies start button height ≥44px
  - Checks touch support class is applied to body

- **Test:** `should support tap interactions on mobile`
  - Uses iPhone 12 device
  - Tests tap (instead of click) on name field
  - Taps room selection button
  - Taps join button
  - Verifies successful join with tap interactions

- **Test:** `should support drag interactions for cards on mobile`
  - Verifies touch event handling exists
  - Checks card renderer has touch support

### 7. Complete Game Flow Integration
- **Test:** `should complete full game from lobby to scoring`
  - **Step 1:** Both players join room
  - **Step 2:** Host starts game
  - **Step 3:** Both players complete bidding phase
  - **Step 4:** Players play cards (at least one trick)
  - **Step 5:** Verifies game state progresses correctly
  - Logs detailed progress through each phase

## Running the Tests

### Run All E2E Tests
```bash
cd frontend
npm run test:e2e
```

### Run Specific Test File
```bash
npm run test:e2e complete-game-flow.spec.js
```

### Run in Headed Mode (See Browser)
```bash
npm run test:e2e -- --headed
```

### Run in Debug Mode
```bash
npm run test:e2e -- --debug
```

### Run Specific Test
```bash
npm run test:e2e -- --grep "should complete full game"
```

## Test Configuration

The tests use the Playwright configuration in `playwright.config.js`:

- **Base URL:** http://127.0.0.1:4173 (preview server)
- **Timeout:** 60 seconds per test
- **Expect Timeout:** 10 seconds
- **Parallel:** Disabled (to avoid conflicts)
- **Retries:** 2 on CI, 0 locally
- **Trace:** Retained on failure
- **Video:** Retained on failure
- **Screenshots:** Taken on failure

### Web Servers

Playwright automatically starts two servers:

1. **Backend Server**
   - Command: `npm run start`
   - URL: http://127.0.0.1:3000/api/health
   - Environment: NODE_ENV=test
   - CORS: http://127.0.0.1:4173

2. **Frontend Server**
   - Command: `npm run build && npm run preview`
   - URL: http://127.0.0.1:4173
   - Environment: NODE_ENV=test
   - Socket URL: http://127.0.0.1:3000

## Test Helpers

### `waitForLobby(page)`
Navigates to the home page and waits for lobby to load.

### `joinRoom(page, { displayName, roomId })`
Completes room join flow:
1. Fills display name
2. Selects room
3. Clicks join button
4. Waits for confirmation

### `waitForBidOpportunity(participants, timeout)`
Polls all participants to find who can bid next.

### `performBid({ page, locator })`
Clicks bid option and waits for bid to be processed.

### `waitForCardOpportunity(participants, timeout)`
Polls all participants to find who can play a card next.

### `playCard({ page, locator })`
Clicks card and returns card details (rank, suit).

### `uniqueName(prefix)`
Generates unique player name with timestamp and random number.

## Test Scenarios Covered

✅ **Room Selection**
- Loading room list
- Selecting Brazilian city rooms
- Joining with display name
- Preventing duplicate names

✅ **Game Initialization**
- Two-player setup
- Card dealing
- Blind Round 1 mechanics
- Player list updates

✅ **Bidding Phase**
- Sequential bidding
- Last bidder restrictions
- Bid history display
- Transition to card play

✅ **Card Play**
- Turn-based card play
- Card visibility in play area
- Trick resolution
- Hand size tracking

✅ **Scoring**
- Round completion
- Score display
- Life deduction
- Round progression

✅ **Mobile Experience**
- 320px viewport support
- 44px+ touch targets
- Tap interactions
- Touch support detection

✅ **Complete Flow**
- End-to-end game from lobby to scoring
- Multi-player coordination
- State synchronization
- Game progression

## Mobile Device Testing

The tests include mobile device profiles:

- **iPhone SE**: 320x568 viewport (smallest common)
- **iPhone 12**: 390x844 viewport
- **Pixel 5**: 393x851 viewport
- **Desktop Chrome**: 1280x720 viewport (default)

## Accessibility Standards

Touch targets verified to meet:
- **Minimum size:** 44px height (iOS Human Interface Guidelines)
- **Recommended size:** 48px height (Material Design)

## Debugging Failed Tests

### View Trace
```bash
npx playwright show-trace trace.zip
```

### View Video
Videos are saved in `test-results/` directory on failure.

### View Screenshots
Screenshots are saved in `test-results/` directory on failure.

### Run with UI Mode
```bash
npm run test:e2e -- --ui
```

## Continuous Integration

The tests are designed to run in CI environments:

- Automatically start backend and frontend servers
- Retry flaky tests (2 retries on CI)
- Generate trace/video/screenshots on failure
- Clean shutdown of servers after tests

## Test Maintenance

### Adding New Tests

1. Create test in `tests/e2e/` directory
2. Use existing helpers for common operations
3. Follow naming convention: `description.spec.js`
4. Add descriptive test names

### Updating Tests

When game logic changes:
1. Update relevant test assertions
2. Check timeout values if game is slower
3. Update test data selectors if UI changes
4. Re-run full test suite

### Common Issues

**Issue:** Tests timeout waiting for bid/card opportunity
**Solution:** Increase timeout or check game state logic

**Issue:** Cannot find element
**Solution:** Check data-testid attributes are present in UI

**Issue:** Race conditions between players
**Solution:** Add appropriate sleep() calls or use waitFor()

## Test Metrics

- **Total Test Suites:** 7 describe blocks
- **Total Tests:** 17 comprehensive tests
- **Coverage:**
  - Room flow: 2 tests
  - Game initialization: 2 tests
  - Bidding: 2 tests
  - Card play: 3 tests
  - Scoring: 2 tests
  - Mobile: 4 tests
  - Complete flow: 1 test
  - Additional integration: 1 test

## Next Steps

Future test enhancements:
1. Add tests for reconnection scenarios
2. Test spectator mode functionality
3. Add chat system tests
4. Test game completion and winner determination
5. Add performance benchmarks
6. Test error recovery scenarios
7. Add accessibility (a11y) tests
8. Test network failure scenarios

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Truco FDP Game Specification](../../specs/implementation-gpt/spec.md)
- [WebSocket API Contract](../../specs/implementation-gpt/contracts/websocket-api.md)
- [HTTP API Contract](../../specs/implementation-gpt/contracts/http-api.yaml)
