# Truco FDP Backend - Maintenance Guide

## Daily Maintenance Tasks

### 1. Health Check Verification

```bash
# Check if server is responding
curl http://localhost:3000/api/health

# Expected response
{
  "status": "healthy",
  "timestamp": "2025-09-29T...",
  "uptime": 12345.67,
  "memory": {
    "used": 123456789,
    "total": 8589934592
  },
  "connections": 42,
  "security": {
    "rateLimiter": {...},
    "antiCheat": {...}
  }
}
```

### 2. Log Review

```bash
# View recent logs
pm2 logs truco-fdp-backend --lines 100

# Search for errors
pm2 logs truco-fdp-backend --err --lines 50

# Save logs to file for analysis
pm2 logs truco-fdp-backend --lines 1000 > /tmp/backend-logs-$(date +%Y%m%d).log
```

### 3. Resource Monitoring

```bash
# Check CPU and memory usage
pm2 monit

# Or get detailed info
pm2 describe truco-fdp-backend

# Check disk space
df -h /var/truco-fdp
df -h logs/
```

### 4. Active Connections

```bash
# Check active socket connections
netstat -an | grep :3000 | wc -l

# Or using ss
ss -an | grep :3000 | wc -l
```

## Weekly Maintenance Tasks

### 1. Backup Verification

```bash
# List recent backups
ls -lh /var/backups/truco-fdp/

# Verify latest backup exists
find /var/backups/truco-fdp/ -name "state_*.json" -mtime -1

# Test backup integrity (JSON validation)
jq empty /var/backups/truco-fdp/state_$(date +%Y%m%d)_*.json && echo "Valid JSON" || echo "Invalid JSON"
```

### 2. Log Rotation Check

```bash
# PM2 rotates logs automatically
# Verify old logs are archived
ls -lh logs/

# Manual log rotation if needed
pm2 flush truco-fdp-backend
```

### 3. Security Review

```bash
# Check for failed connection attempts in logs
grep -i "unauthorized\|forbidden\|rate limit" logs/pm2-error.log | tail -20

# Review anti-cheat detections
grep -i "anti-cheat" logs/pm2-error.log | tail -20
```

### 4. Performance Analysis

```bash
# Check average response times in logs
# Look for patterns of slow requests

# Review PM2 metrics
pm2 describe truco-fdp-backend | grep -E "uptime|restarts|memory"
```

## Monthly Maintenance Tasks

### 1. Dependency Updates

```bash
cd /path/to/backend

# Check for outdated packages
npm outdated

# Review security vulnerabilities
npm audit

# Update dependencies (test first!)
npm update

# Run tests after updates
npm test

# Deploy if tests pass
npm run reload:prod
```

### 2. Security Audit

```bash
# Run npm security audit
npm audit --production

# Fix critical vulnerabilities automatically
npm audit fix --production

# Review high-severity issues manually
npm audit --audit-level=high
```

### 3. Backup Cleanup

```bash
# Check backup disk usage
du -sh /var/backups/truco-fdp/

# Remove backups older than 30 days
find /var/backups/truco-fdp/ -name "state_*.json" -mtime +30 -delete

# Verify recent backups still exist
ls -lh /var/backups/truco-fdp/ | head -10
```

### 4. State File Optimization

```bash
# Check state file size
ls -lh /var/truco-fdp/state.json

# If too large, consider cleanup (backup first!)
# Remove completed/old game sessions
# This depends on your retention policy
```

## Troubleshooting Common Issues

### Issue: Server Not Responding

**Symptoms:**
- Health endpoint times out
- Players can't connect
- PM2 shows app as stopped

**Diagnosis:**
```bash
# Check PM2 status
pm2 list

# Check recent logs
pm2 logs truco-fdp-backend --lines 50 --err

# Check system resources
free -h
df -h
```

**Solutions:**
1. Restart the application:
   ```bash
   npm run restart:prod
   ```

2. If port is in use:
   ```bash
   lsof -ti :3000 | xargs kill -9
   npm run start:prod
   ```

3. If out of memory:
   ```bash
   # Increase memory limit in ecosystem.config.json
   "max_memory_restart": "1G"
   pm2 reload truco-fdp-backend
   ```

### Issue: High Memory Usage

**Symptoms:**
- PM2 shows high memory usage
- Frequent restarts due to memory limit
- Slow response times

**Diagnosis:**
```bash
# Check memory usage trend
pm2 describe truco-fdp-backend | grep memory

# Check for memory leaks in logs
grep -i "memory\|heap" logs/pm2-error.log
```

**Solutions:**
1. Restart to clear memory:
   ```bash
   npm run reload:prod
   ```

