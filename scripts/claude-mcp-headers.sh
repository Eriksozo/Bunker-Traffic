#!/bin/sh
# Claude Code headersHelper for the Bunker agent MCP (Worker /mcp).
# Reads the dedicated Claude credential from a private file outside the repository
# and prints only the JSON header object Claude Code expects on stdout.
# No credential lives in this script, in .mcp.json or in Git.
set -eu

file="${BUNKER_CLAUDE_TOKEN_FILE:-$HOME/.config/bunker-traffic/claude-agent-token}"
expected_url='https://bunker-traffic.erik-iplou.workers.dev/mcp'

fail() { echo "bunker headersHelper: $1" >&2; exit 1; }

# Refuse to hand the credential to any server other than the Bunker Worker.
[ "${CLAUDE_CODE_MCP_SERVER_URL:-}" = "$expected_url" ] || fail 'unexpected MCP server URL'
[ -f "$file" ] && [ ! -L "$file" ] || fail 'credential file missing'
[ "$(stat -f '%u' "$file" 2>/dev/null || stat -c '%u' "$file")" = "$(id -u)" ] || fail 'credential file owner mismatch'
mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file")"
[ "$mode" = 600 ] || [ "$mode" = 400 ] || fail 'credential file permissions must be 600 or 400'

token="$(tr -d '\r\n' < "$file")"
# base64url only, so the value is safe inside JSON without escaping.
printf '%s' "$token" | grep -Eq '^[A-Za-z0-9_-]{43,128}$' || fail 'credential file format invalid'

printf '{"Authorization":"Bearer %s"}\n' "$token"
