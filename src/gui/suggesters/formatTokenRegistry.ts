import { t } from "../../i18n";
import {
	CLIPBOARD_SYNTAX_SUGGEST_REGEX,
	CURSOR_SYNTAX_SUGGEST_REGEX,
	DAILY_SYNTAX_SUGGEST_REGEX,
	DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
	DATE_SYNTAX_SUGGEST_REGEX,
	FIELD_SYNTAX_SUGGEST_REGEX,
	FILENAMECURRENT_SYNTAX_SUGGEST_REGEX,
	FILE_SYNTAX_SUGGEST_REGEX,
	FOLDERCURRENT_SYNTAX_SUGGEST_REGEX,
	FOLDER_SYNTAX_SUGGEST_REGEX,
	GLOBAL_VAR_SYNTAX_SUGGEST_REGEX,
	LINKCURRENT_SYNTAX_SUGGEST_REGEX,
	LINKSECTION_SYNTAX_SUGGEST_REGEX,
	MACRO_SYNTAX_SUGGEST_REGEX,
	MATH_VALUE_SYNTAX_SUGGEST_REGEX,
	MONTHLY_SYNTAX_SUGGEST_REGEX,
	NAME_SYNTAX_SUGGEST_REGEX,
	PROPERTY_SYNTAX_SUGGEST_REGEX,
	QUARTERLY_SYNTAX_SUGGEST_REGEX,
	RANDOM_SYNTAX_SUGGEST_REGEX,
	SELECTED_SYNTAX_SUGGEST_REGEX,
	TEMPLATE_SYNTAX_SUGGEST_REGEX,
	TIME_FORMAT_SYNTAX_SUGGEST_REGEX,
	TIME_SYNTAX_SUGGEST_REGEX,
	TITLE_SYNTAX_SUGGEST_REGEX,
	VALUE_SYNTAX_SUGGEST_REGEX,
	VARIABLE_DATE_SYNTAX_SUGGEST_REGEX,
	VARIABLE_SYNTAX_SUGGEST_REGEX,
	WEEKLY_SYNTAX_SUGGEST_REGEX,
	YEARLY_SYNTAX_SUGGEST_REGEX,
} from "../../constants";

/**
 * Which format field the suggester is attached to. Every field runs a different
 * CompleteFormatter entry point, and those entry points genuinely disagree
 * about which tokens resolve: {{TITLE}} *throws* in a file path, {{LINKCURRENT}}
 * is left literal there, and {{FOLDER}} collapses to "" in a capture target.
 * Offering a token the field cannot resolve is a bug, so the field context is
 * modelled explicitly rather than as a boolean plus an exclusion list.
 */
export type FormatSuggestContext =
	/** Note bodies: capture format, template content, AI prompts, script inputs. `formatFileContent`. */
	| "noteContent"
	/** Capture property value. `formatPropertyValue`. */
	| "propertyValue"
	/** Capture "Capture to". `formatFileName`, but the note is not created *into* a target folder. */
	| "captureTarget"
	/** Template "File name format". `formatFileName` with a configured target folder. */
	| "fileName"
	/** Insert after / insert before line targets. `formatLocationString`. */
	| "lineTarget";

export const ALL_FORMAT_SUGGEST_CONTEXTS: readonly FormatSuggestContext[] = [
	"noteContent",
	"propertyValue",
	"captureTarget",
	"fileName",
	"lineTarget",
];

/** Every context whose value is fed to a formatter that produces a path. */
const PATH_CONTEXTS: readonly FormatSuggestContext[] = ["captureTarget", "fileName"];
const ALL: readonly FormatSuggestContext[] = ALL_FORMAT_SUGGEST_CONTEXTS;

/**
 * One row in the autocomplete. `insert` is what lands in the field; everything
 * else exists so the row can teach what it does before it is accepted.
 */
export interface FormatTokenSuggestion {
	/** Exact text written into the field when this row is accepted. */
	insert: string;
	/** One-line, plain-English explanation rendered beside the token (#1542). */
	description: string;
	/**
	 * Where the caret lands after insertion, counted back from the end of
	 * `insert`. 2 parks it between the closing braces of an empty argument
	 * ("{{DATE:|}}"); 0 leaves it after the token. Explicit per row because
	 * inferring it from the text used to mis-place the caret inside the token
	 * word for the argument-less "{{TEMPLATE:" / "{{MACRO:" forms.
	 */
	caretOffset: number;
	/** Bare fragments (the `|case:` styles) render without token styling. */
	isFragment?: boolean;
}

