import type VaultAgentPlugin from "@/main";
import React, { createContext, useContext } from "react";

const PluginContext = createContext<VaultAgentPlugin | undefined>(undefined);

export const PluginProvider: React.FC<{
  plugin: VaultAgentPlugin;
  children: React.ReactNode;
}> = ({ plugin, children }) => (
  <PluginContext.Provider value={plugin}>{children}</PluginContext.Provider>
);

export const usePlugin = (): VaultAgentPlugin => {
  const plugin = useContext(PluginContext);
  if (!plugin) throw new Error("usePlugin must be used inside <PluginProvider>");
  return plugin;
};
