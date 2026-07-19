#!/usr/bin/bash

set -euo pipefail

WORKSPACE="$1"

git config --global --add safe.directory "$WORKSPACE"
echo "✅ Added $WORKSPACE to git safe directories"

if [[ -z "${CODESPACES:-}" ]] && [[ -z "${GITHUB_ACTIONS:-}" ]]; then
  # Using a glob directly with compgen or checking existence to avoid ls error code 2
  SOCK_PATH=$(find /tmp -maxdepth 1 -name "vscode-ssh-auth-*.sock" 2>/dev/null | head -n1 || true)
  if [[ -n "$SOCK_PATH" ]]; then
    echo "export SSH_AUTH_SOCK=$SOCK_PATH" >> ~/.zshrc
    echo "export SSH_AUTH_SOCK=$SOCK_PATH" >> ~/.bashrc
    export SSH_AUTH_SOCK=$SOCK_PATH
    echo "✅ Mapped SSH_AUTH_SOCK"
  else
    echo "⚠️  VS Code agent socket not found; leaving SSH_AUTH_SOCK unchanged"
  fi
else
  echo "⏩ Skipping SSH_AUTH_SOCK setup for Codespaces or GitHub Actions"
fi

cd "$WORKSPACE"

# node_modules persists across container rebuilds (bind-mounted workspace),
# but patched packages can end up in a stale state that no longer matches
# the current patch file, making patch-package fail on the next `npm install`.
# Force a clean reinstall of every patched package so patches always apply
# cleanly against a fresh copy.
for patch_file in patches/*.patch; do
  [[ -e "$patch_file" ]] || continue
  pkg=$(basename "$patch_file" .patch)
  pkg="${pkg%+*}"
  if [[ "$pkg" == @*+* ]]; then
    pkg="${pkg/+//}"
  fi
  rm -rf "node_modules/$pkg"
done

npm install
npx playwright install --with-deps chromium
echo '✅ Initialized  development environment...'
