import { describe, expect, test } from "bun:test";

async function hudSource(): Promise<string> {
	return Bun.file(new URL("../src/ui/Hud.tsx", import.meta.url)).text();
}

function methodBody(source: string, start: number, endMarker: string): string {
	return source.slice(start, source.indexOf(endMarker, start));
}

describe("panel camera framing recompute triggers", () => {
	test("does not recompute on unrelated per-frame setPlayer updates", async () => {
		const source = await hudSource();
		const start = source.search(/\n\s+setPlayer\(player: PlayerState\)/);
		expect(start).toBeGreaterThanOrEqual(0);
		const body = methodBody(source, start, "configurePanelTriggers");
		expect(body).toMatch(/this\.updateVisibility\(\);/);
		expect(body).not.toMatch(/onPanelLayoutChange/);
	});

	test("recomputes when a panel opens or closes", async () => {
		const source = await hudSource();
		const start = source.search(/\n\s+private setPanelCollapsed\(/);
		expect(start).toBeGreaterThanOrEqual(0);
		const body = methodBody(source, start, "panelOcclusion");
		expect(body).toMatch(/this\.callbacks\.onPanelLayoutChange\(\);/);
	});

	test("recomputes when join visibility flips so the HUD becomes visible", async () => {
		const source = await hudSource();
		const start = source.search(/\n\s+private updateVisibility\(\)/);
		expect(start).toBeGreaterThanOrEqual(0);
		const body = methodBody(source, start, "panelOcclusion");
		expect(body).toMatch(
			/if \(joined !== this\.joinedVisible\) \{\s*this\.joinedVisible = joined;\s*this\.callbacks\.onPanelLayoutChange\(\);/,
		);
	});

	test("keeps the hidden HUD at zero occlusion via display none", async () => {
		const styles = await Bun.file(
			new URL("../src/styles.css", import.meta.url),
		).text();
		expect(styles).toMatch(/\.is-hidden \{\s*display: none;/);
	});
});