interface FormatTokenEntry {
	/** Prefix matcher deciding whether this row is still a candidate. */
	regex: RegExp;
	/** The row shown for the token itself. */
	suggestion: FormatTokenSuggestion;
	/** Fields this token actually resolves in. */
	contexts: readonly FormatSuggestContext[];
	/**
	 * Worked examples for this token family. Withheld until the user has typed
	 * enough of the token's name to have asked for it (see
	 * {@link EXPANSION_MIN_PREFIX}), so a bare "{{" stays a readable index.
	 */
	expansions?: (data: FormatTokenExpansionData) => FormatTokenSuggestion[];
}

/** Vault/settings data the dynamic rows are built from. */
interface FormatTokenExpansionData {
	templatePaths: readonly string[];
	macroNames: readonly string[];
	globalVariableNames: readonly string[];
	context: FormatSuggestContext;
	/**
	 * Renders a Moment format against the current moment, so a date example can
	 * show what it actually produces instead of a sample that goes stale in the
	 * source file.
	 */
	formatDate: (momentFormat: string) => string;
}

/**
 * How many characters after "{{" the user must type before a token's worked
 * examples join the list. At "{{" the popup is an index of what exists; from
 * "{{val" on it is help with one token, so the examples earn their room.
 */
export const EXPANSION_MIN_PREFIX = 3;

function token(
	insert: string,
	description: string,
	caretOffset = insert.endsWith(":}}") ? 2 : 0,
): FormatTokenSuggestion {
	return { insert, description, caretOffset };
}

/**
 * The canonical list, in the order it is offered. Ordering follows the docs'
 * quick reference (ask for input, dates, the note you ran from, the note being
 * created, other content) so the first row a new user meets, {{VALUE}}, is
 * the one that explains what format syntax is for.
 *
 * Casing matches the documentation (uppercase token, lowercase modifiers).
 * Every runtime regex carries /i, so this is a display convention, not a
 * behaviour change; previously the list mixed "{{date}}" with "{{DATE:}}" and
 * left users guessing whether the difference meant anything (#1542).
 *
 * Built as a FUNCTION, not a module-level constant: descriptions resolve
 * through t(), and a top-level call would freeze the pre-setLocale (English)
 * strings into the rows forever. The suggester rebuilds the list on every
 * popup, so the per-call cost is irrelevant.
 */
