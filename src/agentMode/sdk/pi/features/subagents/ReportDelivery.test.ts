import {
  ReportDelivery,
  SUBAGENT_REPORT_ENTRY_KIND,
  SUBAGENT_REPORT_SOURCE_DECLARATION,
  type ReportDeliveryPorts,
  type ReportDeliveryRecord,
  type SubagentReportEntry,
} from "@/agentMode/sdk/pi/features/subagents/ReportDelivery";

class FakeReportPorts {
  readonly appendedEntries: SubagentReportEntry[] = [];
  readonly contextWrites: Array<{ rootId: string; entryId: string; text: string }> = [];
  readonly cardUpdates: Array<{ parentToolCallId: string; resultRef: string; consumed: boolean }> =
    [];
  readonly savedRecords: ReportDeliveryRecord[] = [];
  epoch = 0;
  aborted = false;
  budget = true;
  hostOpen = true;
  private nextEntry = 1;

  readonly ports: ReportDeliveryPorts;

  constructor() {
    this.ports = {
      entries: {
        append: async (entry) => {
          this.appendedEntries.push(entry);
          return { entryId: `entry-${this.nextEntry++}` };
        },
        findByAnswer: async (answerEntryId) => {
          const index = this.appendedEntries.findIndex(
            (entry) => entry.data.answerEntryId === answerEntryId
          );
          return index >= 0 ? { entryId: `entry-${index + 1}` } : undefined;
        },
      },
      roots: {
        cancelEpoch: async () => this.epoch,
        isAborted: () => this.aborted,
        budgetAllows: async () => this.budget,
        deliverContext: async (input) => {
          this.contextWrites.push({
            rootId: input.rootId,
            entryId: input.entryId,
            text: input.text,
          });
          return { delivered: true };
        },
      },
      cards: {
        updateParentCard: async (input) => {
          this.cardUpdates.push({
            parentToolCallId: input.parentToolCallId,
            resultRef: input.resultRef,
            consumed: input.consumed,
          });
        },
      },
      host: { isOpen: () => this.hostOpen },
      checkpoints: {
        save: async (record) => {
          const prior = this.savedRecords.findIndex(
            (saved) => saved.parentToolCallId === record.parentToolCallId
          );
          if (prior >= 0) this.savedRecords[prior] = record;
          else this.savedRecords.push(record);
        },
        list: async () => [...this.savedRecords],
      },
      now: () => 1_000,
    };
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    rootId: "root-1",
    parentRunId: "run-1",
    parentToolCallId: "call-1",
    childConversationId: "child-1",
    answerEntryId: "answer-1",
    text: "Child answer",
    epochAtStart: 0,
    status: "completed" as const,
    ...overrides,
  };
}

