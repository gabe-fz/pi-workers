import type { Api, Model } from "@earendil-works/pi-ai";
import type { Worker } from "./types.js";

/** Only numeric versions within the exact same named model family are comparable. */
function versioned(id: string): { family: string; version: number[] } | undefined {
	const match = /^(.*?)(\d+(?:\.\d+)*)([^\d]*)$/.exec(id);
	if (!match) return undefined;
	return { family: `${match[1]}\0${match[3]}`, version: match[2]!.split(".").map(Number) };
}

function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff) return diff;
	}
	return 0;
}

export interface WorkerUpdate {
	worker: Worker;
	candidate?: Model<Api>;
	status: "current" | "newer" | "unsupported-thinking" | "missing" | "unversioned";
}

/** Advisory only: a higher version is not a guarantee of better quality or price. */
export function findWorkerUpdates(workers: readonly Worker[], available: readonly Model<Api>[]): WorkerUpdate[] {
	return workers.map((worker) => {
		const current = available.find((model) => model.provider === worker.provider && model.id === worker.model);
		if (!current) return { worker, status: "missing" };
		const parsed = versioned(worker.model);
		if (!parsed) return { worker, status: "unversioned" };
		const newer = available.filter((model) => {
			if (model.provider !== worker.provider) return false;
			const other = versioned(model.id);
			return other?.family === parsed.family && compareVersions(other.version, parsed.version) > 0;
		}).sort((a, b) => compareVersions(versioned(b.id)!.version, versioned(a.id)!.version));
		const compatible = newer.find((model) => worker.thinking === "off" ? model.thinkingLevelMap?.off !== null : model.reasoning && model.thinkingLevelMap?.[worker.thinking] !== null);
		if (compatible) return { worker, candidate: compatible, status: "newer" };
		if (newer.length) return { worker, candidate: newer[0]!, status: "unsupported-thinking" };
		return { worker, status: "current" };
	});
}

export function formatWorkerUpdates(updates: readonly WorkerUpdate[]): string {
	return updates.map(({ worker, candidate, status }) => {
		const label = `${worker.alias}: ${worker.provider}/${worker.model}`;
		switch (status) {
			case "newer": return `${label} → ${candidate!.id} (newer; ${worker.thinking} supported)`;
			case "unsupported-thinking": return `${label} → ${candidate!.id} (newer, but ${worker.thinking} unsupported; skipped)`;
			case "missing": return `${label} (not available; cannot check for updates)`;
			case "unversioned": return `${label} (no comparable numeric version)`;
			case "current": return `${label} (current within model family)`;
		}
	}).join("\n");
}
