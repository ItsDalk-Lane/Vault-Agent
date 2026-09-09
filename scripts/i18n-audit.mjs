// One-off i18n audit: find user-visible English literals in src/.
// Usage: node scripts/i18n-audit.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const files = [];
(function walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name === "locales") continue;
			walk(p);
		} else if (
			[".ts", ".svelte"].includes(extname(e.name)) &&
			!/\.(test|spec)\./.test(e.name) &&
			!e.name.endsWith(".d.ts")
		) {
			files.push(p);
		}
	}
})("src");

const Q = String.fromCharCode(34); // double quote
const BT = String.fromCharCode(96); // backtick
const pats = [
	["Notice-literal", new RegExp(`new Notice\\(\\s*(${Q}|${BT})([^${Q}${BT}]{4,})`, "g")],
	["Setting-setters", new RegExp(`\\.set(Name|Desc|Placeholder|ButtonText|Tooltip|Title)\\(\\s*(${Q}|${BT})([^${Q}${BT}]{3,})`, "g")],
	["createEl-text", new RegExp(`create(?:El|Div|Span)\\(\\s*(${Q}[a-z]+${Q}\\s*,)?\\s*\\{[^}]*?text:\\s*(${Q}|${BT})([^${Q}${BT}]{3,})`, "g")],
	["attr-english", new RegExp(`(aria-label|placeholder|title|data-label|alt)=(${Q}|${BT})([^${Q}${BT}{]{3,})`, "g")],
	["throw-Error", new RegExp(`throw new Error\\(\\s*(${Q}|${BT})([^${Q}${BT}]{10,})`, "g")],
	["heading-text", new RegExp(`createEl\\(\\s*${Q}h[1-6]${Q}\\s*,\\s*\\{[^}]*?text:\\s*(${Q}|${BT})([^${Q}${BT}]{2,})`, "g")],
	["prompt-api", new RegExp(`(?:GenericSuggester\\.Suggest|GenericYesNoPrompt\\.Prompt|GenericInputPrompt\\.Prompt|GenericInfoDialog\\.Display|SpeechModal)\\([^)]{0,120}?(${Q}|${BT})([A-Z][^${Q}${BT}]{5,})`, "g")],
];

for (const [name, re] of pats) {
	console.log(`==== ${name} ====`);
	for (const f of files) {
		const src = readFileSync(f, "utf8");
		const lines = src.split("\n");
		let m;
		while ((m = re.exec(src)) !== null) {
			const lineNo = src.slice(0, m.index).split("\n").length;
			const trimmed = (lines[lineNo - 1] ?? "").trim();
			if (
				trimmed.startsWith("//") ||
				trimmed.startsWith("*") ||
				trimmed.startsWith("/*")
			)
				continue;
			console.log(`${f}:${lineNo}: ${trimmed.slice(0, 160)}`);
		}
	}
}