describe("ReportDelivery", () => {
  describe("ReportDelivery", () => {
    describe("deliver()", () => {
      it("marks an explicitly waited report consumed without a followup and never resumes it again https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fake = new FakeReportPorts();
        const subject = new ReportDelivery({
          ...fake.ports,
          roots: {
            ...fake.ports.roots,
            deliverContext: async () => ({ delivered: true, reason: "delivered_to_wait" }),
          },
        });
        const report = await subject.deliver(request());
        expect(report).toMatchObject({ consumed: true, followUpStarted: false });
        expect((await subject.deliver(request())).consumed).toBe(true);
        expect(fake.appendedEntries).toHaveLength(1);
        expect(fake.contextWrites).toEqual([]);
      });
      it("stores a tool-sourced report entry with the parent run and consolidates it once", async () => {
        const fake = new FakeReportPorts();
        const subject = new ReportDelivery(fake.ports);

        const first = await subject.deliver(request());
        const second = await subject.deliver(request());

        expect(first).toMatchObject({
          state: "context_delivered",
          followUpStarted: false,
          consumed: true,
        });
        expect(second.state).toBe("stored_duplicate");
        expect(second.followUpStarted).toBe(false);
        expect(second.consumed).toBe(true);
        expect(fake.contextWrites).toHaveLength(1);
        expect(fake.appendedEntries).toHaveLength(1);
        expect(fake.appendedEntries[0]).toMatchObject({
          kind: SUBAGENT_REPORT_ENTRY_KIND,
          source: "tool",
          data: {
            childConversationId: "child-1",
            answerEntryId: "answer-1",
            parentRunId: "run-1",
            origin: "subagent",
          },
        });
        expect(fake.appendedEntries[0]?.text).toContain(SUBAGENT_REPORT_SOURCE_DECLARATION);
      });

      it("stores a late answer after Stop without starting a model again", async () => {
        const fake = new FakeReportPorts();
        const subject = new ReportDelivery(fake.ports);
        fake.epoch = 1;

        const result = await subject.deliver(request({ epochAtStart: 0 }));

        expect(result.state).toBe("stored_cancelled");
        expect(result.followUpStarted).toBe(false);
        expect(fake.contextWrites).toEqual([]);
        expect(fake.appendedEntries).toEqual([]);
        expect(fake.savedRecords.at(-1)).toMatchObject({ state: "stored_cancelled" });

        fake.epoch = 0;
        fake.aborted = true;
        const aborted = await subject.deliver(request({ answerEntryId: "answer-abort" }));

        expect(aborted.state).toBe("stored_cancelled");
        expect(fake.contextWrites).toEqual([]);
      });

      it("stores a report without delivering context while the root budget is exhausted", async () => {
        const fake = new FakeReportPorts();
        fake.budget = false;
        const subject = new ReportDelivery(fake.ports);

        const result = await subject.deliver(request());

        expect(result.state).toBe("stored_budget");
        expect(fake.contextWrites).toEqual([]);
      });

      it("stops background work while Obsidian is closed and only restores state on reopen", async () => {
        const fake = new FakeReportPorts();
        fake.hostOpen = false;
        const subject = new ReportDelivery(fake.ports);

        const closed = await subject.deliver(request());
        expect(closed.state).toBe("stored_host_closed");
        expect(fake.contextWrites).toEqual([]);

        subject.onHostClosed();
        const whileClosed = await subject.deliver(
          request({ answerEntryId: "answer-2", text: "Second answer" })
        );
        expect(whileClosed.state).toBe("stored_host_closed");
        expect(fake.contextWrites).toEqual([]);
      });

      it("delivers an unconsumed stored report at a later authorized boundary without duplicating its entry https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fake = new FakeReportPorts();
        let allowed = false;
        const ports = {
          ...fake.ports,
          roots: { ...fake.ports.roots, deliverContext: async () => ({ delivered: allowed }) },
        };
        const subject = new ReportDelivery(ports);
        expect((await subject.deliver(request())).consumed).toBe(false);
        allowed = true;
        const reopened = new ReportDelivery(ports);
        expect((await reopened.deliver(request())).consumed).toBe(true);
        expect(fake.appendedEntries).toHaveLength(1);
      });

      it("keeps the parent card result reference consistent with the stored record", async () => {
        const fake = new FakeReportPorts();
        const subject = new ReportDelivery(fake.ports);

        const result = await subject.deliver(request());
        const stored = fake.savedRecords.at(-1);

        expect(stored).toMatchObject({
          parentToolCallId: "call-1",
          state: "context_delivered",
          consumed: true,
          entryId: result.entryId,
        });
        expect(fake.cardUpdates.at(-1)).toMatchObject({
          parentToolCallId: "call-1",
          resultRef: result.entryId,
          consumed: true,
        });

        const reopened = new ReportDelivery(fake.ports);
        expect((await reopened.deliver(request())).consumed).toBe(true);
        expect(fake.contextWrites).toHaveLength(1);
      });
    });

    describe("onHostClosed()", () => {
      it("keeps a pending report stored without context delivery after closing the host https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fake = new FakeReportPorts();
        const subject = new ReportDelivery(fake.ports);
        subject.onHostClosed();
        expect((await subject.deliver(request())).state).toBe("stored_host_closed");
        expect(fake.contextWrites).toEqual([]);
      });
    });
  });
});
