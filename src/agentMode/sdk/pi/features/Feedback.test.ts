import {
  FeedbackService,
  type FeedbackErrorEvent,
  type FeedbackPersistedState,
  type FeedbackReporter,
  type FeedbackStore,
} from "@/agentMode/sdk/pi/features/Feedback";
import type { FeedbackDraft } from "@/agentMode/session/feedback/feedbackOffer";

// Feedback offers come from real repeated errors or an explicit user action (never a model call),
// are redacted before becoming a card, persist dismiss/reported/turn-off state across restarts, and
// never upload before the user confirms a preview:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryFeedbackStore implements FeedbackStore {
  state: FeedbackPersistedState = { turnedOff: false, offers: [] };
  saveCount = 0;

  async load(): Promise<FeedbackPersistedState> {
    return {
      turnedOff: this.state.turnedOff,
      offers: this.state.offers.map((stored) => ({
        ...stored,
        offer: {
          ...stored.offer,
          draft: { ...stored.offer.draft },
          evidence: { ...stored.offer.evidence },
        },
      })),
    };
  }

  async save(state: FeedbackPersistedState): Promise<void> {
    this.saveCount += 1;
    this.state = {
      turnedOff: state.turnedOff,
      offers: state.offers.map((stored) => ({
        ...stored,
        offer: {
          ...stored.offer,
          draft: { ...stored.offer.draft },
          evidence: { ...stored.offer.evidence },
        },
      })),
    };
  }
}

class FakeReporter implements FeedbackReporter {
  readonly submissions: Array<{
    draft: FeedbackDraft;
    evidence: unknown;
    note: string;
  }> = [];
  fail = false;

  async submit(payload: {
    draft: FeedbackDraft;
    evidence: unknown;
    note: string;
  }): Promise<{ reportId: string; issueUrl: string }> {
    this.submissions.push(payload);
    if (this.fail) throw new Error("upload unavailable");
    return { reportId: "report-1", issueUrl: "https://example.test/issues/1" };
  }
}

interface Harness {
  readonly service: FeedbackService;
  readonly store: MemoryFeedbackStore;
  readonly reporter: FakeReporter;
}

function harness(options: { reporter?: boolean; now?: number } = {}): Harness {
  const store = new MemoryFeedbackStore();
  const reporter = new FakeReporter();
  const service = new FeedbackService({
    store,
    ...(options.reporter === false ? {} : { reporter }),
    redaction: {
      privatePathPrefixes: ["/vault", "/Users/example"],
      secretValues: ["sk-live-secret"],
      privateSnippets: ["the private note body"],
    },
    backendId: "pi",
    model: "provider/model",
    sessionId: "session-1",
    now: () => options.now ?? 1_000,
  });
  return { service, store, reporter };
}

function providerError(overrides: Partial<FeedbackErrorEvent> = {}): FeedbackErrorEvent {
  return {
    kind: "provider_error",
    code: "PROVIDER_TIMEOUT",
    message: "provider timed out while streaming",
    runId: "run-1",
    afterUserMessageId: "user-2",
    occurredAtMs: 1_000,
    ...overrides,
  };
}

async function showOffer(harnessed: Harness): Promise<string> {
  await harnessed.service.initialize();
  await harnessed.service.observeError(providerError());
  const creation = await harnessed.service.observeError(providerError());
  if (!creation.shown) throw new Error("the offer was not shown");
  if (creation.offer.id === undefined) throw new Error("the offer has no id");
  return creation.offer.id;
}

