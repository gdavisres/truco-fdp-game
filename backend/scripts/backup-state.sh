#!/bin/bash
# Backup the Truco FDP game state file
# Usage: ./backup-state.sh

set -e

# Configuration
STATE_FILE="${STATE_FILE_PATH:-../var/state.json}"
BACKUP_DIR="${BACKUP_DIR:-../var/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/state_$DATE.json"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "Truco FDP State Backup"
echo "========================================="

# Check if state file exists
if [ ! -f "$STATE_FILE" ]; then
    echo -e "${RED}ERROR: State file not found at $STATE_FILE${NC}"
    exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if backup directory is writable
if [ ! -w "$BACKUP_DIR" ]; then
    echo -e "${RED}ERROR: Backup directory is not writable: $BACKUP_DIR${NC}"
    exit 1
fi

# Validate state file is valid JSON
if ! jq empty "$STATE_FILE" 2>/dev/null; then
    echo -e "${YELLOW}WARNING: State file may contain invalid JSON${NC}"
    echo "Proceeding with backup anyway..."
fi

# Create backup
echo "Creating backup..."
echo "  Source: $STATE_FILE"
echo "  Target: $BACKUP_FILE"

cp "$STATE_FILE" "$BACKUP_FILE"

# Verify backup was created
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}ERROR: Backup file was not created${NC}"
    exit 1
fi

# Verify backup is valid JSON
if ! jq empty "$BACKUP_FILE" 2>/dev/null; then
    echo -e "${RED}ERROR: Backup file contains invalid JSON${NC}"
    exit 1
fi

# Get file sizes
STATE_SIZE=$(du -h "$STATE_FILE" | cut -f1)
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

echo -e "${GREEN}✓ Backup created successfully${NC}"
echo "  Original size: $STATE_SIZE"
echo "  Backup size: $BACKUP_SIZE"
echo "  Backup location: $BACKUP_FILE"

# Count total backups
TOTAL_BACKUPS=$(ls -1 "$BACKUP_DIR"/state_*.json 2>/dev/null | wc -l)
echo ""
echo "Total backups: $TOTAL_BACKUPS"

# Show disk usage
BACKUP_DIR_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "Backup directory size: $BACKUP_DIR_SIZE"

# List most recent backups
echo ""
echo "Recent backups (last 5):"
ls -lth "$BACKUP_DIR"/state_*.json | head -5 | awk '{print "  " $9 " (" $5 ", " $6 " " $7 " " $8 ")"}'

echo ""
echo -e "${GREEN}Backup complete!${NC}"
