import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import workersExtension, { parseThinking } from "../src/extension.js";
import { parseWorkersConfig, saveDefaultWorker } from "../src/config.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const preset = { provider: "test", model: "astra", thinking: "low", description: "Test" };

test("thinking abbreviations are unambiguous and reject extra arguments", () => {
	for (const [token, expected] of Object.entries({ m: "medium", min: "minimal", h: "high", l: "low", x: "xhigh", max: "max", o: "off", MEDIUM: "medium" })) assert.equal(parseThinking(token), expected);
	assert.equal(parseThinking("m extra"), undefined);
	assert.equal(parseThinking("toString"), undefined);
});

test("commands persist defaults and apply temporary thinking with lifecycle boundaries", async () => {
	const dir = mkdtempSync(join(tmpdir(), "workers-test-"));
	const path = join(dir, "workers.json");
	writeFileSync(path, JSON.stringify({ workers: { astra: preset }, extra: true }));
	try {
		const commands = new Map<string, any>();
		const handlers = new Map<string, any>();
		let thinking = "off";
		const entries: any[] = [];
		const notices: string[] = [];
		const ctx: any = {
			model: { provider: "test", id: "astra", reasoning: true },
			isIdle: () => true, hasUI: true,
			modelRegistry: { find: () => ctx.model },
			sessionManager: { getEntries: () => entries },
			ui: { notify: (s: string) => notices.push(s), setStatus() {}, theme: { fg: (_: string, s: string) => s }, select: async () => undefined },
		};
		const pi = {
			registerCommand: (name: string, command: any) => commands.set(name, command),
			on: (name: string, handler: any) => handlers.set(name, handler),
			getThinkingLevel: () => thinking,
			setThinkingLevel: (value: string) => { thinking = value; },
			appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
			getCommands: () => [], events: { on() {}, emit() {} },
		} as unknown as ExtensionAPI;
		workersExtension(pi, path);
		await handlers.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("astra").handler("m", ctx);
		assert.equal(thinking, "medium");
		assert.equal(entries.at(-1).data.thinking, "medium");
		await commands.get("astra").handler("invalid", ctx);
		assert.equal(thinking, "medium");
		await commands.get("worker").handler("astra h", ctx);
		assert.equal(thinking, "high");
		await commands.get("worker").handler("default astra", ctx);
		const saved = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(saved.defaultWorker, "astra");
		assert.equal(saved.extra, true);
		assert.equal(saved.workers.astra.thinking, "low");
		await handlers.get("session_start")({ reason: "reload" }, ctx);
		assert.equal(thinking, "high");
		await handlers.get("session_start")({ reason: "new" }, ctx);
		assert.equal(thinking, "low");
		await commands.get("worker").handler("default none", ctx);
		assert.equal(JSON.parse(readFileSync(path, "utf8")).defaultWorker, undefined);
		assert.throws(() => saveDefaultWorker(path, "missing"), /Unknown worker/);
		assert.match(parseWorkersConfig({ workers: { astra: preset }, defaultWorker: "missing" }).errors[0]!, /defaultWorker/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
