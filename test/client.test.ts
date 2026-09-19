import assert from "node:assert/strict";
import test from "node:test";
import { createWorkersClient, onWorkersChanged, WorkersUnavailableError } from "../src/client.js";
import { WORKERS_CHANGED_EVENT, WORKERS_REQUEST_EVENT, type Worker } from "../src/types.js";

class Bus {
	private handlers = new Map<string, Set<(data: unknown) => void>>();
	emit(channel: string, data: unknown) {
		for (const handler of this.handlers.get(channel) ?? []) handler(data);
	}
	on(channel: string, handler: (data: unknown) => void) {
		const handlers = this.handlers.get(channel) ?? new Set();
		handlers.add(handler);
		this.handlers.set(channel, handlers);
		return () => handlers.delete(handler);
	}
}

const worker: Worker = {
	alias: "quick",
	provider: "test",
	model: "model",
	thinking: "high",
	description: "Quick work",
};

test("client rejects clearly when the extension is absent", async () => {
	const client = createWorkersClient({ events: new Bus() });
	await assert.rejects(client.list(), WorkersUnavailableError);
});

test("client performs request/reply including async switching", async () => {
	const bus = new Bus();
	bus.on(WORKERS_REQUEST_EVENT, (raw) => {
		const request = raw as { method: string; respond(value: unknown): void };
		if (request.method === "list") request.respond([worker]);
		if (request.method === "switch") request.respond(Promise.resolve({ ok: true, changed: true, current: {
			activeAlias: "quick", provider: "test", model: "model", thinking: "high",
		} }));
	});
	const client = createWorkersClient({ events: bus });
	assert.deepEqual(await client.list(), [worker]);
	assert.deepEqual(await client.switch("quick"), {
		ok: true,
		changed: true,
		current: { activeAlias: "quick", provider: "test", model: "model", thinking: "high" },
	});
});

test("changed-event helper filters incompatible events and unsubscribes", () => {
	const bus = new Bus();
	const received: string[] = [];
	const unsubscribe = onWorkersChanged({ events: bus }, (event) => received.push(event.current.activeAlias ?? "none"));
	bus.emit(WORKERS_CHANGED_EVENT, { version: 2 });
	bus.emit(WORKERS_CHANGED_EVENT, {
		version: 1,
		previous: { activeAlias: null, provider: "test", model: "old", thinking: "off" },
		current: { activeAlias: "quick", provider: "test", model: "model", thinking: "high" },
		source: "worker-switch",
	});
	unsubscribe();
	bus.emit(WORKERS_CHANGED_EVENT, {
		version: 1,
		previous: { activeAlias: "quick", provider: "test", model: "model", thinking: "high" },
		current: { activeAlias: null, provider: "test", model: "other", thinking: "off" },
		source: "model-change",
	});
	assert.deepEqual(received, ["quick"]);
});
