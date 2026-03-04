#!/bin/bash
# PostToolUse hook: when Supabase MCP apply_migration runs remotely,
# create the corresponding local migration file so `supabase db push` stays in sync.
set -e

INPUT=$(cat)

# Extract migration name and SQL from tool_input
# The MCP tool may use "name" or "migration_name", and "query" or "sql" or "statements"
NAME=$(echo "$INPUT" | jq -r '.tool_input.name // .tool_input.migration_name // empty' 2>/dev/null)
SQL=$(echo "$INPUT" | jq -r '.tool_input.query // .tool_input.sql // .tool_input.statements // empty' 2>/dev/null)

if [ -z "$NAME" ] || [ -z "$SQL" ]; then
  # Can't extract needed info — log but don't block
  exit 0
fi

MIGRATIONS_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}/supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  exit 0
fi

# Generate timestamp-based filename matching Supabase convention
TIMESTAMP=$(date -u +"%Y%m%d%H%M%S")
FILENAME="${TIMESTAMP}_${NAME}.sql"
FILEPATH="${MIGRATIONS_DIR}/${FILENAME}"

# Don't overwrite if file already exists
if [ -f "$FILEPATH" ]; then
  exit 0
fi

echo "$SQL" > "$FILEPATH"

# Return context to Claude so it knows the file was created
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Local migration file created at supabase/migrations/${FILENAME} to keep local and remote in sync."
  }
}
EOF

exit 0
