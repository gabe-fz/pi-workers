import assert from "node:assert/strict";
import test from "node:test";
import { supportsThinking } from "../src/extension.js";
import type { Api, Model } from "@earendil-works/pi-ai";

function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "test",
		name: "Test",
		api: "openai-responses",
		provider: "test",
		baseUrl: "https://example.test",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
		...overrides,
	};
}

test("thinking support honors model reasoning and explicit null mappings", () => {
	assert.equal(supportsThinking(model(), "high"), true);
	assert.equal(supportsThinking(model({ reasoning: false }), "high"), false);
	assert.equal(supportsThinking(model({ reasoning: false }), "off"), true);
	assert.equal(supportsThinking(model({ thinkingLevelMap: { xhigh: null } }), "xhigh"), false);
});
