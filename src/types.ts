export const WORKERS_API_VERSION = 1 as const;
export const WORKERS_REQUEST_EVENT = "pi-workers:request";
export const WORKERS_CHANGED_EVENT = "pi-workers:changed";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Worker {
	alias: string;
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	description: string;
}

export interface WorkerState {
	activeAlias: string | null;
	provider: string | null;
	model: string | null;
	thinking: ThinkingLevel;
}

export type SwitchErrorCode =
	| "unknown-worker"
	| "model-unavailable"
	| "unsupported-thinking"
	| "busy"
	| "switch-failed";

export type SwitchResult =
	| { ok: true; changed: boolean; current: WorkerState }
	| { ok: false; code: SwitchErrorCode; message: string };

export interface WorkersAPI {
	readonly version: typeof WORKERS_API_VERSION;
	list(): Promise<Worker[]>;
	get(alias: string): Promise<Worker | undefined>;
	current(): Promise<WorkerState>;
	switch(alias: string): Promise<SwitchResult>;
}

export type WorkersRequest =
	| { version: 1; method: "list"; respond(value: Worker[]): void }
	| { version: 1; method: "get"; alias: string; respond(value: Worker | undefined): void }
	| { version: 1; method: "current"; respond(value: WorkerState): void }
	| { version: 1; method: "switch"; alias: string; respond(value: SwitchResult | Promise<SwitchResult>): void };

export interface WorkersChangedEvent {
	version: 1;
	previous: WorkerState;
	current: WorkerState;
	source: "worker-switch" | "model-change" | "thinking-change" | "session-start";
}
