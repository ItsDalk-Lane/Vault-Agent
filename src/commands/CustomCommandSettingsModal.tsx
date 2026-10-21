import { App, Modal } from "obsidian";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import React, { useState } from "react";
import { Root } from "react-dom/client";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { CommandModelSelect } from "@/commands/ui/CommandModelSelect";
import { CustomPromptSyntaxInstruction } from "@/components/CustomPromptSyntaxInstruction";
import { CustomCommand } from "@/commands/type";
import { validateCommandName } from "@/commands/customCommandUtils";
import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";
import { t } from "@/i18n";

type FormErrors = {
  title?: string;
  content?: string;
};

function CustomCommandSettingsModalContent({
  commands,
  command: initialCommand,
  onConfirm,
  onCancel,
}: {
  commands: CustomCommand[];
  command: CustomCommand;
  onConfirm: (command: CustomCommand) => void;
  onCancel: () => void;
}) {
  const { options: activeModels, resolveSelectionId } = useChatBackendModelOptions(false);
  const [command, setCommand] = useState(() => ({
    ...initialCommand,
    modelKey: resolveSelectionId(initialCommand.modelKey) ?? "",
  }));
  const [errors, setErrors] = useState<FormErrors>({});

  const handleUpdate = (field: keyof CustomCommand, value: CustomCommand[keyof CustomCommand]) => {
    setCommand((prev) => ({
      ...prev,
      [field]: value,
    }));
    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const handleSubmit = () => {
    const newErrors: FormErrors = {};

    const nameError = validateCommandName(command.title, commands, initialCommand.title);
    if (nameError) {
      newErrors.title = nameError;
    }

    if (!command.content.trim()) {
      newErrors.content = t("ui.command.promptRequired");
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onConfirm(command);
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="title">{t("ui.command.name")}</Label>
        <Input
          id="title"
          value={command.title}
          onChange={(e) => handleUpdate("title", e.target.value)}
          placeholder={t("ui.command.enterName")}
        />
        {errors.title && <div className="tw-text-sm tw-text-error">{errors.title}</div>}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="content">{t("ui.command.prompt")}</Label>
        <CustomPromptSyntaxInstruction />
        <Textarea
          id="content"
          value={command.content}
          onChange={(e) => handleUpdate("content", e.target.value)}
          placeholder={t("ui.command.enterPrompt")}
          className="tw-min-h-[200px]"
        />
        {errors.content && <div className="tw-text-sm tw-text-error">{errors.content}</div>}
      </div>

      <CommandModelSelect
        value={command.modelKey || ""}
        options={activeModels}
        onChange={(value) => handleUpdate("modelKey", value)}
      />

      <div className="tw-flex tw-items-center tw-gap-2">
        <Checkbox
          id="showInContextMenu"
          checked={command.showInContextMenu}
          onCheckedChange={(checked) => handleUpdate("showInContextMenu", checked)}
        />
        <Label htmlFor="showInContextMenu">{t("ui.command.showInContextMenu")}</Label>
      </div>

      <div className="tw-flex tw-items-center tw-gap-2">
        <Checkbox
          id="showInSlashMenu"
          checked={command.showInSlashMenu}
          onCheckedChange={(checked) => handleUpdate("showInSlashMenu", checked)}
        />
        <Label htmlFor="showInSlashMenu">{t("ui.command.showInSlashMenu")}</Label>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="default" onClick={handleSubmit}>
          {t("ui.common.save")}
        </Button>
      </div>
    </div>
  );
}

export class CustomCommandSettingsModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private commands: CustomCommand[],
    private command: CustomCommand,
    private onUpdate: (command: CustomCommand) => void | Promise<void>
  ) {
    super(app);
    // @ts-ignore
    this.setTitle(t("ui.command.editTitle"));
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createPluginRoot(contentEl, this.app);

    const handleConfirm = (command: CustomCommand) => {
      void this.onUpdate(command);
      this.close();
    };

    this.root.render(
      <CustomCommandSettingsModalContent
        commands={this.commands}
        command={this.command}
        onConfirm={handleConfirm}
        onCancel={() => this.close()}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