2. Check for stuck connections:
   ```bash
   netstat -an | grep :3000 | grep ESTABLISHED | wc -l
   ```

3. Review active game sessions in state file:
   ```bash
   jq '.rooms | length' /var/truco-fdp/state.json
   ```

4. Adjust memory limit if legitimate:
   ```bash
   # Edit ecosystem.config.json
   "max_memory_restart": "1G"  # Increase from 500M
   ```

### Issue: Connection Errors

**Symptoms:**
- Players get disconnected frequently
- WebSocket connection failures
- CORS errors in browser console

**Diagnosis:**
```bash
# Check CORS configuration
grep CORS_ORIGIN .env.production

# Test WebSocket connection
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3000/socket.io/

# Check nginx/reverse proxy logs (if applicable)
tail -f /var/log/nginx/error.log
```

**Solutions:**
1. Verify CORS settings match frontend domain:
   ```bash
   # .env.production
   CORS_ORIGIN=https://your-frontend-domain.com
   ```

2. Check reverse proxy WebSocket configuration:
   ```nginx
   location / {
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
   }
   ```

3. Restart after configuration changes:
   ```bash
   npm run reload:prod
   ```

### Issue: State File Corruption

**Symptoms:**
- Server crashes on startup
- JSON parse errors in logs
- Lost game state

**Diagnosis:**
```bash
# Validate state file JSON
jq empty /var/truco-fdp/state.json

# Check file size (shouldn't be 0)
ls -lh /var/truco-fdp/state.json

# Review error logs
grep -i "state\|json" logs/pm2-error.log | tail -20
```

**Solutions:**
1. Restore from most recent backup:
   ```bash
   npm run stop:prod
   cp /var/backups/truco-fdp/state_$(date +%Y%m%d -d yesterday)_*.json /var/truco-fdp/state.json
   npm run start:prod
   ```

2. If no valid backup, start fresh:
   ```bash
   npm run stop:prod
   echo '{"rooms":{},"roomsByCode":{},"playerSessions":{}}' > /var/truco-fdp/state.json
   npm run start:prod
   ```

### Issue: High CPU Usage

**Symptoms:**
- CPU usage consistently above 80%
- Slow response times
- Server lag

**Diagnosis:**
```bash
# Check PM2 CPU usage
pm2 monit

# Check number of active connections
netstat -an | grep :3000 | grep ESTABLISHED | wc -l

# Review recent activity in logs
pm2 logs truco-fdp-backend --lines 100
```

**Solutions:**
1. Check for infinite loops or stuck requests in logs

2. Verify cluster mode is enabled:
   ```bash
   pm2 describe truco-fdp-backend | grep mode
   # Should show "cluster"
   ```

3. Scale instances if needed:
   ```bash
   pm2 scale truco-fdp-backend +2
   ```

4. Restart to clear stuck processes:
   ```bash
   npm run reload:prod
   ```

## Performance Optimization

### 1. Enable Compression

Compression is configured via middleware. Verify it's working:

```bash
# Test gzip compression
curl -H "Accept-Encoding: gzip" -I http://localhost:3000/api/health
# Look for "Content-Encoding: gzip"
```

### 2. Optimize State Persistence

```bash
# Check state snapshot interval (default: 30 seconds)
grep STATE_SNAPSHOT_INTERVAL .env.production

# Adjust based on activity level
# High activity: 15000 (15 seconds)
# Low activity: 60000 (60 seconds)
```

### 3. Monitor Response Times

```bash
# Add logging middleware to track slow endpoints
# Review logs for patterns
grep -E "took [0-9]{3,}ms" logs/pm2-out.log
```

## Backup and Recovery Procedures

### Manual Backup

```bash
#!/bin/bash
# backup-now.sh

STATE_FILE=/var/truco-fdp/state.json
BACKUP_DIR=/var/backups/truco-fdp
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

if [ -f $STATE_FILE ]; then
    echo "Creating backup: state_$DATE.json"
    cp $STATE_FILE $BACKUP_DIR/state_$DATE.json
    echo "Backup created successfully"
    ls -lh $BACKUP_DIR/state_$DATE.json
else
    echo "ERROR: State file not found at $STATE_FILE"
    exit 1
fi
```

### Automated Backup Verification

