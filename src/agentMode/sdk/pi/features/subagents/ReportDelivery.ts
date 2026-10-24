// 后台报告是有来源的任务资料；持久去重和接纳回执不创建新用户输入，停止或重开只保留记录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const SUBAGENT_REPORT_ENTRY_KIND = "va.subagent.report";
export const SUBAGENT_REPORT_SOURCE_DECLARATION =
  "Background subagent report (tool-sourced; not a new user instruction).";

export interface SubagentReportEntry {
  readonly kind: typeof SUBAGENT_REPORT_ENTRY_KIND;
  readonly source: "tool";
  readonly text: string;
  readonly data: {
    readonly childConversationId: string;
    readonly answerEntryId: string;
    readonly parentRunId: string;
    readonly origin: "subagent";
  };
}

export type ReportDeliveryState =
  | "followed_up"
  | "context_delivered"
  | "stored_cancelled"
  | "stored_duplicate"
  | "stored_host_closed"
  | "stored_budget"
  | "stored_requires_continue";

export interface ReportDeliveryRecord {
  readonly rootId: string;
  readonly parentRunId: string;
  readonly parentToolCallId: string;
  readonly childConversationId: string;
  readonly answerEntryId: string;
  readonly text: string;
  readonly epochAtStart: number;
  readonly entryId?: string;
  readonly state: ReportDeliveryState;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly consumed: boolean;
  readonly followUpStarted: boolean;
}

export interface ReportDeliveryPorts {
  readonly entries: {
    append(entry: SubagentReportEntry): Promise<{ readonly entryId: string }>;
    findByAnswer(answerEntryId: string): Promise<{ readonly entryId: string } | undefined>;
  };
  readonly roots: {
    cancelEpoch(rootId: string, parentRunId: string): Promise<number>;
    isAborted(rootId: string, parentRunId: string): boolean;
    budgetAllows(rootId: string, parentRunId: string): Promise<boolean>;
    deliverContext(input: {
      readonly rootId: string;
      readonly parentRunId: string;
      readonly parentToolCallId: string;
      readonly text: string;
      readonly entryId: string;
      readonly childConversationId: string;
      readonly answerEntryId: string;
    }): Promise<{
      readonly delivered: boolean;
      readonly reason?: string;
    }>;
  };
  readonly cards: {
    updateParentCard(input: {
      readonly parentToolCallId: string;
      readonly childConversationId: string;
      readonly resultRef: string;
      readonly status: "completed" | "failed";
      readonly consumed: boolean;
      readonly updatedAtMs: number;
    }): Promise<void>;
  };
  readonly host: {
    isOpen(): boolean;
  };
  readonly checkpoints: {
    save(record: ReportDeliveryRecord): Promise<void>;
    list(): Promise<readonly ReportDeliveryRecord[]>;
  };
  readonly now?: () => number;
}

export interface ReportDeliveryRequest {
  readonly rootId: string;
  readonly parentRunId: string;
  readonly parentToolCallId: string;
  readonly childConversationId: string;
  readonly answerEntryId: string;
  readonly text: string;
  readonly epochAtStart: number;
  readonly status: "completed" | "failed";
}

export interface ReportDeliveryResult {
  readonly state: ReportDeliveryState;
  readonly entryId?: string;
  readonly followUpStarted: boolean;
  readonly consumed: boolean;
  readonly entry: SubagentReportEntry;
}

export class ReportDelivery {
  readonly #ports: ReportDeliveryPorts;
  readonly #now: () => number;
  readonly #records = new Map<string, ReportDeliveryRecord>();
  #hostClosed = false;

  constructor(ports: ReportDeliveryPorts) {
    this.#ports = ports;
    this.#now = ports.now ?? (() => Date.now());
  }

