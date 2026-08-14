import type { DevlogRequest } from "../server/DevlogRequestRepository.ts";

export const DEFAULT_API_BASE_URL = "https://pvp.up.railway.app";

export async function fetchCommunityRequests(
	baseUrl = DEFAULT_API_BASE_URL,
	fetcher: typeof fetch = fetch,
): Promise<DevlogRequest[]> {
	const endpoint = new URL("/api/devlog/requests", baseUrl);
	const response = await fetcher(endpoint);
	if (!response.ok)
		throw new Error(
			`Community request API returned ${response.status} ${response.statusText}.`,
		);
	const body = (await response.json()) as { requests?: DevlogRequest[] };
	if (!Array.isArray(body.requests))
		throw new Error("Community request API returned an invalid response.");
	return body.requests;
}

if (import.meta.main) {
	const requests = await fetchCommunityRequests(Bun.argv[2]);
	console.log(JSON.stringify(requests, null, 2));
}
