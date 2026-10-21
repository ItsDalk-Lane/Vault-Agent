import type { BackendAuthStatus, InstallState } from "@/agentMode/session/types";
import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";
import { AlertTriangle, Check } from "lucide-react";
import React from "react";

interface InstallBadgeSpec {
  label: string;
  variant: "outline" | "destructive" | "success";
  showCheck?: boolean;
  showAlert?: boolean;
  title?: string;
}

export function installBadge(
  state: InstallState,
  authStatus?: BackendAuthStatus | null
): InstallBadgeSpec | null {
  if (state.kind === "ready") {
    return (
      authBadge(authStatus) ?? {
        label: t("agentInfra.backend.status.ready"),
        variant: "success",
        showCheck: true,
      }
    );
  }
  if (state.kind === "checking") {
    return { label: t("agentInfra.backend.status.checking"), variant: "outline" };
  }
  if (state.kind === "incompatible") {
    return {
      label: t("agentInfra.backend.status.incompatibleVersion"),
      variant: "destructive",
      title: state.message,
    };
  }
  if (state.kind === "error") {
    return {
      label: t("agentInfra.backend.status.error"),
      variant: "destructive",
      title: state.message,
    };
  }
  return null;
}

function authBadge(authStatus: BackendAuthStatus | null | undefined): InstallBadgeSpec | null {
  if (authStatus === null)
    return { label: t("agentInfra.backend.status.checkingSignIn"), variant: "outline" };
  if (authStatus?.signedIn === false)
    return { label: t("agentInfra.backend.status.signInRequired"), variant: "outline" };
  return null;
}

interface ReadinessBadgeProps {
  state: InstallState;
  authStatus?: BackendAuthStatus | null;
}

function configStatusBadge(state: InstallState): InstallBadgeSpec {
  switch (state.kind) {
    case "ready":
      return {
        label: t("agentInfra.backend.status.ready"),
        variant: "success",
        showCheck: true,
      };
    case "absent":
      return { label: t("agentInfra.backend.status.notSetUp"), variant: "outline" };
    case "incompatible":
      return {
        label: t("agentInfra.backend.status.upgradeRequired"),
        variant: "destructive",
        showAlert: true,
      };
    case "checking":
      return { label: t("agentInfra.backend.status.checking"), variant: "outline" };
    case "error":
      return { label: t("agentInfra.backend.status.error"), variant: "destructive" };
  }
}

const StatusBadge: React.FC<{ spec: InstallBadgeSpec }> = ({ spec }) => (
  <Badge variant={spec.variant} className="tw-gap-1" title={spec.title}>
    {spec.showCheck && <Check aria-hidden className="tw-size-icon-xs" />}
    {spec.showAlert && <AlertTriangle aria-hidden className="tw-size-icon-xs" />}
    {spec.label}
  </Badge>
);

export const InstallBadge: React.FC<ReadinessBadgeProps> = ({ state, authStatus }) => {
  const spec = installBadge(state, authStatus);
  if (!spec) return null;
  return <StatusBadge spec={spec} />;
};

export const ConfigStatusBadge: React.FC<ReadinessBadgeProps> = ({ state, authStatus }) => (
  <StatusBadge
    spec={(state.kind === "ready" && authBadge(authStatus)) || configStatusBadge(state)}
  />
);
