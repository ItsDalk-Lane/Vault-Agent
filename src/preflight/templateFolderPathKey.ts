import { QA_INTERNAL_TEMPLATE_FOLDER_PATH } from "src/constants";
import { resolveExistingVariableKey } from "src/utils/valueSyntax";

/**
 * Reserved keys carrying the Template choice's new-note folder out of the
 * one-page preflight form into the run (the folder counterpart of
 * captureTargetKey.ts). The scoped key names the choice it answers so two
 * Template steps in one macro cannot overwrite each other; the unscoped alias
 * keeps the non-interactive CLI form (`value-__qa.templateFolderPath`) working.
 */

type TemplateFolderPathKey = string & {
	readonly __templateFolderPathKey: unique symbol;
};

const SCOPED_PREFIX = `${QA_INTERNAL_TEMPLATE_FOLDER_PATH}.`;

export function templateFolderPathKeyFor(
	choiceId: string,
): TemplateFolderPathKey {
	return `${SCOPED_PREFIX}${choiceId}` as TemplateFolderPathKey;
}

export function isTemplateFolderPathKey(id: string): boolean {
	return (
		id === QA_INTERNAL_TEMPLATE_FOLDER_PATH ||
		(id.startsWith(SCOPED_PREFIX) && id.length > SCOPED_PREFIX.length)
	);
}

export function readPreselectedTemplateFolder(
	variables: Map<string, unknown> | undefined,
	choiceId: string,
): string | undefined {
	if (!variables) return undefined;

	const scoped = variables.get(templateFolderPathKeyFor(choiceId));
	if (typeof scoped === "string" && scoped.length > 0) return scoped;

	// The unscoped alias is honoured only while exactly one scoped key exists,
	// mirroring readPreselectedCaptureTarget: with two Template steps each
	// carrying their own answer, the alias is ambiguous and must not decide.
	let scopedCount = 0;
	for (const key of variables.keys()) {
		if (key.startsWith(SCOPED_PREFIX) && key.length > SCOPED_PREFIX.length) {
			scopedCount++;
		}
	}
	if (scopedCount > 1) return undefined;

	const unscoped = variables.get(QA_INTERNAL_TEMPLATE_FOLDER_PATH);
	if (typeof unscoped === "string" && unscoped.length > 0) return unscoped;

	return undefined;
}

/** The variable key holding this requirement's answer, when it has one. */
export function resolveTemplateFolderPathVariableKey(
	variables: Map<string, unknown>,
	requirementId: string,
): string | null {
	if (!isTemplateFolderPathKey(requirementId)) return null;
	const key = resolveExistingVariableKey(variables, requirementId);
	if (!key) return null;
	return variables.get(key) == null ? null : key;
}
