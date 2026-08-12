import { describe, expect, test } from "bun:test";

interface WebAppManifest {
	name: string;
	start_url: string;
	scope: string;
	display: string;
	icons: Array<{
		src: string;
		sizes: string;
		type: string;
		purpose: string;
	}>;
}

describe("web app manifest", () => {
	test("is linked by the game document", async () => {
		const html = await Bun.file("index.html").text();

		expect(html).toContain(
			'<link rel="manifest" href="/manifest.webmanifest" />',
		);
		expect(html).toContain('<meta name="theme-color" content="#0d1418" />');
	});

	test("provides standalone installation metadata and required icons", async () => {
		const manifest = (await Bun.file(
			"public/manifest.webmanifest",
		).json()) as WebAppManifest;

		expect(manifest.name).toBe("Multi-Line Hero");
		expect(manifest.start_url).toBe("/");
		expect(manifest.scope).toBe("/");
		expect(manifest.display).toBe("standalone");

		for (const size of ["192x192", "512x512"]) {
			const icon = manifest.icons.find((candidate) => candidate.sizes === size);
			expect(icon).toBeDefined();
			expect(icon?.type).toBe("image/png");
			expect(icon?.purpose.split(" ")).toContain("maskable");
			expect(await Bun.file(`public${icon?.src}`).exists()).toBe(true);
		}
	});
});