describe("FeedbackService", () => {
  describe("observeError()", () => {
    it("raises a product-named card only after the same error repeats https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = harness();
      await harnessed.service.initialize();

      const first = await harnessed.service.observeError(providerError());
      const different = await harnessed.service.observeError(
        providerError({ code: "PROVIDER_OVERLOADED" })
      );
      const second = await harnessed.service.observeError(
        providerError({ code: "PROVIDER_OVERLOADED" })
      );

      expect(first).toMatchObject({ shown: false, reason: "below_threshold" });
      expect(different).toMatchObject({ shown: false, reason: "below_threshold" });
      expect(second).toMatchObject({ shown: true });
      if (!second.shown) return;
      expect(second.offer).toMatchObject({
        status: "open",
        afterUserMessageId: "user-2",
        evidence: {
          backendId: "pi",
          source: "pi",
          runId: "run-1",
          errorCodes: ["PROVIDER_OVERLOADED"],
        },
      });
      expect(second.offer.draft.whatHappened).toContain("provider timed out");
      expect(second.offer.draft.title).toBe("Vault Agent provider_error: PROVIDER_OVERLOADED");
      expect(harnessed.store.state.offers).toHaveLength(1);
      expect(harnessed.store.saveCount).toBeGreaterThan(0);
    });

    it("redacts secrets, private paths and note content from the draft", async () => {
      const harnessed = harness();
      await harnessed.service.initialize();

      await harnessed.service.observeError(
        providerError({
          message:
            "boom sk-live-secret token=sk-live-secret path=/vault/notes/private.md contains the private note body",
        })
      );
      const creation = await harnessed.service.observeError(
        providerError({
          message:
            "boom sk-live-secret token=sk-live-secret path=/vault/notes/private.md contains the private note body",
        })
      );

      expect(creation.shown).toBe(true);
      if (!creation.shown) return;
      const draftText = JSON.stringify(creation.offer.draft);
      expect(draftText).not.toContain("sk-live-secret");
      expect(draftText).not.toContain("/vault/notes/private.md");
      expect(draftText).not.toContain("the private note body");
      expect(creation.offer.draft.userSaid).toBe("");
    });

    it("does not offer after feedback is turned off", async () => {
      const harnessed = harness();
      await harnessed.service.initialize();
      await harnessed.service.turnOff();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(await harnessed.service.observeError(providerError())).toEqual({
          shown: false,
          reason: "turned_off",
        });
      }
      expect(harnessed.store.state.offers).toEqual([]);
      expect(harnessed.store.state.turnedOff).toBe(true);
    });
  });

  describe("dismiss()", () => {
    it("persists dismissal and never re-offers the same error after a restart", async () => {
      const harnessed = harness();
      const offerId = await showOffer(harnessed);

      expect(await harnessed.service.dismiss(offerId)).toBe(true);

      const restarted = new FeedbackService({
        store: harnessed.store,
        reporter: harnessed.reporter,
        now: () => 2_000,
      });
      await restarted.initialize();
      expect(restarted.getActiveOffer()).toBeNull();
      expect(restarted.getOffers()[0]).toMatchObject({ status: "dismissed" });

      await restarted.observeError(providerError());
      const again = await restarted.observeError(providerError());
      expect(again).toMatchObject({ shown: false, reason: "already_offered" });
      expect(restarted.getOffers()).toHaveLength(1);
    });
  });

  describe("report()", () => {
    it("uploads nothing before the user confirms, then sends only the confirmed preview", async () => {
      const harnessed = harness();
      const offerId = await showOffer(harnessed);
      expect(harnessed.reporter.submissions).toEqual([]);

      const unchecked = await harnessed.service.report(offerId, {
        confirmedByUser: false,
        includeEvidence: true,
      });
      expect(unchecked).toEqual({ status: "not_uploaded" });
      expect(harnessed.reporter.submissions).toEqual([]);

      const preview = harnessed.service.previewReport(offerId, false);
      expect(preview).not.toBeNull();
      expect(preview?.evidence).toBeNull();
      expect(preview?.note).not.toContain("Evidence:");

      const reported = await harnessed.service.report(offerId, {
        confirmedByUser: true,
        includeEvidence: false,
      });
      expect(reported).toMatchObject({ status: "reported", report: { reportId: "report-1" } });
      expect(harnessed.reporter.submissions).toHaveLength(1);
      expect(harnessed.reporter.submissions[0]?.evidence).toBeNull();
      expect(harnessed.reporter.submissions[0]?.note).not.toContain("Evidence:");

      expect(harnessed.store.state.offers[0]?.offer).toMatchObject({
        status: "reported",
        report: { reportId: "report-1" },
      });
      expect(
        await harnessed.service.report(offerId, { confirmedByUser: true, includeEvidence: true })
      ).toEqual({ status: "already_reported" });
      expect(harnessed.reporter.submissions).toHaveLength(1);
    });

    it("includes sanitized evidence only when the user checked it", async () => {
      const harnessed = harness();
      const offerId = await showOffer(harnessed);

      await harnessed.service.report(offerId, { confirmedByUser: true, includeEvidence: true });

      const payload = harnessed.reporter.submissions[0];
      expect(payload?.evidence).toMatchObject({
        backendId: "pi",
        model: "provider/model",
        sessionId: "session-1",
        source: "pi",
      });
      expect(payload?.note).toContain("Evidence:");
    });

    it("reports unavailable without an uploader and failed when the upload rejects", async () => {
      const noUploader = harness({ reporter: false });
      const noUploaderOffer = await showOffer(noUploader);
      expect(
        await noUploader.service.report(noUploaderOffer, {
          confirmedByUser: true,
          includeEvidence: false,
        })
      ).toEqual({ status: "unavailable" });
      expect(noUploader.service.getActiveOffer()?.status).toBe("open");

      const failing = harness();
      const failingOffer = await showOffer(failing);
      failing.reporter.fail = true;
      expect(
        await failing.service.report(failingOffer, {
          confirmedByUser: true,
          includeEvidence: false,
        })
      ).toMatchObject({ status: "failed", error: "upload unavailable" });
      expect(failing.service.getOffers()[0]?.status).toBe("open");
    });
  });

  describe("offerFromUser()", () => {
    it("shows a sanitized user-report card without waiting for repeated errors", async () => {
      const harnessed = harness();
      await harnessed.service.initialize();

      const creation = await harnessed.service.offerFromUser({
        draft: {
          title: "The plan card froze at /vault/notes/private.md",
          whatHappened: "Opening the card froze the chat.",
          userSaid: "it froze",
          repro: "1. Open a plan card.",
        },
        afterUserMessageId: "user-9",
      });

      expect(creation.shown).toBe(true);
      if (!creation.shown) return;
      expect(creation.offer.draft.title).not.toContain("/vault/notes/private.md");
      expect(creation.offer.afterUserMessageId).toBe("user-9");
      const duplicate = await harnessed.service.offerFromUser({
        draft: {
          title: "The plan card froze at /vault/notes/private.md",
          whatHappened: "Opening the card froze the chat.",
          userSaid: "it froze",
          repro: "1. Open a plan card.",
        },
      });
      expect(duplicate.shown).toBe(false);
    });
  });

  describe("turnOn()", () => {
    it("restores offers only after feedback is explicitly turned back on", async () => {
      const harnessed = harness();
      await harnessed.service.initialize();
      await harnessed.service.turnOff();

      const restarted = new FeedbackService({
        store: harnessed.store,
        reporter: harnessed.reporter,
        now: () => 2_000,
      });
      await restarted.initialize();
      expect(restarted.isTurnedOff()).toBe(true);
      expect(await restarted.observeError(providerError())).toEqual({
        shown: false,
        reason: "turned_off",
      });

      await restarted.turnOn();
      await restarted.observeError(providerError());
      const creation = await restarted.observeError(providerError());
      expect(creation.shown).toBe(true);
    });
  });
});
