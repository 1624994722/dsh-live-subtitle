#!/bin/bash
# Create the GitHub repository and publish the first release.
# Prerequisite: `gh auth login` completed for github.com.
set -euo pipefail
cd "$(dirname "$0")"

GH="$HOME/.local/bin/gh"
if command -v gh >/dev/null 2>&1; then GH="$(command -v gh)"; fi
"$GH" auth status >/dev/null 2>&1 || { echo "First run: $GH auth login"; exit 1; }

LOGIN="$("$GH" api user --jq .login)"
ID="$("$GH" api user --jq .id)"
REPO="$LOGIN/dsh-live-subtitle"

git config user.name "$LOGIN"
git config user.email "${ID}+${LOGIN}@users.noreply.github.com"

git add -A
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git commit -m "dsh-live-subtitle v1.0.0"
else
  git commit --amend --reset-author --no-edit
fi

if "$GH" repo view "$REPO" >/dev/null 2>&1; then
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$REPO.git"
  git push -u origin main
else
  "$GH" repo create "$REPO" --public --source . --remote origin --push
fi

if ! git rev-parse -q --verify "refs/tags/v1.0.0" >/dev/null; then
  git tag -a v1.0.0 -m "dsh-live-subtitle v1.0.0"
fi
git push origin v1.0.0
echo "Published: https://github.com/$REPO"
