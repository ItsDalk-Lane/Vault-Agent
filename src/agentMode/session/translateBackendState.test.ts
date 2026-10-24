import {
  findModelEntry,
  modelCatalogSignature,
  modelStateSignature,
  modeStateSignature,
} from "./translateBackendState";
import type { BackendState } from "./types";

describe("translateBackendState", () => {
  describe("findModelEntry()", () => {
    it("returns the entry with the given base model id, or undefined when absent or the state is null", () => {
      const state: NonNullable<BackendState["model"]> = {
        current: { baseModelId: "m", effort: null },
        availableModels: [{ baseModelId: "m", name: "M", provider: null, effortOptions: [] }],
        apply: { kind: "setModel" },
      };

      expect(findModelEntry(state, "m")?.name).toBe("M");
      expect(findModelEntry(state, "missing")).toBeUndefined();
      expect(findModelEntry(null, "m")).toBeUndefined();
    });
  });

  describe("modelCatalogSignature()", () => {
    it("distinguishes discovery lifecycle and catalog content", () => {
      const signatures = [
        modelCatalogSignature(null),
        modelCatalogSignature({ availableModels: null }),
        modelCatalogSignature({
          availableModels: [
            { baseModelId: "alpha", name: "Alpha", provider: null, effortOptions: [] },
          ],
        }),
        modelCatalogSignature({
          availableModels: [
            { baseModelId: "beta", name: "Beta", provider: null, effortOptions: [] },
          ],
        }),
      ];

      expect(new Set(signatures).size).toBe(signatures.length);
    });
  });

  describe("modelStateSignature()", () => {
    it("returns empty string when model is null", () => {
      expect(modelStateSignature(null)).toBe("");
      expect(modelStateSignature({ model: null, mode: null })).toBe("");
    });

    it("is identical for equivalent model slices regardless of mode", () => {
      const sharedModel: BackendState["model"] = {
        current: { baseModelId: "x", effort: null },
        apply: { kind: "setModel" },
        availableModels: [{ baseModelId: "x", name: "X", provider: null, effortOptions: [] }],
      };
      const a: BackendState = { model: sharedModel, mode: null };
      const b: BackendState = {
        model: sharedModel,
        mode: { current: "plan", options: [{ value: "plan", label: "Plan" }], apply: {} },
      };
      expect(modelStateSignature(a)).toBe(modelStateSignature(b));
    });

    it("differs when current model flips", () => {
      const a: BackendState = {
        model: {
          current: { baseModelId: "x", effort: null },
          apply: { kind: "setModel" },
          availableModels: [
            { baseModelId: "x", name: "X", provider: null, effortOptions: [] },
            { baseModelId: "y", name: "Y", provider: null, effortOptions: [] },
          ],
        },
        mode: null,
      };
      const b: BackendState = {
        ...a,
        model: { ...a.model!, current: { baseModelId: "y", effort: null } },
      };
      expect(modelStateSignature(a)).not.toBe(modelStateSignature(b));
    });

    it("differs when the apply channel flips (setModel vs setConfigOption)", () => {
      const base: NonNullable<BackendState["model"]> = {
        current: { baseModelId: "x", effort: null },
        availableModels: [{ baseModelId: "x", name: "X", provider: null, effortOptions: [] }],
        apply: { kind: "setModel" },
      };
      const a: BackendState = { model: base, mode: null };
      const b: BackendState = {
        model: { ...base, apply: { kind: "setConfigOption", configId: "model" } },
        mode: null,
      };
      expect(modelStateSignature(a)).not.toBe(modelStateSignature(b));
    });

    it("differs when a config-option-backed effort channel appears", () => {
      const base: NonNullable<BackendState["model"]> = {
        current: { baseModelId: "x", effort: null },
        availableModels: [{ baseModelId: "x", name: "X", provider: null, effortOptions: [] }],
        apply: { kind: "setConfigOption", configId: "model" },
      };
      const a: BackendState = { model: base, mode: null };
      const b: BackendState = {
        model: {
          ...base,
          apply: { kind: "setConfigOption", configId: "model", effortConfigId: "effort" },
        },
        mode: null,
      };
      expect(modelStateSignature(a)).not.toBe(modelStateSignature(b));
    });
  });

  describe("modeStateSignature()", () => {
    it("returns empty string when mode is null", () => {
      expect(modeStateSignature(null)).toBe("");
      expect(modeStateSignature({ model: null, mode: null })).toBe("");
    });

    it("is identical for equivalent mode slices regardless of model", () => {
      const sharedMode: BackendState["mode"] = {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: { plan: { kind: "setMode", nativeId: "plan" } },
      };
      const a: BackendState = { model: null, mode: sharedMode };
      const b: BackendState = {
        model: {
          current: { baseModelId: "x", effort: null },
          apply: { kind: "setModel" },
          availableModels: [{ baseModelId: "x", name: "X", provider: null, effortOptions: [] }],
        },
        mode: sharedMode,
      };
      expect(modeStateSignature(a)).toBe(modeStateSignature(b));
    });

    it("differs when current mode flips", () => {
      const opts = [
        { value: "plan" as const, label: "Plan" },
        { value: "default" as const, label: "Default" },
      ];
      const a: BackendState = {
        model: null,
        mode: { current: "plan", options: opts, apply: {} },
      };
      const b: BackendState = {
        model: null,
        mode: { current: "default", options: opts, apply: {} },
      };
      expect(modeStateSignature(a)).not.toBe(modeStateSignature(b));
    });

    it("differs when an option's apply-spec kind flips", () => {
      const opts = [{ value: "plan" as const, label: "Plan" }];
      const a: BackendState = {
        model: null,
        mode: {
          current: "plan",
          options: opts,
          apply: { plan: { kind: "setMode", nativeId: "plan" } },
        },
      };
      const b: BackendState = {
        model: null,
        mode: {
          current: "plan",
          options: opts,
          apply: { plan: { kind: "setConfigOption", configId: "mode", value: "plan" } },
        },
      };
      expect(modeStateSignature(a)).not.toBe(modeStateSignature(b));
    });
  });
});