```bash
#!/bin/bash
# verify-backup.sh

BACKUP_DIR=/var/backups/truco-fdp
LATEST_BACKUP=$(ls -t $BACKUP_DIR/state_*.json | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "ERROR: No backups found"
    exit 1
fi

# Check if backup is recent (within 25 hours)
if [ $(find $LATEST_BACKUP -mtime -1 | wc -l) -eq 0 ]; then
    echo "WARNING: Latest backup is older than 24 hours"
    echo "Latest: $LATEST_BACKUP"
    exit 1
fi

# Validate JSON
if jq empty $LATEST_BACKUP 2>/dev/null; then
    echo "✓ Latest backup is valid: $LATEST_BACKUP"
    echo "  Size: $(du -h $LATEST_BACKUP | cut -f1)"
    echo "  Date: $(stat -c %y $LATEST_BACKUP)"
    exit 0
else
    echo "ERROR: Latest backup has invalid JSON"
    exit 1
fi
```

### Recovery Testing

Perform quarterly recovery tests:

```bash
# 1. Create test environment
mkdir -p /tmp/truco-recovery-test
cp /var/backups/truco-fdp/state_latest.json /tmp/truco-recovery-test/

# 2. Validate backup
jq empty /tmp/truco-recovery-test/state_latest.json

# 3. Check structure
jq 'keys' /tmp/truco-recovery-test/state_latest.json
# Expected: ["rooms", "roomsByCode", "playerSessions"]

# 4. Count records
jq '.rooms | length' /tmp/truco-recovery-test/state_latest.json

# 5. Cleanup
rm -rf /tmp/truco-recovery-test
```

## Update Procedures

### Standard Update Process

```bash
# 1. Backup current state
./scripts/backup-now.sh

# 2. Pull latest code
cd /path/to/backend
git fetch origin
git log HEAD..origin/main --oneline  # Review changes

# 3. Checkout new version
git checkout main
git pull origin main

# 4. Install dependencies
npm install --production

# 5. Run tests
npm test

# 6. Deploy with zero downtime
npm run reload:prod

# 7. Verify deployment
curl http://localhost:3000/api/health

# 8. Monitor logs for 5 minutes
pm2 logs truco-fdp-backend --lines 50
```

### Emergency Rollback

```bash
# 1. Find previous working commit
git log --oneline -10

# 2. Checkout previous version
git checkout <commit-hash>

# 3. Install dependencies
npm install --production

# 4. Restore state backup (if needed)
cp /var/backups/truco-fdp/state_<timestamp>.json /var/truco-fdp/state.json

# 5. Deploy
npm run reload:prod

# 6. Verify
curl http://localhost:3000/api/health
```

## Monitoring Best Practices

### Set Up Alerts

1. **PM2 Monitoring** (built-in):
   ```bash
   pm2 install pm2-server-monit
   ```

2. **External Monitoring** (recommended):
   - UptimeRobot: HTTP endpoint monitoring
   - Pingdom: WebSocket connection monitoring
   - DataDog/New Relic: APM monitoring

3. **Custom Health Checks**:
   ```bash
   # Add to cron (every 5 minutes)
   */5 * * * * curl -f http://localhost:3000/api/health || systemctl restart truco-backend
   ```

### Log Analysis

```bash
# Most common errors
grep -i error logs/pm2-error.log | cut -d: -f2 | sort | uniq -c | sort -rn | head -10

# Connection issues
grep -i "disconnect\|connection" logs/pm2-out.log | wc -l

# Rate limiting triggers
grep -i "rate limit" logs/pm2-out.log | wc -l

# Anti-cheat detections
grep -i "anti-cheat" logs/pm2-error.log | tail -20
```

## Maintenance Checklist

### Daily
- [ ] Check PM2 status: `pm2 list`
- [ ] Verify health endpoint responding
- [ ] Review error logs for critical issues
- [ ] Check disk space: `df -h`

### Weekly
- [ ] Verify backups created successfully
- [ ] Review security logs for suspicious activity
- [ ] Check memory and CPU trends
- [ ] Test health endpoint from external location

### Monthly
- [ ] Run `npm audit` and review vulnerabilities
- [ ] Update dependencies if needed
- [ ] Clean up old backups (>30 days)
- [ ] Review and optimize state file size
- [ ] Test backup restoration process
- [ ] Review PM2 restart count (should be low)

### Quarterly
- [ ] Perform full backup/restore test
- [ ] Review and update security policies
- [ ] Performance audit and optimization
- [ ] Update documentation as needed
- [ ] Review and update monitoring alerts

## Emergency Contacts

- **System Administrator**: [contact info]
- **Development Team**: [contact info]
- **On-Call Engineer**: [contact info]

## Support Resources

- **Documentation**: `/path/to/backend/README.md`
- **Deployment Guide**: `/path/to/backend/DEPLOYMENT.md`
- **API Contracts**: `/path/to/specs/implementation-gpt/contracts/`
- **GitHub Issues**: [repository-url]/issues
