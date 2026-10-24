#!/usr/bin/env bash
set -euo pipefail

OBSIDIAN_BIN="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/obsidian-cli}"

if [[ -z "${COPILOT_TEST_VAULT_PATH:-}" ]]; then
  cat >&2 <<'EOF'
error: COPILOT_TEST_VAULT_PATH is not set.

Set it once at the user level to the absolute path of an Obsidian vault you've
opened at least once, then re-run: npm run gallery:vault
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

if ! PLUGIN_ID="$(node -e '
  const id = require("./dev/gallery/manifest.json").id;
  if (typeof id !== "string" || id.length === 0) process.exit(1);
  process.stdout.write(id);
')"; then
  echo "error: could not read plugin id from dev/gallery/manifest.json" >&2
  exit 1
fi
if [[ ! "$PLUGIN_ID" =~ ^[a-z0-9-]+$ ]]; then
  echo "error: invalid plugin id in dev/gallery/manifest.json: $PLUGIN_ID" >&2
  exit 1
fi
PLUGIN_ID_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$PLUGIN_ID")"

GALLERY_SOURCE_DIR="$WORKTREE_ROOT/dev/gallery"
for artifact in main.js manifest.json styles.css; do
  source_path="$GALLERY_SOURCE_DIR/$artifact"
  if [[ ! -f "$source_path" ]]; then
    echo "error: expected gallery artifact missing: $source_path" >&2
    exit 1
  fi
done
touch "$GALLERY_SOURCE_DIR/.hotreload"

PLUGIN_ROOT="$VAULT_PATH/.obsidian/plugins"
PLUGIN_DIR="$PLUGIN_ROOT/$PLUGIN_ID"
mkdir -p "$PLUGIN_ROOT"

preflight_legacy_plugin_dir() {
  local entry
  local entry_name

  while IFS= read -r -d '' entry; do
    entry_name="${entry##*/}"
    case "$entry_name" in
      main.js|manifest.json|styles.css)
        if [[ ! -L "$entry" ]]; then
          echo "error: refusing to replace gallery directory with non-symlink artifact: $entry" >&2
          return 1
        fi
        ;;
      .hotreload)
        if [[ ! -f "$entry" || -L "$entry" ]]; then
          echo "error: refusing to replace gallery directory with invalid marker: $entry" >&2
          return 1
        fi
        ;;
      *)
        echo "error: refusing to replace gallery directory with unexpected entry: $entry" >&2
        return 1
        ;;
    esac
  done < <(find "$PLUGIN_DIR" -mindepth 1 -maxdepth 1 -print0)
}

echo "==> Linking gallery plugin directory at $PLUGIN_DIR"
if [[ -L "$PLUGIN_DIR" ]]; then
  rm -f "$PLUGIN_DIR"
elif [[ -d "$PLUGIN_DIR" ]]; then
  preflight_legacy_plugin_dir
  for entry_name in main.js manifest.json styles.css .hotreload; do
    entry_path="$PLUGIN_DIR/$entry_name"
    if [[ -e "$entry_path" || -L "$entry_path" ]]; then
      rm -f "$entry_path"
    fi
  done
  rmdir "$PLUGIN_DIR"
elif [[ -e "$PLUGIN_DIR" ]]; then
  echo "error: refusing to replace non-directory gallery plugin path: $PLUGIN_DIR" >&2
  exit 1
fi
ln -s "$GALLERY_SOURCE_DIR" "$PLUGIN_DIR"

echo "==> Reloading gallery plugin in Obsidian (vault dir: $VAULT_PATH)"
if [[ ! -x "$OBSIDIAN_BIN" ]]; then
  echo "warning: Obsidian CLI not found at $OBSIDIAN_BIN; skipping reload." >&2
else
  # 身份复核与重载放在同一次求值，防止预检后连接切换到其他库。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  RELOAD_CODE="(async()=>{const target=$VAULT_IDENTITY_JSON;if(app.vault.getName()!==target.name||app.vault.adapter.getBasePath()!==target.path)throw new Error('Refusing to reload a different vault');const id=$PLUGIN_ID_JSON;await app.plugins.loadManifests();if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);await app.plugins.enablePluginAndSave(id);const state={manifest:!!app.plugins.manifests[id],loaded:!!app.plugins.plugins[id],enabled:app.plugins.enabledPlugins.has(id)};if(!state.manifest||!state.loaded||!state.enabled)throw new Error('Gallery plugin failed to load: '+JSON.stringify(state));return JSON.stringify(state);})()"
  if (cd "$VAULT_PATH" && "$OBSIDIAN_BIN" "vault=$VAULT_NAME" eval code="$RELOAD_CODE" >/dev/null 2>&1); then
    echo "    reloaded"
  else
    echo "error: reload failed or the running vault changed; no other vault will be selected." >&2
    exit 1
  fi
fi

echo
echo "Done."
echo "  worktree: $WORKTREE_ROOT"
echo "  vault:    $VAULT_PATH"
echo "  plugin:   $PLUGIN_ID"
