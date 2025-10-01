# Truco FDP Backend - Deployment Guide

## Prerequisites

- Node.js 18+ installed
- PM2 process manager: `npm install -g pm2`
- Git (for code deployment)
- Sufficient disk space for logs and state files (minimum 1GB)

## Production Setup

### 1. Clone and Install

```bash
git clone <repository-url> truco-fdp-game
cd truco-fdp-game/backend
npm install --production
```

### 2. Environment Configuration

```bash
# Copy example environment file
cp .env.production.example .env.production

# Edit with your production values
nano .env.production
```

Required environment variables:
- `NODE_ENV=production`
- `PORT` - Server port (default: 3000)
- `CORS_ORIGIN` - Your frontend domain
- `STATE_FILE_PATH` - Path to state persistence file
- `SESSION_SECRET` - Secure random string for sessions

### 3. Create Required Directories

```bash
# Create logs directory
mkdir -p logs

# Create state directory (if using custom path)
mkdir -p /var/truco-fdp
```

### 4. Start with PM2

```bash
# Start the application
npm run start:prod

# Verify it's running
pm2 list

# Check logs
npm run logs:prod
```

## PM2 Management Commands

### Basic Operations

```bash
# Start
npm run start:prod

# Stop
npm run stop:prod

# Restart (with downtime)
npm run restart:prod

# Reload (zero-downtime, cluster mode)
npm run reload:prod

# View logs
npm run logs:prod

# Monitor resource usage
npm run monit:prod
```

### Advanced PM2 Commands

```bash
# View detailed application info
pm2 describe truco-fdp-backend

# Save PM2 process list (survives reboot)
pm2 save

# Setup PM2 to start on system boot
pm2 startup

# Delete from PM2
pm2 delete truco-fdp-backend
```

## Monitoring and Health Checks

### Health Endpoint

The server provides a health check endpoint:

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-29T...",
  "uptime": 1234.56
}
```

### Log Files

PM2 creates two log files:
- `logs/pm2-out.log` - Standard output
- `logs/pm2-error.log` - Error output

View logs in real-time:
```bash
pm2 logs truco-fdp-backend --lines 100
```

### Resource Monitoring

Monitor CPU, memory, and other metrics:
```bash
pm2 monit
```

PM2 will automatically restart the process if:
- Memory exceeds 500MB
- Process crashes (max 10 restarts)
- Uptime is less than 10 seconds

## Backup and Recovery

### State File Backup

The game state is persisted to `STATE_FILE_PATH`. Back it up regularly:

```bash
# Create backup script
cat > /etc/cron.daily/truco-backup << 'EOF'
#!/bin/bash
STATE_FILE=/var/truco-fdp/state.json
BACKUP_DIR=/var/backups/truco-fdp
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
if [ -f $STATE_FILE ]; then
    cp $STATE_FILE $BACKUP_DIR/state_$DATE.json
    # Keep only last 7 days
    find $BACKUP_DIR -name "state_*.json" -mtime +7 -delete
fi
EOF

chmod +x /etc/cron.daily/truco-backup
```

### Restore from Backup

```bash
# Stop the server
npm run stop:prod

# Restore state file
cp /var/backups/truco-fdp/state_YYYYMMDD_HHMMSS.json /var/truco-fdp/state.json

# Start the server
npm run start:prod
```

### Database-less Recovery

Since the application uses file-based persistence:
1. All game state is in `state.json`
2. No database to backup/restore
3. Simply copy the state file to recover

## Security Considerations

### Firewall Configuration

```bash
# Allow only necessary ports
sudo ufw allow 3000/tcp  # Backend API/WebSocket
sudo ufw enable
```

### SSL/TLS Setup

Use a reverse proxy (nginx/Apache) for SSL termination:

```nginx
server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Environment Security

- Never commit `.env.production` to version control
- Use strong `SESSION_SECRET` (32+ random characters)
- Restrict file permissions:

```bash
chmod 600 .env.production
chmod 600 /var/truco-fdp/state.json
```

## Updating the Application

### Zero-Downtime Update

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
npm install --production

# 3. Run tests
npm test

# 4. Reload with zero downtime (cluster mode)
npm run reload:prod
```

### Rolling Back

```bash
# 1. Checkout previous version
git checkout <previous-commit-hash>

# 2. Install dependencies
npm install --production

# 3. Reload
npm run reload:prod
```

## Troubleshooting

### Server Won't Start

```bash
# Check PM2 logs
pm2 logs truco-fdp-backend --err

# Check if port is already in use
lsof -i :3000

# Verify environment variables
pm2 env truco-fdp-backend
```

### High Memory Usage

```bash
# Check current memory usage
pm2 monit

# Restart if needed
npm run restart:prod

# Adjust max memory in ecosystem.config.json
"max_memory_restart": "500M"  # Increase if needed
```

### Connection Issues

```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Check Socket.io connection
curl http://localhost:3000/socket.io/

# Verify CORS settings
# Check CORS_ORIGIN in .env.production
```

### State File Corruption

```bash
# Stop server
npm run stop:prod

# Restore from backup
cp /var/backups/truco-fdp/state_<latest>.json /var/truco-fdp/state.json

# Start server
npm run start:prod
```

## Performance Optimization

### Cluster Mode

PM2 runs in cluster mode by default (`"instances": "max"`), utilizing all CPU cores.

To adjust:
```json
{
  "instances": 4  // Specific number
}
```

### Compression

The server uses Helmet and Express built-in compression. For additional optimization, use nginx:

```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;
gzip_min_length 1000;
```

### Caching

Static assets are cached automatically. Configure cache headers in nginx:

```nginx
location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## Maintenance Schedule

### Daily
- Check PM2 logs for errors
- Monitor resource usage
- Verify health endpoint

### Weekly
- Review backup files
- Check disk space
- Analyze error patterns

### Monthly
- Update dependencies: `npm update`
- Review security advisories: `npm audit`
- Test backup restoration process

## Support and Monitoring

### Adding External Monitoring

For production monitoring, integrate with:

**Sentry (Error Tracking)**
```bash
npm install @sentry/node
```

Add to `.env.production`:
```
SENTRY_DSN=your-sentry-dsn
```

**New Relic (APM)**
```bash
npm install newrelic
```

Add to `.env.production`:
```
NEW_RELIC_LICENSE_KEY=your-key
```

### Alerts

Set up PM2 alerts for critical events:
```bash
pm2 install pm2-server-monit
```

## System Requirements

### Minimum
- 1 CPU core
- 512MB RAM
- 5GB disk space

### Recommended
- 2+ CPU cores
- 1GB+ RAM
- 10GB disk space
- SSD for better I/O performance

### Scaling
For high traffic, consider:
- Load balancer (nginx/HAProxy)
- Multiple backend instances
- Redis for session sharing (future enhancement)
- Database for state persistence (future enhancement)

## Contact

For issues and support:
- Check logs first: `npm run logs:prod`
- Review this documentation
- Check GitHub issues: <repository-url>/issues
