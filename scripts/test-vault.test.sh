#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURE_ROOT="$TEST_ROOT/repo"
VAULT_ROOT="$TEST_ROOT/vault"
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FIXTURE_ROOT/scripts" "$VAULT_ROOT/.obsidian" "$FAKE_BIN"
cp "$REPO_ROOT/scripts/test-vault.sh" "$FIXTURE_ROOT/scripts/test-vault.sh"
if ! grep -qF 'OBSIDIAN_BIN="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/obsidian-cli}"' "$FIXTURE_ROOT/scripts/test-vault.sh"; then
  echo "expected the official CLI as the default instead of an application launcher" >&2
  exit 1
fi

cat >"$FIXTURE_ROOT/manifest.json" <<'EOF'
{
  "id": "copilot",
  "name": "Copilot",
  "version": "4.0.0-preview-260629",
  "description": "Test fixture"
}
EOF
printf 'clean bundle\n' >"$FIXTURE_ROOT/main.js"
printf 'clean styles\n' >"$FIXTURE_ROOT/styles.css"
printf 'tracked\n' >"$FIXTURE_ROOT/source.txt"
printf 'main.js\nstyles.css\n' >"$FIXTURE_ROOT/.gitignore"

DEPLOY_CALL_LOG="$TEST_ROOT/deploy-calls.log"
cat >"$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "npm $*" >>"$DEPLOY_CALL_LOG"
exit 0
EOF
cat >"$FAKE_BIN/obsidian" <<'EOF'
#!/usr/bin/env bash
node - "$@" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const expectedName = path.basename(fs.realpathSync(process.env.COPILOT_TEST_VAULT_PATH));
if (!args.includes("vault=" + expectedName)) throw new Error("missing explicit target vault");
const record = value => fs.appendFileSync(process.env.DEPLOY_CALL_LOG, value + "\n");
record("obsidian " + args.join(" "));
const command = args.find(value => !value.startsWith("vault="));
if (command !== "eval") {
  record("mutation " + command);
  process.exit(0);
}
const code = args.find(value => value.startsWith("code="))?.slice(5);
const actualPath = (code.includes("app.plugins") ? process.env.FAKE_RELOAD_VAULT_PATH : null)
  || process.env.FAKE_ACTUAL_VAULT_PATH;
const plugins = { copilot: {}, "copilot-component-gallery": {} };
const app = {
  vault: {
    getName: () => path.basename(fs.realpathSync(actualPath)),
    adapter: { getBasePath: () => actualPath },
  },
  plugins: {
    plugins,
    manifests: plugins,
    enabledPlugins: new Set(Object.keys(plugins)),
    loadManifests: async () => record("mutation loadManifests"),
    disablePlugin: async id => record("mutation disable " + id),
    enablePluginAndSave: async id => record("mutation enable " + id),
  },
};
Promise.resolve().then(() => Function("app", "return (" + code + ");")(app))
  .then(value => process.stdout.write((process.env.FAKE_RESULT_PREFIX || "") + (typeof value === "string" ? value : JSON.stringify(value)) + "\n"))
  .catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
JS
EOF
chmod +x "$FAKE_BIN/npm" "$FAKE_BIN/obsidian"

git -C "$FIXTURE_ROOT" init -q
git -C "$FIXTURE_ROOT" config user.email "test@example.com"
git -C "$FIXTURE_ROOT" config user.name "Test"
git -C "$FIXTURE_ROOT" config commit.gpgsign false
git -C "$FIXTURE_ROOT" add .gitignore manifest.json scripts/test-vault.sh source.txt
git -C "$FIXTURE_ROOT" commit -qm "fixture"

DEPLOY_STDERR="$TEST_ROOT/deploy-stderr.log"
run_deploy() {
  : >"$DEPLOY_CALL_LOG"
  PATH="$FAKE_BIN:$PATH" \
    COPILOT_TEST_VAULT_PATH="$VAULT_ROOT" \
    OBSIDIAN_BIN="$FAKE_BIN/obsidian" \
    DEPLOY_CALL_LOG="$DEPLOY_CALL_LOG" \
    FAKE_ACTUAL_VAULT_PATH="${FAKE_ACTUAL_VAULT_PATH:-$VAULT_ROOT}" \
    FAKE_RELOAD_VAULT_PATH="${FAKE_RELOAD_VAULT_PATH:-}" \
    FAKE_RESULT_PREFIX="${FAKE_RESULT_PREFIX:-}" \
    bash "$FIXTURE_ROOT/scripts/test-vault.sh" >/dev/null 2>"$DEPLOY_STDERR"
}

WRONG_VAULT="$TEST_ROOT/other/vault"
mkdir -p "$WRONG_VAULT/.obsidian"
if FAKE_ACTUAL_VAULT_PATH="$WRONG_VAULT" run_deploy; then
  echo "expected a same-name vault with a different full path to fail before deployment" >&2
  exit 1
fi
if grep -q '^mutation ' "$DEPLOY_CALL_LOG" || [[ -e "$VAULT_ROOT/.obsidian/plugins/copilot/main.js" ]]; then
  echo "wrong-vault preflight allowed a plugin mutation or artifact deployment" >&2
  exit 1
fi

if FAKE_RELOAD_VAULT_PATH="$WRONG_VAULT" run_deploy; then
  echo "expected a vault changed after preflight to fail before reload mutation" >&2
  exit 1
