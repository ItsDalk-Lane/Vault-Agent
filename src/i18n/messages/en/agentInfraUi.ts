export const agentInfraUi = {
  "agentInfra.setup.claude":
    "Anthropic models, billed to your Claude Code subscription. Runs the claude CLI already on your machine.",
  "agentInfra.setup.codex":
    "OpenAI models, billed to your ChatGPT subscription. Runs the codex-acp adapter on your machine.",
  "agentInfra.setup.opencode":
    "Any model on your own provider key. Vault Agent can download and manage the binary for you.",
  "agentInfra.skills.title": "Skills",
  "agentInfra.skills.intro":
    "Skills are instruction packets your agents can run - things like “review a diff” or “write a release note”. Skills you put under your shared folder, or directly inside an agent’s own skills folder, show up here automatically.",
  "agentInfra.skills.searchPlaceholder": "Search skills…",
  "agentInfra.skills.searchAria": "Search skills",
  "agentInfra.skills.loadedCount": "{count} loaded",
  "agentInfra.skills.yourSkills": "Your Skills",
  "agentInfra.skills.noMatch": "No skills match “{query}”.",
  "agentInfra.skills.refreshLinksFailed":
    "Some skill links could not be updated. Check folder permissions.",
  "agentInfra.skills.updateFailed": "Could not update {name}: {error}",
  "agentInfra.skills.deleteFailed": "Failed to delete {name}: {error}",
  "agentInfra.skills.collision":
    "A skill with this name already exists in Your Skills. Your file is kept unchanged.",
  "agentInfra.skills.eperm.title": "Windows needs Developer Mode for multi-agent fanout.",
  "agentInfra.skills.eperm.body":
    "Creating shortcuts in your agent folders requires admin, or Settings → Privacy & security → For developers → Developer Mode. Until then, agent toggles flip in the file but no shortcut is created.",
  "agentInfra.skills.dismiss": "Dismiss",
  "agentInfra.skills.sync.title": "This vault is inside {brand}.",
  "agentInfra.skills.sync.body":
    "Sync sometimes replaces directory junctions with shortcuts. If a skill disappears from an agent after a sync, re-toggle it here to recreate the link.",
  "agentInfra.skills.empty.title": "No skills yet",
  "agentInfra.skills.empty.bodyPrefix":
    "Skills you create or save into your shared folder show up here. Skills under ",
  "agentInfra.skills.empty.middle": ", ",
  "agentInfra.skills.empty.or": ", or ",
  "agentInfra.skills.empty.suffix": " show up here automatically too.",
  "agentInfra.skills.empty.footer": "shared home ·",
  "agentInfra.skills.builtin.title": "Built-in Skills",
  "agentInfra.skills.builtin.empty": "No built-in skills match your search.",
  "agentInfra.skills.builtin.disabled": "Disabled",
  "agentInfra.skills.builtin.setUpToEnable": "Set up {agent} to enable",
  "agentInfra.skills.builtin.forAgent": "{skill} for {agent}",
  "agentInfra.skills.actions.more": "More actions",
  "agentInfra.skills.actions.moreFor": "More actions for {name}",
  "agentInfra.skills.actions.disableSkill": "Disable skill",
  "agentInfra.skills.actions.enableSkill": "Enable skill",
  "agentInfra.skills.actions.viewSkillMd": "View SKILL.md (read-only)",
  "agentInfra.skills.builtin.contentAria": "{name} content (read-only)",
  "agentInfra.skills.agentButton.disable": "Disable {agent}",
  "agentInfra.skills.agentButton.enable": "Enable {agent}",
  "agentInfra.skills.row.editSkillMd": "Edit SKILL.md",
  "agentInfra.skills.row.properties": "Properties…",
  "agentInfra.skills.row.reveal": "Reveal in vault",
  "agentInfra.skills.row.delete": "Delete…",
  "agentInfra.skills.row.migrate": "Migrate to shared folder",
  "agentInfra.skills.row.tooltipEnabled": "Enabled for {agent}",
  "agentInfra.skills.row.tooltipDisabled": "Disabled for {agent} · click to enable",
  "agentInfra.skills.row.duplicated":
    "This skill is duplicated in {count} agent folders. Editing one copy would silently diverge from the others. Migrate it to your shared folder first to enable edits.",
  "agentInfra.skills.row.inFolder": "in {folder}",
  "agentInfra.skills.row.mirroredIn": "mirrored in {folders}",
  "agentInfra.skills.chip.modelInvokeOff": "model-invoke off",
  "agentInfra.skills.chip.hiddenFromSlash": "hidden from /",
  "agentInfra.skills.notice.enableFailed": "Could not enable {agent}: {error}",
  "agentInfra.skills.notice.disableFailed": "Could not disable {agent}: {error}",
  "agentInfra.skills.notice.removeFailed": "Could not remove {skill} from {agent}: {error}",
  "agentInfra.skills.notice.removedFrom":
    "Removed {skill} from {agent} project folder; still active in {survivors}.",
  "agentInfra.skills.notice.migrateFailed": "Could not migrate {skill}: {error}",
  "agentInfra.skills.notice.movedEnabled": "Moved {skill} to {folder}/ and enabled {agent}.",
  "agentInfra.skills.notice.movedDisabled": "Moved {skill} to {folder}/ and disabled {agent}.",
  "agentInfra.skills.notice.consolidateFailed": "Could not consolidate {skill}: {error}",
  "agentInfra.skills.notice.consolidated": "Consolidated {skill} into {folder}/.",
  "agentInfra.skills.migrate.willDo": "Copilot will:",
  "agentInfra.skills.migrate.dontAsk": "Don't ask again for future migrations",
  "agentInfra.skills.migrate.nameTaken":
    'The name "{name}" is already taken in your shared folder. The migrated skill will be named "{resolved}".',
  "agentInfra.skills.migrate.anotherAgent": "another agent",
  "agentInfra.skills.migrate.thisAgent": "this agent",
  "agentInfra.skills.migrate.agent": "agent",
  "agentInfra.skills.migrate.title.projectSingle": 'Move "{name}" to share with {target}?',
  "agentInfra.skills.migrate.title.projectMirrored":
    'Consolidate "{name}" and share with {target}?',
  "agentInfra.skills.migrate.title.disableLastAgent":
    'Move "{name}" to your shared folder before disabling {target}?',
  "agentInfra.skills.migrate.title.proactiveConsolidate":
    'Consolidate "{name}" into your shared folder?',
  "agentInfra.skills.migrate.body.projectSingle":
    "This skill currently lives only in your {source} project folder.\nTo enable it for {target}, Copilot needs to move it to a shared location\nso both agents stay in sync.",
  "agentInfra.skills.migrate.body.projectMirrored":
    "The same skill is currently duplicated in {folders}:",
  "agentInfra.skills.migrate.body.disableLastAgent": "This skill currently lives only in:",
  "agentInfra.skills.migrate.body.proactiveConsolidate":
    "The same skill is currently duplicated in:",
  "agentInfra.skills.migrate.foldersTwo": "two project folders",
  "agentInfra.skills.migrate.foldersThree": "three project folders",
  "agentInfra.skills.migrate.foldersMany": "{count} project folders",
  "agentInfra.skills.migrate.outro.projectSingle":
    "You can still edit the skill exactly as before — there's just one copy now,\nso changes are visible to both agents immediately.",
  "agentInfra.skills.migrate.outro.projectMirrored":
    "After this, edits to the skill are visible to all {count} agents.",
  "agentInfra.skills.migrate.outro.disableLastAgent":
    "If you disable {source}, the file has nowhere to live in its project folder.\nCopilot can preserve it by moving the skill to your shared skills folder with\nno agents enabled — you can toggle agents back on any time, or delete it later\nfrom the Skills tab.",
  "agentInfra.skills.migrate.outro.proactiveConsolidate":
    "Editing, renaming, or deleting one copy would silently diverge from the others.\nCopilot can consolidate them into a single shared location, with a shortcut in\neach agent folder so all agents still see the skill.\n\nAfter this, your edits stay in sync across all agents automatically.",
  "agentInfra.skills.migrate.confirmMoveEnable": "Move and enable {target}",
  "agentInfra.skills.migrate.confirmMoveDisable": "Move and disable {target}",
  "agentInfra.skills.migrate.confirmConsolidate": "Consolidate",
  "agentInfra.skills.migrate.verb.move": "Move",
  "agentInfra.skills.migrate.verb.delete": "Delete",
  "agentInfra.skills.migrate.verb.create": "Create",
  "agentInfra.skills.migrate.verb.notCreate": "Not create",
  "agentInfra.skills.migrate.noShortcuts": "any shortcuts (no agents enabled).",
  "agentInfra.skills.migrate.note.identicalDuplicate": "(identical duplicate)",
  "agentInfra.skills.migrate.note.shortcut": "(shortcut to the new location)",
  "agentInfra.skills.delete.title": "Delete {name}?",
  "agentInfra.skills.delete.projectWarningFolder":
    "This removes the skill folder from your project. Vault sync / git is the only rollback path.",
  "agentInfra.skills.delete.projectWarningFolders":
    "This removes the skill folders from your project. Vault sync / git is the only rollback path.",
  "agentInfra.skills.delete.canonicalWarning":
    "This removes the canonical copy and every agent symlink. Vault sync / git is the only rollback path.",
  "agentInfra.skills.delete.willRemove": "Will remove:",
  "agentInfra.skills.delete.confirm": "Delete skill",
  "agentInfra.skills.delete.noteProject": "project SKILL.md and supporting files",
  "agentInfra.skills.delete.noteCanonical": "canonical SKILL.md and supporting files",
  "agentInfra.skills.delete.noteSymlink": "symlink",
  "agentInfra.skills.properties.title": "Properties · {name}",
  "agentInfra.skills.properties.writesTo": "Writes to",
  "agentInfra.skills.properties.name": "Name",
  "agentInfra.skills.properties.description": "Description",
  "agentInfra.skills.properties.allowedTools": "Allowed tools",
  "agentInfra.skills.properties.modelOverride": "Model override",
  "agentInfra.skills.properties.claudeOnly": "Claude Code only",
  "agentInfra.skills.properties.disableAuto": "Don't let Claude invoke this on its own",
  "agentInfra.skills.properties.hideSlash": "Hide from slash menu",
  "agentInfra.skills.properties.nameHelpPrefix":
    "Lowercase, hyphenated. This is what users type after",
  "agentInfra.skills.properties.nameHelpSuffix": "in chat.",
  "agentInfra.skills.properties.collision": "A skill named “{name}” already exists.",
  "agentInfra.skills.properties.save": "Save",
  "agentInfra.skills.properties.error.nameRequired": "Name is required.",
  "agentInfra.skills.properties.error.nameMax": "Name must be at most {max} characters.",
  "agentInfra.skills.properties.error.namePattern":
    "Lowercase a–z, 0–9, and hyphens only — no leading, trailing, or consecutive hyphens.",
  "agentInfra.skills.properties.error.descriptionRequired": "Description is required.",
  "agentInfra.skills.properties.error.descriptionMax":
    "Description must be at most {max} characters.",
  "agentInfra.skills.issues.titleOne": "1 skill could not be loaded",
  "agentInfra.skills.issues.titleMany": "{count} skills could not be loaded",
  "agentInfra.skills.issues.formatErrors": "The skills have format errors.",
  "agentInfra.skills.issues.viewDetails": "View details",
  "agentInfra.skills.issues.fixAll": "Fix All with Agent",
  "agentInfra.skills.issues.fixWithAgent": "Fix with Agent",
  "agentInfra.skills.issues.openSkillMd": "Open SKILL.md",
  "agentInfra.skills.issues.showInFolder": "Show in folder",
  "agentInfra.skills.issues.allNotLoaded":
    "No skills are loaded yet. Choose View details above to repair a SKILL.md. When it loads successfully, it will move into the loaded list.",
  "agentInfra.skills.format.missingFrontmatter":
    "SKILL.md must begin with a YAML frontmatter block delimited by ---",
  "agentInfra.skills.format.quotedDescription": 'The description contains ": " and must be quoted.',
  "agentInfra.skills.format.invalidYaml": "SKILL.md frontmatter YAML is invalid: {error}",
  "agentInfra.skills.format.notMapping": "SKILL.md frontmatter must be a YAML mapping",
  "agentInfra.skills.format.nameMustBeString": "Skill `name` must be a string",
  "agentInfra.skills.format.missingName": "SKILL.md frontmatter is missing required field `name`",
  "agentInfra.skills.format.nameNonEmpty": "Skill `name` must be a non-empty string",
  "agentInfra.skills.format.nameMax":
    "Skill `name` must be at most {max} characters (got {length})",
  "agentInfra.skills.format.nameRepair":
    "Use the same lowercase, hyphenated name in the file and folder.",
  "agentInfra.skills.format.descriptionMustBeString": "Skill `description` must be a string",
  "agentInfra.skills.format.missingDescription":
    "SKILL.md frontmatter is missing required field `description`",
  "agentInfra.skills.format.descriptionNonEmpty": "Skill `description` must be a non-empty string",
  "agentInfra.skills.format.descriptionMax":
    "Skill `description` must be at most {max} characters (got {length})",
  "agentInfra.skills.manager.builtinImmutable":
    "Built-in skills cannot be edited or deleted. Disable the skill instead.",
  "agentInfra.skills.manager.invalidName": "Skill name is invalid.",
  "agentInfra.skills.manager.nameCollision": "A skill with that name already exists.",
  "agentInfra.skills.manager.notProject": "Skill is not project-managed.",
  "agentInfra.skills.manager.noVaultPath": "Vault has no on-disk path on this platform.",
  "agentInfra.skills.manager.fsUnknown": "Unknown filesystem error.",
  "agentInfra.skills.manager.eperm": "Permission denied while creating a skill link.",
  "agentInfra.skills.manager.mkdirFailed": "Could not create canonical folder: {error}",
  "agentInfra.skills.manager.moveFailed": "Could not move {from} → {to}: {error}",
  "agentInfra.skills.manager.serializeFailed": "Could not serialize SKILL.md: {error}",
  "agentInfra.skills.manager.writeFailed": "Could not write SKILL.md: {error}",
  "agentInfra.skills.manager.suffixTooLong":
    'Cannot suffix "{name}" without exceeding the {max}-char name cap.',
  "agentInfra.skills.manager.suffixUnavailable": 'Could not find a free suffix for "{name}".',
  "agentInfra.skills.manager.unknownBuiltin": "Unknown built-in skill.",
  "agentInfra.skills.manager.builtinUpdateFailed": "Could not update built-in skill files.",
  "agentInfra.skills.builtin.removeRetiredFailed":
    "Could not remove retired built-in skill {name}.",
  "agentInfra.skills.builtin.occupies": "A user-owned skill occupies {name}.",
  "agentInfra.skills.builtin.installFailed": "Could not install built-in skill {name}.",
  "agentInfra.skills.builtin.removeDisabledFailed":
    "Could not remove disabled built-in skill {name}.",

  "agentInfra.backend.configure": "Configure",
  "agentInfra.backend.done": "Done",
  "agentInfra.backend.copy": "Copy",
  "agentInfra.backend.copied": "Copied",
  "agentInfra.backend.autoDetect": "Auto-detect",
  "agentInfra.backend.clear": "Clear",
  "agentInfra.backend.searched": "Searched:",
  "agentInfra.backend.pathRequired": "Path is required.",
  "agentInfra.backend.notFoundOnPath":
    "{binary} not found on PATH. Install it or paste a custom path manually.",
  "agentInfra.backend.foundAt": "Found {binary} at {path}",
  "agentInfra.backend.env.title": "Environment variables",
  "agentInfra.backend.env.description": "Set values for {backend}, like {a} or {b}.",
  "agentInfra.backend.env.valuePlaceholder": "value",
  "agentInfra.backend.env.removeAria": "Remove variable",
  "agentInfra.backend.env.invalidName":
    "Name must start with a letter or underscore and contain only letters, digits, and underscores.",
  "agentInfra.backend.env.add": "Add variable",
  "agentInfra.backend.auth.title": "Authentication",
  "agentInfra.backend.auth.checking": "Checking…",
  "agentInfra.backend.auth.signedIn": "Signed in",
  "agentInfra.backend.auth.signedInSentence": "Signed in.",
  "agentInfra.backend.auth.signedInAs": "Signed in as {label}.",
  "agentInfra.backend.auth.notSignedIn": "Not signed in",
  "agentInfra.backend.auth.signingOut": "Signing out…",
  "agentInfra.backend.auth.signOut": "Sign out",
  "agentInfra.backend.auth.signOutIncomplete": "Sign-out didn't complete. Try again.",
  "agentInfra.backend.auth.signInBrowser": "Sign in with your browser",
  "agentInfra.backend.auth.signInTerminal": "Sign in using a terminal instead",
  "agentInfra.backend.auth.finishInBrowser": "Finish signing in in your browser.",
  "agentInfra.backend.auth.signInIncomplete": "Sign-in didn't complete. Try again.",
  "agentInfra.backend.auth.openSignInPage": "Open sign-in page",
  "agentInfra.backend.auth.signingIn": "Signing in…",
  "agentInfra.backend.auth.tryAgain": "Try again",
  "agentInfra.backend.auth.checkingSignIn": "Checking sign-in…",
  "agentInfra.backend.auth.signIn": "Sign in",
  "agentInfra.backend.auth.cancelSignIn": "Cancel sign-in",
  "agentInfra.backend.status.ready": "Ready",
  "agentInfra.backend.status.checking": "Checking…",
  "agentInfra.backend.status.incompatibleVersion": "Incompatible version",
  "agentInfra.backend.status.error": "Error",
  "agentInfra.backend.status.checkingSignIn": "Checking sign-in…",
  "agentInfra.backend.status.signInRequired": "Sign in required",
  "agentInfra.backend.status.notSetUp": "Not set up",
  "agentInfra.backend.status.upgradeRequired": "Upgrade required",
  "agentInfra.backend.status.starting": "Starting…",
  "agentInfra.backend.status.configuring": "Configuring…",
  "agentInfra.backend.managed.sourceManaged": "Managed by Vault Agent",
  "agentInfra.backend.managed.sourceCustom": "My own binary",
  "agentInfra.backend.managed.unavailable": "Unavailable",
  "agentInfra.backend.managed.platform": "Platform",
  "agentInfra.backend.managed.version": "Version",
  "agentInfra.backend.managed.pinned": "v{version} (pinned)",
  "agentInfra.backend.managed.destination": "Destination",
  "agentInfra.backend.managed.reinstall": "Reinstall",
  "agentInfra.backend.managed.reinstallUseManaged": "Reinstall & use managed",
  "agentInfra.backend.managed.downloadInstall": "Download & install",
  "agentInfra.backend.managed.uninstall": "Uninstall",
  "agentInfra.backend.managed.binarySourceAria": "{binary} binary source",
  "agentInfra.backend.managed.inUseCustomWithDownloads":
    "Your own binary is currently in use. Vault Agent's managed downloads are still on this computer. Reinstall to switch to Managed by Vault Agent, or uninstall to free up space.",
  "agentInfra.backend.managed.inUseCustom":
    "Your own binary is currently in use. Download and install the managed copy to switch to Managed by Vault Agent.",
  "agentInfra.backend.managed.inUseManaged":
    "The Copilot-managed binary is currently in use. Apply your own binary path below to switch to it.",
  "agentInfra.backend.managed.versionWarning":
    "Copilot is tested with the version managed by Copilot. Other versions may not work correctly. We recommend Managed by Vault Agent.",
  "agentInfra.backend.managed.cleanupFailed":
    "Your own binary is now in use, but Copilot could not remove its managed downloads: {error}",
  "agentInfra.backend.managed.updated": "{name} updated to {version}.",
  "agentInfra.backend.managed.updateFailed":
    "{name} could not update. Your runtime selection was kept; retry from Configure.",
  "agentInfra.backend.codex.adapterName": "Codex adapter",
  "agentInfra.backend.progress.connecting": "Connecting to {name} download…",
  "agentInfra.backend.progress.downloading": "Downloading {name} — {received} / {total}",
  "agentInfra.backend.progress.extracting": "Extracting {name}…",
  "agentInfra.backend.progress.verifying": "Verifying {subject}…",
  "agentInfra.backend.progress.activating": "Activating {name}…",
  "agentInfra.backend.progress.ready": "{name} ready.",
  "agentInfra.backend.progress.elapsed": "{label} {seconds}s elapsed",
  "agentInfra.backend.install.inFlight": "A {name} setup operation is already running.",
  "agentInfra.backend.compat.invalidMetadata":
    "{name} has invalid version metadata. Configure a valid installation.",
  "agentInfra.backend.compat.unsupported":
    "{name} v{version} is not supported. Vault Agent requires {name} v{minimum} or newer.",
  "agentInfra.backend.compat.notInstalled": "{name} is not installed. Configure an installation.",
  "agentInfra.backend.compat.claudeVerifyFailed":
    "Could not verify the installed Claude Code version. Vault Agent requires Claude Code {minimum} or newer.",
  "agentInfra.backend.compat.claudeReadFailed":
    "Could not read the installed Claude Code version. Vault Agent requires Claude Code {minimum} or newer.",
  "agentInfra.backend.compat.claudeUnsupported":
    "Claude Code {version} is not supported. Vault Agent requires Claude Code {minimum} or newer.",
  "agentInfra.backend.compat.claudeUpdateCustom":
    "Update the binary at the saved path, or clear the override to use an auto-detected installation.",
  "agentInfra.backend.compat.claudeUpdate":
    "Update it with the install command below, then reopen this dialog.",
  "agentInfra.backend.compat.codexUnsupportedAdapter":
    "The configured Codex adapter is not supported. Install {package} {minimum} or newer, then run Auto-detect again.",
  "agentInfra.backend.compat.codexPathCommand":
    "CODEX_PATH names {path}, which Copilot cannot run directly. Point CODEX_PATH at codex.exe or Codex's bin\\codex.js instead.",
  "agentInfra.backend.compat.codexNodeMissing":
    "Node.js was not found. Install Node.js, restart Obsidian, then run Codex Auto-detect again.",
  "agentInfra.backend.download.unsafeRedirect": "Unsafe {name} download redirect.",
  "agentInfra.backend.download.httpFailed": "{name} download failed: HTTP {status}",
  "agentInfra.backend.download.stalled": "{name} download stalled. Check your network and retry.",
  "agentInfra.backend.download.sizeUnknown": "{name} download size unknown.",
  "agentInfra.backend.download.sizeMismatch": "{name} download size mismatch.",
  "agentInfra.backend.download.checksumMismatch": "{name} download checksum mismatch.",
  "agentInfra.backend.download.tarMissing":
    "`tar` was not found on PATH. macOS/Linux ship it by default; on Windows you need 10 1803+ (which ships `tar.exe`/bsdtar) or to install bsdtar manually.",
  "agentInfra.backend.download.tarLaunch": "Failed to launch tar: {error}",
  "agentInfra.backend.download.tarExit": "tar exited with code {code}: {stderr}",
  "agentInfra.backend.download.codexNoDisk":
    "Not enough disk space to download and unpack Codex while keeping your current installation.",
  "agentInfra.backend.download.codexInvalidManifest": "Invalid Codex release manifest.",
  "agentInfra.backend.download.codexUnsupportedTarget": "Codex does not support {target}.",
  "agentInfra.backend.download.opencodeNpmLookup":
    "OpenCode npm package lookup failed with status {status}.",
  "agentInfra.backend.download.opencodeNpmMissingIntegrity":
    "Missing tarball or sha512 integrity for {package}@{version}.",
  "agentInfra.backend.download.opencodeNpmNoMatch":
    "No matching OpenCode npm package found. Tried: {candidates}.",
  "agentInfra.backend.download.opencodeIntegrity":
    "OpenCode npm download integrity mismatch. Retry the installation.",
  "agentInfra.backend.download.opencodeArchiveMissing": "OpenCode npm archive lacks {wanted}.",
  "agentInfra.backend.download.unsupportedPlatform":
    "Unsupported platform/arch: {platform}/{arch}. Agent Mode requires darwin/linux/windows on x64/arm64.",
  "agentInfra.backend.opencode.desktopOnly":
    "Agent Mode requires desktop Obsidian (FileSystemAdapter).",
  "agentInfra.backend.opencode.homeDir":
    "Could not resolve your home directory to install the opencode runtime. Agent Mode installs it under ~/.vault-agent; check that your account has a valid home directory.",
  "agentInfra.backend.opencode.mkdirFailed":
    "Could not create the opencode install directory at {path}: {error}. Check that it is writable.",
  "agentInfra.backend.opencode.versionMismatch":
    "The opencode download did not report version {version}.",
  "agentInfra.backend.opencode.noCustomToUpgrade":
    "No custom opencode binary is configured to upgrade.",
  "agentInfra.backend.opencode.upgradeCommandFailed": "`{path} upgrade` failed: {error}",
  "agentInfra.backend.opencode.upgradeNoVersion":
    "{path} --version didn't report a version after upgrade.",
  "agentInfra.backend.opencode.upgradeTooOld":
    "opencode upgrade did not reach the required version {minimum}+ (still v{version}).",
  "agentInfra.backend.opencode.noVersion":
    "{path} --version output didn't include a version number. Is this an opencode binary?",
  "agentInfra.backend.opencode.noFile": "No file at {path}",
  "agentInfra.backend.opencode.versionTimeout":
    "{path} did not respond to --version within {ms}ms. Is this an opencode binary?",
  "agentInfra.backend.opencode.versionFailed":
    "{path} --version failed: {error}. Is this an opencode binary?",
  "agentInfra.backend.codex.homeDir":
    "Could not resolve your home directory for the managed Codex adapter.",
  "agentInfra.backend.codex.runtimeStart": "The bundled Codex runtime could not start.",
  "agentInfra.backend.codex.versionMismatch": "The Codex adapter did not report version {version}.",
  "agentInfra.backend.claude.pathSaved": "Claude CLI path saved.",
  "agentInfra.backend.claude.overrideCleared":
    "Claude CLI override cleared. Auto-detection will be used.",
  "agentInfra.backend.claude.configureTitle": "Configure Claude",
  "agentInfra.backend.claude.binarySection": "Claude Code binary",
  "agentInfra.backend.claude.binaryBodyPrefix": "Copilot runs the",
  "agentInfra.backend.claude.binaryBodySuffix":
    "CLI on this machine. Auto-detect checks the usual install locations.",
  "agentInfra.backend.claude.notFoundHint":
    "claude not found in known install locations. Run the install command below, then click Auto-detect again.",
  "agentInfra.backend.claude.installSection": "Install Claude Code",
  "agentInfra.backend.claude.unavailable": "Set up a supported Claude CLI above to enable sign-in.",
  "agentInfra.backend.claude.cliNotFound":
    "Claude CLI not found. Install with: {command}, or set agentMode.claudeCli.path in settings.",
  "agentInfra.backend.claude.thinkingTitle": "Show extended thinking",
  "agentInfra.backend.claude.thinkingDescription":
    "Stream the model's reasoning blocks during a turn. Increases token usage.",
  "agentInfra.backend.claude.autoModeTitle": "Auto mode permissions",
  "agentInfra.backend.claude.autoModeDescription":
    "Auto lets Claude judge each request and still ask about risky ones, Accept edits auto-approves file edits only, and Bypass permissions skips every check.",
  "agentInfra.backend.claude.autoMode.auto": "Auto",
  "agentInfra.backend.claude.autoMode.acceptEdits": "Accept edits",
  "agentInfra.backend.claude.autoMode.bypass": "Bypass permissions",
  "agentInfra.backend.codex.pathSaved": "Codex adapter path saved.",
  "agentInfra.backend.codex.pathCleared": "Codex adapter path cleared.",
  "agentInfra.backend.codex.clearFailed": "Couldn't clear the custom path: {error}",
  "agentInfra.backend.codex.uninstalled": "Codex adapter uninstalled (freed {size}).",
  "agentInfra.backend.codex.uninstallFailed": "Couldn't uninstall the Codex adapter: {error}",
  "agentInfra.backend.codex.removeConfirm":
    "Remove all Copilot-managed Codex adapter downloads ({size})? Your own binary and Codex login are kept.",
  "agentInfra.backend.codex.removeTitle": "Uninstall Codex adapter",
  "agentInfra.backend.codex.inspectFailed": "Couldn't inspect Codex downloads: {error}",
  "agentInfra.backend.codex.configureTitle": "Configure Codex",
  "agentInfra.backend.codex.managedDescription": "Let Copilot download and manage Codex.",
  "agentInfra.backend.codex.customDescriptionPrefix": "Copilot supports",
  "agentInfra.backend.codex.customDescriptionSuffix":
    "{minimum} or newer. You manage its upgrades; Auto-detect checks the usual npm locations and your PATH.",
  "agentInfra.backend.codex.customPathNotFound":
    "A supported {binary} adapter was not found. Install your own adapter or choose Managed by Vault Agent.",
  "agentInfra.backend.codex.upgradeLabel": "Upgrade",
  "agentInfra.backend.codex.unavailable":
    "Set up a supported Codex adapter above to enable sign-in.",
  "agentInfra.backend.codex.pathNotConfigured":
    "Codex adapter path not configured. Open Agent Mode settings and install or detect @agentclientprotocol/codex-acp.",
  "agentInfra.backend.opencode.installed": "opencode v{version} installed.",
  "agentInfra.backend.opencode.uninstalled": "opencode uninstalled.",
  "agentInfra.backend.opencode.uninstalledFreed": "opencode uninstalled (freed {size}).",
  "agentInfra.backend.opencode.uninstallFailed": "Uninstall failed: {error}",
  "agentInfra.backend.opencode.removeConfirm":
    "Remove all downloaded opencode binaries, including any old copy inside your vault? Your custom binary path and BYOK keys are kept.",
  "agentInfra.backend.opencode.removeConfirmWithSize":
    "Remove all downloaded opencode binaries ({size}), including any old copy inside your vault? Your custom binary path and BYOK keys are kept.",
  "agentInfra.backend.opencode.removeTitle": "Uninstall opencode",
  "agentInfra.backend.opencode.upgraded": "opencode upgraded to v{version}.",
  "agentInfra.backend.opencode.customPathSaved": "Custom opencode binary path saved.",
  "agentInfra.backend.opencode.customPathCleared": "Custom opencode path cleared.",
  "agentInfra.backend.opencode.clearFailed": "Couldn't clear the custom path: {error}",
  "agentInfra.backend.opencode.configureTitle": "Configure opencode",
  "agentInfra.backend.opencode.managedDescription":
    "Let Copilot download and manage the official opencode binary.",
  "agentInfra.backend.opencode.customDescription":
    "Point Agent Mode at a binary you already have on disk. Useful for self-builders or air-gapped machines.",
  "agentInfra.backend.opencode.customPathNotFound":
    "opencode not found. Install it natively (`~/.opencode/bin/opencode[.exe]`), via bun/npm, or paste a custom path manually.",
  "agentInfra.backend.opencode.legacyKeys":
    "opencode OPENCODE_CONFIG_CONTENT uses OpenCode 1 keys ({keys}); Self-Host Mode requires the OpenCode 2 `permissions` and `agents` keys.",
  "agentInfra.backend.opencode.webSearchUnavailable":
    "Copilot self-host web search channel is unavailable.",
  "agentInfra.backend.opencode.upgradeRun": "Run opencode upgrade",
  "agentInfra.backend.opencode.upgradeTo": "Upgrade to v{version}",
  "agentInfra.backend.destination.openaiBaseUrl": "The server set in OPENAI_BASE_URL",
  "agentInfra.backend.destination.claudeSettings": "The server set in your Claude Code settings",
  "agentInfra.backend.permission.codex.sessionScope":
    "Covers what this option names, until this chat ends. Start a new chat to undo.",
  "agentInfra.backend.permission.codex.rulesScope":
    "Saved to rules/default.rules in your Codex home (~/.codex by default) for all later Codex chats. Delete it there to undo.",
  "agentInfra.backend.permission.codex.blockAlways": "Block Always",
  "agentInfra.backend.permission.codex.allowAlways": "Allow Always",
  "agentInfra.backend.permission.opencode.ruleScope":
    "Saves a rule that opencode uses in later chats in this folder: the vault folder, or the project note's folder for a project chat.",

  "agentInfra.session.signInOpening": "Opening your browser to sign in to {agent}…",
  "agentInfra.session.signedIn": "Signed in to {agent}.",
  "agentInfra.session.signedInAs": "Signed in to {agent} as {label}.",
  "agentInfra.session.signedOut": "Signed out of {agent}.",
  "agentInfra.session.signInIncomplete": "Sign-in didn't complete. Please try again.",
  "agentInfra.session.signOutIncomplete": "Sign-out didn't complete. Please try again.",
  "agentInfra.session.signInFailed": "Sign-in for {agent} failed. Please try again.",
  "agentInfra.session.signOutFailed": "Sign-out for {agent} failed. Please try again.",
  "agentInfra.session.projectGone": "This project no longer exists. Restore it to open its chats.",
  "agentInfra.session.chatProjectGone": "This chat belongs to a project that no longer exists.",
  "agentInfra.session.refreshed": "{agent} refreshed.",
  "agentInfra.session.modelUnavailableWithReplacement":
    "{agent} couldn't use {model}. Using {replacement} instead.",
  "agentInfra.session.modelUnavailable":
    "{agent} couldn't use {model}. Enable a model {agent} can run.",
  "agentInfra.session.modelNotEnabled":
    "This chat's model isn't enabled for {agent}. Pick an enabled model to continue.",
  "agentInfra.session.untitledChat": "Untitled chat",
  "agentInfra.session.imageAttachment": "Image attachment",
  "agentInfra.session.approvedPlan": "Approved plan",
  "agentInfra.session.rejectedPlan": "Rejected plan",
  "agentInfra.session.requestedPlanChanges": "Requested plan changes: {feedback}",
  "agentInfra.session.planFeedbackSent": "Feedback sent",
  "agentInfra.session.fanoutTimeout": "Timed out waiting for this agent to answer.",
  "agentInfra.session.fanoutAllFailed":
    "All agents failed to answer; no summary could be generated.",
  "agentInfra.session.planProposal": "Plan proposal",
  "agentInfra.session.toolCall": "Tool call",
  "agentInfra.session.closeUnsupported": "This agent does not support closing individual sessions.",
  "agentInfra.session.saveNoteFailed": "Could not save chat {id} as a note.",
  "agentInfra.session.notSignedIn": "Not signed in. Use the Sign in button above to continue.",
  "agentInfra.sdk.streamStalled":
    "Claude stopped responding — the response stream stalled mid-reply (no output for {seconds}s) and the turn was ended. Send your message again to continue.",
  "agentInfra.sdk.claudeNotSignedIn":
    "You're not signed in to Claude. Use the Sign in button above the chat box to continue.",
  "agentInfra.sdk.effort": "Effort",
  "agentInfra.sdk.mode.default": "Default",
  "agentInfra.sdk.mode.plan": "Plan",
  "agentInfra.sdk.mode.acceptEdits": "Accept Edits",
  "agentInfra.sdk.mode.auto": "Auto",
  "agentInfra.sdk.mode.bypassPermissions": "Bypass Permissions",
  "agentInfra.sdk.permission.allowOnce": "Allow once",
  "agentInfra.sdk.permission.denyOnce": "Deny once",
  "agentInfra.sdk.permission.allowAlways": "Allow always",
  "agentInfra.sdk.permission.suggestedRule": "Claude Code's suggested rule",
  "agentInfra.sdk.permission.chatFolder":
    "the vault folder (for a project chat, the project note's folder)",
  "agentInfra.sdk.permission.savedUserSettings":
    "settings.json in your Claude Code config folder (~/.claude by default), for all your Claude Code projects",
  "agentInfra.sdk.permission.savedProjectSettings":
    ".claude/settings.json in {folder}, for later chats there",
  "agentInfra.sdk.permission.savedLocalSettings":
    ".claude/settings.local.json in {folder}, for later chats there",
  "agentInfra.sdk.permission.coversUntilChatEnds":
    "Covers {covers} until this chat ends. Start a new chat to undo.",
  "agentInfra.sdk.permission.coversSaved":
    "Covers {covers}. Saved to {destination}. Remove it there to undo.",
  "agentInfra.sdk.permission.allFileEdits": "all file edits",
  "agentInfra.sdk.permission.modeName": "{mode} mode",
  "agentInfra.sdk.permission.accessTo": "access to {path}",
  "agentInfra.acp.serviceFailedToStart":
    "{agent}'s internal service failed to start. Check the Vault Agent log for its error.",
  "agentInfra.acp.serviceStopped": "{agent}'s internal service stopped. Please try again.",
} as const;
