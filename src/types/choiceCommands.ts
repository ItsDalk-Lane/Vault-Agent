import type { DateOrigin } from "./dateOrigin";
import { dateOriginToPreset } from "./dateOriginPresets";
import { t } from "../i18n";

// Functions, not literals: module-level strings would freeze the English
// fallback before setLocale() runs (see dateOriginPresets.ts).
export const COMMAND_SETTING_NAME = () => t("choiceCommands.commandPalette");
export const COMMAND_SETTING_DESC = () =>
	t("choiceCommands.commandPaletteDesc");

export const PICK_DAY_SETTING_DESC = () => t("choiceCommands.pickDayDesc");

export function pickDaySettingName(choiceName: string): string {
	return t("choiceCommands.alsoAdd", {
		name: pickDayCommandName(choiceName),
	});
}

export function choiceCommandId(choiceId: string): string {
	return `choice:${choiceId}`;
}

export function pickDayCommandId(choiceId: string): string {
	return `${choiceCommandId(choiceId)}:pick-day`;
}

export function pickDayCommandName(choiceName: string): string {
	return t("choiceCommands.pickDayName", { name: choiceName });
}

/**
 * The pick-a-day toggle only makes sense when the main command does not
 * already prompt, so Ask each time hides it.
 */
export function canOfferPickDayCommand(origin: DateOrigin | undefined): boolean {
	return dateOriginToPreset(origin) !== "ask";
}

export function shouldRegisterPickDayCommand(input: {
	origin?: DateOrigin;
	enabled?: boolean;
}): boolean {
	return Boolean(input.enabled) && canOfferPickDayCommand(input.origin);
}