function buildFormatTokenEntries(): readonly FormatTokenEntry[] {
	return [
		// == Ask for input ==
		{
			regex: VALUE_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{VALUE}}", t("formatTokens.value")),
		},
		{
			regex: VARIABLE_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{VALUE:}}", t("formatTokens.valueNamed")),
			expansions: () => [
				token("{{VALUE:title}}", t("formatTokens.valueExampleTitle")),
				token("{{VALUE:option1,option2,option3}}", t("formatTokens.valueExampleOptions")),
				token(
					"{{VALUE:option1,option2,option3|custom}}",
					t("formatTokens.valueExampleOptionsCustom"),
				),
				token("{{VALUE:title|label:Note title}}", t("formatTokens.valueExampleLabel")),
				token("{{VALUE:option1,option2|label:Pick one}}", t("formatTokens.valueExampleOptionsLabel")),
				token(
					"{{VALUE:title|label:Note title|default:Untitled}}",
					t("formatTokens.valueExampleDefault"),
				),
				token(
					"{{VALUE:<items>|text:<display items>}}",
					t("formatTokens.valueExampleText"),
				),
				token(
					"{{VALUE:option1,option2|name:category}}",
					t("formatTokens.valueExampleName"),
				),
				// A ready-made, valid |case: token. Without it the only way to reach
				// |case: is to hand-type it inside an already-closed token, and the
				// live preview warns on every keystroke of a half-typed style name.
				token(
					"{{VALUE:title|case:kebab}}",
					t("formatTokens.valueExampleCase"),
				),
				token("{{VALUE:title|trim}}", t("formatTokens.valueExampleTrim")),
				token("{{VALUE:title|optional}}", t("formatTokens.valueExampleOptional")),
			],
		},
		{
			regex: NAME_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{NAME}}", t("formatTokens.name")),
		},
		{
			regex: VARIABLE_DATE_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{VDATE:}}", t("formatTokens.vdate")),
			expansions: () => [
				token("{{VDATE:date,YYYY-MM-DD}}", t("formatTokens.vdateExampleNamed")),
				token("{{VDATE:date,YYYY-MM-DD|today}}", t("formatTokens.vdateExampleToday")),
				token("{{VDATE:dueDate,YYYY-MM-DD|next monday}}", t("formatTokens.vdateExampleMonday")),
				token("{{VDATE:dueDate,YYYY-MM-DD|optional}}", t("formatTokens.vdateExampleOptional")),
				token(
					"{{VDATE:date,dddd, MMMM Do, YYYY|case:lower}}",
					t("formatTokens.vdateExampleCase"),
				),
			],
		},
		{
			regex: FIELD_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{FIELD:}}", t("formatTokens.field")),
		},
		{
			regex: PROPERTY_SYNTAX_SUGGEST_REGEX,
			// Resolves only in property Capture formats (hard error elsewhere).
			contexts: ["noteContent", "propertyValue"],
			suggestion: token("{{PROPERTY}}", t("formatTokens.property")),
		},
		{
			regex: CURSOR_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent"],
			suggestion: token("{{CURSOR}}", t("formatTokens.cursor")),
		},
		{
			regex: FILE_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{FILE:}}", t("formatTokens.file")),
			expansions: ({ context }) => {
				const rows = [
					token("{{FILE:<folder>}}", t("formatTokens.fileExampleFolder")),
				];
				// |link and |path insert characters that are invalid in a file name,
				// and |optional permits an all-optional name resolving to nothing,
				// which is rejected at creation time.
				if (!PATH_CONTEXTS.includes(context)) {
					rows.push(
						token("{{FILE:<folder>|link}}", t("formatTokens.fileExampleLink")),
						token("{{FILE:<folder>|path}}", t("formatTokens.fileExamplePath")),
						token("{{FILE:<folder>|type:image|link}}", t("formatTokens.fileExampleImage")),
						token("{{FILE:<folder>|optional}}", t("formatTokens.fileExampleOptional")),
					);
				}
				rows.push(
					token("{{FILE:<folder>|custom}}", t("formatTokens.fileExampleCustom")),
				);
				return rows;
			},
		},
		{
			regex: MATH_VALUE_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{MVALUE}}", t("formatTokens.mvalue")),
		},

		// == Dates ==
		{
			regex: DATE_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{DATE}}", t("formatTokens.date")),
		},
		{
			regex: DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{DATE:}}", t("formatTokens.dateFormat")),
			// Moment format strings are the one part of the syntax nobody guesses,
			// so these show what they render to right now rather than a sample that
			// would go stale in the source.
			expansions: ({ formatDate }) => [
				...["YYYY-MM-DD", "MMMM Do, YYYY", "ddd D MMM", "gggg-[W]ww"].map((fmt) =>
					token(`{{DATE:${fmt}}}`, formatDate(fmt)),
				),
				token("{{DATE+7}}", t("formatTokens.datePlusDays")),
				token(
					"{{DATE:YYYY-MM-DD|startof:week}}",
					t("formatTokens.dateStartOf"),
				),
				token(
					"{{DATE:dddd, MMMM Do, YYYY|case:lower}}",
					t("formatTokens.dateCaseLower"),
				),
			],
		},
		{
			regex: TIME_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{TIME}}", t("formatTokens.time")),
		},
		{
			regex: TIME_FORMAT_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{TIME:}}", t("formatTokens.timeFormat")),
			expansions: () => [
				token("{{TIME:A|case:lower}}", t("formatTokens.timeCaseLower")),
			],
		},
		{
			regex: DAILY_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{DAILY}}", t("formatTokens.daily")),
		},
		{
			regex: DAILY_SYNTAX_SUGGEST_REGEX,
			// A link is content; in a path it would name a file "[[...]]".
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{DAILY|link}}", t("formatTokens.dailyLink")),
		},
		{
			regex: WEEKLY_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{WEEKLY}}", t("formatTokens.weekly")),
		},
		{
			regex: WEEKLY_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{WEEKLY|link}}", t("formatTokens.weeklyLink")),
		},
		{
			regex: MONTHLY_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{MONTHLY}}", t("formatTokens.monthly")),
		},
		{
			regex: MONTHLY_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{MONTHLY|link}}", t("formatTokens.monthlyLink")),
		},
		{
			regex: QUARTERLY_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{QUARTERLY}}", t("formatTokens.quarterly")),
		},
		{
			regex: QUARTERLY_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{QUARTERLY|link}}", t("formatTokens.quarterlyLink")),
		},
		{
			regex: YEARLY_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{YEARLY}}", t("formatTokens.yearly")),
		},
		{
			regex: YEARLY_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{YEARLY|link}}", t("formatTokens.yearlyLink")),
		},

		// == The note you ran QuickAdd from ==
		{
			regex: LINKCURRENT_SYNTAX_SUGGEST_REGEX,
			// Left literal by formatFileName, so a capture target would be named
			// "[[...]]", so it is offered only where a link is content.
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{LINKCURRENT}}", t("formatTokens.linkCurrent")),
		},
		{
			regex: LINKSECTION_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{LINKSECTION}}", t("formatTokens.linkSection")),
		},
		{
			regex: FILENAMECURRENT_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "captureTarget", "fileName", "lineTarget"],
			suggestion: token("{{FILENAMECURRENT}}", t("formatTokens.fileNameCurrent")),
		},
		{
			// formatLocationString deliberately leaves this literal, and an empty
			// selector would match the first line, so it is withheld there.
			regex: FOLDERCURRENT_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "captureTarget"],
			suggestion: token("{{FOLDERCURRENT}}", t("formatTokens.folderCurrent")),
		},
		{
			// In a template file name the full path would nest under the configured
			// target folder ("Notes/Projects/Alpha/Note.md"), so only the leaf form
			// is offered there.
			regex: FOLDERCURRENT_SYNTAX_SUGGEST_REGEX,
			contexts: ["fileName"],
			suggestion: token("{{FOLDERCURRENT|name}}", t("formatTokens.folderCurrentName")),
		},
		{
			regex: SELECTED_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{SELECTED}}", t("formatTokens.selected")),
		},

		// == The note being created ==
		{
			// Throws in every path context: the title is derived from the path.
			regex: TITLE_SYNTAX_SUGGEST_REGEX,
			contexts: ["noteContent", "propertyValue", "lineTarget"],
			suggestion: token("{{TITLE}}", t("formatTokens.title")),
		},
		{
			// The bare {{FOLDER}} expands to the full target path, so "{{FOLDER}} -
			// Note" under Projects/Acme would yield "Projects/Acme/Projects/Acme -
			// Note.md". The leaf form avoids that duplicated segment.
			regex: FOLDER_SYNTAX_SUGGEST_REGEX,
			contexts: ["fileName"],
			suggestion: token("{{FOLDER|name}}", t("formatTokens.folderName")),
		},

		// == Other content ==
		{
			regex: CLIPBOARD_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{CLIPBOARD}}", t("formatTokens.clipboard")),
		},
		{
			regex: TEMPLATE_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{TEMPLATE:}}", t("formatTokens.template")),
			expansions: ({ templatePaths }) =>
				templatePaths.map((path) =>
					token(`{{TEMPLATE:${path}}}`, t("formatTokens.templatePath")),
				),
		},
		{
			regex: MACRO_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{MACRO:}}", t("formatTokens.macro")),
			expansions: ({ macroNames }) => [
				...macroNames.map((name) => token(`{{MACRO:${name}}}`, t("formatTokens.macroNamed", { name }))),
				token("{{MACRO:MyMacro|label:Label}}", t("formatTokens.macroLabel")),
			],
		},
		{
			regex: GLOBAL_VAR_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{GLOBAL_VAR:}}", t("formatTokens.globalVar")),
			expansions: ({ globalVariableNames }) =>
				globalVariableNames.map((name) =>
					token(`{{GLOBAL_VAR:${name}}}`, t("formatTokens.globalVarNamed", { name })),
				),
		},
		{
			regex: RANDOM_SYNTAX_SUGGEST_REGEX,
			contexts: ALL,
			suggestion: token("{{RANDOM:}}", t("formatTokens.random")),
		},
	];
}

