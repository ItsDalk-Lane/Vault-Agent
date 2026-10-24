import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface PiExternalFolderScope {
  readonly root: string;
  readonly permissions: readonly ("read" | "write")[];
  readonly expiresAtMs?: number;
}

export interface PiExternalFoldersProps {
  readonly scopes: readonly PiExternalFolderScope[];
  readonly onChange: (scopes: readonly PiExternalFolderScope[]) => void;
}

export function PiExternalFolders({ scopes, onChange }: PiExternalFoldersProps) {
  const [folder, setFolder] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-text-sm tw-font-medium">{t("agentInfra.backend.pi.external.title")}</div>
      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        {t("agentInfra.backend.pi.external.description")}
      </p>
      {scopes.map((scope) => (
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-ui-smaller" key={scope.root}>
          <span className="tw-min-w-0 tw-flex-1 tw-break-all">
            {scope.root} ·{" "}
            {t(
              scope.permissions.includes("write")
                ? "agentInfra.backend.pi.external.readWrite"
                : "agentInfra.backend.pi.external.readOnly"
            )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onChange(scopes.filter((entry) => entry.root !== scope.root))}
          >
            {t("agentInfra.backend.pi.external.revoke")}
          </Button>
        </div>
      ))}
      <form
        className="tw-flex tw-flex-col tw-gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const root = folder.trim();
          if (!requireNodeModule<typeof import("node:path")>("node:path").isAbsolute(root)) {
            setError(true);
            return;
          }
          // 目录授权只能由设置页用户动作创建，默认一小时后失效。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          onChange([
            ...scopes.filter((scope) => scope.root !== root),
            {
              root,
              permissions: canWrite ? ["read", "write"] : ["read"],
              expiresAtMs: Date.now() + 60 * 60 * 1000,
            },
          ]);
          setFolder("");
          setError(false);
        }}
      >
        <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
          {t("agentInfra.backend.pi.external.folder")}
          <input
            className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2 tw-text-sm"
            required
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
        <label className="tw-flex tw-items-center tw-gap-2 tw-text-sm">
          <input
            type="checkbox"
            checked={canWrite}
            onChange={(event) => setCanWrite(event.target.checked)}
          />
          {t("agentInfra.backend.pi.external.allowWrite")}
        </label>
        {error ? (
          <p className="tw-m-0 tw-text-ui-smaller tw-text-error">
            {t("agentInfra.backend.pi.external.absoluteRequired")}
          </p>
        ) : null}
        <div>
          <Button type="submit" size="sm" variant="secondary">
            {t("agentInfra.backend.pi.external.grant")}
          </Button>
        </div>
      </form>
    </div>
  );
}
