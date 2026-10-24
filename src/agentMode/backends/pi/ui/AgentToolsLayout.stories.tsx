import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { AgentToolsLayout, type AgentToolsLayoutProps } from "./AgentToolsLayout";

const permissions = (
  <>
    <label className="tw-flex tw-items-start tw-gap-2 tw-text-sm">
      <input type="checkbox" checked={false} readOnly />
      <span>
        Allow approved local programs. Local services can access content outside the vault.
      </span>
    </label>
    <label className="tw-flex tw-items-start tw-gap-2 tw-text-sm">
      <input type="checkbox" checked={false} readOnly />
      <span>Allow writing subtasks</span>
    </label>
    <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
      Writing subtasks remain limited to allowed files and the chat approval rules.
    </p>
  </>
);

const folders = (
  <div className="tw-flex tw-flex-col tw-gap-2">
    <div className="tw-text-sm tw-font-medium">Other folders</div>
    <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
      Grants last one hour. Changes still follow chat approval rules.
    </p>
    <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
      Full folder path
      <input
        className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2 tw-text-sm"
        readOnly
        value=""
      />
    </label>
    <label className="tw-flex tw-items-start tw-gap-2 tw-text-sm">
      <input type="checkbox" checked={false} readOnly />
      Also allow changes in this folder
    </label>
    <div>
      <Button size="sm" variant="secondary">
        Grant access for one hour
      </Button>
    </div>
  </div>
);

const meta = {
  title: "Settings/Tools and Permissions",
  component: AgentToolsLayout,
  args: { permissions, externalFolders: folders },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentToolsLayoutProps>;
export default meta;

export const PermissionsAndFolders: StoryObj<AgentToolsLayoutProps> = {};
