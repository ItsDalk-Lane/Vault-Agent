import type { App, DropdownComponent, TextComponent } from "obsidian";
import { ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import type {
	ConditionalCondition,
	ScriptCondition,
	VariableCondition,
} from "../../types/macros/Conditional/types";
import {
	getConditionSummary,
	getDefaultValueTypeForOperator,
	requiresExpectedValue,
} from "../../utils/conditionalHelpers";
import InputSuggester from "../InputSuggester/inputSuggester";
import { showNoScriptsFoundNotice } from "./noScriptsFoundNotice";
import { t } from "../../i18n";
import { reportingHandler } from "../../utils/errorUtils";
import {
	type ScriptCandidate,
	loadScriptCandidates,
	noteScriptError,
} from "./scriptCandidates";

function cloneCondition(condition: ConditionalCondition): ConditionalCondition {
	return condition.mode === "variable"
		? { ...condition }
		: { ...condition };
}

function createDefaultVariableCondition(): VariableCondition {
	return {
		mode: "variable",
		variableName: "",
		operator: "isTruthy",
		valueType: "boolean",
	};
}

function createDefaultScriptCondition(): ScriptCondition {
	return {
		mode: "script",
		scriptPath: "",
	};
}

export class ConditionalCommandSettingsModal extends Modal {
	public waitForClose: Promise<IConditionalCommand | null>;
	private resolvePromise!: (command: IConditionalCommand | null) => void;
	private readonly originalCommand: IConditionalCommand;
	private workingCommand: IConditionalCommand;
	private isResolved = false;
	private scriptCandidates: ScriptCandidate[] = [];

	constructor(app: App, command: IConditionalCommand) {
		super(app);
		this.originalCommand = command;
		this.workingCommand = {
			...command,
			condition: cloneCondition(command.condition),
		};

		this.waitForClose = new Promise<IConditionalCommand | null>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.loadScriptCandidates();
		this.display();
		this.open();
	}

	onClose() {
		super.onClose();
		if (!this.isResolved) {
			this.resolve(null);
		}
	}

	private resolve(value: IConditionalCommand | null) {
		if (this.isResolved) return;
		this.isResolved = true;
		this.resolvePromise(value);
	}

	private loadScriptCandidates() {
		this.scriptCandidates = loadScriptCandidates(this.app);
	}

	private reload() {
		this.display();
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "conditionalSettingsModal");
		this.contentEl.empty();

		const headerEl = this.contentEl.createEl("h2", {
			text: t("macro.configureTitle"),
		});
		headerEl.addClass("qa-modal-title");

		this.renderModeSelector();
		if (this.workingCommand.condition.mode === "variable") {
			this.renderVariableConfiguration(this.workingCommand.condition);
		} else {
			this.renderScriptConfiguration(this.workingCommand.condition);
		}

		this.renderButtonBar();
	}

	private renderModeSelector() {
		new Setting(this.contentEl)
			.setName(t("macro.conditionType.name"))
			.setDesc(t("macro.conditionType.desc"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("variable", t("macro.kind.variable"))
					.addOption("script", t("macro.kind.script"))
					.setValue(this.workingCommand.condition.mode)
					.onChange((value) => {
						if (value === this.workingCommand.condition.mode) return;
						this.workingCommand.condition =
							value === "variable"
								? createDefaultVariableCondition()
								: createDefaultScriptCondition();
						this.reload();
					});
			});
	}

	private renderVariableConfiguration(condition: VariableCondition) {
		this.renderVariableNameSetting(condition);
		this.renderOperatorSetting(condition);
		this.renderValueTypeSetting(condition);
		if (requiresExpectedValue(condition.operator)) {
			this.renderExpectedValueSetting(condition);
		}
	}

	private renderVariableNameSetting(condition: VariableCondition) {
		new Setting(this.contentEl)
			.setName(t("macro.variableName.name"))
			.setDesc(t("macro.variableName.desc"))
			.addText((text) =>
				text
					.setPlaceholder(t("macro.variableName.placeholder"))
					.setValue(condition.variableName)
					.onChange((value) => {
						condition.variableName = value.trim();
					})
			);
	}

	private renderOperatorSetting(condition: VariableCondition) {
		const operators: Array<{ value: VariableCondition["operator"]; label: string }> = [
			{ value: "equals", label: t("macro.operators.equals") },
			{ value: "notEquals", label: t("macro.operators.notEquals") },
			{ value: "lessThan", label: t("macro.operators.lessThan") },
			{ value: "lessThanOrEqual", label: t("macro.operators.lessThanOrEqual") },
			{ value: "greaterThan", label: t("macro.operators.greaterThan") },
			{ value: "greaterThanOrEqual", label: t("macro.operators.greaterThanOrEqual") },
			{ value: "contains", label: t("macro.operators.contains") },
			{ value: "notContains", label: t("macro.operators.notContains") },
			{ value: "isTruthy", label: t("macro.operators.isTruthy") },
			{ value: "isFalsy", label: t("macro.operators.isFalsy") },
		];

		new Setting(this.contentEl)
			.setName(t("macro.operator.name"))
			.setDesc(t("macro.operator.desc"))
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOptions(
					operators.reduce<Record<string, string>>((acc, option) => {
						acc[option.value] = option.label;
						return acc;
					}, {})
				);
				dropdown.setValue(condition.operator);
				dropdown.onChange((value) => {
					condition.operator = value as VariableCondition["operator"];
					condition.valueType = getDefaultValueTypeForOperator(
						condition.operator
					);
					if (!requiresExpectedValue(condition.operator)) {
						delete condition.expectedValue;
					}
					this.reload();
				});
			});
	}

	private renderValueTypeSetting(condition: VariableCondition) {
		new Setting(this.contentEl)
			.setName(t("macro.valueType.name"))
			.setDesc(t("macro.valueType.desc"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("string", t("macro.valueTypes.string"))
					.addOption("number", t("macro.valueTypes.number"))
					.addOption("boolean", t("macro.valueTypes.boolean"))
					.setValue(condition.valueType)
					.onChange((value) => {
						condition.valueType = value as VariableCondition["valueType"];
						this.reload();
					});
			});
	}

	private renderExpectedValueSetting(condition: VariableCondition) {
		if (condition.valueType === "boolean") {
			new Setting(this.contentEl)
				.setName(t("macro.expectedBool.name"))
				.setDesc(t("macro.expectedBool.desc"))
				.addDropdown((dropdown) => {
					dropdown
						.addOption("true", t("macro.expectedBool.true"))
						.addOption("false", t("macro.expectedBool.false"))
						.setValue(condition.expectedValue ?? "true")
						.onChange((value) => {
							condition.expectedValue = value;
						});
				});
			return;
		}

		new Setting(this.contentEl)
			.setName(t("macro.expectedValue.name"))
			.setDesc(t("macro.expectedValue.desc"))
			.addText((text: TextComponent) => {
				text
					.setPlaceholder(t("macro.expectedValue.placeholder"))
					.setValue(condition.expectedValue ?? "")
					.onChange((value) => {
						condition.expectedValue = value;
					});
			});
	}

	private renderScriptConfiguration(condition: ScriptCondition) {
		this.renderScriptPathSetting(condition);
		this.renderScriptExportSetting(condition);
	}

	private renderScriptPathSetting(condition: ScriptCondition) {
		let input: TextComponent;

		new Setting(this.contentEl)
			.setName(t("macro.scriptPath.name"))
			.setDesc(t("macro.scriptPath.desc"))
			.addText((text) => {
				input = text;
				text
					.setPlaceholder(t("macro.scriptPath.placeholder"))
					.setValue(condition.scriptPath)
					.onChange((value) => {
						condition.scriptPath = value.trim();
					});
			})
			.addButton((button) =>
				button
					.setButtonText(t("macro.scriptPath.browse"))
					.setTooltip(t("macro.scriptPath.browseTooltip"))
					// Obsidian drops the click handler's promise: without this, pressing
					// Escape in the picker is an unhandled rejection.
					.onClick(reportingHandler(t("macro.scriptPath.browseFailed"), async () => {
						// Refresh so notes/scripts created while this modal is open appear.
						this.loadScriptCandidates();
						if (this.scriptCandidates.length === 0) {
							showNoScriptsFoundNotice(this.app);
							return;
						}

						// This picker stores condition.scriptPath, so show full paths for
						// every entry (a vault can have several same-basename scripts).
						const paths = this.scriptCandidates.map((c) => c.file.path);
						const selected = await InputSuggester.Suggest(
							this.app,
							paths,
							paths,
							{
								placeholder:
									t("macro.scriptPath.browseLabel"),
								emptyStateText: t("macro.scriptPath.browseEmpty"),
							}
						);

						if (!selected) return;

						const candidate = this.scriptCandidates.find(
							(c) => c.file.path === selected
						);
						if (candidate?.isMarkdown) {
							const reason = await noteScriptError(
								this.app,
								candidate.file
							);
							if (reason) {
								new Notice(
									t("macro.commandRunFailed", { path: candidate.file.path, reason }),
								);
								return;
							}
						}

						condition.scriptPath = selected;
						input.setValue(selected);
					}))
			);
	}

	private renderScriptExportSetting(condition: ScriptCondition) {
		new Setting(this.contentEl)
			.setName(t("macro.exportName.name"))
			.setDesc(t("macro.exportName.desc"))
			.addText((text) =>
				text
					.setPlaceholder(t("macro.exportName.placeholder"))
					.setValue(condition.exportName ?? "")
					.onChange((value) => {
						condition.exportName = value.trim() || undefined;
					})
			);
	}

	private renderButtonBar() {
		const buttonContainer = this.contentEl.createDiv({
			cls: "qa-command-button-row",
		});

		new ButtonComponent(buttonContainer)
			.setButtonText(t("common.cancel"))
			.onClick(() => {
				this.resolve(null);
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setCta()
			.setButtonText(t("common.save"))
			.onClick(() => {
				if (!this.validateCondition()) return;
				this.applyChanges();
				this.resolve(this.originalCommand);
				this.close();
			});
	}

	private validateCondition(): boolean {
		const condition = this.workingCommand.condition;
		if (condition.mode === "variable") {
			if (!condition.variableName.trim()) {
				new Notice(t("macro.notices.enterVariableName"));
				return false;
			}
			return true;
		}

		if (!condition.scriptPath.trim()) {
			new Notice(t("macro.notices.enterScriptPath"));
			return false;
		}
		return true;
	}

	private applyChanges() {
		this.originalCommand.condition = cloneCondition(
			this.workingCommand.condition
		);
		const summary = getConditionSummary(this.originalCommand.condition);
		this.originalCommand.name = `If ${summary}`;
	}
}
