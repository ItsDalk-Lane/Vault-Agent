import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import {
  ProcessSupervisor,
  type ProcessChildLike,
  type ProcessCleanup,
  type ProcessSpawner,
  type ProcessStreamLike,
  type ProcessTimer,
  type ProcessTreeKiller,
  type SpawnProcessRequest,
  type SpillSink,
} from "@/agentMode/sdk/pi/tools/ProcessSupervisor";

// A supervised command must never receive an API key, must stop on the output ceiling, must pass a
// cancellation to the real process, and must report cleanup_incomplete when it cannot prove the
// subtree is gone. Opaque execution is replay:unsafe, so nothing is auto-retried:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeStream implements ProcessStreamLike {
  readonly listeners: Array<(chunk: string | Uint8Array) => void> = [];
  on(_event: "data", listener: (chunk: string | Uint8Array) => void): void {
    this.listeners.push(listener);
  }
  emit(chunk: string): void {
    for (const listener of this.listeners) listener(chunk);
  }
}

class FakeChild implements ProcessChildLike {
  readonly pid = 42;
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly kills: Array<string | undefined> = [];
  readonly exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
  readonly errorListeners: Array<(error: Error) => void> = [];

  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.exitListeners.push(listener);
  }
  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }
  kill(signal?: string): boolean {
    this.kills.push(signal);
    return true;
  }
  emitExit(code: number | null, signal: string | null = null): void {
    for (const listener of this.exitListeners) listener(code, signal);
  }
  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

class FakeSpawner implements ProcessSpawner {
  readonly requests: SpawnProcessRequest[] = [];
  readonly children: FakeChild[] = [];
  readonly spawned = new Promise<void>((resolve) => {
    this.resolveSpawned = resolve;
  });
  resolveSpawned!: () => void;

  spawn(request: SpawnProcessRequest): ProcessChildLike {
    this.requests.push(request);
    const child = new FakeChild();
    this.children.push(child);
    this.resolveSpawned();
    return child;
  }
}

class FakeKiller implements ProcessTreeKiller {
  readonly reasons: Array<"timeout" | "cancelled" | "output_limit"> = [];
  outcome: "confirmed" | "incomplete" = "confirmed";

  async terminate(
    child: ProcessChildLike,
    reason: "timeout" | "cancelled" | "output_limit"
  ): Promise<"confirmed" | "incomplete"> {
    this.reasons.push(reason);
    child.kill("SIGTERM");
    return this.outcome;
  }
}

class FakeTimer implements ProcessTimer {
  nowValue = 0;
  readonly callbacks: Array<{ id: number; callback: () => void }> = [];
  #nextId = 1;

