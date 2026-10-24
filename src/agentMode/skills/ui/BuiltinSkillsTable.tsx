import type { BuiltinPreferences } from "@/settings/builtinSkillPreferences";
import { t } from "@/i18n";
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, CircleOff, Eye, MoreVertical, Power } from "lucide-react";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { SkillRowLayout } from "./SkillRowLayout";

export interface BuiltinSkillRow {
  name: string;
  description: string;
  content: string;
}

export interface BuiltinSkillsTableProps {
  skills: readonly BuiltinSkillRow[];
  preferences?: BuiltinPreferences;
  unavailableReasons?: Readonly<Record<string, string>>;
  pendingSkills: readonly string[];
  error?: string;
  onToggleSkill: (name: string, enabled: boolean) => void;
}

export function BuiltinSkillsTable({
  skills,
  preferences,
  unavailableReasons,
  pendingSkills,
  error,
  onToggleSkill,
}: BuiltinSkillsTableProps) {
  return (
    <section aria-label={t("agentInfra.skills.builtin.title")} className="tw-space-y-3">
      <div role="heading" aria-level={3} className="tw-text-left tw-text-base tw-font-semibold">
        {t("agentInfra.skills.builtin.title")}
      </div>
      {error && (
        <div role="alert" className="tw-text-ui-smaller tw-text-error">
          {error}
        </div>
      )}
      <div className="tw-space-y-1.5">
        {skills.map((skill) => (
          <BuiltinSkillItem
            key={skill.name}
            skill={skill}
            preference={preferences?.[skill.name]}
            unavailableReason={unavailableReasons?.[skill.name]}
            pending={pendingSkills.includes(skill.name)}
            onToggleSkill={onToggleSkill}
          />
        ))}
        {skills.length === 0 && (
          <p className="tw-text-ui-smaller tw-text-muted">{t("agentInfra.skills.builtin.empty")}</p>
        )}
      </div>
    </section>
  );
}

interface BuiltinSkillItemProps extends Pick<BuiltinSkillsTableProps, "onToggleSkill"> {
  skill: BuiltinSkillRow;
  preference?: BuiltinPreferences[string];
  unavailableReason?: string;
  pending: boolean;
}

const BuiltinSkillItem = React.memo(function BuiltinSkillItem({
  skill,
  preference,
  unavailableReason,
  pending,
  onToggleSkill,
}: BuiltinSkillItemProps) {
  const skillEnabled = preference?.disabled !== true && !preference?.disabledAgents?.includes("pi");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  return (
    <div ref={containerRef}>
      <SkillRowLayout
        name={skill.name}
        description={skill.description}
        menuOpen={menuOpen}
        annotations={
          <>
            {!skillEnabled && (
              <>
                <Badge
                  variant="secondary"
                  className="tw-hidden tw-shrink-0 @[140px]/skill-title:tw-inline-flex"
                >
                  {t("agentInfra.skills.builtin.disabled")}
                </Badge>
                <span
                  title={t("agentInfra.skills.builtin.disabled")}
                  aria-label={t("agentInfra.skills.builtin.disabled")}
                  className="tw-shrink-0 @[140px]/skill-title:tw-hidden"
                >
                  <CircleOff aria-hidden="true" className="tw-size-3.5 tw-text-muted" />
                </span>
              </>
            )}
            {unavailableReason && (
              <span title={unavailableReason} aria-label={unavailableReason}>
                <AlertTriangle className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
              </span>
            )}
          </>
        }
        controls={
          <SettingSwitch
            checked={skillEnabled && !unavailableReason}
            disabled={pending || !!unavailableReason}
            aria-label={t("agentInfra.skills.row.enabled", { name: skill.name })}
            onCheckedChange={(enabled) => onToggleSkill(skill.name, enabled)}
          />
        }
        actions={
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={(open) => setMenuOpen(open)}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title={t("agentInfra.skills.actions.more")}
                aria-label={t("agentInfra.skills.actions.moreFor", { name: skill.name })}
              >
                <MoreVertical className="tw-size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={containerRef.current}>
              <DropdownMenuItem
                disabled={pending}
                className="tw-gap-2.5 tw-text-ui-small"
                onSelect={() => onToggleSkill(skill.name, !skillEnabled)}
              >
                <Power className="tw-size-3.5" />
                {skillEnabled
                  ? t("agentInfra.skills.actions.disableSkill")
                  : t("agentInfra.skills.actions.enableSkill")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="tw-gap-2.5 tw-text-ui-small"
                onSelect={() => setPreviewOpen(!previewOpen)}
              >
                <Eye className="tw-size-3.5" />
                {t("agentInfra.skills.actions.viewSkillMd")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {previewOpen && (
        <pre
          aria-label={t("agentInfra.skills.builtin.contentAria", { name: skill.name })}
          className="tw-max-h-80 tw-overflow-auto tw-whitespace-pre-wrap tw-break-all tw-rounded-md tw-bg-secondary tw-p-3 tw-text-ui-smaller"
        >
          {skill.content}
        </pre>
      )}
    </div>
  );
});
