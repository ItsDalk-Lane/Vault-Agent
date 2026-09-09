import { type App, Setting, setIcon } from "obsidian";
import { ICON_LIST } from "../../../types/IconType";
import type { ChoiceType } from "../../../types/choices/choiceType";
import { defaultIconForChoiceType } from "../../../utils/choiceUtils";
import { GenericTextSuggester } from "../../suggesters/genericTextSuggester";
import { createOwnedElement } from "../../../utils/activeWindow";
import { t } from "../../../i18n";

export interface ChoiceIconSettingState {
	type: ChoiceType;
	icon?: string | undefined;
}

function normalizeIcon(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function resolveIcon(state: ChoiceIconSettingState): string {
	const override = typeof state.icon === "string" ? state.icon.trim() : "";
	return override || defaultIconForChoiceType(state.type);
}

export function addChoiceIconSetting(
	app: App,
	parent: HTMLElement,
	state: ChoiceIconSettingState,
	onChange: (icon: string | undefined) => void,
): void {
	const defaultIcon = defaultIconForChoiceType(state.type);
	const setting = new Setting(parent)
		.setName(t("choiceBuilder.icon.name"))
		.setDesc(t("choiceBuilder.icon.desc").replace("{default}", defaultIcon));
	setting.settingEl.addClass("qa-choice-icon-setting");

	const preview = createOwnedElement(parent, "span");
	preview.classList.add("qa-choice-icon-setting-preview");
	preview.setAttribute("aria-hidden", "true");
	setting.controlEl.appendChild(preview);

	function renderPreview() {
		preview.replaceChildren();
		setIcon(preview, resolveIcon(state));
	}

	setting.addText((text) => {
		text.setPlaceholder(t("choiceBuilder.icon.placeholder"));
		text.setValue(typeof state.icon === "string" ? state.icon : "");
		text.inputEl.addClass("qa-choice-icon-input");
		text.inputEl.setAttribute("aria-label", t("choiceBuilder.icon.aria"));
		new GenericTextSuggester(app, text.inputEl, ICON_LIST, 50);
		text.onChange((value) => {
			const icon = normalizeIcon(value);
			state.icon = icon;
			onChange(icon);
			renderPreview();
		});
	});

	renderPreview();
}
