import type { BackendAuthStatus } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import React from "react";

export interface SignInActionProps {
  status: BackendAuthStatus | null;
  onSignIn: () => void;
  signingIn: boolean;
  url: string | null;
  onCancel?: () => void;
  failed?: boolean;
  signInLabel?: string;
}

export const SignInAction: React.FC<SignInActionProps> = (auth) => (
  <div className="tw-flex tw-flex-col tw-items-start tw-gap-2" aria-live="polite">
    {auth.status?.signedIn ? (
      <span>
        {auth.status.label
          ? t("agentInfra.backend.auth.signedInAs", { label: auth.status.label })
          : t("agentInfra.backend.auth.signedInSentence")}
      </span>
    ) : (
      <>
        {auth.signingIn && (
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            {t("agentInfra.backend.auth.finishInBrowser")}
          </p>
        )}
        {auth.failed && (
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            {t("agentInfra.backend.auth.signInIncomplete")}
          </p>
        )}
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          {auth.signingIn && auth.url ? (
            <Button asChild variant="default" size="sm">
              <a href={auth.url} target="_blank" rel="noopener noreferrer">
                {t("agentInfra.backend.auth.openSignInPage")}
              </a>
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={auth.onSignIn}
              disabled={auth.signingIn || auth.status === null}
            >
              {auth.signingIn
                ? t("agentInfra.backend.auth.signingIn")
                : auth.failed
                  ? t("agentInfra.backend.auth.tryAgain")
                  : auth.status === null
                    ? t("agentInfra.backend.auth.checkingSignIn")
                    : (auth.signInLabel ?? t("agentInfra.backend.auth.signIn"))}
            </Button>
          )}
          {auth.signingIn && auth.onCancel && (
            <Button variant="ghost" size="sm" onClick={auth.onCancel}>
              {t("agentInfra.backend.auth.cancelSignIn")}
            </Button>
          )}
        </div>
      </>
    )}
  </div>
);