/**
 * Casing styles completed after `|case:` inside a supported token. These are
 * bare fragments, not tokens, so each one shows what it does to a title rather
 * than pretending to be insertable syntax on its own.
 *
 * A FUNCTION for the same reason the token list is: the slug row's trailing
 * note is localized, and a module-level constant would freeze English in.
 */
export function caseStyleSuggestions(): readonly FormatTokenSuggestion[] {
	return [
		{ insert: "kebab", description: "my-note-title", caretOffset: 0, isFragment: true },
		{ insert: "snake", description: "my_note_title", caretOffset: 0, isFragment: true },
		{ insert: "camel", description: "myNoteTitle", caretOffset: 0, isFragment: true },
		{ insert: "pascal", description: "MyNoteTitle", caretOffset: 0, isFragment: true },
		{ insert: "title", description: "My Note Title", caretOffset: 0, isFragment: true },
		{ insert: "lower", description: "my note title", caretOffset: 0, isFragment: true },
		{ insert: "upper", description: "MY NOTE TITLE", caretOffset: 0, isFragment: true },
		{ insert: "slug", description: `my-note-title, ${t("formatTokens.caseSlug")}`, caretOffset: 0, isFragment: true },
	];
}

/** Entries offered in a given field, in display order. */
export function entriesForContext(
	context: FormatSuggestContext,
): readonly FormatTokenEntry[] {
	return buildFormatTokenEntries().filter((entry) => entry.contexts.includes(context));
}
