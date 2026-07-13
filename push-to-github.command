#!/bin/bash
# ============================================================================
# push-to-github.command — publish The Stated Order to
# github.com/Doriankantor/statedorder (feeds the live GitHub Pages site).
#
# Run it either way:
#   • double-click this file in Finder, OR
#   • in Terminal:  bash "push-to-github.command"
#
# Safe to run repeatedly: it commits whatever changed (e.g. a fresh
# publications.generated.js after re-running the scraper) and pushes.
# Reads your GitHub token from .env (which .gitignore keeps out of the repo).
# ============================================================================
set -e
cd "$(dirname "$0")"

# --- read token from .env -------------------------------------------------
if [ ! -f .env ]; then echo "ERROR: no .env file with GH_TOKEN in this folder."; exit 1; fi
GH_TOKEN=$(grep '^GH_TOKEN=' .env | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')
if [ -z "$GH_TOKEN" ]; then echo "ERROR: GH_TOKEN is empty in .env."; exit 1; fi
REMOTE="https://${GH_TOKEN}@github.com/Doriankantor/statedorder.git"

# --- init once, then reuse the existing repo on later runs ----------------
if [ ! -d .git ]; then
  git init -q -b main
  git config user.name  "Dorian Kantor"
  git config user.email "doriankantor@gmail.com"
fi
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/Doriankantor/statedorder.git

# --- stage everything except what .gitignore excludes (.env stays out) -----
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -q -m "Update The Stated Order — $(date '+%Y-%m-%d %H:%M')"
fi

echo "Tracked files:"
git ls-files | sed 's/^/  /'

# --- push; if the remote is ahead, rebase onto it and retry ---------------
echo "Pushing to github.com/Doriankantor/statedorder ..."
if ! git push "$REMOTE" main:main 2>/tmp/so_push_err; then
  cat /tmp/so_push_err
  echo "Remote has other commits — rebasing onto it, then pushing again..."
  git pull --rebase "$REMOTE" main
  git push "$REMOTE" main:main
fi

echo ""
echo "Done -> https://github.com/Doriankantor/statedorder"
