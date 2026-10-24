#!/usr/bin/env bash
set -euo pipefail

OBSIDIAN_BIN="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/obsidian-cli}"

if [[ -z "${COPILOT_TEST_VAULT_PATH:-}" ]]; then
  cat >&2 <<'EOF'
error: COPILOT_TEST_VAULT_PATH is not set.

Set it once at the user level (e.g. in ~/.zshrc or ~/.config/fish/config.fish)
to the absolute path of an Obsidian vault you've opened at least once:

  export COPILOT_TEST_VAULT_PATH="$HOME/Obsidian/CopilotTestVault"

Then re-run: npm run test:vault
EOF
  exit 1
fi

VAULT_PATH="$COPILOT_TEST_VAULT_PATH"

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "error: vault directory not found: $VAULT_PATH" >&2
  exit 1
fi

if [[ ! -d "$VAULT_PATH/.obsidian" ]]; then
  echo "error: $VAULT_PATH has no .obsidian/ folder." >&2
  echo "Open the folder as a vault in Obsidian once, then re-run." >&2
  exit 1
fi

WORKTREE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKTREE_ROOT"

# Guard: refuse to run if the worktree lives inside the target vault. Otherwise
# the build artifacts and source tree become vault content, Obsidian indexes
# the whole repo on the next reload, and the plugin dir may coincide with the
# worktree (deploying onto itself).
WORKTREE_REAL="$(cd "$WORKTREE_ROOT" && pwd -P)"
VAULT_REAL="$(cd "$VAULT_PATH" && pwd -P)"
case "$WORKTREE_REAL" in
  "$VAULT_REAL"|"$VAULT_REAL"/*)
    cat >&2 <<EOF
error: the worktree is inside the test vault — refusing to deploy.
  worktree: $WORKTREE_REAL
  vault:    $VAULT_REAL
Move the worktree outside the vault, or point \$COPILOT_TEST_VAULT_PATH
at a different vault, then re-run.
EOF
    exit 1
    ;;
esac

VAULT_NAME="$(basename "$VAULT_REAL")"
VAULT_IDENTITY_JSON=""
if [[ -x "$OBSIDIAN_BIN" ]]; then
  echo "==> Verifying the running Obsidian vault before deployment"
  IDENTITY_CODE='JSON.stringify({name:app.vault.getName(),path:app.vault.adapter.getBasePath()})'
  if ! VAULT_IDENTITY_JSON="$(cd "$VAULT_PATH" && "$OBSIDIAN_BIN" "vault=$VAULT_NAME" eval code="$IDENTITY_CODE")"; then
    echo "error: could not verify the running test vault; refusing deployment and reload." >&2
    exit 1
  fi
  if ! VAULT_IDENTITY_JSON="$(node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    try {
      const target = JSON.parse(process.argv[1].trim().replace(/^=>\s*/, ""));
      if (target?.name !== process.argv[3] || typeof target.path !== "string" ||
          !path.isAbsolute(target.path) || fs.realpathSync(target.path) !== process.argv[2]) {
        throw new Error("running vault does not match the configured test vault: " + JSON.stringify(target));
      }
      process.stdout.write(JSON.stringify({ name: target.name, path: target.path }));
    } catch (error) {
      process.stderr.write("error: refusing a different or unverified vault; " + error.message + "\n");
      process.exit(1);
    }
  ' "$VAULT_IDENTITY_JSON" "$VAULT_REAL" "$VAULT_NAME")"; then
    exit 1
  fi
fi

echo "==> Installing dependencies"
npm install --prefer-offline --no-audit --no-fund

