# Bug Fixes: Card Display and Blind Round Issues

## Date: 2025-09-30

## Issues Fixed

### Issue 1: Cards Played Not Being Displayed on the Table
**Symptom:** When players play cards during a trick, the cards are not shown on the game board table.

**Root Cause:** Malformed HTML template in `frontend/src/modules/gameUI/gameBoard.js`. There was a closing `</header>` tag without a corresponding opening `<header>` tag, which caused the DOM structure to be broken and prevented proper rendering of the trick slots.

**Fix:**
- Added the opening `<header class="game-board__header">` tag to properly wrap the game board header section
- File: `frontend/src/modules/gameUI/gameBoard.js`

```javascript
// Before
section.innerHTML = `
  <h2 class="game-board__title">Trick play</h2>
  ...
</header>  // No opening tag!

// After
section.innerHTML = `
  <header class="game-board__header">
    <h2 class="game-board__title">Trick play</h2>
    ...
  </header>
```

---

### Issue 2: Cannot Play Cards in Blind Round (Round 1)
**Symptom:** In round 1 (blind round), players cannot play their cards because they only see other players' cards, not their own.

**Root Cause:** In blind rounds, the backend was sending an empty `hand` array to players and putting all visible cards (including from other players) in the `visibleCards` array. This meant players had no cards in their hand to select and play.

**Design Intent:** In blind rounds:
- Players should see their own cards face-down (hidden)
- Players should see other players' cards face-up
- Players should still be able to select and play their hidden cards

**Fix:**
1. **Backend Change** - `backend/src/socket/roomHandlers.js`:
   - Changed the `emitHandsToPlayers` function to send the player's own cards in the `hand` array (marked with `hidden: true`) even during blind rounds
   - Previously: `const selfCards = round.isBlindRound ? [] : view.self;`
   - Now: `const selfCards = view.self;` (which already contains hidden cards for blind rounds from `getHandViewForPlayer`)

2. **Test Update** - `backend/tests/socket/gameStart.test.js`:
   - Updated test expectations to verify that:
     - `hand` array contains cards with `hidden: true` flag in blind rounds
     - `visibleCards` array contains other players' visible cards
     - Players can still interact with their hidden cards

**Technical Details:**

The `GameState.getHandViewForPlayer()` method already correctly handles blind rounds:
```javascript
getHandViewForPlayer(playerId) {
  const selfHand = normalizeHand(this.hands.get(playerId));
  const hiddenSelfHand = selfHand.map((card) => ({ ...card, hidden: true }));
  
  const view = {
    self: this.isBlindRound ? hiddenSelfHand : selfHand,  // Hidden in blind rounds
    others: { ... }  // Visible in blind rounds
  };
  return view;
}
```

The frontend's `cardRenderer` already supports rendering hidden cards and making them interactive:
```javascript
const isHidden = Boolean(card?.hidden) && options.reveal !== true;
// Hidden cards display as face-down but can still be clicked/dragged
if (options.interactive) {
  element.disabled = false;
  attachPointerInteractions(element, card, options.interactive);
}
```

---

## Additional Enhancement

Added console logging to the `card_played` event handler in `frontend/src/modules/gameState/index.js` to help with future debugging of card display issues.

```javascript
console.log('[GameState] card_played event received:', payload);
console.log('[GameState] card played - updating cardsPlayed:', {
  playerId: payload.playerId,
  card: payload.card,
  totalCardsPlayed: Object.keys(nextCards).length,
});
```

---

## Testing

### Backend Tests
Ran `npm test tests/socket/gameStart.test.js` - All tests pass ✓

The updated test verifies:
- In blind rounds (round 1), players receive their cards in the `hand` array
- Each card in the hand has `hidden: true` property
- Players also receive `visibleCards` array with other players' cards
- All visible cards have `ownerDisplayName` property

### Manual Testing Checklist
To verify the fixes work correctly:

1. **Card Display on Table:**
   - [ ] Start a game with 3+ players
   - [ ] Play cards during a trick
   - [ ] Verify all played cards appear in the table slots
   - [ ] Verify the winning card is highlighted

2. **Blind Round (Round 1):**
   - [ ] Start a game
   - [ ] In round 1, verify you see your cards face-down (hidden)
   - [ ] Verify you can see other players' cards face-up
   - [ ] Verify you can click/tap your hidden card to play it
   - [ ] Verify the card is successfully played

3. **Subsequent Rounds:**
   - [ ] In round 2+, verify you see your own cards face-up
   - [ ] Verify other players' cards are face-down
   - [ ] Verify card play works normally

---

## Files Changed

### Backend
1. `backend/src/socket/roomHandlers.js` - Fixed blind round card dealing logic
2. `backend/tests/socket/gameStart.test.js` - Updated test expectations

### Frontend  
1. `frontend/src/modules/gameUI/gameBoard.js` - Fixed malformed HTML template
2. `frontend/src/modules/gameState/index.js` - Added debug logging

---

## Technical Notes

### Card Visibility Rules
- **Blind Round (Round 1):**
  - Own cards: Hidden (face-down) but playable
  - Other players' cards: Visible (face-up)
  
- **Normal Rounds (Round 2+):**
  - Own cards: Visible (face-up) and playable
  - Other players' cards: Hidden (face-down)

### Card Data Structure
Cards have an optional `hidden` boolean property:
```javascript
{
  rank: "7",
  suit: "hearts",
  strength: 5,
  isManilha: false,
  hidden: true  // Present only in blind rounds for own cards
}
```

The frontend's `createCardElement` function automatically handles rendering:
- If `hidden: true` → Displays face-down card (🂠) but still allows interaction
- If `hidden: false` or undefined → Displays normal card with rank and suit

---

## Backward Compatibility

These changes may affect any client-side code that expects:
- Empty `hand` array in blind rounds
- All cards (including own) in `visibleCards` during blind rounds

The new behavior is more intuitive and aligns better with game rules where players can play their own hidden cards in blind rounds.

---

## Future Improvements

Consider:
1. Add visual indicator that cards are hidden in blind rounds (e.g., "Blind Round" badge)
2. Add tutorial/help text explaining blind round mechanics
3. Consider adding a "preview" hover effect for hidden cards to remind players they can still play them
