# Backend

Node.js server for Truco FDP Game. This directory contains the Express API, Socket.io event handlers, and supporting modules.

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm test:watch
```

### Production

```bash
# Install production dependencies
npm install --production

# Start with PM2 process manager
npm run start:prod

# View logs
npm run logs:prod

# Monitor resources
npm run monit:prod

# Restart server
npm run restart:prod

# Reload with zero downtime
npm run reload:prod

# Stop server
npm run stop:prod
```

## Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete production deployment guide
- **[MAINTENANCE.md](MAINTENANCE.md)** - Operational maintenance procedures
- **[scripts/README.md](scripts/README.md)** - Backup and recovery scripts

## Architecture

### Directory Structure

```
backend/
├── src/
│   ├── server.js              # Express app and Socket.io server
│   ├── api/                   # HTTP REST API endpoints
│   │   └── rooms.js           # Room management API
│   ├── config/                # Configuration management
│   │   ├── environment.js     # Environment variables
│   │   └── logger.js          # Logging configuration
│   ├── modules/               # Core game modules
│   │   ├── cardEngine/        # Card deck and dealing logic
│   │   ├── gameLogic/         # Game rules (bidding, tricks, etc.)
│   │   ├── roomManager/       # Room/lobby management
│   │   ├── stateManager/      # State persistence
│   │   └── security/          # Security features (rate limiting, validation, anti-cheat)
│   └── socket/                # Socket.io event handlers
│       └── roomHandlers.js    # Game room WebSocket handlers
├── tests/                     # Test suites
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   ├── socket/                # Socket.io tests
│   └── contract/              # API contract tests
└── scripts/                   # Maintenance scripts
    ├── backup-state.sh        # Backup game state
    ├── restore-state.sh       # Restore from backup
    └── cleanup-old-backups.sh # Clean old backups
```

### Key Features

- **RESTful API**: Room management endpoints
- **WebSocket**: Real-time game communication via Socket.io
- **State Persistence**: File-based state management with automatic snapshots
- **Security**:
  - Rate limiting on socket events
  - Input validation and sanitization
  - Anti-cheat detection (timing, card visibility, action validation)
  - Helmet.js security headers
  - CORS protection
- **Production Ready**:
  - PM2 cluster mode with auto-restart
  - Compression middleware (gzip)
  - Comprehensive health checks
  - Automated backups
  - Log rotation

## API Endpoints

### Health Check

```
GET /api/health
```

Returns server health status:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-29T...",
  "uptime": 12345.67,
  "memory": {
    "heapUsed": 123456789,
    "heapTotal": 234567890,
    "rss": 345678901,
    "external": 12345678
  },
  "activeRooms": 42,
  "activePlayers": 168,
  "security": {
    "rateLimiter": {...},
    "antiCheat": {...}
  }
}
```

### Rooms API

See [contracts/http-api.yaml](../specs/implementation-gpt/contracts/http-api.yaml) for full API documentation.

**Create Room:**
```
POST /api/rooms
```

**List Rooms:**
```
GET /api/rooms
```

**Join Room:**
```
POST /api/rooms/:code/join
```

**Leave Room:**
```
POST /api/rooms/:code/leave
```

## WebSocket Events

See [contracts/websocket-api.md](../specs/implementation-gpt/contracts/websocket-api.md) for full WebSocket API documentation.

### Client → Server Events

- `join_room` - Join a game room
- `leave_room` - Leave current room
- `start_game` - Start the game (host only)
- `submit_bid` - Submit truco bid
- `play_card` - Play a card
- `chat_message` - Send chat message
- `update_host_settings` - Update room settings (host only)

### Server → Client Events

- `room_updated` - Room state changed
- `game_started` - Game has started
- `hand_dealt` - Cards dealt to player
- `bid_update` - Bid state changed
- `card_played` - Card was played
- `trick_completed` - Trick finished
- `round_completed` - Round finished
- `game_completed` - Game finished
- `chat_message` - Chat message received
- `player_rejoined` - Player reconnected
- `error` - Error occurred

## Environment Variables

Create `.env` (development) or `.env.production` (production):

```env
# Server
NODE_ENV=development
PORT=3000
HOST=localhost

# CORS
CORS_ORIGIN=http://localhost:5173

# State Management
STATE_FILE_PATH=backend/var/state.json
STATE_SNAPSHOT_INTERVAL=30000

# Logging
LOG_LEVEL=debug

# Security
SESSION_SECRET=your-secret-key-here
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=100

# Game Configuration
MAX_GAME_DURATION_MS=3600000
TURN_TIMER_SECONDS=30
MAX_RECONNECTION_TIME_MS=300000
```

See [.env.production.example](.env.production.example) for production configuration.

## Testing

