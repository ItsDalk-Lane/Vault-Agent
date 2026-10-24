import { PiRuntimeEventBarrier } from "@/agentMode/sdk/pi/runtime/PiRuntimeEventBarrier";

describe("PiRuntimeEventBarrier", () => {
  describe("PiRuntimeEventBarrier", () => {
    describe("waitFor()", () => {
      it("resolves an already consumed entry immediately and waits explicitly for later entries https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const barrier = new PiRuntimeEventBarrier();
        barrier.advance([1, 4]);
        await barrier.waitFor(4);
        let resolved = false;
        const work = barrier.waitFor(8).then(() => {
          resolved = true;
        });
        expect(resolved).toBe(false);
        barrier.advance([8]);
        await work;
        expect(resolved).toBe(true);
      });
    });
    describe("advance()", () => {
      it("accepts a newer snapshot without requiring skipped entry events and never moves backwards https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const barrier = new PiRuntimeEventBarrier();
        const work = barrier.waitFor(5);
        barrier.advance([9]);
        await work;
        barrier.advance([1]);
        await barrier.waitFor(8);
      });
    });
    describe("close()", () => {
      it("rejects pending and subsequent replay waits when the stream fails or closes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const barrier = new PiRuntimeEventBarrier();
        const work = barrier.waitFor(5);
        const assertion = expect(work).rejects.toThrow("stream failed");
        barrier.close(new Error("stream failed"));
        await assertion;
        await expect(barrier.waitFor(9)).rejects.toThrow("stream failed");
      });
    });
  });
});
