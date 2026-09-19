import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { Api } from "@earendil-works/pi-ai";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadWorkersConfig } from "./config.js";
import {
	WORKERS_API_VERSION,
	WORKERS_CHANGED_EVENT,
	WORKERS_REQUEST_EVENT,
	type SwitchResult,
	type ThinkingLevel,
	type Worker,
	type WorkersChangedEvent,
	type WorkersRequest,
	type WorkerState,
} from "./types.js";

const CONFIG_PATH = join(getAgentDir(), "workers.json");

function sameState(a: WorkerState, b: WorkerState): boolean {
	return a.activeAlias === b.activeAlias && a.provider === b.provider && a.model === b.model && a.thinking === b.thinking;
}

export function supportsThinking(model: Model<Api>, level: ThinkingLevel): boolean {
	if (level === "off") return true;
	if (!model.reasoning) return false;
	return model.thinkingLevelMap?.[level] !== null;
}

export default function workersExtension(pi: ExtensionAPI) {
	const loaded = loadWorkersConfig(CONFIG_PATH);
	const workers = loaded.workers;
	const byAlias = new Map(workers.map((worker) => [worker.alias, worker]));
	let currentCtx: ExtensionContext | undefined;
	let preferredAlias: string | null = null;
	let lastState: WorkerState = { activeAlias: null, provider: null, model: null, thinking: "off" };
	let switchInFlight = false;

	function state(ctx = currentCtx): WorkerState {
		const model = ctx?.model;
		const thinking = pi.getThinkingLevel();
		let activeAlias: string | null = null;
		if (preferredAlias) {
			const worker = byAlias.get(preferredAlias);
			if (worker && model?.provider === worker.provider && model.id === worker.model && thinking === worker.thinking) {
				activeAlias = preferredAlias;
			}
		}
		return { activeAlias, provider: model?.provider ?? null, model: model?.id ?? null, thinking };
	}

	function updateStatus(ctx: ExtensionContext): void {
		const current = state(ctx);
		ctx.ui.setStatus("pi-workers", current.activeAlias ? ctx.ui.theme.fg("accent", `worker:${current.activeAlias}`) : undefined);
	}

	function publishState(source: WorkersChangedEvent["source"], ctx = currentCtx): void {
		if (!ctx) return;
		const next = state(ctx);
		if (!sameState(lastState, next)) {
			const event: WorkersChangedEvent = { version: 1, previous: lastState, current: next, source };
			lastState = next;
			pi.events.emit(WORKERS_CHANGED_EVENT, event);
		}
		updateStatus(ctx);
	}

	async function switchWorker(alias: string): Promise<SwitchResult> {
		const worker = byAlias.get(alias);
		if (!worker) return { ok: false, code: "unknown-worker", message: `Unknown worker "${alias}"` };
		const ctx = currentCtx;
		if (!ctx) return { ok: false, code: "switch-failed", message: "pi-workers is not ready" };
		if (!ctx.isIdle() || switchInFlight) {
			return { ok: false, code: "busy", message: "Workers can only be switched while pi is idle" };
		}

		const model = ctx.modelRegistry.find(worker.provider, worker.model);
		if (!model) {
			return {
				ok: false,
				code: "model-unavailable",
				message: `Model ${worker.provider}/${worker.model} is not available`,
			};
		}
		if (!supportsThinking(model, worker.thinking)) {
			return {
				ok: false,
				code: "unsupported-thinking",
				message: `Model ${worker.provider}/${worker.model} does not support thinking level ${worker.thinking}`,
			};
		}

		const before = state(ctx);
		if (before.provider === worker.provider && before.model === worker.model && before.thinking === worker.thinking) {
			preferredAlias = alias;
			pi.appendEntry("pi-workers-state", { alias });
			publishState("worker-switch", ctx);
			return { ok: true, changed: false, current: state(ctx) };
		}

		const originalModel = ctx.model;
		const originalThinking = pi.getThinkingLevel();
		switchInFlight = true;
		try {
			if (ctx.model?.provider !== worker.provider || ctx.model.id !== worker.model) {
				const authenticated = await pi.setModel(model);
				if (!authenticated) {
					return {
						ok: false,
						code: "switch-failed",
						message: `No authentication is configured for provider ${worker.provider}`,
					};
				}
			}
			pi.setThinkingLevel(worker.thinking);
			const effective = pi.getThinkingLevel();
			if (effective !== worker.thinking) {
				if (originalModel) await pi.setModel(originalModel);
				pi.setThinkingLevel(originalThinking);
				return {
					ok: false,
					code: "unsupported-thinking",
					message: `Requested thinking level ${worker.thinking}, but pi selected ${effective}`,
				};
			}
			preferredAlias = alias;
			pi.appendEntry("pi-workers-state", { alias });
			return { ok: true, changed: true, current: state(ctx) };
		} catch (error) {
			try {
				if (originalModel) await pi.setModel(originalModel);
				pi.setThinkingLevel(originalThinking);
			} catch {
				// Preserve the original switching error.
			}
			return { ok: false, code: "switch-failed", message: error instanceof Error ? error.message : String(error) };
		} finally {
			switchInFlight = false;
			publishState("worker-switch", ctx);
		}
	}

	async function activate(alias: string, ctx: ExtensionContext): Promise<void> {
		const result = await switchWorker(alias);
		if (result.ok) {
			ctx.ui.notify(`Worker "${alias}" ${result.changed ? "activated" : "is already active"}`, "info");
		} else {
			ctx.ui.notify(result.message, "error");
		}
	}

	async function chooseWorker(ctx: ExtensionContext): Promise<void> {
		if (workers.length === 0) {
			ctx.ui.notify(`No valid workers configured in ${CONFIG_PATH}`, "warning");
			return;
		}
		if (!ctx.hasUI) {
			ctx.ui.notify(workers.map((w) => `${w.alias}: ${w.description} (${w.provider}/${w.model}, ${w.thinking})`).join("\n"), "info");
			return;
		}
		const labels = workers.map((w) => `${w.alias} — ${w.description} [${w.provider}/${w.model}, ${w.thinking}]`);
		const selected = await ctx.ui.select("Select worker", labels);
		if (!selected) return;
		const index = labels.indexOf(selected);
		const worker = workers[index];
		if (worker) await activate(worker.alias, ctx);
	}

	pi.registerCommand("workers", {
		description: "List workers and select one",
		handler: async (_args, ctx) => chooseWorker(ctx),
	});
	pi.registerCommand("worker", {
		description: "Switch worker (usage: /worker <alias>)",
		getArgumentCompletions: (prefix) => {
			const matches = workers
				.filter((worker) => worker.alias.startsWith(prefix))
				.map((worker) => ({ value: worker.alias, label: worker.alias, description: worker.description }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const alias = args.trim();
			if (!alias) return chooseWorker(ctx);
			await activate(alias, ctx);
		},
	});

	for (const worker of workers) {
		pi.registerCommand(worker.alias, {
			description: `Switch to pi worker "${worker.alias}": ${worker.description}`,
			handler: async (_args, ctx) => activate(worker.alias, ctx),
		});
	}

	pi.events.on(WORKERS_REQUEST_EVENT, (data) => {
		const request = data as Partial<WorkersRequest>;
		if (request.version !== WORKERS_API_VERSION || typeof request.respond !== "function") return;
		switch (request.method) {
			case "list": request.respond(workers.map((worker) => ({ ...worker }))); break;
			case "get": {
				const worker = request.alias ? byAlias.get(request.alias) : undefined;
				request.respond(worker ? { ...worker } : undefined);
				break;
			}
			case "current": request.respond(state()); break;
			case "switch": request.respond(switchWorker(request.alias ?? "")); break;
		}
	});

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		const saved = [...ctx.sessionManager.getEntries()].reverse().find(
			(entry) => entry.type === "custom" && entry.customType === "pi-workers-state",
		) as { data?: { alias?: unknown } } | undefined;
		preferredAlias = typeof saved?.data?.alias === "string" ? saved.data.alias : null;
		lastState = state(ctx);
		updateStatus(ctx);

		for (const error of loaded.errors) ctx.ui.notify(`workers.json: ${error}`, "warning");
		for (const worker of workers) {
			const expected = `Switch to pi worker "${worker.alias}": ${worker.description}`;
			const command = pi.getCommands().find((item) => item.description === expected);
			if (command && command.name !== worker.alias) {
				ctx.ui.notify(`Worker alias /${worker.alias} collided with another command; use /${command.name} or /worker ${worker.alias}`, "warning");
			}
		}
		publishState("session-start", ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		if (switchInFlight) return;
		preferredAlias = null;
		publishState("model-change", ctx);
	});
	pi.on("thinking_level_select", (_event, ctx) => {
		if (switchInFlight) return;
		preferredAlias = null;
		publishState("thinking-change", ctx);
	});
	pi.on("session_shutdown", () => {
		currentCtx = undefined;
	});
}
