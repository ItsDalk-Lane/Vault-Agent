import type { Api, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { withStructuredToolSampling } from "./ModelRequestCapabilities";

describe("ModelRequestCapabilities", () => {
  describe("withStructuredToolSampling()", () => {
    it("requests strict JSON Schema tools when the saved model declares support https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const context = {
        messages: [
          {
            role: "system",
            content: "instructions",
            timestamp: 1,
            toolsAdded: [
              { name: "read", description: "read", parameters: { type: "object" } },
              {
                name: "custom",
                description: "custom",
                parameters: { type: "object" },
                constrainedSampling: false,
              },
            ],
          },
        ],
      } as unknown as TranscriptContext;
      const result = withStructuredToolSampling(
        { compat: { supportsStrictMode: true } } as Model<Api>,
        context
      );
      expect(result.messages[0]).toMatchObject({
        toolsAdded: [
          { constrainedSampling: { type: "json_schema", strict: "prefer" } },
          { constrainedSampling: false },
        ],
      });
      expect(context.messages[0]).not.toHaveProperty("toolsAdded.0.constrainedSampling");
    });
    it("keeps the original transcript when strict output is not declared https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const context = { messages: [] } as unknown as TranscriptContext;
      expect(
        withStructuredToolSampling({ compat: { supportsStrictMode: false } } as Model<Api>, context)
      ).toBe(context);
    });
  });
});
