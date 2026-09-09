// One-off: merge an .i18n-batch/<X>.json fragment into src/i18n/locales/{en,zh-CN}.ts
// inside the `errors` block. Idempotent: keys already present (followed by ":") are skipped.
// Usage: node scripts/merge-batch.mjs H
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const name = process.argv[2];
const batchPath = `.i18n-batch/${name}.json`;
if (!existsSync(batchPath)) {
	console.error(`missing ${batchPath}`);
	process.exit(1);
}
const batch = JSON.parse(readFileSync(batchPath, "utf8"));

function indentToDepth(indent) {
	return indent.length;
}

function mergeIntoLocale(file, localeKey, varName) {
	let src = readFileSync(file, "utf8");
	const entries = batch[localeKey]?.errors ?? {};
	const added = [];
	for (const [key, value] of Object.entries(entries)) {
		// Skip keys already present in this locale file.
		const already = new RegExp(`^\\t{2}${key}:`, "m").test(src);
		if (already) continue;
		// Escape for a TS double-quoted string.
		const escaped = String(value)
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\n/g, "\\n");
		// Insert before the errors block's closing "\t},".
		const marker = "\n\t},\n} as const;";
		if (!src.includes(marker)) {
			console.error(`${file}: cannot find errors block end`);
			process.exit(1);
		}
		src = src.replace(marker, `\n\t\t${key}: "${escaped}",${marker}`);
		added.push(key);
	}
	writeFileSync(file, src);
	console.log(`${localeKey}: +${added.length} keys -> ${file}`);
	return added;
}

mergeIntoLocale("src/i18n/locales/en.ts", "en", "en");
mergeIntoLocale("src/i18n/locales/zh-CN.ts", "zh-CN", "zhCN");
