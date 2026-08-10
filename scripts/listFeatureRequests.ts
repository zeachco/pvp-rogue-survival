import type { DevlogRequest } from "../server/DevlogRequestRepository.ts";

export const DEFAULT_API_BASE_URL = "https://pvp.up.railway.app";

export function submittedFeatures(requests: DevlogRequest[]): DevlogRequest[] {
	return requests.filter((request) => request.kind === "feature");
}

export async function fetchFeatureRequests(
	baseUrl = DEFAULT_API_BASE_URL,
	fetcher: typeof fetch = fetch,
): Promise<DevlogRequest[]> {
	const endpoint = new URL("/api/devlog/requests", baseUrl);
	const response = await fetcher(endpoint);
	if (!response.ok)
		throw new Error(
			`Feature request API returned ${response.status} ${response.statusText}.`,
		);
	const body = (await response.json()) as { requests?: DevlogRequest[] };
	if (!Array.isArray(body.requests))
		throw new Error("Feature request API returned an invalid response.");
	return submittedFeatures(body.requests);
}

if (import.meta.main) {
	const features = await fetchFeatureRequests(Bun.argv[2]);
	console.log(JSON.stringify(features, null, 2));
}
