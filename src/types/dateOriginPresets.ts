import type { DateOrigin, DateOriginUnit } from "./dateOrigin";
import { t } from "../i18n";

export const DATE_ORIGIN_PRESETS = [
	"today",
	"ask",
	"yesterday",
	"last-week",
	"next-week",
	"last-month",
	"custom",
	"variable",
] as const;

export type DateOriginPreset = (typeof DATE_ORIGIN_PRESETS)[number];

// The exported "setting name/desc" values below are FUNCTIONS so their strings
// resolve through t() at call time: module-level literals would freeze the
// English fallback (this module is imported before main.ts calls setLocale()).

export const DATE_ORIGIN_SETTING_NAME = () => t("dateOrigin.whichDay");
export const DATE_ORIGIN_SETTING_DESC = () => t("dateOrigin.whichDayDesc");

export const ASK_DEFAULT_SETTING_NAME = () => t("dateOrigin.pickerStartsOn");
export const ASK_DEFAULT_SETTING_DESC = () => t("dateOrigin.pickerStartsOnDesc");

export const CUSTOM_OFFSET_SETTING_NAME = () => t("dateOrigin.howFar");
export const CUSTOM_OFFSET_SETTING_DESC = () => t("dateOrigin.howFarDesc");

export const VARIABLE_SETTING_NAME = () => t("dateOrigin.variableName");
export const VARIABLE_SETTING_DESC = () => t("dateOrigin.variableNameDesc");

export const NAMED_RELATIVE_PRESETS = [
	{
		id: "yesterday",
		get label() {
			return t("dateOrigin.yesterday");
		},
		offset: -1,
		unit: "days",
	},
	{
		id: "last-week",
		get label() {
			return t("dateOrigin.lastWeek");
		},
		offset: -1,
		unit: "weeks",
	},
	{
		id: "next-week",
		get label() {
			return t("dateOrigin.nextWeek");
		},
		offset: 1,
		unit: "weeks",
	},
	{
		id: "last-month",
		get label() {
			return t("dateOrigin.lastMonth");
		},
		offset: -1,
		unit: "months",
	},
] as const satisfies readonly {
	id: DateOriginPreset;
	label: string;
	offset: number;
	unit: DateOriginUnit;
}[];

// Function, not a module-level array: rebuilding per call keeps the labels
// (and the mapped NAMED_RELATIVE labels) following the active locale.
export function DATE_ORIGIN_PRESET_OPTIONS(): {
	value: DateOriginPreset;
	label: string;
}[] {
	return [
		{ value: "today", label: t("dateOrigin.today") },
		{ value: "ask", label: t("dateOrigin.askEachTime") },
		...NAMED_RELATIVE_PRESETS.map((item) => ({
			value: item.id,
			label: item.label,
		})),
		{ value: "custom", label: t("dateOrigin.custom") },
		{ value: "variable", label: t("dateOrigin.aVariable") },
	];
}

export const ASK_DEFAULT_PRESETS = [
	{
		id: "today",
		get label() {
			return t("dateOrigin.today");
		},
		defaultValue: undefined,
		aliases: ["", "today"],
	},
	{
		id: "yesterday",
		get label() {
			return t("dateOrigin.yesterday");
		},
		defaultValue: "yesterday",
		aliases: ["yesterday", "yd"],
	},
	{
		id: "last-week",
		get label() {
			return t("dateOrigin.lastWeek");
		},
		defaultValue: "last week",
		aliases: ["last week", "lw"],
	},
	{
		id: "next-week",
		get label() {
			return t("dateOrigin.nextWeek");
		},
		defaultValue: "next week",
		aliases: ["next week", "nw"],
	},
	{
		id: "last-month",
		get label() {
			return t("dateOrigin.lastMonth");
		},
		defaultValue: "last month",
		aliases: ["last month", "lm"],
	},
] as const;

const DATE_ORIGIN_PRESET_IDS = new Set<string>(DATE_ORIGIN_PRESETS);

export function isDateOriginPreset(value: string): value is DateOriginPreset {
	return DATE_ORIGIN_PRESET_IDS.has(value);
}

export function dateOriginToPreset(
	origin: DateOrigin | undefined,
): DateOriginPreset {
	if (!origin || origin.kind === "now") return "today";
	if (origin.kind === "ask") return "ask";
	if (origin.kind === "variable") return "variable";

	for (const named of NAMED_RELATIVE_PRESETS) {
		if (origin.offset === named.offset && origin.unit === named.unit) {
			return named.id;
		}
	}
	return "custom";
}

export function dateOriginFromPreset(input: {
	preset: DateOriginPreset;
	previous?: DateOrigin;
}): DateOrigin | undefined {
	const { preset, previous } = input;

	if (preset === "today") return undefined;

	if (preset === "ask") {
		if (previous?.kind === "ask") return previous;
		return askOriginFromNamedDay(dateOriginToPreset(previous));
	}

	if (preset === "variable") {
		return previous?.kind === "variable"
			? previous
			: { kind: "variable", name: "" };
	}

	if (preset === "custom") {
		if (
			previous?.kind === "relative" &&
			dateOriginToPreset(previous) === "custom"
		) {
			return previous;
		}
		return { kind: "relative", offset: -2, unit: "days" };
	}

	for (const named of NAMED_RELATIVE_PRESETS) {
		if (named.id === preset) {
			return {
				kind: "relative",
				offset: named.offset,
				unit: named.unit,
			};
		}
	}

	return undefined;
}

function askOriginFromNamedDay(preset: DateOriginPreset): DateOrigin {
	for (const item of ASK_DEFAULT_PRESETS) {
		if (item.id === preset && item.defaultValue) {
			return { kind: "ask", defaultValue: item.defaultValue };
		}
	}
	return { kind: "ask" };
}

export function askDefaultToPresetId(defaultValue?: string): string {
	const normalized = (defaultValue ?? "").trim().toLowerCase();
	for (const item of ASK_DEFAULT_PRESETS) {
		if (item.aliases.some((alias) => alias === normalized)) {
			return item.id;
		}
	}
	return "kept";
}

export function askDefaultOptions(
	defaultValue?: string,
): { value: string; label: string }[] {
	const options: { value: string; label: string }[] = ASK_DEFAULT_PRESETS.map(
		(item) => ({
			value: item.id,
			label: item.label,
		}),
	);
	if (askDefaultToPresetId(defaultValue) === "kept") {
		const kept = defaultValue?.trim();
		if (kept) {
			options.push({ value: "kept", label: kept });
		}
	}
	return options;
}

export function askDefaultFromPresetId(
	id: string,
	previous?: string,
): string | undefined {
	if (id === "kept") {
		const trimmed = previous?.trim();
		return trimmed ? trimmed : undefined;
	}
	for (const item of ASK_DEFAULT_PRESETS) {
		if (item.id === id) return item.defaultValue;
	}
	return undefined;
}

export function isPickDateToken(value: unknown): boolean {
	return typeof value === "string" && value.trim().toLowerCase() === "ask";
}

export function dateOriginForPick(
	origin: DateOrigin | undefined,
): DateOrigin {
	if (origin?.kind === "ask") return origin;
	return askOriginFromNamedDay(dateOriginToPreset(origin));
}
