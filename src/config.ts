import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { ThinkingLevel, Worker } from "./types.js";
import type { WorkerUpdate } from "./updates.js";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const ALIAS_PATTERN = /^[a-z][a-z0-9-]*$/;

// Extension commands take precedence over interactive built-ins, so these aliases are unsafe.
export const RESERVED_ALIASES = new Set([
	"changelog", "clone", "compact", "copy", "export", "fork", "hotkeys", "import", "login", "logout", "model", "name",
	"new", "quit", "reload", "resume", "scoped-models", "session", "settings", "share", "thinking", "tree", "trust", "workers",
	"worker", "default", "none", "updates",
]);

export interface LoadedWorkers {
	workers: Worker[];
	defaultWorker?: string;
	errors: string[];
}

export function parseWorkersConfig(value: unknown): LoadedWorkers {
	const errors: string[] = [];
	const workers: Worker[] = [];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { workers, errors: ["configuration must be a JSON object"] };
	}
	const root = value as Record<string, unknown>;
	if (!root.workers || typeof root.workers !== "object" || Array.isArray(root.workers)) {
		return { workers, errors: ['configuration must contain a "workers" object'] };
	}

	for (const [alias, raw] of Object.entries(root.workers as Record<string, unknown>)) {
		if (!ALIAS_PATTERN.test(alias)) {
			errors.push(`worker alias "${alias}" must match ${ALIAS_PATTERN}`);
			continue;
		}
		if (RESERVED_ALIASES.has(alias)) {
			errors.push(`worker alias "${alias}" conflicts with a pi or pi-workers command`);
			continue;
		}
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			errors.push(`worker "${alias}" must be an object`);
			continue;
		}
		const candidate = raw as Record<string, unknown>;
		const invalid: string[] = [];
		if (typeof candidate.provider !== "string" || !candidate.provider.trim()) invalid.push("provider");
		if (typeof candidate.model !== "string" || !candidate.model.trim()) invalid.push("model");
		if (typeof candidate.description !== "string" || !candidate.description.trim()) invalid.push("description");
		if (typeof candidate.thinking !== "string" || !THINKING_LEVELS.has(candidate.thinking as ThinkingLevel)) invalid.push("thinking");
		if (invalid.length > 0) {
			errors.push(`worker "${alias}" has invalid or missing fields: ${invalid.join(", ")}`);
			continue;
		}
		workers.push({
			alias,
			provider: (candidate.provider as string).trim(),
			model: (candidate.model as string).trim(),
			thinking: candidate.thinking as ThinkingLevel,
			description: (candidate.description as string).trim(),
		});
	}
	if (root.defaultWorker !== undefined) {
		if (typeof root.defaultWorker !== "string" || !workers.some((w) => w.alias === root.defaultWorker)) {
			errors.push('"defaultWorker" must name a valid worker');
		} else {
			return { workers, errors, defaultWorker: root.defaultWorker };
		}
	}
	return { workers, errors };
}

export function saveDefaultWorker(path: string, alias?: string): void {
	const root = JSON.parse(readFileSync(path, "utf8"));
	const parsed = parseWorkersConfig(root);
	if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
	if (alias && !parsed.workers.some((w) => w.alias === alias)) throw new Error(`Unknown worker "${alias}"`);
	if (alias) root.defaultWorker = alias;
	else delete root.defaultWorker;
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

export function saveWorkerUpdates(path: string, updates: readonly WorkerUpdate[]): void {
	const root = JSON.parse(readFileSync(path, "utf8"));
	const parsed = parseWorkersConfig(root);
	if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
	for (const update of updates) {
		if (update.status !== "newer" || !update.candidate) continue;
		const configured = root.workers[update.worker.alias];
		if (configured?.provider !== update.worker.provider || configured.model !== update.worker.model || configured.thinking !== update.worker.thinking) {
			throw new Error(`Worker "${update.worker.alias}" changed since the update check; rerun /worker updates`);
		}
	}
	for (const update of updates) {
		if (update.status === "newer" && update.candidate) root.workers[update.worker.alias].model = update.candidate.id;
	}
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 });
		renameSync(temporary, path);
	} catch (error) {
		try { unlinkSync(temporary); } catch { /* no temp file */ }
		throw error;
	}
}

export function loadWorkersConfig(path: string): LoadedWorkers {
	try {
		return parseWorkersConfig(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { workers: [], errors: [`cannot read ${path}: ${detail}`] };
	}
}