  now(): number {
    return this.nowValue;
  }
  setTimeout(callback: () => void): unknown {
    const id = this.#nextId++;
    this.callbacks.push({ id, callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    const index = this.callbacks.findIndex((entry) => entry.id === handle);
    if (index >= 0) this.callbacks.splice(index, 1);
  }
  fireAll(): void {
    for (const entry of [...this.callbacks]) entry.callback();
  }
}

class FakeSpill implements SpillSink {
  readonly writes: string[] = [];
  fail = false;
  async write(content: string): Promise<string> {
    if (this.fail) throw new Error("spill unavailable");
    this.writes.push(content);
    return "/private/spill/1";
  }
}

interface Harness {
  readonly supervisor: ProcessSupervisor;
  readonly spawner: FakeSpawner;
  readonly killer: FakeKiller;
  readonly timer: FakeTimer;
  readonly spill: FakeSpill;
  readonly intents: string[];
  readonly environment: CommandEnvironment;
}

function harness(
  options: {
    spillBytes?: number;
    tailBytes?: number;
    intent?: boolean;
    failIntent?: boolean;
    spawnThrows?: boolean;
  } = {}
): Harness {
  const spawner = new FakeSpawner();
  const killer = new FakeKiller();
  const timer = new FakeTimer();
  const spill = new FakeSpill();
  const intents: string[] = [];
  const environment = new CommandEnvironment({
    platform: "linux",
    parentEnv: {
      PATH: "/usr/bin",
      HOME: "/home/user",
      API_KEY: "sk-live-parent-secret",
      GITHUB_TOKEN: "ghp-parent-token",
    },
    knownSecrets: ["sk-live-parent-secret"],
  });
  const supervisor = new ProcessSupervisor({
    spawner: options.spawnThrows
      ? {
          spawn: () => {
            throw new Error("spawn refused");
          },
        }
      : spawner,
    environment,
    killer,
    timer,
    spill,
    ...(options.intent === true
      ? {
          recordIntent: async () => {
            intents.push("intent");
            if (options.failIntent === true) throw new Error("intent store unavailable");
          },
        }
      : {}),
    tailBytes: options.tailBytes ?? 64,
    spillBytes: options.spillBytes ?? 4_096,
  });
  return { supervisor, spawner, killer, timer, spill, intents, environment };
}

describe("ProcessSupervisor", () => {
  describe("run()", () => {
    it("keeps the output tail within UTF-8 bytes without corrupting Chinese characters https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = harness({ spillBytes: 128, tailBytes: 7 });
      const running = fixture.supervisor.run({ command: "/bin/bash", cwd: "/tmp" });
      fixture.spawner.children[0].stdout.emit("甲乙丙丁");
      fixture.spawner.children[0].emitExit(0);
      const result = await running;
      expect(result.output).toBe("丙丁");
      expect(new TextEncoder().encode(result.output).byteLength).toBeLessThanOrEqual(7);
    });

    it("redacts a known credential split between process output chunks https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = harness({ spillBytes: 1024, tailBytes: 64 });
      const running = fixture.supervisor.run({ command: "/bin/bash", cwd: "/tmp" });
      fixture.spawner.children[0].stdout.emit("sk-live-");
      fixture.spawner.children[0].stdout.emit("parent-secret");
      fixture.spawner.children[0].emitExit(0);
      const result = await running;
      expect(result.output).toBe("[REDACTED]");
    });

    it("spawns nothing when cancellation arrives while the durable intent is saved https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const controller = new AbortController();
      const spawn = jest.fn(() => {
        throw new Error("must not spawn");
      });
      const supervisor = new ProcessSupervisor({
        spawner: { spawn },
        environment: new CommandEnvironment({ platform: "linux", parentEnv: {} }),
        recordIntent: async () => {
          controller.abort();
        },
      });
      const result = await supervisor.run(
        { command: "/bin/bash", cwd: "/tmp" },
        { signal: controller.signal }
      );
      expect(result.status).toBe("cancelled");
      expect(result.intentRecorded).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    });

    it("never puts the API key into the child environment", async () => {
      const harnessed = harness();
      const running = harnessed.supervisor.run({
        command: "/bin/bash",
        args: ["-lc", "echo hi"],
        cwd: "/home/user",
      });
      harnessed.spawner.children[0].emitExit(0, null);
      const result = await running;

      const request = harnessed.spawner.requests[0];
      expect(request.inheritEnv).toBe(false);
      expect(request.env).toMatchObject({ PATH: "/usr/bin", HOME: "/home/user" });
      expect(request.env).not.toHaveProperty("API_KEY");
      expect(request.env).not.toHaveProperty("GITHUB_TOKEN");
      expect(result).toMatchObject({ status: "completed", replay: "unsafe" });
    });

    it("records the intent before spawning", async () => {
      const harnessed = harness({ intent: true });
      const running = harnessed.supervisor.run({ command: "/bin/bash", cwd: "/home/user" });
      await harnessed.spawner.spawned;
      expect(harnessed.intents).toEqual(["intent"]);
      harnessed.spawner.children[0].emitExit(0, null);
      await running;
    });

    it("limits long output and terminates the process", async () => {
      const harnessed = harness({ spillBytes: 32, tailBytes: 8 });
      const running = harnessed.supervisor.run({ command: "/bin/bash", cwd: "/home/user" });
      harnessed.spawner.children[0].stdout.emit("x".repeat(100));
      expect(harnessed.killer.reasons).toEqual(["output_limit"]);
      harnessed.spawner.children[0].emitExit(null, "SIGTERM");
      const result = await running;

      expect(result).toMatchObject({
        status: "output_limit",
        truncated: true,
        errorCode: "OUTPUT_LIMIT",
      });
      expect(result.output.length).toBeLessThanOrEqual(8);
      expect(harnessed.spill.writes[0].length).toBeLessThanOrEqual(32);
    });

    it("passes the cancellation signal to the real process", async () => {
      const harnessed = harness();
      const controller = new AbortController();
      const running = harnessed.supervisor.run(
        { command: "/bin/bash", cwd: "/home/user" },
        { signal: controller.signal }
      );

      controller.abort();
      harnessed.spawner.children[0].emitExit(null, "SIGTERM");
      const result = await running;

      expect(harnessed.killer.reasons).toEqual(["cancelled"]);
      expect(harnessed.spawner.children[0].kills).toEqual(["SIGTERM"]);
      expect(result).toMatchObject({
        status: "cancelled",
        errorCode: "CANCELLED",
        cleanup: "clean",
      });
    });

    it("reports cleanup_incomplete when the subtree exit cannot be proven", async () => {
      const harnessed = harness();
      harnessed.killer.outcome = "incomplete";
      const running = harnessed.supervisor.run({
        command: "/bin/bash",
        cwd: "/home/user",
        timeoutMs: 5_000,
      });

      harnessed.timer.fireAll();
      harnessed.spawner.children[0].emitExit(null, "SIGTERM");
      const result = await running;

      expect(harnessed.killer.reasons).toEqual(["timeout"]);
      expect(result.cleanup satisfies ProcessCleanup).toBe("cleanup_incomplete");
      expect(result).toMatchObject({ status: "timed_out", errorCode: "TIMEOUT" });
    });

    it("redacts known secrets before keeping the tail", async () => {
      const harnessed = harness({ spillBytes: 1_024, tailBytes: 10 });
      const running = harnessed.supervisor.run({ command: "/bin/bash", cwd: "/home/user" });
      harnessed.spawner.children[0].stdout.emit("sk-live-parent-secret");
      harnessed.spawner.children[0].emitExit(0, null);
      const result = await running;

      expect(result.output).not.toContain("sk-live");
      expect(result.output).not.toContain("sk-live-parent-secret");
      expect(result.output).toContain("[REDACT");
    });

    it("keeps the real output on a non-zero exit", async () => {
      const harnessed = harness();
      const running = harnessed.supervisor.run({ command: "/bin/bash", cwd: "/home/user" });
      harnessed.spawner.children[0].stdout.emit("real error output");
      harnessed.spawner.children[0].emitExit(3, null);
      const result = await running;

      expect(result).toMatchObject({
        status: "failed",
        exitCode: 3,
        errorCode: "NONZERO_EXIT",
      });
      expect(result.output).toBe("real error output");
    });

    it("does not retry an opaque command after a spawn error", async () => {
      const harnessed = harness({ spawnThrows: true });
      const result = await harnessed.supervisor.run({ command: "/bin/bash", cwd: "/home/user" });

      expect(result).toMatchObject({
        status: "spawn_error",
        errorCode: "SPAWN_ERROR",
        replay: "unsafe",
      });
      expect(harnessed.spawner.requests).toEqual([]);
    });

    it("does not spawn when the intent cannot be recorded", async () => {
      const harnessed = harness({ intent: true, failIntent: true });
      const result = await harnessed.supervisor.run({ command: "/bin/bash", cwd: "/home/user" });

      expect(result).toMatchObject({ status: "intent_failed", errorCode: "INTENT_FAILED" });
      expect(harnessed.spawner.requests).toEqual([]);
    });

    it("filters a secret-like explicit env value end to end", async () => {
      const harnessed = harness();
      const running = harnessed.supervisor.run({
        command: "/bin/bash",
        cwd: "/home/user",
        env: { SAFE: "1", API_KEY: "sk-explicit" },
      });
      harnessed.spawner.children[0].emitExit(0, null);
      await running;

      expect(harnessed.spawner.requests[0].env).toMatchObject({ SAFE: "1" });
      expect(harnessed.spawner.requests[0].env).not.toHaveProperty("API_KEY");
    });
  });
});
