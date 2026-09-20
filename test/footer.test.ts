import assert from "node:assert/strict";
import test from "node:test";
import { FooterComponent } from "@earendil-works/pi-coding-agent";
import { installWorkerFooter, labelModelRow } from "../src/footer.js";

test("worker label shares the model row and preserves native width and other rows", () => {
	const lines = ["~/repo (main)", "\x1b[2m12%/200k\x1b[0m\x1b[2m                    (openai) gpt-6-astra • low\x1b[0m", "other extension"];
	const result = labelModelRow(lines, "gpt-6-astra", "astra");
	assert.equal(result.length, lines.length);
	assert.equal(result[0], lines[0]);
	assert.equal(result[2], lines[2]);
	assert.equal(result[1]!.length, lines[1]!.length);
	assert.match(result[1]!, /\(openai\) \[astra\] gpt-6-astra • low/);
	assert.doesNotMatch(lines[1]!, /\[astra\]/);
});

test("native output is unchanged without an active worker or enough room", () => {
	for (const lines of [["cwd", "stats  astra • low"], ["cwd", "stats          truncated"], ["cwd"]]) {
		assert.equal(labelModelRow(lines, "astra", "astra"), lines);
	}
	const lines = ["cwd", "stats                  astra • low"];
	assert.equal(labelModelRow(lines, "astra", null), lines);
	assert.equal(labelModelRow(lines, null, "astra"), lines);
});

test("native render adapter is restored on teardown", () => {
	const original = FooterComponent.prototype.render;
	const dispose = installWorkerFooter(() => ({ model: null, activeAlias: null }));
	assert.notEqual(FooterComponent.prototype.render, original);
	dispose();
	assert.equal(FooterComponent.prototype.render, original);
	dispose();
	assert.equal(FooterComponent.prototype.render, original);
});
