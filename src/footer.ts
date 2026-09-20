import { FooterComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Decorate only the native model row, consuming padding rather than adding width. */
export function labelModelRow(lines: string[], model: string | null, alias: string | null): string[] {
	if (!model || !alias || !lines[1]) return lines;
	const row = lines[1];
	const index = row.lastIndexOf(model);
	if (index < 0) return lines;
	const label = `[${alias}] `;
	const before = row.slice(0, index);
	// Native footer separates stats and the optional provider/model with padding.
	// Prefer consuming padding; on crowded rows truncate stats, not the worker label.
	const padding = / {2,}/g;
	let match: RegExpExecArray | null;
	let gap: RegExpExecArray | undefined;
	while ((match = padding.exec(before))) gap = match;
	if (!gap) return lines;
	const result = [...lines];
	const right = before.slice(gap.index + gap[0].length) + label + row.slice(index);
	const width = visibleWidth(row);
	const leftWidth = Math.max(0, width - visibleWidth(right) - 2);
	const left = truncateToWidth(before.slice(0, gap.index), leftWidth, "…");
	result[1] = truncateToWidth(left + " ".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(right))) + right, width);
	return result;
}

/**
 * Pi exposes footer replacement, but no native model-label decorator. Keep its
 * renderer intact with a reversible adapter instead of copying its stats/layout.
 * Custom footers are deliberately unaffected.
 */
export function installWorkerFooter(getState: () => { model: string | null; activeAlias: string | null }): () => void {
	const original = FooterComponent.prototype.render;
	const render: typeof original = function (this: FooterComponent, width) {
		const lines = original.call(this, width);
		const state = getState();
		return labelModelRow(lines, state.model, state.activeAlias);
	};
	FooterComponent.prototype.render = render;
	return () => {
		if (FooterComponent.prototype.render === render) FooterComponent.prototype.render = original;
	};
}
