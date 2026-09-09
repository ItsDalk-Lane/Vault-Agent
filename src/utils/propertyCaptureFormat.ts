import { parseAnonymousValueOptions, parseValueToken } from "./valueSyntax";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { PropertyCapture } from "../types/choices/ICaptureChoice";
import { VALUE_SYNTAX } from "../constants";

export function untypedPropertyValueVariable(format: string): string | null {
	const named = /^\{\{VALUE:([^{}]+)\}\}$/i.exec(format);
	if (named) {
		const parsed = parseValueToken(named[1]);
		return parsed && !parsed.inputTypeOverride && !parsed.hasOptions && !parsed.caseStyle
			? parsed.variableKey : null;
	}
	const anonymous = /^\{\{(?:VALUE|NAME)(\|[^{}]+)?\}\}$/i.exec(format);
	if (!anonymous) return null;
	const parsed = parseAnonymousValueOptions(anonymous[1] ?? "");
	return !parsed.inputTypeOverride && !parsed.caseStyle ? "value" : null;
}

export function inheritPropertyValueType(format: string, propertyType: string | null): string {
	const type = propertyType === "boolean" ? "checkbox" : propertyType;
	if ((type !== "number" && type !== "checkbox") || untypedPropertyValueVariable(format) === null) {
		return format;
	}
	return `${format.slice(0, -2)}|type:${type}}}`;
}

/**
 * The format a property capture's VALUE comes from: the row's own
 * `valueFormat` when set, otherwise the choice's capture format — the exact
 * expression the single-property engine used, so legacy rows with no
 * valueFormat resolve byte-identically. Engine and preflight share this so
 * the one-page form collects precisely the fields a run will read.
 */
export function effectivePropertyValueFormat(
	choice: ICaptureChoice,
	capture: PropertyCapture,
): string {
	const rowFormat = capture.valueFormat?.trim();
	if (rowFormat) return rowFormat;
	return choice.format.enabled
		? choice.format.format
		: VALUE_SYNTAX;
}
