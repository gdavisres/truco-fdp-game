#!/bin/bash
# Restore the Truco FDP game state file from a backup
# Usage: ./restore-state.sh [backup_file]
# If backup_file is not provided, lists available backups

set -e

# Configuration
STATE_FILE="${STATE_FILE_PATH:-../var/state.json}"
BACKUP_DIR="${BACKUP_DIR:-../var/backups}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "========================================="
echo "Truco FDP State Restoration"
echo "========================================="

# Check if backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}ERROR: Backup directory not found: $BACKUP_DIR${NC}"
    exit 1
fi

# If no argument provided, list available backups
if [ -z "$1" ]; then
    echo "Available backups:"
    echo ""
    
    BACKUPS=($(ls -t "$BACKUP_DIR"/state_*.json 2>/dev/null))
    
    if [ ${#BACKUPS[@]} -eq 0 ]; then
        echo -e "${YELLOW}No backups found in $BACKUP_DIR${NC}"
        exit 1
    fi
    
    for i in "${!BACKUPS[@]}"; do
        BACKUP_FILE="${BACKUPS[$i]}"
        BACKUP_NAME=$(basename "$BACKUP_FILE")
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        BACKUP_DATE=$(stat -c %y "$BACKUP_FILE" 2>/dev/null || stat -f %Sm "$BACKUP_FILE" 2>/dev/null)
        
        # Validate JSON
        if jq empty "$BACKUP_FILE" 2>/dev/null; then
            JSON_STATUS="${GREEN}✓ Valid${NC}"
        else
            JSON_STATUS="${RED}✗ Invalid${NC}"
        fi
        
        echo -e "  $((i+1)). $BACKUP_NAME"
        echo -e "     Size: $BACKUP_SIZE | Date: $BACKUP_DATE"
        echo -e "     JSON: $JSON_STATUS"
        echo ""
    done
    
    echo "Usage: ./restore-state.sh <backup_file>"
    echo "Example: ./restore-state.sh $BACKUP_DIR/state_20250929_120000.json"
    exit 0
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}ERROR: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

# Validate backup file is valid JSON
echo "Validating backup file..."
if ! jq empty "$BACKUP_FILE" 2>/dev/null; then
    echo -e "${RED}ERROR: Backup file contains invalid JSON${NC}"
    echo "Cannot restore from corrupted backup."
    exit 1
fi

# Show backup info
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
BACKUP_DATE=$(stat -c %y "$BACKUP_FILE" 2>/dev/null || stat -f %Sm "$BACKUP_FILE" 2>/dev/null)

echo ""
echo "Backup information:"
echo "  File: $BACKUP_FILE"
echo "  Size: $BACKUP_SIZE"
echo "  Date: $BACKUP_DATE"
echo ""

# Check if state file exists and create backup
if [ -f "$STATE_FILE" ]; then
    CURRENT_SIZE=$(du -h "$STATE_FILE" | cut -f1)
    echo -e "${YELLOW}WARNING: Current state file will be replaced${NC}"
    echo "  Current state size: $CURRENT_SIZE"
    
    # Create emergency backup of current state
    EMERGENCY_BACKUP="$BACKUP_DIR/state_emergency_$(date +%Y%m%d_%H%M%S).json"
    echo ""
    echo "Creating emergency backup of current state..."
    cp "$STATE_FILE" "$EMERGENCY_BACKUP"
    echo -e "${GREEN}✓ Emergency backup created: $EMERGENCY_BACKUP${NC}"
fi

echo ""
read -p "Are you sure you want to restore? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo "Restoration cancelled."
    exit 0
fi

# Restore the backup
echo "Restoring state from backup..."
cp "$BACKUP_FILE" "$STATE_FILE"

# Verify restoration
if [ ! -f "$STATE_FILE" ]; then
    echo -e "${RED}ERROR: State file was not created${NC}"
    exit 1
fi

# Validate restored file
if ! jq empty "$STATE_FILE" 2>/dev/null; then
    echo -e "${RED}ERROR: Restored state file contains invalid JSON${NC}"
    
    # Restore emergency backup if it exists
    if [ -f "$EMERGENCY_BACKUP" ]; then
        echo "Restoring emergency backup..."
        cp "$EMERGENCY_BACKUP" "$STATE_FILE"
        echo -e "${YELLOW}Emergency backup restored${NC}"
    fi
    
    exit 1
fi

RESTORED_SIZE=$(du -h "$STATE_FILE" | cut -f1)

echo ""
echo -e "${GREEN}✓ State restored successfully${NC}"
echo "  Restored size: $RESTORED_SIZE"
echo "  Location: $STATE_FILE"
echo ""
echo -e "${BLUE}Note: Restart the server for changes to take effect${NC}"
echo "  npm run restart:prod"
