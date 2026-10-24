# AGENTS.md

This file provides guidance to any coding agent when working with code in this repository.

## Overview

Vault Agent is a desktop-only Obsidian plugin with one bundled, in-process Pi SDK runtime. Models and credentials come from user-configured BYOK providers; no external Claude Code, Codex, OpenCode, or Pi CLI is installed or launched as the agent engine. There is no hosted service, account system, paid plan, or telemetry — see `README.md`.

The product retains agent chat, plans, diffs and revert, projects, skills with one enablement state, and model-based fan-out. Models are managed in BYOK, external tool services in the standalone MCP tab. Tool permissions use a single layer: per-call approval cards are the only gate (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15). This is a non-compatible storage release: previous chats, including previous Pi chats, are not read or migrated. Their original files remain untouched.

The Agent Mode module lives in `src/agentMode/` and talks to the host through a single barrel (`src/agentMode/index.ts`). Read [`src/agentMode/AGENTS.md`](./src/agentMode/AGENTS.md) before changing it: its layer rules are enforced by `eslint-plugin-boundaries`.

## Commands

- **NEVER RUN `npm run dev`**.
- `npm run build` — production build (TypeScript check + minified output).
- `npm run lint` / `npm run lint:fix` — ESLint check / autofix.
- `npm run format` / `npm run format:check` — Prettier write / check.
- **Before PR: always run `npm run format && npm run lint`.**
- `npm run test` — unit tests. Single test: `npm test -- -t "test name"`.
- `npm run test:vault` — macOS-only build-and-deploy into `$COPILOT_TEST_VAULT_PATH`; see [`TESTING_GUIDE.md`](./designdocs/agents/TESTING_GUIDE.md).

## 本机唯一测试库（2026-10-22 用户指定）

- 后续真实 Obsidian 测试只使用现有库 **houde**，绝对路径为 `/Users/study_superior/Desktop/Project/houde`。`COPILOT_TEST_VAULT_PATH` 必须指向此路径；不得再创建 PiSmoke 或其他测试库。
- 使用日常 Obsidian 配置，保留原有仓库列表；不得为测试另起 `--user-data-dir` 或切换到独立测试 profile。
- 每次部署、重载、CLI/UI 写操作前，同时核对实际库名 `houde` 与解析后的绝对路径，不能仅依赖当前窗口或默认 CLI 连接。
- houde 是用户指定的测试库，但已有笔记、聊天、设置仍须保留。授权仅覆盖当前任务所需测试，不代表可清空库、覆盖无关内容或重置全部设置；临时修改只清理本次明确创建的内容。
- `designdocs/pi-rebuild/` 中的 PiSmoke 路径和独立 profile 只描述历史证据，不能作为新操作指令；不得为重现旧记录重建旧测试库。迁移进度见 `TODO.md`。

## Core principles (apply to every change)

