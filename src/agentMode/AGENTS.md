# Agent Mode — layer rules

Layer imports are strict. Enforced by `eslint-plugin-boundaries`
(see root `eslint.config.mjs`). The list below mirrors `boundaries/elements` and
`boundaries/dependencies` exactly — when in doubt, the lint config wins.

1. **`session/`** — **the contract layer.** Hosts the
   backend-agnostic session, message store, UI-state bridge,
   persistence manager.
2. **`sdk/`** — the in-process adapter layer. `sdk/pi/` is the only
   execution runtime and the only place allowed to import the locked
   `@earendil-works` Pi runtime (see [Pi SDK boundary](#pi-sdk-boundary)). The
   Claude Agent SDK and ACP execution bridges were removed; the boundary scanner
   rejects importing `acp/`, `ClaudeSdkBackendProcess`, `permissionBridge`, or
   either removed SDK package.
3. **`backends/pi/`** — 当前唯一运行装配入口；安装、登录、旧程序探测和旧后端描述符均已移除。
4. **`backends/registry.ts`** — 只注册当前内置引擎 (`pi`)，作为模型发现和新聊天的唯一运行列表。
5. **`ui/`** — backend-agnostic React UI. — permission modals, model pickers, and
   trail rendering all read session-domain types;
6. **`skills/`** — canonical-store discovery, SKILL.md parsing/editing, built-in
   coordination, enable/disable metadata, and the Skills settings UI. Skill
   distribution to agent directories (symlinks, reconcile passes, backend
   restarts) was removed: Pi reads the canonical store directly through
   `sdk/pi/features/SkillsCatalog.ts`.

## Pi SDK boundary

The locked Pi runtime (`@earendil-works/pi-durable`, `pi-ai`, `pi-mcp`, `chord` at
`1.3.0`) is imported **only** from `sdk/pi/`, and only through public package entry
points. Never import `/dist/` files, `node_modules` paths, or subpaths that are absent
from the package's `exports` map — the locked contract is `sdk/pi/sdkContract.test.ts`.

Every other layer — `session/`, `ui/`, `backends/`, `skills/` — consumes the
backend-agnostic session-domain types in `session/types.ts` instead. `backends/pi/`
descriptors assemble dependencies and construct `sdk/pi/` adapters; they do not import
the Pi SDK directly.

本版本不兼容此前聊天存储，包括此前的 Pi 会话。不得恢复旧后端历史读取、笔记导入、旧索引扫描或自动迁移；旧文件原样保留，不在启动时清理。

Enforced by `no-restricted-imports` in the root `eslint.config.mjs` (plus the existing
`boundaries/dependencies` sibling rules) and by
`node scripts/check-pi-boundaries.mjs`. The scanner's behavior is covered by
`sdk/pi/__tests__/boundaries.test.ts`.

## 当前运行入口

新聊天只通过 `backends/pi/descriptor.ts` 装配 `sdk/pi/PiBackendProcess.ts`。
`session/` 与界面只能调用后端无关的契约。最近会话直接来自当前库外会话记录，不读取旧程序或库内聊天笔记。

需要增加能力时，先使用现有 Pi 宿主工具和公共 SDK 接口，不重新引入 ACP、旧代理 SDK、二进制下载或后台守护程序。
修改会话契约时，同时检查普通聊天、后台标签、多模型候选、恢复与当前会话的只读状态。

## Adding a new layer

1. Create `src/agentMode/<layer>/`.
2. Add an entry under `boundaries/elements` in root `eslint.config.mjs` and a
   corresponding rule in `boundaries/dependencies`.
3. Re-export from `src/agentMode/index.ts` if it should be visible to
   plugin host code.
4. Update this doc.

## What lives where (cheatsheet)

- "Backend-agnostic contract — `BackendProcess`, `BackendDescriptor`,
  the session-domain types, `MethodUnsupportedError`, debug sink,
  model-state selectors and signatures" → `session/`
- "In-process driver for an SDK that produces session-domain events
  natively" → `sdk/`
- "Helper used by more than one backend" → `backends/shared/`
- "模型选择、设置与宿主依赖装配" → `backends/pi/`
- "React component or modal" → `ui/` (generic) or `backends/<id>/`
  (backend-specific)
- "技能发现、SKILL.md 编辑、启用状态与设置界面" → `skills/`
- "Plugin-level wiring" → `index.ts` only

## Modals and dialogs

**Use Obsidian's native `Modal`** (from `obsidian`). It gives us correct
popout-window behavior, native header chrome, ESC handling, and visual
consistency with the rest of the plugin.

The standard pattern is in `src/components/modals/ConfirmModal.tsx` and
`src/agentMode/skills/ui/DeleteConfirmDialog.tsx`. If a surface must live
inside an existing React tree, keep its visual content as a presentational
component and host it from an Obsidian modal instead of introducing a second
modal system.

## BackendDescriptor surface

The descriptor is the contract `session/`, `sdk/`, and `ui/` rely on.

If a UI component needs something the descriptor doesn't expose, **add
it to the descriptor** — don't reach into a specific backend. The
descriptor will keep growing; that's by design.

## 调试与验收

使用 `scripts/test-pi-runtime.mjs` 的实际后端场景检查生产接线；模块单测和文件存在检查不能代替产品入口。
每次 Obsidian 部署都要明确设置测试库位置，核对正在连接的库名和真实完整路径。禁止依赖当前窗口或默认库。

历史和恢复以 Durable 的真实记录为准；取消、出错、摘要未放置、待恢复任务不能投影成完成。
真实平台、真实模型与远程授权分别记录，缺少环境的检查标记为 `not_run`。
