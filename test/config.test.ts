import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkersConfig } from "../src/config.js";

const valid = {
	workers: {
		quick: {
			provider: "openai-codex",
			model: "gpt-test",
			thinking: "high",
			description: "Routine implementation",
		},
	},
};

test("parses valid workers and adds aliases", () => {
	assert.deepEqual(parseWorkersConfig(valid), {
		workers: [{ alias: "quick", ...valid.workers.quick }],
		errors: [],
	});
});

test("rejects unsafe aliases and malformed worker fields", () => {
	const result = parseWorkersConfig({
		workers: {
			model: valid.workers.quick,
			"Bad Alias": valid.workers.quick,
			broken: { provider: "x", model: "y", thinking: "enormous" },
		},
	});
	assert.equal(result.workers.length, 0);
	assert.equal(result.errors.length, 3);
	assert.match(result.errors[0]!, /conflicts/);
	assert.match(result.errors[1]!, /must match/);
	assert.match(result.errors[2]!, /description, thinking/);
});

test("requires a workers object", () => {
	assert.deepEqual(parseWorkersConfig({}), {
		workers: [],
		errors: ['configuration must contain a "workers" object'],
	});
});
