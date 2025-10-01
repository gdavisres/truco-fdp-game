# Frontend Tests

This directory contains all test suites for the Truco FDP frontend application.

## Test Categories

### Unit Tests (`unit/`)
Component-level tests for individual modules:
- Card renderer
- Game state management
- Network client
- UI components (bidding, chat, game board, game setup, game over, room selection, scoring, reconnection)
- Error handling and resilience
- Mobile features (haptic feedback, touch detection)

Unit tests validate UI logic, rendering, and network edge cases. Organized to mirror the `src/modules` structure.

**Run:** `npm test`

### End-to-End Tests (`e2e/`)
Full application flow tests using Playwright:
- Room join flow
- Game initialization
- Complete game flow from lobby to scoring
- Mobile responsiveness (320px viewport, touch interactions)
- Multi-player coordination

**Run:** `npm run test:e2e`

#### Comprehensive E2E Test Suite (NEW)

**File:** `e2e/complete-game-flow.spec.js`

Comprehensive test coverage including:
- ✅ **Room Join Flow:** Brazilian city room selection (Itajubá), display name entry, player list verification
- ✅ **Two-Player Initialization:** Dual browser contexts, card dealing, player synchronization
- ✅ **Blind Round 1:** Opponent card visibility testing (Truco FDP blind round mechanics)
- ✅ **Bidding Phase:** Sequential bidding, last bidder restrictions, bid history display
- ✅ **Card Play:** Turn-based play, trick resolution, hand size tracking
- ✅ **Manilha Cards:** Highlighting verification
- ✅ **Scoring:** Round completion, score display, round progression
- ✅ **Mobile (320px):** Touch targets ≥44px, tap/drag interactions, responsive layout
- ✅ **Complete Flow:** End-to-end integration from lobby to scoring

**Total:** 17 comprehensive test cases across 7 test suites

**Documentation:** See `e2e/COMPREHENSIVE-E2E-TESTS.md` for detailed test coverage and usage.

### Performance Tests (`performance/`)
Performance benchmarks and optimization tests.

**Run:** `npm run test:performance`

## Running Tests

```bash
# All unit tests
npm test

# Unit tests in watch mode
npm run test:watch

# All E2E tests
npm run test:e2e

# Specific E2E test file
npm run test:e2e complete-game-flow.spec.js

# E2E with browser visible
npm run test:e2e -- --headed

# E2E in debug mode
npm run test:e2e -- --debug

# E2E with UI mode
npm run test:e2e -- --ui

# Performance tests
npm run test:performance

# All tests (CI)
npm run test:ci
```

## Test Statistics

- **Unit Tests:** 121 tests across 14 test files ✅
- **E2E Tests:** 17+ tests across 3 test files ✅
- **Total Frontend Coverage:** 138+ tests
- **Pass Rate:** 100%

## Test Infrastructure

### Vitest (Unit Tests)
- Fast execution (~4 seconds)
- JSDOM environment for browser simulation
- Coverage reporting available
- Watch mode for development

### Playwright (E2E Tests)
- Chromium browser automation
- Multi-context support (simulates multiple players)
- Mobile device emulation (iPhone SE, Pixel 5, iPhone 12)
- Video/screenshot capture on failure
- Trace viewer for debugging
- Automatic server startup (backend + frontend)

## Mobile Testing

E2E tests include comprehensive mobile testing:
- **Viewports:** 320px (iPhone SE), 393px (Pixel 5), 390px (iPhone 12)
- **Touch Targets:** Verified ≥44px height (iOS guidelines)
- **Interactions:** Tap, drag, touch event handling
- **Responsive:** Layout verification at small screens

## Test Helpers

Common test utilities in E2E tests:
- `waitForLobby(page)` - Navigate and wait for lobby
- `joinRoom(page, options)` - Complete room join flow
- `waitForBidOpportunity(participants)` - Find next bidder
- `performBid({page, locator})` - Submit bid
- `waitForCardOpportunity(participants)` - Find next card player
- `playCard({page, locator})` - Play a card
- `uniqueName(prefix)` - Generate unique player names

## Debugging Tests

### Unit Tests
```bash
# Run with console output
npm test -- --reporter=verbose

# Run specific test
npm test -- bidding.test.js

# Debug in VS Code
# Set breakpoint and use "JavaScript Debug Terminal"
```

### E2E Tests
```bash
# View trace of failed test
npx playwright show-trace trace.zip

# Open test results
npx playwright show-report

# Run with inspector
npm run test:e2e -- --debug

# Run with UI mode (recommended)
npm run test:e2e -- --ui
```

## Coverage

Test coverage spans:
- ✅ Core game mechanics (bidding, card play, tricks)
- ✅ Room management (join, leave, spectate)
- ✅ Real-time synchronization (Socket.io events)
- ✅ Mobile responsiveness and touch interactions
- ✅ Error handling and recovery
- ✅ Reconnection scenarios
- ✅ Chat functionality
- ✅ Game completion and scoring
- ✅ Multi-player coordination

## CI Integration

Tests run automatically in CI:
1. Build frontend
2. Start backend server
3. Start frontend preview server
4. Run unit tests
5. Run E2E tests
6. Run performance tests
7. Generate reports
8. Upload artifacts (videos, screenshots, traces)

## Contributing

When adding new features:
1. Write unit tests for individual modules
2. Add E2E tests for user flows
3. Ensure mobile responsiveness is tested
4. Update this README with new test categories
5. Run full test suite: `npm run test:ci`

## Resources

- [Vitest Documentation](https://vitest.dev)
- [Playwright Documentation](https://playwright.dev)
- [E2E Test Guide](e2e/COMPREHENSIVE-E2E-TESTS.md)
- [Game Specification](../../specs/implementation-gpt/spec.md)

