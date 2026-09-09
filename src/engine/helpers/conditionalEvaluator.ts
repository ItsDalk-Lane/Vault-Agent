import { log } from "../../logger/logManager";
import type {
	ConditionalCondition,
	ScriptCondition,
	VariableCondition,
} from "../../types/macros/Conditional/types";
import {
	normalizeExpectedValue,
	formatUnknownValue,
	normalizeVariableValue,
	requiresExpectedValue,
} from "../../utils/conditionalHelpers";
import { t } from "../../i18n";

export interface EvaluateConditionContext {
	variables: Record<string, unknown>;
	evaluateScriptCondition: (condition: ScriptCondition) => Promise<boolean>;
}

export async function evaluateCondition(
	condition: ConditionalCondition,
	context: EvaluateConditionContext
): Promise<boolean> {
	if (condition.mode === "script") {
		return await context.evaluateScriptCondition(condition);
	}

	return evaluateVariableCondition(condition, context.variables);
}

function evaluateVariableCondition(
	condition: VariableCondition,
	variables: Record<string, unknown>
): boolean {
	const variableName = condition.variableName?.trim();

	if (!variableName) {
		log.logWarning(
			t("errors.conditionalNoVariableName")
		);
		return false;
	}

	if (!(variableName in variables)) {
		log.logWarning(
			t("errors.conditionalVariableNotDefined", { name: variableName })
		);
		return false;
	}

	const rawValue = variables[variableName];

	switch (condition.operator) {
		case "isTruthy":
			return !!rawValue;
		case "isFalsy":
			return !rawValue;
	}

	if (requiresExpectedValue(condition.operator)) {
		const expected = normalizeExpectedValue(condition);

		if (expected === undefined) {
			log.logWarning(
				t("errors.conditionalOperatorRequiresValue", {
					operator: condition.operator,
				})
			);
			return false;
		}

		if (condition.operator === "contains") {
			return evaluateContains(rawValue, expected, condition);
		}

		if (condition.operator === "notContains") {
			return !evaluateContains(rawValue, expected, condition);
		}

		return evaluateComparable(rawValue, expected, condition);
	}

	return false;
}

function evaluateContains(
	rawValue: unknown,
	expected: unknown,
	condition: VariableCondition
): boolean {
	if (rawValue === null || rawValue === undefined) return false;

	if (typeof expected === "string" && expected.length === 0) {
		log.logWarning(
			t("errors.conditionalContainsRequiresNonEmpty")
		);
		return false;
	}

	if (Array.isArray(rawValue)) {
		return rawValue
			.map((item) => normalizeVariableValue(item, condition.valueType))
			.some((item) => item === expected);
	}

	if (typeof rawValue === "string") {
		return rawValue.includes(formatUnknownValue(expected));
	}

	if (typeof rawValue === "number" && typeof expected === "number") {
		return rawValue === expected;
	}

	const formattedValue = formatUnknownValue(rawValue);
	const formattedExpected = formatUnknownValue(expected);
	return typeof formattedValue === "string"
		&& formattedValue.includes(formattedExpected);
}

function evaluateComparable(
	rawValue: unknown,
	expected: unknown,
	condition: VariableCondition
): boolean {
	const normalizedValue = normalizeVariableValue(
		rawValue,
		condition.valueType
	);

	switch (condition.operator) {
		case "equals":
			return normalizedValue === expected;
		case "notEquals":
			return normalizedValue !== expected;
		case "lessThan":
			return compareNumbers(normalizedValue, expected, (a, b) => a < b);
		case "lessThanOrEqual":
			return compareNumbers(normalizedValue, expected, (a, b) => a <= b);
		case "greaterThan":
			return compareNumbers(normalizedValue, expected, (a, b) => a > b);
		case "greaterThanOrEqual":
			return compareNumbers(normalizedValue, expected, (a, b) => a >= b);
		default:
			return false;
	}
}

function compareNumbers(
	actual: unknown,
	expected: unknown,
	comparator: (a: number, b: number) => boolean
): boolean {
	const actualNumber = Number(actual);
	const expectedNumber = Number(expected);

	if (Number.isNaN(actualNumber) || Number.isNaN(expectedNumber)) {
		log.logWarning(
			t("errors.conditionalNumericComparisonFailed")
		);
		return false;
	}

	return comparator(actualNumber, expectedNumber);
}
