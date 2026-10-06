import { FuzzySuggestModal, setIcon, type App, type FuzzyMatch } from "obsidian";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { promptCancelled } from "src/errors/UserCancelError";
import {
	existingNoteActionVerb,
	getExistingNoteAction,
} from "src/template/fileExistsPolicy";
import { t } from "../i18n";
import {
	createTemplateNoteSelection,
	decodeTemplateNoteSelection,
	normalizedKey,
	type DiscoveryCandidate,
	type TemplateNoteSelection,
} from "src/utils/templateNoteDiscovery";
import { renderNotePathSuggestion } from "./InputSuggester/renderNotePathSuggestion";

type DiscoveryRow =
	| { kind: "candidate"; candidate: DiscoveryCandidate }
	| { kind: "create"; title: string };

export class TemplateNoteDiscoveryModal extends FuzzySuggestModal<DiscoveryRow> {
	readonly promise: Promise<TemplateNoteSelection>;
	private resolvePromise!: (row: DiscoveryRow) => void;
	private rejectPromise!: (reason: unknown) => void;
	private settled = false;
	private readonly rows: DiscoveryRow[];
	private readonly action: string;
	private readonly isOpenAction: boolean;

	constructor(app: App, choice: ITemplateChoice, candidates: DiscoveryCandidate[]) {
		super(app);
		// `qa-suggester` is a stable hook for user CSS snippets (see SuggesterModal).
		this.modalEl.addClass("qa-suggester");
		this.rows = candidates.map(candidate => ({ kind: "candidate", candidate }));
		this.action = existingNoteActionVerb(choice.existingNoteAction);
		// Compare the action ID, never the localized verb string.
		this.isOpenAction = getExistingNoteAction(choice.existingNoteAction) === "open";
		this.promise = new Promise<DiscoveryRow>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		}).then(row => row.kind === "candidate"
			? decodeTemplateNoteSelection(row.candidate.item)
			: createTemplateNoteSelection(row.title));
		this.setPlaceholder(t("templateDiscovery.searchOrCreate", { name: choice.name }));
		this.open();
	}

	getItems(): DiscoveryRow[] { return this.rows; }

	getItemText(row: DiscoveryRow): string {
		return row.kind === "candidate" ? row.candidate.display : row.title;
	}

	getSuggestions(query: string): FuzzyMatch<DiscoveryRow>[] {
		const title = query.trim();
		const key = normalizedKey(title);
		const exact = (row: DiscoveryRow) => row.kind === "candidate" && row.candidate.exactKeys.includes(key);
		const suggestions = super.getSuggestions(title)
			.sort((a, b) => Number(exact(b.item)) - Number(exact(a.item)));
		if (title && !this.rows.some(exact)) {
			suggestions.unshift({ item: { kind: "create", title }, match: { score: Number.NEGATIVE_INFINITY, matches: [] } });
		}
		return suggestions;
	}

	renderSuggestion({ item: row }: FuzzyMatch<DiscoveryRow>, el: HTMLElement): void {
		if (row.kind === "candidate" && row.candidate.renderPath) {
			const candidate = row.candidate;
			renderNotePathSuggestion(el, row.candidate.renderPath);
			if (!this.isOpenAction) el.querySelector(".suggestion-title")?.prepend(`${this.action}: `);
			if (candidate.renderAlias) el.querySelector(".suggestion-content")?.createDiv({ cls: "suggestion-note", text: t("templateDiscovery.aliasLabel", { alias: candidate.renderAlias }) });
			return;
		}
		el.addClass("mod-complex");
		const content = el.createDiv({ cls: "suggestion-content" });
		content.createDiv({ cls: "suggestion-title", text: row.kind === "create" ? t("templateDiscovery.createNewNote", { title: row.title }) : row.candidate.unresolvedTitle ?? row.candidate.title });
		if (row.kind === "create") {
			setIcon(el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" }), "file-plus");
		} else {
			content.createDiv({ cls: "suggestion-note", text: t("templateDiscovery.unresolvedLink") });
		}
	}

	selectSuggestion(value: FuzzyMatch<DiscoveryRow>, event: MouseEvent | KeyboardEvent): void {
		this.settled = true;
		super.selectSuggestion(value, event);
	}

	onChooseItem(row: DiscoveryRow): void {
		this.settled = true;
		this.resolvePromise(row);
	}

	onClose(): void {
		super.onClose();
		if (!this.settled) this.rejectPromise(promptCancelled());
	}
}
