# Backup Scripts for Truco FDP

This directory contains backup and maintenance scripts for the Truco FDP game state.

## Scripts

### backup-state.sh

Creates a timestamped backup of the game state file.

**Usage:**
```bash
./backup-state.sh
```

**Features:**
- Creates backup with timestamp: `state_YYYYMMDD_HHMMSS.json`
- Validates state file JSON before backup
- Shows backup size and location
- Lists recent backups

**Environment Variables:**
- `STATE_FILE_PATH`: Path to state file (default: `../var/state.json`)
- `BACKUP_DIR`: Backup directory (default: `../var/backups`)

### restore-state.sh

Restores game state from a backup file.

**Usage:**
```bash
# List available backups
./restore-state.sh

# Restore from specific backup
./restore-state.sh ../var/backups/state_20250929_120000.json
```

**Features:**
- Lists available backups with validation status
- Validates backup before restoration
- Creates emergency backup of current state before restoring
- Prompts for confirmation before proceeding
- Rollback support if restoration fails

**Safety:**
- Always creates emergency backup before overwriting
- Validates JSON integrity of backup file
- Requires explicit confirmation

### cleanup-old-backups.sh

Removes backup files older than specified retention period.

**Usage:**
```bash
# Clean up backups older than 30 days (default)
./cleanup-old-backups.sh

# Clean up backups older than 7 days
./cleanup-old-backups.sh 7

# Clean up backups older than 90 days
./cleanup-old-backups.sh 90
```

**Features:**
- Configurable retention period (default: 30 days)
- Shows total size to be freed
- Lists files before deletion
- Prompts for confirmation
- Shows summary after cleanup

## Automated Backups

### Daily Backup (Recommended)

Create a cron job for daily backups:

```bash
# Edit crontab
crontab -e

# Add daily backup at 3 AM
0 3 * * * cd /path/to/backend/scripts && ./backup-state.sh >> /var/log/truco-backup.log 2>&1
```

### Weekly Cleanup (Recommended)

Create a cron job for weekly cleanup:

```bash
# Edit crontab
crontab -e

# Add weekly cleanup on Sunday at 4 AM (keep 30 days)
0 4 * * 0 cd /path/to/backend/scripts && ./cleanup-old-backups.sh 30 >> /var/log/truco-cleanup.log 2>&1
```

### Combined Schedule Example

```bash
# Daily backup at 3 AM
0 3 * * * cd /path/to/backend/scripts && ./backup-state.sh >> /var/log/truco-backup.log 2>&1

# Weekly cleanup on Sunday at 4 AM (keep 30 days)
0 4 * * 0 cd /path/to/backend/scripts && ./cleanup-old-backups.sh 30 >> /var/log/truco-cleanup.log 2>&1
```

## Backup Strategy

### Retention Policy

- **Daily backups**: Keep for 30 days
- **Weekly backups**: Keep for 90 days (create weekly cron)
- **Monthly backups**: Keep for 1 year (create monthly cron)

### Storage Requirements

Estimate storage needs based on state file size:
- Average state file: ~10-50 KB
- Daily backups (30 days): ~1.5 MB
- Weekly backups (12 weeks): ~600 KB
- Monthly backups (12 months): ~600 KB
- **Total: ~3 MB per year**

### Off-site Backups

For production environments, consider off-site backups:

```bash
# Sync to S3
aws s3 sync ../var/backups s3://your-bucket/truco-backups/

# Sync to remote server
rsync -avz ../var/backups/ user@backup-server:/backups/truco/
```

## Recovery Testing

Test backup/restore process quarterly:

```bash
# 1. Create test environment
mkdir -p /tmp/truco-recovery-test

# 2. List available backups
./restore-state.sh

# 3. Test restore to temporary location
STATE_FILE_PATH=/tmp/truco-recovery-test/state.json \
  ./restore-state.sh ../var/backups/state_latest.json

# 4. Validate restored file
jq empty /tmp/truco-recovery-test/state.json && echo "Valid" || echo "Invalid"

# 5. Cleanup
rm -rf /tmp/truco-recovery-test
```

## Troubleshooting

### Permission Issues

```bash
# Make scripts executable
chmod +x *.sh

# Ensure backup directory is writable
chmod 755 ../var/backups
```

### Invalid JSON

If state file has invalid JSON:
```bash
# Attempt to fix with jq
jq . ../var/state.json > /tmp/fixed-state.json
mv /tmp/fixed-state.json ../var/state.json
```

### Missing jq Command

Install jq for JSON validation:
```bash
# Ubuntu/Debian
sudo apt-get install jq

# macOS
brew install jq

# CentOS/RHEL
sudo yum install jq
```

## Integration with PM2

Backup before deployments:

```bash
# Update package.json scripts
"predeploy": "scripts/backup-state.sh",
"deploy": "npm run reload:prod"
```

Then deploy with automatic backup:
```bash
npm run deploy
```

## Security Considerations

- Backup files contain game state data
- Store backups in secure location with restricted permissions
- Consider encrypting backups for sensitive data
- Regularly test backup restoration process
- Keep backup logs for audit trail

## Monitoring

Monitor backup status:

```bash
# Check last backup age
find ../var/backups -name "state_*.json" -type f -mtime -1 | wc -l
# Should return 1 if daily backup is working

# Check backup directory size
du -sh ../var/backups

# Verify latest backup is valid
jq empty $(ls -t ../var/backups/state_*.json | head -1) && echo "OK" || echo "ERROR"
```

## See Also

- [DEPLOYMENT.md](../DEPLOYMENT.md) - Deployment guide
- [MAINTENANCE.md](../MAINTENANCE.md) - Maintenance procedures
- [README.md](../README.md) - Backend documentation
