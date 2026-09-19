import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	WORKERS_API_VERSION,
	WORKERS_CHANGED_EVENT,
	WORKERS_REQUEST_EVENT,
	type SwitchResult,
	type Worker,
	type WorkersAPI,
	type WorkersChangedEvent,
	type WorkersRequest,
	type WorkerState,
} from "./types.js";

export class WorkersUnavailableError extends Error {
	constructor() {
		super("pi-workers is not installed, enabled, or ready");
		this.name = "WorkersUnavailableError";
	}
}

type EventHost = Pick<ExtensionAPI, "events">;
type RequestMessage = { version: 1; method: "list" | "get" | "current" | "switch"; alias?: string };

function request<T>(pi: EventHost, message: RequestMessage): Promise<T> {
	let response: T | Promise<T> | undefined;
	let responded = false;
	const requestMessage = {
		...message,
		respond(value: T | Promise<T>) {
			if (!responded) {
				responded = true;
				response = value;
			}
		},
	};
	pi.events.emit(WORKERS_REQUEST_EVENT, requestMessage as unknown as WorkersRequest);
	if (!responded) return Promise.reject(new WorkersUnavailableError());
	return Promise.resolve(response as T | Promise<T>);
}

export function createWorkersClient(pi: EventHost): WorkersAPI {
	return {
		version: WORKERS_API_VERSION,
		list: () => request<Worker[]>(pi, { version: 1, method: "list" }),
		get: (alias) => request<Worker | undefined>(pi, { version: 1, method: "get", alias }),
		current: () => request<WorkerState>(pi, { version: 1, method: "current" }),
		switch: (alias) => request<SwitchResult>(pi, { version: 1, method: "switch", alias }),
	};
}

export function onWorkersChanged(pi: EventHost, handler: (event: WorkersChangedEvent) => void): () => void {
	return pi.events.on(WORKERS_CHANGED_EVENT, (data) => {
		const event = data as Partial<WorkersChangedEvent>;
		if (event.version === WORKERS_API_VERSION && event.current && event.previous && event.source) {
			handler(event as WorkersChangedEvent);
		}
	});
}

export type {
	SwitchResult,
	Worker,
	WorkersAPI,
	WorkersChangedEvent,
	WorkerState,
} from "./types.js";
