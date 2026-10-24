import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import {
  MCP_TEST_MAX_ERROR_CHARS,
  MCP_TEST_MAX_TOOLS,
  McpConnectionTester,
  type McpTestConnection,
  type McpTestTimerHandle,
  type McpTestTimerPort,
  type McpTestTool,
} from "@/agentMode/sdk/pi/mcp/McpConnectionTest";

// The bounded test only connects, lists and closes; requests are bounded at 15 s, the whole test at
// 20 s and closing at 2 s; clicks on one fingerprint share a single real test; the last cancelled
// waiter aborts it; and secrets are redacted before truncation so they cannot survive the cut:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class ManualTimer implements McpTestTimerPort {
  #next = 1;
  #entries = new Map<number, { at: number; callback: () => void }>();
  nowMs = 0;

  setTimeout(callback: () => void, ms: number): McpTestTimerHandle {
    const id = this.#next++;
    this.#entries.set(id, { at: this.nowMs + ms, callback });
    return { id };
  }

  clearTimeout(handle: McpTestTimerHandle): void {
    this.#entries.delete(handle.id);
  }

  advance(ms: number): void {
    this.nowMs += ms;
    const due = [...this.#entries.entries()]
      .filter(([, entry]) => entry.at <= this.nowMs)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, entry] of due) {
      this.#entries.delete(id);
      entry.callback();
    }
  }

  get pending(): number {
    return this.#entries.size;
  }
}

class FakeConnection implements McpTestConnection {
  serverInfo = { name: "fake", version: "1.0.0" };
  capabilities: Readonly<Record<string, unknown>> = { resources: {}, tools: {} };
  stderrTail: string | undefined;
  tools: readonly McpTestTool[] = [{ name: "search" }, { name: "index" }, { name: "read" }];
  listCalls = 0;
  closeCalls = 0;
  sideEffectCalls = 0;
  listSignal: AbortSignal | undefined;
  listImpl:
    | ((options: { signal?: AbortSignal; timeoutMs: number }) => Promise<readonly McpTestTool[]>)
    | null = null;
  closeImpl: (() => Promise<void>) | null = null;
  readonly listStarted: Promise<void>;
  readonly closeStarted: Promise<void>;
  #listStartedResolve: () => void = () => undefined;
  #closeStartedResolve: () => void = () => undefined;

  constructor() {
    this.listStarted = new Promise<void>((resolve) => {
      this.#listStartedResolve = resolve;
    });
    this.closeStarted = new Promise<void>((resolve) => {
      this.#closeStartedResolve = resolve;
    });
  }

