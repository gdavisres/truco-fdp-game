'use strict';

const MIN_TURN_TIMER_SECONDS = 5;
const MAX_TURN_TIMER_SECONDS = 30;
const DEFAULT_TURN_TIMER_SECONDS = 20;

const clampTurnTimerSeconds = (value, fallback = DEFAULT_TURN_TIMER_SECONDS) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }

  const rounded = Math.floor(raw);
  if (rounded < MIN_TURN_TIMER_SECONDS) {
    return MIN_TURN_TIMER_SECONDS;
  }

  if (rounded > MAX_TURN_TIMER_SECONDS) {
    return MAX_TURN_TIMER_SECONDS;
  }

  return rounded;
};

const calculateDeadline = (seconds, now = Date.now()) => {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  return now + duration * 1000;
};

const getTimeLeftSeconds = (deadline, now = Date.now()) => {
  if (!Number.isFinite(deadline)) {
    return 0;
  }

  const diff = Math.ceil((deadline - now) / 1000);
  return diff > 0 ? diff : 0;
};

const selectAutoBid = (validBids) => {
  if (Array.isArray(validBids) && validBids.length > 0) {
    return validBids[0];
  }

  return 0;
};

const selectAutoCard = ({
  hand,
  round,
  trick,
  playerId,
  expectedPlayerId,
  validateCardPlay,
}) => {
  if (!Array.isArray(hand) || hand.length === 0) {
    return null;
  }

  const validator = typeof validateCardPlay === 'function' ? validateCardPlay : null;
  const targetPlayer = expectedPlayerId ?? playerId;

  for (let index = 0; index < hand.length; index += 1) {
    const candidate = hand[index];
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    if (!validator) {
      return { ...candidate };
    }

    const result = validator({
      round,
      trick,
      playerId,
      card: candidate,
      expectedPlayerId: targetPlayer,
    });

    if (result?.isValid) {
      return { ...candidate };
    }
  }

  const fallback = hand[0];
  return fallback && typeof fallback === 'object' ? { ...fallback } : null;
};

module.exports = {
  MIN_TURN_TIMER_SECONDS,
  MAX_TURN_TIMER_SECONDS,
  DEFAULT_TURN_TIMER_SECONDS,
  clampTurnTimerSeconds,
  calculateDeadline,
  getTimeLeftSeconds,
  selectAutoBid,
  selectAutoCard,
};