BRANCH="$(git -C "$WORKTREE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
BUILD_COMMIT="$(git -C "$WORKTREE_ROOT" rev-parse --short=8 HEAD 2>/dev/null || echo unknown)"
BUILD_STATE="clean"
if [[ -n "$(git -C "$WORKTREE_ROOT" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
  BUILD_STATE="dirty"
fi

# The plugin type check covers dev/gallery, and the gallery's generated story
# index is untracked build output. Regenerate it first so a story renamed or
# deleted on this branch cannot fail the plugin build with a dangling import.
echo "==> Regenerating gallery story index"
npm run gallery:stories

echo "==> Building plugin"
npm run build

PLUGIN_ID="$(node -p "require('./manifest.json').id")"
if [[ -z "$PLUGIN_ID" ]]; then
  echo "error: could not read plugin id from manifest.json" >&2
  exit 1
fi
PLUGIN_ID_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$PLUGIN_ID")"

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$PLUGIN_DIR"

echo "==> Copying artifacts into $PLUGIN_DIR"
for f in main.js styles.css; do
  if [[ ! -f "$WORKTREE_ROOT/$f" ]]; then
    echo "error: expected build artifact missing: $WORKTREE_ROOT/$f" >&2
    exit 1
  fi
  rm -f "$PLUGIN_DIR/$f"
  cp -f "$WORKTREE_ROOT/$f" "$PLUGIN_DIR/$f"
done

BUILD_TS="$(date +%Y%m%d-%H%M%S)"
rm -f "$PLUGIN_DIR/manifest.json"
BUILD_TAG="$(
  SRC="$WORKTREE_ROOT/manifest.json" \
    DEST="$PLUGIN_DIR/manifest.json" \
    ARTIFACT_DIR="$PLUGIN_DIR" \
    BRANCH="$BRANCH" \
    BUILD_COMMIT="$BUILD_COMMIT" \
    BUILD_STATE="$BUILD_STATE" \
    BUILD_TS="$BUILD_TS" \
    node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const hash = crypto.createHash("sha256");
    for (const file of ["main.js", "styles.css"]) {
      hash.update(file);
      hash.update("\0");
      hash.update(fs.readFileSync(path.join(process.env.ARTIFACT_DIR, file)));
      hash.update("\0");
    }
    const bundleSha = hash.digest("hex").slice(0, 12);
    const buildTag = [
      process.env.BUILD_COMMIT,
      process.env.BUILD_STATE,
      bundleSha,
    ].join("-");
    const manifest = JSON.parse(fs.readFileSync(process.env.SRC, "utf8"));
    const versionSeparator = manifest.version.includes("+") ? "." : "+";
    manifest.version += versionSeparator + [
      "dev",
      process.env.BUILD_COMMIT,
      process.env.BUILD_STATE,
      bundleSha,
    ].join(".");
    manifest.name += " [" + buildTag + "]";
    manifest.description = [
      "[dev build: " + buildTag,
      "branch: " + process.env.BRANCH,
      "built: " + process.env.BUILD_TS + "]",
    ].join(" | ") + " " + manifest.description;
    fs.writeFileSync(process.env.DEST, JSON.stringify(manifest, null, 2) + "\n");
    process.stdout.write(buildTag);
  '
)"
echo "==> Wrote development manifest (build: $BUILD_TAG, branch: $BRANCH)"

# The component gallery plugin ships a near-complete copy of the production
# stylesheet (scripts/prepare-gallery-css.mjs concatenates src/styles/tailwind.css
# into its source), and Obsidian injects every enabled plugin's styles.css
# document-wide. Both copies then compete at equal specificity in shared views, so
# a gallery copy built from an older src/styles/tailwind.css silently outranks the
# CSS deployed above and the plugin renders pre-change behavior.
GALLERY_MANIFEST="$WORKTREE_ROOT/dev/gallery/manifest.json"
GALLERY_ID=""
if [[ -f "$GALLERY_MANIFEST" ]]; then
  if ! GALLERY_ID="$(node -e '
    const id = require("./dev/gallery/manifest.json").id;
    if (typeof id !== "string" || id.length === 0) process.exit(1);
    process.stdout.write(id);
  ')" || [[ ! "$GALLERY_ID" =~ ^[a-z0-9-]+$ ]]; then
    echo "warning: no valid plugin id in $GALLERY_MANIFEST; skipping the gallery refresh." >&2
    GALLERY_ID=""
  fi
fi

if [[ -n "$GALLERY_ID" ]]; then
  GALLERY_PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$GALLERY_ID"
  # gallery-vault.sh symlinks its whole source directory into the vault, so the
  # live copy belongs to whichever worktree deployed it last and dangles once
  # that worktree is deleted. Taking it over here keeps both stylesheets in step
  # and means a vanished worktree never blocks testing another branch. Obsidian
  # injects styles.css when a plugin is enabled, so a rewrite in place would not
  # re-inject it; gallery:vault rebuilds and reloads, which does.
  if [[ -e "$GALLERY_PLUGIN_DIR" || -L "$GALLERY_PLUGIN_DIR" ]]; then
    echo "==> Redeploying the gallery plugin from this worktree so both stylesheets match"
    npm run gallery:vault
  fi
fi

# CLI 的连接可能在部署期间改变；同一次求值先复核实际库，再重载，避免误停其他库的插件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
echo "==> Reloading plugin in Obsidian (vault dir: $VAULT_PATH)"
if [[ ! -x "$OBSIDIAN_BIN" ]]; then
  echo "warning: Obsidian CLI not found at $OBSIDIAN_BIN; skipping reload." >&2
else
  RELOAD_CODE="(async()=>{const target=$VAULT_IDENTITY_JSON;if(app.vault.getName()!==target.name||app.vault.adapter.getBasePath()!==target.path)throw new Error('Refusing to reload a different vault');const id=$PLUGIN_ID_JSON;await app.plugins.loadManifests();if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);await app.plugins.enablePluginAndSave(id);return 'reloaded';})()"
  if (cd "$VAULT_PATH" && "$OBSIDIAN_BIN" "vault=$VAULT_NAME" eval code="$RELOAD_CODE" >/dev/null 2>&1); then
    echo "    reloaded (onload re-ran). Note: the sidebar manifest label only"
    echo "    refreshes on a full Obsidian restart; use a dev-console marker to"
    echo "    confirm the loaded build, not the label."
  else
    echo "error: reload failed or the running vault changed; no other vault will be selected." >&2
    exit 1
  fi
fi

echo
echo "Done."
echo "  worktree: $WORKTREE_ROOT"
echo "  branch:   $BRANCH"
echo "  build:    $BUILD_TAG"
echo "  built:    $BUILD_TS"
echo "  vault:    $VAULT_PATH"
echo "  plugin:   $PLUGIN_ID"