### Run Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- gameState.test.js

# Run tests in watch mode
npm test:watch

# Run tests with coverage
npm test -- --coverage
```

### Test Structure

- **Unit Tests** (`tests/unit/`): Individual module tests
- **Integration Tests** (`tests/integration/`): Multi-module workflows
- **Socket Tests** (`tests/socket/`): WebSocket event tests
- **Contract Tests** (`tests/contract/`): API contract validation

**Test Coverage:** 197 tests across 26 test suites

## Security Features

### Rate Limiting

Socket events are rate-limited per connection:
- Default: 100 requests per 60 seconds
- Configurable via `RATE_LIMIT_WINDOW` and `RATE_LIMIT_MAX_REQUESTS`
- Returns `rate_limit_exceeded` error when triggered

### Input Validation

All inputs are validated and sanitized:
- XSS prevention (HTML entity encoding)
- Schema validation (data types, ranges)
- SQL injection prevention
- Path traversal prevention

### Anti-Cheat Detection

Server-side validation prevents cheating:
- **Timing validation**: Detects suspiciously fast actions
- **Card visibility**: Prevents playing cards not in hand
- **Game state validation**: Ensures actions are valid for current state
- **Turn enforcement**: Prevents playing out of turn

### Security Headers

- CSP (Content Security Policy)
- X-Frame-Options (clickjacking protection)
- X-Content-Type-Options (MIME sniffing prevention)
- HSTS (Strict Transport Security)

## Production Deployment

### Prerequisites

- Node.js 18+
- PM2 process manager: `npm install -g pm2`
- 1GB+ RAM recommended
- 10GB+ disk space recommended

### Deployment Steps

1. **Clone repository**
   ```bash
   git clone <repo-url> truco-fdp-game
   cd truco-fdp-game/backend
   ```

2. **Install dependencies**
   ```bash
   npm install --production
   ```

3. **Configure environment**
   ```bash
   cp .env.production.example .env.production
   # Edit .env.production with your values
   ```

4. **Start with PM2**
   ```bash
   npm run start:prod
   ```

5. **Verify deployment**
   ```bash
   curl http://localhost:3000/api/health
   npm run logs:prod
   ```

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive deployment guide.

## Maintenance

### Daily Tasks
- Check server health: `curl /api/health`
- Review logs: `npm run logs:prod`
- Monitor resources: `npm run monit:prod`

### Weekly Tasks
- Verify backups: `ls -lh backend/var/backups/`
- Review security logs
- Check disk space

### Monthly Tasks
- Update dependencies: `npm update`
- Security audit: `npm audit`
- Clean old backups: `./scripts/cleanup-old-backups.sh`

See [MAINTENANCE.md](MAINTENANCE.md) for detailed maintenance procedures.

## Backup and Recovery

### Automated Backups

```bash
# Daily backup at 3 AM
0 3 * * * cd /path/to/backend/scripts && ./backup-state.sh

# Weekly cleanup (keep 30 days)
0 4 * * 0 cd /path/to/backend/scripts && ./cleanup-old-backups.sh 30
```

### Manual Backup

```bash
./scripts/backup-state.sh
```

### Restore from Backup

```bash
# List available backups
./scripts/restore-state.sh

# Restore specific backup
./scripts/restore-state.sh backend/var/backups/state_20250929_120000.json
```

See [scripts/README.md](scripts/README.md) for backup documentation.

## Troubleshooting

### Server Won't Start

```bash
# Check logs
npm run logs:prod

# Check if port is in use
lsof -i :3000

# Restart
npm run restart:prod
```

### High Memory Usage

```bash
# Check memory
pm2 describe truco-fdp-backend

# Restart if needed
npm run reload:prod
```

### Connection Issues

```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Check CORS settings
grep CORS_ORIGIN .env.production
```

See [MAINTENANCE.md](MAINTENANCE.md) for comprehensive troubleshooting.

## Performance

- **Cluster Mode**: Utilizes all CPU cores via PM2
- **Compression**: Gzip compression enabled for responses
- **Memory**: Auto-restart on high memory usage (500MB default)
- **Caching**: Cache-Control headers for static assets
- **State Persistence**: Periodic snapshots (30s default)

## Contributing

### Development Setup

```bash
# Install all dependencies (including dev)
npm install

# Start development server
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format:write
```

### Code Style

- ESLint for linting
- Prettier for formatting
- Run `npm run lint` before committing

### Testing

- Write tests for new features
- Maintain test coverage
- Run `npm test` before committing

## License

MIT

## Support

- **Issues**: [GitHub Issues](<repo-url>/issues)
- **Documentation**: See `specs/implementation-gpt/` directory
- **API Contracts**: See `specs/implementation-gpt/contracts/`

