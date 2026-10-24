// Explicit, promise-based fault breakpoints for tests; production must never import this:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type FaultBreakpoint =
  | "before_intent"
  | "before_approval"
  | "before_write"
  | "after_write_before_receipt"
  | "after_receipt";

interface FaultGate {
  readonly wait: Promise<void>;
  readonly resolved: () => void;
  readonly reached: Promise<void>;
  readonly markReached: () => void;
}

function createGate(): FaultGate {
  let resolveWait: () => void = () => undefined;
  let resolveReached: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    resolveReached = resolve;
  });
  return {
    wait,
    resolved: () => resolveWait(),
    reached,
    markReached: () => resolveReached(),
  };
}

export interface FaultInjectorOptions {
  enabled?: boolean;
}

export class FaultInjector {
  private readonly gates = new Map<FaultBreakpoint, FaultGate>();
  private readonly armedFailures = new Map<FaultBreakpoint, unknown>();
  private readonly reachedBreakpoints: FaultBreakpoint[] = [];
  private readonly enabled: boolean;

  constructor(options: FaultInjectorOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get reachedLabels(): readonly FaultBreakpoint[] {
    return [...this.reachedBreakpoints];
  }

  reached(breakpoint: FaultBreakpoint): Promise<void> {
    return this.gate(breakpoint).reached;
  }

  async pause(breakpoint: FaultBreakpoint): Promise<void> {
    if (!this.enabled) return;
    const gate = this.gate(breakpoint);
    this.reachedBreakpoints.push(breakpoint);
    gate.markReached();
    if (this.armedFailures.has(breakpoint)) {
      const failure = this.armedFailures.get(breakpoint);
      this.armedFailures.delete(breakpoint);
      throw failure;
    }
    await gate.wait;
  }

  release(breakpoint: FaultBreakpoint): void {
    this.gate(breakpoint).resolved();
  }

  releaseAll(): void {
    for (const breakpoint of this.reachedBreakpoints) this.release(breakpoint);
  }

  failAt(breakpoint: FaultBreakpoint, failure: unknown): void {
    this.armedFailures.set(breakpoint, failure);
  }

  private gate(breakpoint: FaultBreakpoint): FaultGate {
    const existing = this.gates.get(breakpoint);
    if (existing) return existing;
    const gate = createGate();
    this.gates.set(breakpoint, gate);
    return gate;
  }
}
