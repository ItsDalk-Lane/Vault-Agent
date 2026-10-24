import type {
  FeedbackDraft,
  FeedbackEvidence,
  FeedbackOffer,
} from "@/agentMode/session/feedback/feedbackOffer";

// A feedback offer is raised only by a real repeated provider/tool error or an explicit user action,
// never by a model call. Drafts are redacted before they become a card, dismiss/reported/turn-off
// state persists across restarts, and nothing is uploaded before the user confirms a preview. The
// existing FeedbackCard/ReportIssueModal shapes are reused and the old feedback MCP server is not
// involved:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type FeedbackErrorKind = "provider_error" | "tool_error";

export interface FeedbackErrorEvent {
  readonly kind: FeedbackErrorKind;
  readonly code: string;
  readonly message?: string;
  readonly runId?: string | null;
  readonly afterUserMessageId?: string | null;
  readonly occurredAtMs?: number;
  readonly privateSnippets?: readonly string[];
  readonly secretValues?: readonly string[];
}

export interface FeedbackRedactionOptions {
  readonly secretValues?: readonly string[];
  readonly privateSnippets?: readonly string[];
  readonly privatePathPrefixes?: readonly string[];
  readonly maxLength?: number;
}

export interface StoredFeedbackOffer {
  readonly offer: FeedbackOffer;
  readonly dedupeKey: string;
  readonly runId: string | null;
  readonly errorCodes: readonly string[];
}

export interface FeedbackPersistedState {
  readonly turnedOff: boolean;
  readonly offers: readonly StoredFeedbackOffer[];
}

export interface FeedbackStore {
  load(): Promise<FeedbackPersistedState>;
  save(state: FeedbackPersistedState): Promise<void>;
}

export interface FeedbackReporter {
  submit(payload: {
    readonly draft: FeedbackDraft;
    readonly evidence: FeedbackEvidence | null;
    readonly note: string;
  }): Promise<{ readonly reportId: string; readonly issueUrl: string }>;
}

export type FeedbackOfferCreation =
  | { readonly shown: true; readonly offer: FeedbackOffer }
  | {
      readonly shown: false;
      readonly reason: "turned_off" | "already_offered" | "below_threshold";
    };

export type FeedbackReportOutcome =
  | { readonly status: "reported"; readonly report: { reportId: string; issueUrl: string } }
  | { readonly status: "not_uploaded" }
  | { readonly status: "unavailable" }
  | { readonly status: "not_found" }
  | { readonly status: "already_reported" }
  | { readonly status: "failed"; readonly error: string };

export interface FeedbackReportPreview {
  readonly offerId: string;
  readonly draft: FeedbackDraft;
  readonly evidence: FeedbackEvidence | null;
  readonly note: string;
}

export interface FeedbackServiceOptions {
  readonly store: FeedbackStore;
  readonly reporter?: FeedbackReporter;
  readonly redaction?: FeedbackRedactionOptions;
  readonly backendId?: string;
  readonly model?: string | null;
  readonly sessionId?: string | null;
  readonly now?: () => number;
  readonly consecutiveThreshold?: number;
}

const DEFAULT_MAX_LENGTH = 500;
const DEFAULT_THRESHOLD = 2;

export class FeedbackService {
  readonly #store: FeedbackStore;
  readonly #reporter: FeedbackReporter | undefined;
  readonly #redaction: FeedbackRedactionOptions;
  readonly #backendId: string;
  readonly #model: string | null;
  readonly #sessionId: string | null;
  readonly #now: () => number;
  readonly #threshold: number;
  #state: FeedbackPersistedState = { turnedOff: false, offers: [] };
  #initialized = false;
  #lastErrorKey: string | null = null;
  #consecutive = 0;

  constructor(options: FeedbackServiceOptions) {
    this.#store = options.store;
    this.#reporter = options.reporter;
    this.#redaction = options.redaction ?? {};
    this.#backendId = options.backendId ?? "pi";
    this.#model = options.model ?? null;
    this.#sessionId = options.sessionId ?? null;
    this.#now = options.now ?? Date.now;
    this.#threshold = options.consecutiveThreshold ?? DEFAULT_THRESHOLD;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#state = await this.#store.load();
    this.#initialized = true;
  }