  async listTools(options: {
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<readonly McpTestTool[]> {
    this.listCalls += 1;
    this.listSignal = options.signal;
    this.#listStartedResolve();
    if (this.listImpl !== null) return this.listImpl(options);
    return this.tools;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.#closeStartedResolve();
    if (this.closeImpl !== null) return this.closeImpl();
  }

  callTool(): never {
    this.sideEffectCalls += 1;
    throw new Error("a test must never call a tool");
  }
}

interface Harness {
  readonly tester: McpConnectionTester;
  readonly timer: ManualTimer;
  readonly connection: FakeConnection;
  readonly connectCalls: () => number;
  readonly connectSignal: () => AbortSignal | undefined;
}

function harness(
  options: {
    connect?: (input: { signal: AbortSignal }) => Promise<McpTestConnection>;
    secretValues?: readonly string[];
  } = {}
): Harness {
  const timer = new ManualTimer();
  const connection = new FakeConnection();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const tester = new McpConnectionTester({
    fingerprint: "fingerprint-1",
    connect: async (input) => {
      calls += 1;
      signal = input.signal;
      if (options.connect !== undefined) return options.connect(input);
      return connection;
    },
    redactor: new Redactor({ secretValues: options.secretValues ?? [] }),
    timer,
    now: () => timer.nowMs,
  });
  return {
    tester,
    timer,
    connection,
    connectCalls: () => calls,
    connectSignal: () => signal,
  };
}

function abortable<T>(signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

describe("McpConnectionTest", () => {
  describe("run()", () => {
    it("reports real status, server info, capabilities and tools without calling a tool", async () => {
      const harnessed = harness();

      const report = await harnessed.tester.run();

      expect(report).toMatchObject({
        status: "connected",
        serverInfo: { name: "fake", version: "1.0.0" },
        capabilities: ["resources", "tools"],
        toolCount: 3,
        toolSample: ["search", "index", "read"],
        toolsTruncated: false,
        closeTimedOut: false,
      });
      expect(harnessed.connectCalls()).toBe(1);
      expect(harnessed.connection.listCalls).toBe(1);
      expect(harnessed.connection.closeCalls).toBe(1);
      expect(harnessed.connection.sideEffectCalls).toBe(0);
      expect(report.error).toBeUndefined();
      expect(harnessed.timer.pending).toBe(0);
    });

    it("merges concurrent clicks on the same fingerprint into one real test", async () => {
      const harnessed = harness();

      const [first, second] = await Promise.all([harnessed.tester.run(), harnessed.tester.run()]);

      expect(first).toBe(second);
      expect(harnessed.connectCalls()).toBe(1);
      expect(harnessed.connection.listCalls).toBe(1);
      expect(harnessed.tester.inFlight).toBe(false);

      await harnessed.tester.run();
      expect(harnessed.connectCalls()).toBe(2);
    });

    it("stops the real transport when the total test timeout fires", async () => {
      const harnessed = harness({
        connect: (input) => abortable<McpTestConnection>(input.signal),
      });

      const running = harnessed.tester.run();
      harnessed.timer.advance(20_000);
      const report = await running;

      expect(report.status).toBe("timed_out");
      expect(harnessed.connectSignal()?.aborted).toBe(true);
      expect(report.durationMs).toBe(20_000);
    });

    it("bounds a single request at 15 seconds and closes the connection", async () => {
      const harnessed = harness();
      harnessed.connection.listImpl = (options) =>
        abortable<readonly McpTestTool[]>(options.signal);

      const running = harnessed.tester.run();
      await harnessed.connection.listStarted;
      harnessed.timer.advance(15_000);
      const report = await running;

      expect(report.status).toBe("timed_out");
      expect(harnessed.connection.listSignal?.aborted).toBe(true);
      expect(harnessed.connection.closeCalls).toBe(1);
      expect(harnessed.timer.pending).toBe(0);
    });

    it("aborts the real test when the last waiter cancels", async () => {
      const harnessed = harness({
        connect: (input) => abortable<McpTestConnection>(input.signal),
      });
      const first = new AbortController();
      const second = new AbortController();

      const firstRun = harnessed.tester.run({ signal: first.signal });
      const secondRun = harnessed.tester.run({ signal: second.signal });
      expect(harnessed.tester.waiterCount).toBe(2);

      first.abort();
      expect(harnessed.tester.waiterCount).toBe(1);
      expect(harnessed.connectSignal()?.aborted).toBe(false);

      second.abort();
      const [firstReport, secondReport] = await Promise.all([firstRun, secondRun]);

      expect(firstReport.status).toBe("cancelled");
      expect(secondReport).toBe(firstReport);
      expect(harnessed.connectCalls()).toBe(1);
      expect(harnessed.connectSignal()?.aborted).toBe(true);
    });

    it("redacts secrets before truncating the error and stderr tail", async () => {
      const secret = "sk-live-secret";
      const harnessed = harness({
        secretValues: [secret],
        connect: async () => {
          const connection = new FakeConnection();
          connection.stderrTail = `${"x".repeat(1_990)}${secret}${"y".repeat(200)}`;
          throw Object.assign(new Error(`${"e".repeat(1_990)}${secret}${"f".repeat(200)}`), {
            connection,
          });
        },
      });

      const report = await harnessed.tester.run();

      expect(report.status).toBe("error");
      expect(report.error?.length).toBeLessThanOrEqual(MCP_TEST_MAX_ERROR_CHARS);
      expect(report.error).not.toContain(secret);
      expect(report.error).not.toContain("sk-live");
      expect(report.error).toContain("[REDACTED]");
      expect(report.stderrTail).toBeUndefined();
    });

    it("classifies an authorization failure and a plain error separately", async () => {
      const auth = harness({
        connect: async () => {
          const error = new Error("authorization required");
          error.name = "McpAuthRequiredError";
          throw error;
        },
      });
      const failed = harness({
        connect: async () => {
          throw new Error("connection refused");
        },
      });

      await expect(auth.tester.run()).resolves.toMatchObject({ status: "auth_required" });
      await expect(failed.tester.run()).resolves.toMatchObject({
        status: "error",
        error: "connection refused",
      });
    });

    it("caps the tool sample at 500 while reporting the real count", async () => {
      const harnessed = harness();
      harnessed.connection.tools = Array.from({ length: 600 }, (_, index) => ({
        name: `tool-${index}`,
      }));

      const report = await harnessed.tester.run();

      expect(report.toolCount).toBe(600);
      expect(report.toolSample).toHaveLength(MCP_TEST_MAX_TOOLS);
      expect(report.toolsTruncated).toBe(true);
    });

    it("does not wait forever for a hanging close and reports closeTimedOut", async () => {
      const harnessed = harness();
      harnessed.connection.closeImpl = () => abortable<void>(undefined);

      const running = harnessed.tester.run();
      await harnessed.connection.closeStarted;
      harnessed.timer.advance(2_000);
      const report = await running;

      expect(report.status).toBe("connected");
      expect(report.closeTimedOut).toBe(true);
      expect(harnessed.connection.closeCalls).toBe(1);
    });
  });
});
