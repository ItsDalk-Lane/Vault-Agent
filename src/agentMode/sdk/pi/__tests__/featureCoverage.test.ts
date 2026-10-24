import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = path.resolve(__dirname, "../../../../..");
const packRoot = path.join(projectRoot, "designdocs/pi-rebuild");

interface Feature {
  id: string;
  component: string;
  producer: string;
  taskIds: string[];
  scenarioIds: string[];
  acceptance: string;
}

interface Scenario {
  id: string;
  taskId: string;
  given: string;
  when: string[];
  then: string;
  verification: string;
  result: string;
}

interface Task {
  id: string;
  scenarioIds: string[];
}

interface Flow {
  id: string;
  taskId: string;
  steps: string[];
  expected: string[];
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(packRoot, relativePath), "utf8")) as T;
}

const features = readJson<{ features: Feature[] }>("fixtures/feature-matrix.json").features;
const scenarios = readJson<{ scenarios: Scenario[] }>(
  "fixtures/acceptance-scenarios.json"
).scenarios;
const tasks = readJson<{ tasks: Task[] }>("execution/TASKS.json").tasks;
const flows = readJson<{ flows: Flow[] }>("fixtures/agent-flows.json").flows;
const taskById = new Map(tasks.map((task) => [task.id, task]));
const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

describe("featureCoverage", () => {
  describe("inventory contract", () => {
    it("lists every documented feature exactly once in the same order", () => {
      const inventory = fs.readFileSync(
        path.join(packRoot, "design/01-feature-inventory.md"),
        "utf8"
      );
      const inventoryIds = [...inventory.matchAll(/^\| (F\d{2}) \|/gm)].map((match) => match[1]);
      const featureIds = features.map((feature) => feature.id);

      expect(featureIds).toEqual(inventoryIds);
      expect(new Set(featureIds).size).toBe(featureIds.length);
    });

    it("declares an implementation location and an observable acceptance requirement for each feature", () => {
      for (const feature of features) {
        expect(feature.component.trim()).not.toBe("");
        expect(feature.producer).toMatch(/^src\/.+\.tsx?$/);
        expect(feature.producer).not.toMatch(/\.(test|stories)\./);
        expect(feature.acceptance.trim()).not.toBe("");
      }
    });

    it("links each feature to defined tasks and the assertions those tasks promise to verify", () => {
      for (const feature of features) {
        expect(feature.taskIds.length).toBeGreaterThan(0);
        expect(feature.scenarioIds.length).toBeGreaterThan(0);
        for (const taskId of feature.taskIds) expect(taskById.has(taskId)).toBe(true);
        for (const scenarioId of feature.scenarioIds) {
          const scenario = scenarioById.get(scenarioId);
          expect(scenario).toBeDefined();
          expect(feature.taskIds).toContain(scenario?.taskId);
          expect(taskById.get(scenario?.taskId ?? "")?.scenarioIds).toContain(scenarioId);
        }
      }
    });
  });

  describe("scenario contract", () => {
    it("defines each assertion once with a condition, action, expected outcome and verification kind", () => {
      expect(scenarioById.size).toBe(scenarios.length);
      for (const scenario of scenarios) {
        expect(taskById.has(scenario.taskId)).toBe(true);
        expect(scenario.given.trim()).not.toBe("");
        expect(scenario.when.length).toBeGreaterThan(0);
        expect(scenario.when.every((step) => step.trim().length > 0)).toBe(true);
        expect(scenario.then.trim()).not.toBe("");
        expect(scenario.verification.trim()).not.toBe("");
        expect(["not_run", "passed", "failed"]).toContain(scenario.result);
      }
    });
  });

  describe("flow contract", () => {
    it("assigns each user flow to a task and states its steps and observable outcomes", () => {
      expect(new Set(flows.map((flow) => flow.id)).size).toBe(flows.length);
      for (const flow of flows) {
        expect(taskById.has(flow.taskId)).toBe(true);
        expect(flow.steps.length).toBeGreaterThanOrEqual(3);
        expect(flow.expected.length).toBeGreaterThanOrEqual(3);
        expect([...flow.steps, ...flow.expected].every((step) => step.trim().length > 0)).toBe(
          true
        );
      }
    });
  });
});
