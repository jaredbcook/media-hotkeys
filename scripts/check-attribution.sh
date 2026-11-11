#!/bin/sh
# Rejects co-authorship, attribution, and authored-by lines in commit messages and
# pull request descriptions. Reads the files given as arguments, or stdin.
# Used by .husky/commit-msg and the pull request check in .github/workflows/ci.yml.

pattern='^[[:space:]]*(🤖|co-?authored-by:|claude-session:|(generated|authored|written|created|made)[[:space:]]+(with|by)[[:space:]])|noreply@(anthropic|openai)\.com'

text=$(cat -- "$@") || exit 1

if matches=$(printf '%s\n' "$text" | grep -n -i -E "$pattern"); then
  echo "Attribution lines aren't allowed in commit messages or pull request descriptions:" >&2
  echo "$matches" >&2
  echo "Remove them. Changes are judged on their merits, not on who or what wrote them (see AGENTS.md)." >&2
  exit 1
fi
