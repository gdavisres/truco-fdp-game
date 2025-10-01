#!/bin/bash
# Clean up old backup files
# Usage: ./cleanup-old-backups.sh [days]
# Default: 30 days

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-../var/backups}"
RETENTION_DAYS="${1:-30}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "Truco FDP Backup Cleanup"
echo "========================================="

# Check if backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}ERROR: Backup directory not found: $BACKUP_DIR${NC}"
    exit 1
fi

# Count total backups before cleanup
TOTAL_BACKUPS_BEFORE=$(ls -1 "$BACKUP_DIR"/state_*.json 2>/dev/null | wc -l)

if [ "$TOTAL_BACKUPS_BEFORE" -eq 0 ]; then
    echo "No backups found in $BACKUP_DIR"
    exit 0
fi

echo "Total backups: $TOTAL_BACKUPS_BEFORE"
echo "Retention period: $RETENTION_DAYS days"
echo ""

# Find old backups
OLD_BACKUPS=$(find "$BACKUP_DIR" -name "state_*.json" -type f -mtime +$RETENTION_DAYS 2>/dev/null)

if [ -z "$OLD_BACKUPS" ]; then
    echo -e "${GREEN}No backups older than $RETENTION_DAYS days found${NC}"
    echo "Nothing to clean up."
    exit 0
fi

# Count old backups
OLD_BACKUP_COUNT=$(echo "$OLD_BACKUPS" | wc -l)

# Calculate total size of old backups
OLD_BACKUP_SIZE=$(echo "$OLD_BACKUPS" | xargs du -ch 2>/dev/null | tail -1 | cut -f1)

echo -e "${YELLOW}Found $OLD_BACKUP_COUNT backups older than $RETENTION_DAYS days${NC}"
echo "Total size to be freed: $OLD_BACKUP_SIZE"
echo ""

# List old backups
echo "Backups to be deleted:"
echo "$OLD_BACKUPS" | while read -r file; do
    FILENAME=$(basename "$file")
    FILESIZE=$(du -h "$file" | cut -f1)
    FILEDATE=$(stat -c %y "$file" 2>/dev/null || stat -f %Sm "$file" 2>/dev/null)
    echo "  - $FILENAME ($FILESIZE, $FILEDATE)"
done

echo ""
read -p "Delete these backups? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo "Cleanup cancelled."
    exit 0
fi

# Delete old backups
echo "Deleting old backups..."
DELETED_COUNT=0

echo "$OLD_BACKUPS" | while read -r file; do
    if [ -f "$file" ]; then
        rm "$file"
        echo "  ✓ Deleted: $(basename "$file")"
        DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
done

# Count remaining backups
TOTAL_BACKUPS_AFTER=$(ls -1 "$BACKUP_DIR"/state_*.json 2>/dev/null | wc -l)
BACKUP_DIR_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)

echo ""
echo -e "${GREEN}Cleanup complete!${NC}"
echo "  Deleted: $OLD_BACKUP_COUNT backups"
echo "  Remaining: $TOTAL_BACKUPS_AFTER backups"
echo "  Directory size: $BACKUP_DIR_SIZE"

# List remaining backups
if [ "$TOTAL_BACKUPS_AFTER" -gt 0 ]; then
    echo ""
    echo "Most recent backups (last 5):"
    ls -lth "$BACKUP_DIR"/state_*.json | head -5 | awk '{print "  " $9 " (" $5 ", " $6 " " $7 " " $8 ")"}'
fi