- **Always write generalizable solutions.** No hardcoded folder names, file patterns, or special-case logic (no "piano notes" / "daily notes" branches). Make varying behavior configurable, not hardcoded.
- **Never modify AI prompt content** — system prompts, model adapter prompts, etc. — unless the user explicitly asks.
- **Never edit `RELEASES.md` outside a release PR.** If a rebase conflicts in `RELEASES.md`, resolve it to the base branch's version.
- **Use stories for user-visible React work.** When a feature adds or changes a component or a meaningful visual state, add or update its adjacent `*.stories.tsx` file and verify the rendered states in the component gallery. Stories complement unit tests; non-visual changes do not require one. Follow the [`Component gallery workflow`](./designdocs/agents/TESTING_GUIDE.md#component-gallery-workflow).
- **Referential stability.** Never return a freshly-allocated `[]` / `{}` for an "empty" slice; return a frozen module-level constant (canonical examples: `EMPTY_PROVIDERS` / `EMPTY_CONFIGURED_MODELS` / `EMPTY_BACKENDS` in `src/settings/model.ts`).
- **Structure unit tests by module, class, and callable.** Use exactly one top-level `describe("moduleName", ...)` for the module under test; do not split the same subject across multiple top-level `describe` blocks. Within that module suite, wrap each class's tests in exactly one `describe("ClassName", ...)` so method ownership remains visible, then give each method exactly one nested `describe("methodName()", ...)` group. Keep module-level functions directly under the module suite, with exactly one `describe("functionName()", ...)` group per function. Merge cases that exercise the same callable. Separate same-callable groups only when a material test-lifecycle constraint makes merging misleading, and name that constraint in the groups' `describe` titles. Write `it(...)` descriptions that state the observable behavior without requiring the reader to inspect the test body.
- **Write unit tests as executable specifications.** A developer or agent reading the `describe`/`it` outline should understand the module's purpose and observable contract without opening its implementation. Establish normal behavior before boundary, failure, and regression cases; name each case by its condition and expected outcome. Use concrete fixtures and assert the promised result, not just internal calls. For behavior changes, verify the test fails for the intended reason before making it pass, then refactor with tests green. → [`Test design workflow`](./designdocs/agents/TESTING_GUIDE.md#test-design-workflow)
- **Preserve provenance for new behavioral branches and edge cases.** When a change adds a conditional branch or explicit edge-case path, include the originating GitHub issue's full URL in both the nearby code comment that explains why the path exists and the `it(...)` description that covers it. If no issue exists, create one before landing the behavior. Explain the user or reliability failure that justified the path, not its mechanics.
- **Pair every production TypeScript function and method with unit coverage.** Directly test exported and public callables; cover private and module-local helpers through their observable public contract unless direct isolation materially improves clarity. Test-only helper functions are exempt.
- **Never wait for async work by ticks or timers.** No `setTimeout(…, 0)`, `queueMicrotask`, or `await Promise.resolve()` to "let pending work land". Await the work itself, handle events where their order is defined, or signal completion explicitly. → [`Async ordering`](./designdocs/agents/STYLE_GUIDE.md#async-ordering)
- **Never call `console` directly** — use `logInfo()` / `logWarn()` / `logError()` from `@/logger`.
- **Every JavaScript/TypeScript comment links a GitHub issue.** A comment may only record a tricky decision tied to a specific issue: the one-line why plus the issue's full URL (`https://github.com/OWNER/REPO/issues/N`). Everything else, including JSDoc, section banners, restated logic, and issue-less TODOs, is expressed through names, types, and tests. If a decision needs explaining and no issue exists, file one. When you change code under an issue-linked comment, re-check the comment against its issue and update or delete it. `copilot/issue-linked-comments` enforces this in `npm run lint`; tool directives (`eslint-disable`, `@ts-expect-error`, `prettier-ignore`, …) are exempt. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **Keep React styling in Tailwind.** Put static styles on React-owned elements with Tailwind utilities, and reuse a shared component when the same visual pattern appears more than once. Do not add one-off selector families such as `.feature`, `.feature-copy`, and `.feature-actions` to `src/styles/tailwind.css` just to move utility declarations out of JSX. Add custom CSS only for markup React does not own or a styling contract Tailwind cannot express, and document that constraint beside the rule. Never edit `styles.css` (generated), use inline `style` for static values, or add arbitrary font sizes; wrap composed class strings in `cn()`. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **TypeScript:** `@/` absolute imports; `interface` for shapes, `type` for unions. **React:** custom hooks, props interfaces above components. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **Never use the global `app`** (footgun in popouts, hides dependencies); thread it via `useApp()` or a parameter. → [`PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md)

## Task-specific guides

Read the matching guide when your task touches that area — they aren't loaded by default.

| When you're…                                                          | Read                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| writing or altering tests, or doing E2E via the Obsidian CLI          | [`designdocs/agents/TESTING_GUIDE.md`](./designdocs/agents/TESTING_GUIDE.md)                    |
| building or changing user-visible React components or visual states   | [`Component gallery workflow`](./designdocs/agents/TESTING_GUIDE.md#component-gallery-workflow) |
| writing code: DI/structure, TypeScript, React, comments, CSS/Tailwind | [`designdocs/agents/STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)                        |
| touching plugin runtime: the `app`, network requests, popout windows  | [`designdocs/agents/PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md)              |
| running a multi-step dev session                                      | [`designdocs/agents/PROCESS_GUIDE.md`](./designdocs/agents/PROCESS_GUIDE.md)                    |
| changing user-facing behavior                                         | [`designdocs/agents/DOCS_GUIDE.md`](./designdocs/agents/DOCS_GUIDE.md)                          |
| reviewing code or preparing an Obsidian submission                    | [`designdocs/OBSIDIAN_COMMUNITY_REVIEW.md`](./designdocs/OBSIDIAN_COMMUNITY_REVIEW.md)          |

## Important notes

- The plugin declares `isDesktopOnly: true`: the bundled runtime uses desktop APIs and private durable storage. Optional, explicitly approved local tools can launch processes; the core agent runs inside the plugin. The bundle is never loaded on mobile.
- Multiple BYOK providers with custom endpoints are supported; keys live in the OS keychain, not in `data.json`.
- Agent sessions use private durable transcripts and sidecar files outside the vault. Session records generate history directly; an explicit export is a standalone copy that is never indexed or read back. Opening history restores visible state without automatically resuming unfinished work.
- Skills are discovered from the canonical vault folder with one enablement state; built-in skills ship with the plugin. No per-CLI symlinks or agent-directory distribution is performed.
- Tech debt and known issues → [`designdocs/todo/TECHDEBT.md`](./designdocs/todo/TECHDEBT.md). Current session plan → [`TODO.md`](./TODO.md).
- Available Tailwind tokens/classes → [`tailwind.config.js`](./tailwind.config.js).

## Obsidian review guidelines

When reviewing code or preparing a PR that changes plugin source, CSS, package metadata, or dependencies, run `npm run review:obsidian` and inspect its warning output. Obsidian review errors are blockers. Fix warnings only when runtime, UI, and persisted behavior remain equivalent; leave risky warnings visible and nonblocking.

Review changed lines for desktop-only Node imports, `fetch` outside justified streaming adapters, async callbacks passed to void-returning APIs, global `app` access, console use, deprecated APIs, runtime dependency replacements, native DOM creation instead of Obsidian helpers, external CSS URLs, `!important`, and `:has()`. Never suppress, ignore, or downgrade a review rule just to make the gate green.

If the authenticated community review finds something the local gate missed, first check the pinned official Obsidian lint packages, then add a regression fixture outside source roots. See [`designdocs/OBSIDIAN_COMMUNITY_REVIEW.md`](./designdocs/OBSIDIAN_COMMUNITY_REVIEW.md) for the parity and risk policy.

<!-- brevilabs-review-guidelines:start (synced from Brevilabs/brevilabs-skills — edit there, not here) -->

## Review guidelines

Apply these in addition to the built-in review. Report only problems
introduced or exposed by this pull request, and describe the concrete failure
scenario for each finding rather than giving general advice.

Priorities, in order:

1. **Correctness** — logic errors, data loss, unhandled failure paths,
   concurrency hazards.
2. **Security** — authorization bypass, injection, secrets or private data
   leaving the codebase.
3. **Breaking changes and migrations** — changed function signatures, renamed
   or removed exports, altered return shapes, changed defaults, tightened
   validation; persisted schemas, settings files, and serialized formats that
   already-written data must still load. A change that needs a migration and
   ships without one is a defect. When a migration exists, check that it
   handles already-in-the-wild states, not just the happy path.
4. **Code budget** — added lines are spend, not progress. A change that
   solves the problem in fewer concepts beats one that solves it in more; the
   best diff is the smallest one that does the job.
5. **Tests** — changed behavior, failure paths, and boundary cases are
   covered, and tests assert behavior rather than implementation detail.

Severity calibration:

- Treat as P1: an unhandled breaking change to a public API, plugin interface,
  CLI flag, or wire format; a change requiring a migration that ships without
  one; a data-corrupting or destructive operation; an authorization bypass; a
  reproducible crash.
- Also treat as P1: a diff carrying substantial code the problem does not
  require — a speculative abstraction with a single caller, configurability
  nothing asks for, premature optimization without a measurement showing the
  need, defensive branches guarding states that cannot occur, or a
  reimplementation of a helper that already exists in the codebase. Rank
  smaller instances of the same problems P2/P3 rather than dropping them. An
  over-engineering finding must name the simpler shape that solves the same
  problem; a bare "consider simplifying" is not a finding.
- Never report naming, formatting, or style that automated checks enforce, at
  any priority.

Code-budget checks:

- Prefer fixes that remove code; say so when a net-negative diff is available.
- Flag dead code the change itself creates — superseded branches, obsolete
  fallbacks, stale tests — deletion belongs in the same PR.
- Do not suggest broad refactors of pre-existing code unless required to fix
  a reported defect; the budget applies to what this PR adds, not to what was
  already there.

## Responding to review comments

Reply with the endpoint that publishes immediately, where `ROOT_COMMENT_ID` is
the thread's top-level comment:

```bash
gh api -X POST repos/OWNER/REPO/pulls/PR/comments/ROOT_COMMENT_ID/replies -f body="..."
```

Never open a review draft: `POST /pulls/PR/reviews` without an `event` (and the
UI's "Start a review") leaves the reply _pending_, which means invisible — it
never reaches the reviewer, it is absent from the comments API, and its thread
still reads as unanswered. Before finishing, confirm none exists:

```bash
gh api repos/OWNER/REPO/pulls/PR/reviews --jq '[.[]|select(.state=="PENDING")]|length'   # must be 0
```

<!-- brevilabs-review-guidelines:end -->
