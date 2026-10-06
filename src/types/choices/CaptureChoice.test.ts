import { describe, expect, it } from "vitest";
import { CaptureChoice } from "./CaptureChoice";

describe("CaptureChoice.Load", () => {
	it("migrates legacy active-file prepend to bottom mode", () => {
		const legacy = new CaptureChoice("Legacy");
		legacy.captureToActiveFile = true;
		legacy.prepend = true;
		legacy.activeFileWritePosition = "cursor";
		legacy.insertAfter.enabled = false;
		legacy.newLineCapture.enabled = false;

		const loaded = CaptureChoice.Load(legacy as any);

		expect(loaded.activeFileWritePosition).toBe("bottom");
		expect(loaded.prepend).toBe(false);
	});

	it("clears legacy prepend flag when active-file write position is top", () => {
		const legacy = new CaptureChoice("LegacyTop");
		legacy.captureToActiveFile = true;
		legacy.prepend = true;
		legacy.activeFileWritePosition = "top";
		legacy.insertAfter.enabled = false;
		legacy.newLineCapture.enabled = false;

		const loaded = CaptureChoice.Load(legacy as any);

		expect(loaded.activeFileWritePosition).toBe("top");
		expect(loaded.prepend).toBe(false);
	});

	it("does not migrate when capture is not active-file", () => {
		const choice = new CaptureChoice("NonActive");
		choice.captureToActiveFile = false;
		choice.prepend = true;
		choice.activeFileWritePosition = "cursor";

		const loaded = CaptureChoice.Load(choice as any);

		expect(loaded.activeFileWritePosition).toBe("cursor");
		expect(loaded.prepend).toBe(true);
	});

	it("normalizes unknown write position values", () => {
		const choice = new CaptureChoice("Invalid") as any;
		choice.activeFileWritePosition = "invalid-value";

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.activeFileWritePosition).toBe("cursor");
	});

	it("adds default insert-before settings to legacy choices", () => {
		const choice = new CaptureChoice("Legacy") as any;
		delete choice.insertBefore;

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertBefore).toEqual({
			enabled: false,
			before: "",
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		});
	});

	it("backfills a safe ordering descriptor for an ordered choice missing orderBy", () => {
		const choice = new CaptureChoice("Ordered") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "ordered";
		delete choice.insertAfter.orderBy;

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.orderBy).toEqual({
			by: "insertion",
			direction: "desc",
			unparseable: "bottom",
		});
	});

	it("preserves an existing orderBy descriptor on an ordered choice", () => {
		const choice = new CaptureChoice("OrderedDate") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "ordered";
		choice.insertAfter.orderBy = {
			by: "date",
			direction: "desc",
			dateFormat: "YYYY-MM-DD",
			unparseable: "top",
		};

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.orderBy).toEqual({
			by: "date",
			direction: "desc",
			dateFormat: "YYYY-MM-DD",
			unparseable: "top",
		});
	});

	it("clears inline on an ordered choice (enforces the UI invariant at load)", () => {
		const choice = new CaptureChoice("InlineOrdered") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.inline = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "ordered";

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.inline).toBe(false);
		expect(loaded.insertAfter.orderBy).toEqual({
			by: "insertion",
			direction: "desc",
			unparseable: "bottom",
		});
	});

	it("does not add orderBy to non-ordered choices", () => {
		const choice = new CaptureChoice("Top") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "top";

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.orderBy).toBeUndefined();
	});

	it("round-trips property-capture shapes through an export/import cycle", () => {
		const multi = new CaptureChoice("Multi") as any;
		multi.propertyCapture = [
			{ property: { kind: "named", format: "status" }, action: "set", createIfMissing: true, valueFormat: "{{VALUE:a}}" },
			{ property: { kind: "prompt" }, action: "addToList", createIfMissing: false },
		];
		const imported = CaptureChoice.Load(JSON.parse(JSON.stringify(multi)));
		expect(imported.propertyCapture).toEqual([
			{ property: { kind: "named", format: "status" }, action: "set", createIfMissing: true, valueFormat: "{{VALUE:a}}" },
			{ property: { kind: "prompt" }, action: "addToList", createIfMissing: false },
		]);

		// A one-row list folds back to the legacy single object on load.
		const single = new CaptureChoice("One") as any;
		single.propertyCapture = [{ property: { kind: "named", format: "x" }, action: "set", createIfMissing: true }];
		expect(CaptureChoice.Load(JSON.parse(JSON.stringify(single))).propertyCapture)
			.toEqual({ property: { kind: "named", format: "x" }, action: "set", createIfMissing: true });

		// A blank valueFormat means "fall back" and is dropped, not persisted.
		const blank = new CaptureChoice("Blank") as any;
		blank.propertyCapture = { property: { kind: "named", format: "x" }, action: "set", createIfMissing: true, valueFormat: "  " };
		expect(CaptureChoice.Load(blank).propertyCapture)
			.toEqual({ property: { kind: "named", format: "x" }, action: "set", createIfMissing: true });

		// An empty array collapses to the field being absent entirely.
		const empty = new CaptureChoice("Empty") as any;
		empty.propertyCapture = [];
		expect(CaptureChoice.Load(empty).propertyCapture).toBeUndefined();
	});
});

// #2007: most After-line captures append to the section and create a missing
// heading, so new Captures start that way. Saved choices keep their values.
describe("CaptureChoice After line defaults", () => {
	it("starts a new Capture appending to the section and creating a missing heading at the top", () => {
		const { insertAfter } = new CaptureChoice("New");

		expect(insertAfter).toMatchObject({
			enabled: false,
			insertAtEnd: true,
			createIfNotFound: true,
			createIfNotFoundLocation: "top",
		});
	});

	it("leaves a saved choice's After line settings as they were", () => {
		const saved = JSON.parse(JSON.stringify(new CaptureChoice("Saved")));
		saved.insertAfter = { enabled: true, after: "## Log", insertAtEnd: false, createIfNotFound: false };

		const loaded = CaptureChoice.Load(saved);

		expect(loaded.insertAfter.insertAtEnd).toBe(false);
		expect(loaded.insertAfter.createIfNotFound).toBe(false);
	});
});
