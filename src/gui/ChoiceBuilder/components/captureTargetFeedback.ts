import type { FieldFilter } from "../../../utils/FieldSuggestionParser";
import { parseCaptureFileFilterTarget } from "../../../utils/captureFileFilterTarget";
import { parsePropertyTarget } from "../../../utils/propertyTarget";
import { t } from "../../../i18n";

export type CaptureTargetFeedback = {
	recognized: true;
	valid: boolean;
	variant: "success" | "error";
	message: string;
};

function normalizeCaptureTarget(raw: string): string {
	return raw.trim().replace(/^\/+/, "");
}

function compact(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function formatList(values: readonly string[], finalJoiner?: string): string {
	const NS = "choiceBuilder.captureTargetFeedback";
	const joiner = finalJoiner ?? t(`${NS}.joinerOr`);
	if (values.length <= 1) return values[0] ?? "";
	if (joiner === "+") return values.join(" + ");
	if (values.length === 2) return `${values[0]} ${joiner} ${values[1]}`;
	return `${values.slice(0, -1).join(t(`${NS}.listJoinMiddle`))} ${joiner} ${values[values.length - 1]}`;
}

function plural(count: number, baseKey: string): string {
	return t(`${baseKey}.${count === 1 ? "one" : "other"}`);
}

function summarizeFilter(filter: FieldFilter): string {
	const NS = "choiceBuilder.captureTargetFeedback";
	const folders = compact(filter.folders ?? (filter.folder ? [filter.folder] : []));
	const tags = compact(filter.tags);
	const excludedFolders = compact(filter.excludeFolders);
	const excludedTags = compact(filter.excludeTags);
	const excludedFiles = compact(filter.excludeFiles);
	const parts: string[] = [];

	if (folders.length > 0) {
		parts.push(`${plural(folders.length, `${NS}.folder`)} ${formatList(folders)}`);
	}
	if (tags.length > 0) {
		parts.push(`${plural(tags.length, `${NS}.tag`)} ${formatList(tags, "+")}`);
	}
	if (excludedFolders.length > 0) {
		parts.push(
			t(`${NS}.excluding`, {
				noun: plural(excludedFolders.length, `${NS}.folder`),
				list: formatList(excludedFolders),
			}),
		);
	}
	if (excludedTags.length > 0) {
		parts.push(
			t(`${NS}.excluding`, {
				noun: plural(excludedTags.length, `${NS}.tag`),
				list: formatList(excludedTags, "+"),
			}),
		);
	}
	if (excludedFiles.length > 0) {
		parts.push(
			t(`${NS}.excluding`, {
				noun: plural(excludedFiles.length, `${NS}.file`),
				list: formatList(excludedFiles),
			}),
		);
	}

	return parts.length > 0
		? parts.join(t(`${NS}.partSeparator`))
		: t(`${NS}.allNotes`);
}

export function getCaptureTargetFeedback(
	raw: string,
): CaptureTargetFeedback | null {
	const normalized = normalizeCaptureTarget(raw);
	const propertyTarget = parsePropertyTarget(normalized);
	if (propertyTarget) {
		if (!propertyTarget.field) {
			return {
				recognized: true,
				valid: false,
				variant: "error",
				message: t("choiceBuilder.captureTargetFeedback.needsField"),
			};
		}

		const propertySummary = propertyTarget.value
			? t("choiceBuilder.captureTargetFeedback.frontmatterWithValue", {
					field: propertyTarget.field,
					value: propertyTarget.value,
				})
			: t("choiceBuilder.captureTargetFeedback.frontmatterFieldOnly", {
					field: propertyTarget.field,
				});
		const filterSummary = summarizeFilter(propertyTarget.filter);
		const suffix =
			filterSummary === t("choiceBuilder.captureTargetFeedback.allNotes")
				? ""
				: `${t("choiceBuilder.captureTargetFeedback.partSeparator")}${filterSummary}`;

		return {
			recognized: true,
			valid: true,
			variant: "success",
			message: t("choiceBuilder.captureTargetFeedback.recognizedProperty", {
				summary: `${propertySummary}${suffix}`,
			}),
		};
	}

	const fileFilterTarget = parseCaptureFileFilterTarget(normalized);
	if (!fileFilterTarget) return null;

	if (fileFilterTarget.multiSelect) {
		return {
			recognized: true,
			valid: false,
			variant: "error",
			message: t("choiceBuilder.captureTargetFeedback.filtersDesc"),
		};
	}

	return {
		recognized: true,
		valid: true,
		variant: "success",
		message: t("choiceBuilder.captureTargetFeedback.recognizedPicker", {
			summary: summarizeFilter(fileFilterTarget.filter),
		}),
	};
}
