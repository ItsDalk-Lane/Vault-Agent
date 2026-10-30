import { describe, expect, it } from "vitest";
import {
	effectivePropertyValueFormat,
	inheritPropertyValueType,
	untypedPropertyValueVariable,
} from "./propertyCaptureFormat";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { PropertyCapture } from "../types/choices/ICaptureChoice";

describe("property input type inheritance", () => {
	it.each(["{{VALUE}}", "{{NAME}}", "{{VALUE:rating}}", "{{VALUE:rating|optional}}"])("inherits the native widget for %s", (format) => {
		expect(inheritPropertyValueType(format, "number")).toBe(`${format.slice(0, -2)}|type:number}}`);
		expect(inheritPropertyValueType(format, "checkbox")).toBe(`${format.slice(0, -2)}|type:checkbox}}`);
	});
	it.each(["{{VALUE:rating|type:text}}", "{{VALUE:rating|type:number}}", "{{VALUE:rating}} points", "{{VALUE:a,b|multi}}", "{{VALUE:rating|case:upper}}", "{{FIELD:rating}}", "42"])("keeps an explicit or composite format %s", (format) => {
		expect(inheritPropertyValueType(format, "number")).toBe(format);
		expect(untypedPropertyValueVariable(format)).toBeNull();
	});
	it("keeps an unregistered property as plain text and retains named variable identity", () => {
		expect(inheritPropertyValueType("{{VALUE:rating}}", null)).toBe("{{VALUE:rating}}");
		expect(untypedPropertyValueVariable("{{VALUE:rating|label:Score}}" )).toBe("rating");
	});
});

describe("effectivePropertyValueFormat", () => {
	const makeChoice = (format: { enabled: boolean; format: string }): ICaptureChoice =>
		({ format }) as ICaptureChoice;
	const row = (valueFormat?: string): PropertyCapture =>
		({ property: { kind: "named", format: "p" }, action: "set", createIfMissing: true, sort: "none", valueFormat });

	it("prefers the row's own value format", () => {
		const choice = makeChoice({ enabled: true, format: "{{VALUE:body}}" });
		expect(effectivePropertyValueFormat(choice, row("{{VALUE:row}}"))).toBe("{{VALUE:row}}");
	});

	it("falls back to the enabled capture format when the row has none", () => {
		const choice = makeChoice({ enabled: true, format: "{{VALUE:body}}" });
		expect(effectivePropertyValueFormat(choice, row(undefined))).toBe("{{VALUE:body}}");
		expect(effectivePropertyValueFormat(choice, row(""))).toBe("{{VALUE:body}}");
		expect(effectivePropertyValueFormat(choice, row("   "))).toBe("{{VALUE:body}}");
	});

	it("falls back to the plain value token when the capture format is disabled", () => {
		const choice = makeChoice({ enabled: false, format: "ignored" });
		expect(effectivePropertyValueFormat(choice, row(undefined))).toBe("{{value}}");
	});
});
