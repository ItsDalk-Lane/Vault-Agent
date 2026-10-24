import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { t } from "@/i18n";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import React from "react";
import { DesktopOnlySettingsPanel } from "./DesktopOnlySettingsPanel";

const LazyMcpSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.AgentMcpSettings }))
);

export function McpSettingsPanel() {
  const app = useApp();
  const plugin = usePlugin();
  // MCP 独立入口沿用原服务配置；桌面服务不得随移动端设置载入。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  if (!isDesktopRuntime())
    return <DesktopOnlySettingsPanel message={t("settings.mcpDesktopOnly")} />;
  return (
    <React.Suspense fallback={null}>
      <LazyMcpSettings app={app} plugin={plugin} />
    </React.Suspense>
  );
}
