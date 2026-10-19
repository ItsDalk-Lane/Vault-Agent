import { VAULT_AGENT_ICON_PATH, VAULT_AGENT_ICON_TRANSFORM } from "@/constants";
import { cn } from "@/lib/utils";
import React from "react";

interface VaultAgentBrandIconProps {
  className?: string;
}

export const VaultAgentBrandIcon: React.FC<VaultAgentBrandIconProps> = ({ className }) => (
  <svg
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn("tw-shrink-0", className)}
  >
    <g transform={VAULT_AGENT_ICON_TRANSFORM}>
      <path fill="currentColor" d={VAULT_AGENT_ICON_PATH} />
    </g>
  </svg>
);
