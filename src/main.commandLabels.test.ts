import { describe, expect, it } from "vitest";
import { quickAddCommandLabels } from "./commandLabels";
import { setLocale } from "./i18n";

describe("QuickAdd command labels", () => {
	it("keeps built-in command labels free of the plugin name", () => {
		setLocale("en");
		expect(quickAddCommandLabels()).toEqual({
			run: "Run",
			runTemplateFromFolder: "New note from template",
			applyTemplate: "Apply template to active note",
			reloadDev: "Reload (dev)",
			openSettings: "Open settings",
			openAISettings: "Open AI Assistant settings",
			resumePrompt: "Return to prompt",
		});

		for (const label of Object.values(quickAddCommandLabels())) {
			expect(label).not.toContain("QuickAdd");
		}
	});
});
