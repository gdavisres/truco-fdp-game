# Debugging Card Display Issue

## Current Status
Cards played during tricks are not visible on the game board table, even though trick status shows correctly (e.g., "Trick 1", "Winner: hahaha").

## Added Debug Logging

### Frontend - gameState/index.js
Added console logging to track events:
- `cards_dealt` - When cards are distributed
- `trick_started` - When a new trick begins
- `card_played` - When each card is played
- `trick_completed` - When trick finishes

### Frontend - gameUI/gameBoard.js  
Added console logging to track rendering:
- `render()` - Main render function with full state
- `renderTrick()` - Trick rendering with cardsPlayed details
- Per-player slot creation with card data

## How to Debug

1. **Open Browser Console (F12)**

2. **Start a Game**
   - Join a room
   - Start the game
   - Go through bidding

3. **Play Cards and Watch Console**
   Look for these log patterns:

```
[GameState] trick_started event received: {...}
[GameState] card_played event received: {...}
[GameState] card played - updating cardsPlayed: {...}
[GameBoard] render called, state: {...}
[GameBoard] renderTrick called: {...}
[GameBoard] Creating slot for player: {...}
```

## What to Check

### 1. Are card_played events arriving?
```javascript
// Should see:
[GameState] card_played event received: {
  playerId: "player-123",
  card: { rank: "7", suit: "hearts", ... },
  nextPlayer: "player-456",
  ...
}
```

### 2. Is cardsPlayed being updated?
```javascript
// Should see increasing number:
[GameState] card played - updating cardsPlayed: {
  playerId: "player-123",
  card: {...},
  totalCardsPlayed: 1  // Then 2, 3, etc.
}
```

### 3. Is renderTrick seeing the cards?
```javascript
// Should show cards in state:
[GameBoard] renderTrick called: {
  trickNumber: 1,
  cardsPlayed: {
    "player-123": { rank: "7", suit: "hearts", ... },
    "player-456": { rank: "A", suit: "spades", ... }
  },
  cardsPlayedKeys: ["player-123", "player-456"],
  playerOrder: ["player-123", "player-456", ...]
}
```

### 4. Are slots being created?
```javascript
// Should see one per player:
[GameBoard] Creating slot for player: {
  playerId: "player-123",
  playerName: "Alice",
  hasCard: true,
  card: { rank: "7", suit: "hearts", ... }
}
```

### 5. Final verification
```javascript
// Should confirm DOM elements created:
[GameBoard] renderTrick complete, element children: 4  // Number of players
```

## Potential Issues

### Issue A: Events Not Arriving
**Symptom:** No `card_played` events in console
**Cause:** Socket subscription not working
**Solution:** Check socket connection, verify subscriptions applied

### Issue B: cardsPlayed Empty in Render
**Symptom:** `card_played` events arrive but `cardsPlayed: {}` in renderTrick
**Cause:** State update not propagating or being cleared
**Solution:** Check state flow, timing of trick_started vs card_played

### Issue C: Slots Created But Not Visible
**Symptom:** Console shows slots created but not visible in UI
**Cause:** CSS issue or DOM not attached
**Solution:** Check element.children.length, inspect DOM in browser

### Issue D: Race Condition
**Symptom:** Cards sometimes appear, sometimes don't
**Cause:** trick_started clearing cards before render
**Solution:** Delay trick_started or preserve previous trick cards

## Next Steps

Based on console output, determine which scenario matches:

1. **If no card_played events:** Check socket subscriptions
2. **If events arrive but state empty:** Check state reducer logic
3. **If state correct but UI empty:** Check render/DOM logic
4. **If works initially but clears:** Check trick_started timing

## File Changes for Debugging

- `frontend/src/modules/gameState/index.js` - Added logging to event handlers
- `frontend/src/modules/gameUI/gameBoard.js` - Added logging to render functions
