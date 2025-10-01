'use strict';

const express = require('express');

const { stateManager } = require('../modules/stateManager');
const { roomManager, DEFAULT_ROOMS, MAX_PLAYERS } = require('../modules/roomManager');

const router = express.Router();

const mapRoomSummary = (room) => {
  const playerCount = Array.isArray(room.players) ? room.players.length : 0;
  const spectatorCount = Array.isArray(room.spectators) ? room.spectators.length : 0;
  const gameStatus = room.status ?? 'waiting';

  return {
    roomId: room.roomId,
    displayName: room.displayName,
    playerCount,
    spectatorCount,
    maxPlayers: MAX_PLAYERS,
    gameStatus,
    canJoin: gameStatus !== 'playing' && playerCount < MAX_PLAYERS,
  };
};

const toPlayerInfo = (player) => ({
  playerId: player.playerId,
  displayName: player.displayName,
  lives: player.lives,
  isHost: player.isHost,
  isSpectator: player.isSpectator,
  connectionStatus: player.connectionStatus,
});

const mapRoomDetails = (room) => {
  const players = Array.isArray(room.players)
    ? room.players
        .map((playerId) => stateManager.getPlayer(playerId))
        .filter(Boolean)
        .map(toPlayerInfo)
    : [];

  const spectatorCount = Array.isArray(room.spectators) ? room.spectators.length : 0;
  const gamePhase = room.gameState?.currentPhase ?? (room.status === 'playing' ? 'playing' : 'waiting');
  const currentRound = room.gameState?.currentRound ?? 0;

  return {
    roomId: room.roomId,
    displayName: room.displayName,
    maxPlayers: MAX_PLAYERS,
    players,
    spectatorCount,
    hostSettings: { ...room.hostSettings },
    currentRound,
    gamePhase,
    gameStatus: room.status ?? 'waiting',
  };
};

router.get('/', (req, res) => {
  roomManager.ensureDefaultRooms();

  const rooms = stateManager.listRooms();
  const payload = rooms
    .filter((room) => DEFAULT_ROOMS.some((entry) => entry.roomId === room.roomId))
    .map(mapRoomSummary)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  res.json(payload);
});

router.get('/:roomId', (req, res) => {
  roomManager.ensureDefaultRooms();

  const room = stateManager.getRoom(req.params.roomId);

  if (!room) {
    res.status(404).json({
      error: 'room_not_found',
      message: `Room ${req.params.roomId} was not found`,
    });
    return;
  }

  res.json(mapRoomDetails(room.toJSON ? room.toJSON() : room));
});

module.exports = router;