fi
if grep -q '^mutation ' "$DEPLOY_CALL_LOG"; then
  echo "a reload mutated a vault that changed after preflight" >&2
  exit 1
fi
rm -rf "$VAULT_ROOT/.obsidian/plugins"

assert_manifest() {
  local state="$1"
  ARTIFACT_DIR="$VAULT_ROOT/.obsidian/plugins/copilot" \
    BUILD_COMMIT="$COMMIT" \
    BUILD_STATE="$state" \
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
    const manifest = require(path.join(process.env.ARTIFACT_DIR, "manifest.json"));
    const expectedVersion =
      `4.0.0-preview-260629+dev.${process.env.BUILD_COMMIT}.${process.env.BUILD_STATE}.${bundleSha}`;
    if (manifest.version !== expectedVersion) {
      throw new Error(`expected ${expectedVersion}, received ${manifest.version}`);
    }
    if (manifest.name !== `Copilot [${buildTag}]`) {
      throw new Error(`unexpected build name: ${manifest.name}`);
    }
    if (!manifest.description.includes(`dev build: ${buildTag}`)) {
      throw new Error(`build tag missing from description: ${manifest.description}`);
    }
  '
}

COMMIT="$(git -C "$FIXTURE_ROOT" rev-parse --short=8 HEAD)"
mkdir -p "$VAULT_ROOT/.obsidian/plugins/copilot"
ln -s "$FIXTURE_ROOT/main.js" "$VAULT_ROOT/.obsidian/plugins/copilot/main.js"
ln -s "$FIXTURE_ROOT/styles.css" "$VAULT_ROOT/.obsidian/plugins/copilot/styles.css"
run_deploy
assert_manifest clean
FAKE_RESULT_PREFIX='=> ' FAKE_ACTUAL_VAULT_PATH="$VAULT_ROOT/." run_deploy
assert_manifest clean

for artifact in main.js styles.css; do
  if [[ -L "$VAULT_ROOT/.obsidian/plugins/copilot/$artifact" ]]; then
    echo "expected $artifact to be copied, not symlinked" >&2
    exit 1
  fi
done
DEPLOYED_MAIN="$VAULT_ROOT/.obsidian/plugins/copilot/main.js"
printf 'changed after deployment\n' >"$FIXTURE_ROOT/main.js"
if [[ "$(cat "$DEPLOYED_MAIN")" != "clean bundle" ]]; then
  echo "deployed main.js changed when the worktree artifact changed" >&2
  exit 1
fi
if [[ "$(node -p "require('$FIXTURE_ROOT/manifest.json').version")" != "4.0.0-preview-260629" ]]; then
  echo "test-vault changed the source manifest version" >&2
  exit 1
fi

STORIES_LINE="$(grep -n -m1 '^npm run gallery:stories$' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
BUILD_LINE="$(grep -n -m1 '^npm run build$' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
if [[ -z "$STORIES_LINE" || -z "$BUILD_LINE" || "$BUILD_LINE" -le "$STORIES_LINE" ]]; then
  echo "built the plugin before regenerating the gallery story index" >&2
  exit 1
fi

printf 'dirty\n' >>"$FIXTURE_ROOT/source.txt"
printf 'dirty bundle\n' >"$FIXTURE_ROOT/main.js"
run_deploy
assert_manifest dirty

GALLERY_ID="copilot-component-gallery"
GALLERY_PLUGIN_DIR="$VAULT_ROOT/.obsidian/plugins/$GALLERY_ID"
mkdir -p "$FIXTURE_ROOT/dev/gallery"
cat >"$FIXTURE_ROOT/dev/gallery/manifest.json" <<EOF
{
  "id": "$GALLERY_ID",
  "name": "Gallery",
  "version": "0.0.1"
}
EOF

run_deploy
if grep -q "gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "rebuilt the gallery when the vault has no gallery plugin installed" >&2
  exit 1
fi
if grep -qi "gallery" "$DEPLOY_STDERR"; then
  echo "warned about the gallery when the vault has no gallery plugin installed" >&2
  exit 1
fi

ln -s "$FIXTURE_ROOT/dev/gallery" "$GALLERY_PLUGIN_DIR"
run_deploy
if ! grep -q "npm run gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "did not rebuild the gallery deployed from this worktree" >&2
  exit 1
fi
GALLERY_DEPLOY_LINE="$(grep -n -m1 '^npm run gallery:vault$' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
FIRST_RELOAD_LINE="$(grep -n -m1 '^mutation ' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
if [[ -z "$GALLERY_DEPLOY_LINE" || -z "$FIRST_RELOAD_LINE" || "$FIRST_RELOAD_LINE" -le "$GALLERY_DEPLOY_LINE" ]]; then
  echo "reloaded Obsidian before both plugins were deployed" >&2
  exit 1
fi

FOREIGN_GALLERY="$TEST_ROOT/other-worktree/dev/gallery"
mkdir -p "$FOREIGN_GALLERY"
rm "$GALLERY_PLUGIN_DIR"
ln -s "$FOREIGN_GALLERY" "$GALLERY_PLUGIN_DIR"
run_deploy
if ! grep -q "npm run gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "did not take over a gallery deployed from another worktree" >&2
  exit 1
fi

rm -r "$FOREIGN_GALLERY"
run_deploy
if ! grep -q "npm run gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "did not take over a gallery whose worktree no longer exists" >&2
  exit 1
fi

echo "test-vault deployment tests passed"
