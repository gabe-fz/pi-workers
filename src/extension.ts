import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { Api } from "@earendil-works/pi-ai";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { loadWorkersConfig, saveDefaultWorker, saveWorkerUpdates } from "./config.js";
import { findWorkerUpdates, formatWorkerUpdates } from "./updates.js";
import { installWorkerFooter } from "./footer.js";
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
	if (level === "off") return model.thinkingLevelMap?.off !== null;
	if (!model.reasoning) return false;
	return model.thinkingLevelMap?.[level] !== null;
}

const efforts: Record<string, ThinkingLevel> = {
	o: "off", off: "off", min: "minimal", minimal: "minimal", l: "low", low: "low",
	m: "medium", medium: "medium", h: "high", high: "high", x: "xhigh", xh: "xhigh", xhigh: "xhigh", max: "max",
};

export function parseThinking(value: string): ThinkingLevel | undefined {
	return Object.hasOwn(efforts, value.toLowerCase()) ? efforts[value.toLowerCase()] : undefined;
}

function effortCompletions(prefix: string) {
	return Object.entries(efforts).filter(([key]) => key.startsWith(prefix))
		.map(([value, label]) => ({ value, label }));
}

export default function workersExtension(pi: ExtensionAPI, configPath = CONFIG_PATH) {
	const loaded = loadWorkersConfig(configPath);
	const workers = loaded.workers;
	const byAlias = new Map(workers.map((worker) => [worker.alias, worker]));
	let currentCtx: ExtensionContext | undefined;
	let preferredAlias: string | null = null;
	let preferredThinking: ThinkingLevel | undefined;
	let defaultWorker = loaded.defaultWorker;
	let lastState: WorkerState = { activeAlias: null, provider: null, model: null, thinking: "off" };
	let switchInFlight = false;
	let disposeFooter: (() => void) | undefined;

	function state(ctx = currentCtx): WorkerState {
		const model = ctx?.model;
		const thinking = pi.getThinkingLevel();
		let activeAlias: string | null = null;
		if (preferredAlias) {
			const worker = byAlias.get(preferredAlias);
			if (worker && model?.provider === worker.provider && model.id === worker.model && thinking === (preferredThinking ?? worker.thinking)) {
				activeAlias = preferredAlias;
			}
		}
		return { activeAlias, provider: model?.provider ?? null, model: model?.id ?? null, thinking };
	}

	function updateStatus(ctx: ExtensionContext): void {
		// Clear the legacy extra status row; this also requests a footer redraw.
		ctx.ui.setStatus("pi-workers", undefined);
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

	async function switchWorker(alias: string, thinking?: ThinkingLevel): Promise<SwitchResult> {
		const preset = byAlias.get(alias);
		const worker = preset && { ...preset, thinking: thinking ?? preset.thinking };
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
			preferredThinking = worker.thinking;
			pi.appendEntry("pi-workers-state", { alias, thinking: worker.thinking });
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
			preferredThinking = worker.thinking;
			pi.appendEntry("pi-workers-state", { alias, thinking: worker.thinking });
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

	async function activate(alias: string, ctx: ExtensionContext, args = ""): Promise<void> {
		const token = args.trim();
		const thinking = token ? parseThinking(token) : undefined;
		if (token && !thinking) {
			ctx.ui.notify("Thinking must be off/o, minimal/min, low/l, medium/m, high/h, xhigh/x/xh, or max", "error");
			return;
		}
		const result = await switchWorker(alias, thinking);
		if (result.ok) {
			ctx.ui.notify(`Worker "${alias}" ${result.changed ? "activated" : "is already active"} (${result.current.thinking})`, "info");
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

	async function checkUpdates(ctx: ExtensionCommandContext, apply: boolean): Promise<void> {
		if (!workers.length) return ctx.ui.notify("No valid workers configured", "warning");
		const providers = [...new Set(workers.map((worker) => worker.provider))];
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);
		try {
			const result = await ctx.modelRegistry.refresh({ allowNetwork: true, providers, signal: controller.signal });
			if (result.aborted || controller.signal.aborted || result.errors.size) {
				const detail = [...result.errors].map(([provider, error]) => `${provider}: ${error.message}`).join("; ");
				ctx.ui.notify(`Model catalog refresh failed${detail ? ` (${detail})` : " (timed out)"}; no update check was trusted`, "error");
				return;
			}
			const updates = findWorkerUpdates(workers, ctx.modelRegistry.getAvailable());
			const report = formatWorkerUpdates(updates);
			const newer = updates.filter((update) => update.status === "newer");
			if (!apply || !newer.length) {
				ctx.ui.notify(`${report}${newer.length ? "\nRun /worker updates apply to save these model IDs (no active model switch)." : ""}`, "info");
				return;
			}
			saveWorkerUpdates(configPath, newer);
			ctx.ui.notify(`${report}\nSaved ${newer.length} update(s) to ${configPath}; reloading pi-workers.`, "info");
			await ctx.reload();
		} catch (error) {
			ctx.ui.notify(`Worker update check failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			clearTimeout(timeout);
		}
	}

	pi.registerCommand("workers", {
		description: "List workers and select one",
		handler: async (_args, ctx) => chooseWorker(ctx),
	});
	pi.registerCommand("worker", {
		description: "Switch worker; /worker default [alias|none]; /worker updates [apply] checks newer model versions",
		getArgumentCompletions: (prefix) => {
			const match = prefix.match(/^(\S+)\s+(.*)$/);
			if (match) {
				const [, alias, tail] = match;
				const items = alias === "default"
					? ["none", ...workers.map((w) => w.alias)].filter((v) => v.startsWith(tail!)).map((value) => ({ value, label: value }))
					: alias === "updates" ? ["apply"].filter((v) => v.startsWith(tail!)).map((value) => ({ value, label: value }))
					: byAlias.has(alias!) ? effortCompletions(tail!) : [];
				return items.map((item) => ({ ...item, value: `${alias} ${item.value}` }));
			}
			const matches = [{ alias: "default", description: "Choose the startup default" }, { alias: "updates", description: "Check newer model versions" }, ...workers]
				.filter((worker) => worker.alias.startsWith(prefix))
				.map((worker) => ({ value: worker.alias, label: worker.alias, description: worker.description }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const [alias, ...rest] = args.trim().split(/\s+/);
			if (!alias) return chooseWorker(ctx);
			if (alias === "updates") {
				if (rest.length && !(rest.length === 1 && rest[0] === "apply")) {
					ctx.ui.notify("Usage: /worker updates [apply]", "error");
					return;
				}
				return checkUpdates(ctx, rest[0] === "apply");
			}
			if (alias === "default") {
				let selected = rest.join(" ");
				if (!selected) {
					if (!ctx.hasUI) return ctx.ui.notify(`Default worker: ${defaultWorker ?? "none"}. Use /worker default <alias|none>`, "info");
					selected = await ctx.ui.select(`Default worker: ${defaultWorker ?? "none"}`, ["none", ...workers.map((w) => w.alias)]) ?? "";
					if (!selected) return;
				}
				try {
					saveDefaultWorker(configPath, selected === "none" ? undefined : selected);
					defaultWorker = selected === "none" ? undefined : selected;
					ctx.ui.notify(`Default worker: ${defaultWorker ?? "none"} (applies on startup and /new)`, "info");
				} catch (error) {
					ctx.ui.notify(String(error), "error");
				}
				return;
			}
			await activate(alias, ctx, rest.join(" "));
		},
	});

	for (const worker of workers) {
		pi.registerCommand(worker.alias, {
			description: `Switch to pi worker "${worker.alias}": ${worker.description}`,
			getArgumentCompletions: effortCompletions,
			handler: async (args, ctx) => activate(worker.alias, ctx, args),
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

	pi.on("session_start", async (event, ctx) => {
		currentCtx = ctx;
		disposeFooter?.();
		disposeFooter = ctx.mode === "tui" ? installWorkerFooter(() => state()) : undefined;
		const saved = [...ctx.sessionManager.getEntries()].reverse().find(
			(entry) => entry.type === "custom" && entry.customType === "pi-workers-state",
		) as { data?: { alias?: unknown; thinking?: string } } | undefined;
		preferredAlias = typeof saved?.data?.alias === "string" ? saved.data.alias : null;
		preferredThinking = typeof saved?.data?.thinking === "string" ? parseThinking(saved.data.thinking) : undefined;
		if (defaultWorker && (event.reason === "startup" || event.reason === "new")) await activate(defaultWorker, ctx);
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
		disposeFooter?.();
		disposeFooter = undefined;
		currentCtx = undefined;
	});
}
