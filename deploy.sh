#!/usr/bin/env bash
# One-shot: create a local git repo, a public GitHub repo, and enable GitHub Pages
# (deployed by .github/workflows/deploy.yml after the Playwright tests pass).
#
#   ./deploy.sh [repo-name]        # default: ironcrown
set -euo pipefail
REPO="${1:-ironcrown}"
cd "$(dirname "$0")"

command -v gh >/dev/null || { echo "Install the GitHub CLI: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login

# 1. Local repository
[ -d .git ] || git init -b main
git add -A
git diff --cached --quiet || git commit -m "Ironcrown: kingdom strategy game"

# 2. Public GitHub repository + push
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source=. --remote=origin \
    --description "Ironcrown — browser kingdom strategy game (HTML5 Canvas)" --push
else
  git push -u origin main
fi
OWNER="$(gh api user --jq .login)"

# 3. GitHub Pages, built by GitHub Actions
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null
gh workflow run deploy.yml --ref main >/dev/null 2>&1 || true   # first push may have raced Pages setup

echo "Waiting for the test + deploy workflow…"
sleep 5
RUN_ID="$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --exit-status
echo "Live at: https://$OWNER.github.io/$REPO/"