  async observeError(event: FeedbackErrorEvent): Promise<FeedbackOfferCreation> {
    await this.initialize();
    if (this.#state.turnedOff) return { shown: false, reason: "turned_off" };
    const errorKey = `${event.kind}:${event.code}`;
    if (this.#lastErrorKey === errorKey) {
      this.#consecutive += 1;
    } else {
      this.#lastErrorKey = errorKey;
      this.#consecutive = 1;
    }
    if (this.#consecutive < this.#threshold) return { shown: false, reason: "below_threshold" };
    const dedupeKey = `error:${errorKey}`;
    const existing = this.#state.offers.find((stored) => stored.dedupeKey === dedupeKey);
    if (existing !== undefined) return { shown: false, reason: "already_offered" };
    const extras: FeedbackRedactionOptions = {
      secretValues: event.secretValues,
      privateSnippets: event.privateSnippets,
    };
    const title = this.sanitize(`Vault Agent ${event.kind}: ${event.code}`, extras, 80);
    const whatHappened = this.sanitize(
      event.message !== undefined && event.message.length > 0
        ? event.message
        : `${event.kind} failed with code ${event.code}.`,
      extras,
      DEFAULT_MAX_LENGTH
    );
    const draft: FeedbackDraft = {
      title,
      whatHappened,
      userSaid: "",
      repro: "1. Run an agent turn on the provider. 2. The same error happened twice in a row.",
    };
    const offer = await this.createOffer(draft, dedupeKey, event);
    return { shown: true, offer };
  }

  async offerFromUser(input: {
    draft: FeedbackDraft;
    afterUserMessageId?: string | null;
    runId?: string | null;
  }): Promise<FeedbackOfferCreation> {
    await this.initialize();
    if (this.#state.turnedOff) return { shown: false, reason: "turned_off" };
    const draft: FeedbackDraft = {
      title: this.sanitize(input.draft.title, {}, 80),
      whatHappened: this.sanitize(input.draft.whatHappened, {}, DEFAULT_MAX_LENGTH),
      userSaid: this.sanitize(input.draft.userSaid, {}, DEFAULT_MAX_LENGTH),
      repro: this.sanitize(input.draft.repro, {}, DEFAULT_MAX_LENGTH),
    };
    const dedupeKey = `user:${draft.title}`;
    const existing = this.#state.offers.find((stored) => stored.dedupeKey === dedupeKey);
    if (existing !== undefined) return { shown: false, reason: "already_offered" };
    const offer = await this.createOffer(draft, dedupeKey, {
      kind: "tool_error",
      code: "user_report",
      runId: input.runId ?? null,
      afterUserMessageId: input.afterUserMessageId ?? null,
    });
    return { shown: true, offer };
  }

  async dismiss(offerId: string): Promise<boolean> {
    return this.updateStatus(offerId, { status: "dismissed" });
  }

  async turnOff(): Promise<void> {
    await this.initialize();
    this.#state = { ...this.#state, turnedOff: true };
    await this.persist();
  }

  async turnOn(): Promise<void> {
    await this.initialize();
    this.#state = { ...this.#state, turnedOff: false };
    await this.persist();
  }

  getOffers(): readonly FeedbackOffer[] {
    return this.#state.offers.map((stored) => stored.offer);
  }

  getActiveOffer(): FeedbackOffer | null {
    return this.#state.offers.find((stored) => stored.offer.status === "open")?.offer ?? null;
  }

  isTurnedOff(): boolean {
    return this.#state.turnedOff;
  }

  previewReport(offerId: string, includeEvidence: boolean): FeedbackReportPreview | null {
    const stored = this.#state.offers.find((entry) => entry.offer.id === offerId);
    if (stored === undefined) return null;
    const { draft } = stored.offer;
    const evidence = includeEvidence ? { ...stored.offer.evidence } : null;
    const note = [
      draft.title,
      "",
      `What happened: ${draft.whatHappened}`,
      "",
      `What the user said: ${draft.userSaid || "The user didn't comment."}`,
      "",
      `Steps to reproduce: ${draft.repro}`,
      ...(evidence !== null
        ? [
            "",
            `Evidence: backend ${evidence.backendId} · model ${evidence.model ?? "unknown"} · session ${evidence.sessionId ?? "unknown"} · ${evidence.raisedAt}`,
          ]
        : []),
    ].join("\n");
    return { offerId, draft, evidence, note };
  }

  async report(
    offerId: string,
    input: { confirmedByUser: boolean; includeEvidence: boolean }
  ): Promise<FeedbackReportOutcome> {
    await this.initialize();
    const stored = this.#state.offers.find((entry) => entry.offer.id === offerId);
    if (stored === undefined) return { status: "not_found" };
    if (stored.offer.status === "reported") return { status: "already_reported" };
    if (input.confirmedByUser !== true) return { status: "not_uploaded" };
    const preview = this.previewReport(offerId, input.includeEvidence);
    if (preview === null) return { status: "not_found" };
    if (this.#reporter === undefined) return { status: "unavailable" };
    try {
      const report = await this.#reporter.submit({
        draft: preview.draft,
        evidence: preview.evidence,
        note: preview.note,
      });
      await this.updateStatus(offerId, { status: "reported", report });
      return { status: "reported", report };
    } catch (thrown) {
      return {
        status: "failed",
        error: thrown instanceof Error ? thrown.message : String(thrown),
      };
    }
  }

  sanitize(text: string, extras: FeedbackRedactionOptions, maxLength: number): string {
    let output = text;
    const secretValues = [...(this.#redaction.secretValues ?? []), ...(extras.secretValues ?? [])];
    for (const secret of secretValues) {
      if (secret.length >= 4) output = output.split(secret).join("[redacted]");
    }
    const privateSnippets = [
      ...(this.#redaction.privateSnippets ?? []),
      ...(extras.privateSnippets ?? []),
    ];
    for (const snippet of privateSnippets) {
      if (snippet.length >= 4) output = output.split(snippet).join("[redacted content]");
    }
    const pathPrefixes = [
      ...(this.#redaction.privatePathPrefixes ?? []),
      ...(extras.privatePathPrefixes ?? []),
    ];
    for (const prefix of pathPrefixes) {
      if (prefix.length === 0) continue;
      output = output.split(prefix).join("[path]");
    }
    output = output.replace(
      /(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization)\s*[:=]\s*\S+/gi,
      "$1=[redacted]"
    );
    output = output.replace(/\s+/g, " ").trim();
    return output.slice(0, extras.maxLength ?? maxLength);
  }

  async createOffer(
    draft: FeedbackDraft,
    dedupeKey: string,
    source: {
      kind: FeedbackErrorKind;
      code: string;
      runId?: string | null;
      afterUserMessageId?: string | null;
      occurredAtMs?: number;
    }
  ): Promise<FeedbackOffer> {
    const raisedAtMs = source.occurredAtMs ?? this.#now();
    const offer: FeedbackOffer = {
      id: `feedback-${raisedAtMs}-${this.#state.offers.length + 1}`,
      draft,
      evidence: {
        backendId: this.#backendId,
        model: this.#model,
        sessionId: this.#sessionId,
        raisedAt: new Date(raisedAtMs).toISOString(),
        source: "pi",
        runId: source.runId ?? null,
        errorCodes: [source.code],
      },
      afterUserMessageId: source.afterUserMessageId ?? null,
      status: "open",
    };
    const stored: StoredFeedbackOffer = {
      offer,
      dedupeKey,
      runId: source.runId ?? null,
      errorCodes: [source.code],
    };
    this.#state = { ...this.#state, offers: [...this.#state.offers, stored] };
    await this.persist();
    return offer;
  }

  async updateStatus(
    offerId: string,
    patch: { status: FeedbackOffer["status"]; report?: { reportId: string; issueUrl: string } }
  ): Promise<boolean> {
    await this.initialize();
    let found = false;
    const offers = this.#state.offers.map((stored) => {
      if (stored.offer.id !== offerId) return stored;
      found = true;
      return {
        ...stored,
        offer: {
          ...stored.offer,
          status: patch.status,
          ...(patch.report !== undefined ? { report: patch.report } : {}),
        },
      };
    });
    if (!found) return false;
    this.#state = { ...this.#state, offers };
    await this.persist();
    return true;
  }

  async persist(): Promise<void> {
    await this.#store.save({
      turnedOff: this.#state.turnedOff,
      offers: this.#state.offers,
    });
  }
}