  get #hostOpen(): boolean {
    return this.#ports.host.isOpen() && !this.#hostClosed;
  }

  async deliver(request: ReportDeliveryRequest): Promise<ReportDeliveryResult> {
    const entry = this.#composeEntry(request);
    const duplicate =
      this.#findByAnswer(request.rootId, request.answerEntryId) ??
      (await this.#ports.checkpoints
        .list()
        .then((records) =>
          records.find(
            (record) =>
              record.rootId === request.rootId && record.answerEntryId === request.answerEntryId
          )
        ));
    if (duplicate?.consumed) {
      const stored = await this.#store({ ...duplicate, state: "stored_duplicate" });
      return this.#result(stored, entry);
    }
    if (!this.#hostOpen) {
      return this.#result(await this.#store(this.#record(request, "stored_host_closed")), entry);
    }
    const epoch = await this.#ports.roots.cancelEpoch(request.rootId, request.parentRunId);
    if (
      epoch !== request.epochAtStart ||
      this.#ports.roots.isAborted(request.rootId, request.parentRunId)
    ) {
      return this.#result(await this.#store(this.#record(request, "stored_cancelled")), entry);
    }
    if (!(await this.#ports.roots.budgetAllows(request.rootId, request.parentRunId))) {
      return this.#result(await this.#store(this.#record(request, "stored_budget")), entry);
    }
    return this.#integrate(request, entry);
  }

  onHostClosed(): void {
    this.#hostClosed = true;
  }

  async #integrate(
    request: ReportDeliveryRequest,
    entry: SubagentReportEntry
  ): Promise<ReportDeliveryResult> {
    const appended =
      (await this.#ports.entries.findByAnswer(request.answerEntryId)) ??
      (await this.#ports.entries.append(entry));
    const delivered = await this.#ports.roots.deliverContext({
      rootId: request.rootId,
      parentRunId: request.parentRunId,
      parentToolCallId: request.parentToolCallId,
      text: entry.text,
      entryId: appended.entryId,
      childConversationId: request.childConversationId,
      answerEntryId: request.answerEntryId,
    });
    const stored = await this.#store({
      ...this.#record(
        request,
        delivered.delivered ? "context_delivered" : "stored_requires_continue"
      ),
      entryId: appended.entryId,
      followUpStarted: false,
      consumed: delivered.delivered,
    });
    return this.#result(stored, entry);
  }

  #record(request: ReportDeliveryRequest, state: ReportDeliveryState): ReportDeliveryRecord {
    const now = this.#now();
    return Object.freeze({
      rootId: request.rootId,
      parentRunId: request.parentRunId,
      parentToolCallId: request.parentToolCallId,
      childConversationId: request.childConversationId,
      answerEntryId: request.answerEntryId,
      text: request.text,
      epochAtStart: request.epochAtStart,
      state,
      createdAtMs: now,
      updatedAtMs: now,
      consumed: false,
      followUpStarted: false,
    });
  }

  async #store(record: ReportDeliveryRecord): Promise<ReportDeliveryRecord> {
    await this.#ports.checkpoints.save(record);
    this.#records.set(record.parentToolCallId, record);
    await this.#ports.cards.updateParentCard({
      parentToolCallId: record.parentToolCallId,
      childConversationId: record.childConversationId,
      resultRef: record.entryId ?? record.answerEntryId,
      status: "completed" as const,
      consumed: record.consumed,
      updatedAtMs: record.updatedAtMs,
    });
    return record;
  }

  #composeEntry(request: ReportDeliveryRequest): SubagentReportEntry {
    return Object.freeze({
      kind: SUBAGENT_REPORT_ENTRY_KIND,
      source: "tool" as const,
      text: `${SUBAGENT_REPORT_SOURCE_DECLARATION}\n\n${request.text}`,
      data: Object.freeze({
        childConversationId: request.childConversationId,
        answerEntryId: request.answerEntryId,
        parentRunId: request.parentRunId,
        origin: "subagent" as const,
      }),
    });
  }

  #findByAnswer(rootId: string, answerEntryId: string): ReportDeliveryRecord | undefined {
    return [...this.#records.values()].find(
      (record) => record.rootId === rootId && record.answerEntryId === answerEntryId
    );
  }

  #result(record: ReportDeliveryRecord, entry: SubagentReportEntry): ReportDeliveryResult {
    return Object.freeze({
      state: record.state,
      ...(record.entryId !== undefined ? { entryId: record.entryId } : {}),
      followUpStarted: record.followUpStarted,
      consumed: record.consumed,
      entry,
    });
  }
}
