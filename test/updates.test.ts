import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import workersExtension from "../src/extension.js";
import { findWorkerUpdates } from "../src/updates.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Worker } from "../src/types.js";

const worker: Worker = { alias: "sol", provider: "github-copilot", model: "gpt-6-sol", thinking: "medium", description: "Review" };
const model = (id: string, provider = "github-copilot", map?: Record<string, string | null>) =>
	({ id, provider, reasoning: true, thinkingLevelMap: map }) as unknown as Model<Api>;

test("version comparison stays in provider and exact family, including dotted versions", () => {
	const list = [model("gpt-6-sol"), model("gpt-6.1-sol"), model("gpt-6.2-sol"), model("gpt-7-luna"), model("gpt-99-sol", "openai")];
	assert.equal(findWorkerUpdates([worker], list)[0]?.candidate?.id, "gpt-6.2-sol");
	assert.equal(findWorkerUpdates([{ ...worker, model: "gpt-6.2-sol" }], list)[0]?.status, "current");
	assert.equal(findWorkerUpdates([{ ...worker, model: "gpt-9-sol" }], list)[0]?.status, "missing");
	assert.equal(findWorkerUpdates([{ ...worker, model: "unversioned" }], [model("unversioned")])[0]?.status, "unversioned");
});

test("skips unsupported latest thinking and can offer an older compatible update", () => {
	const list = [model("gpt-6-sol"), model("gpt-6.1-sol"), model("gpt-6.2-sol", "github-copilot", { medium: null })];
	assert.equal(findWorkerUpdates([worker], list)[0]?.candidate?.id, "gpt-6.1-sol");
	assert.equal(findWorkerUpdates([worker], [list[0]!, list[2]!])[0]?.status, "unsupported-thinking");
});

test("/worker updates checks freshly, applies explicitly, reloads, and refuses stale or changed configs", async () => {
	const dir = mkdtempSync(join(tmpdir(), "workers-updates-"));
	const path = join(dir, "workers.json");
	writeFileSync(path, JSON.stringify({ defaultWorker: "sol", workers: { sol: { ...worker, alias: undefined, extra: 3 } }, extra: true }));
	try {
		const commands = new Map<string, any>();
		const notices: string[] = [];
		let refreshResult = { aborted: false, errors: new Map() };
		let calls = 0;
		let reloads = 0;
		let available = [model("gpt-6-sol"), model("gpt-6.1-sol")];
		const ctx: any = {
			ui: { notify: (text: string) => notices.push(text) },
			modelRegistry: {
				refresh: async (opts: any) => { calls++; assert.deepEqual(opts.providers, ["github-copilot"]); assert.equal(opts.allowNetwork, true); return refreshResult; },
				getAvailable: () => available,
			},
			reload: async () => { reloads++; },
		};
		workersExtension({ registerCommand: (name: string, command: any) => commands.set(name, command), on() {}, events: { on() {} } } as unknown as ExtensionAPI, path);
		const command = commands.get("worker");
		assert.ok(command.getArgumentCompletions("upd").some((item: any) => item.value === "updates"));
		assert.deepEqual(command.getArgumentCompletions("updates a").map((item: any) => item.value), ["updates apply"]);
		await command.handler("updates", ctx);
		assert.match(notices.at(-1)!, /gpt-6-sol → gpt-6.1-sol/);
		assert.equal(JSON.parse(readFileSync(path, "utf8")).workers.sol.model, "gpt-6-sol");
		await command.handler("updates apply", ctx);
		assert.equal(reloads, 1);
		const saved = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(saved.workers.sol.model, "gpt-6.1-sol");
		assert.equal(saved.workers.sol.extra, 3);
		assert.equal(saved.defaultWorker, "sol");
		assert.equal(saved.extra, true);
		await command.handler("updates apply", ctx);
		assert.equal(reloads, 1);
		assert.match(notices.at(-1)!, /changed since the update check/);
		refreshResult = { aborted: true, errors: new Map() };
		await command.handler("updates apply", ctx);
		assert.equal(reloads, 1);
		assert.match(notices.at(-1)!, /no update check was trusted/);
		assert.equal(calls, 4);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
