import { describe, expect, test } from "bun:test";
import {
  buildDocument,
  CHANGELOG_MAX_ATTEMPTS,
  CHANGELOG_MODEL,
  extractPeriods,
  generatePeriods,
  PROJECT_INITIALIZATION_MODEL,
  parseGitLog,
  projectInitializationCommit,
  promptFor,
  runLLM,
  selectChangelogCommits,
  semanticCommitType,
  startOfWeek,
  weekKey,
  weekStartsBetween,
} from "../scripts/changelog";

describe("generated devlog history", () => {
  test("requires detailed summaries of every supplied reportable commit", () => {
    const prompt = promptFor([
      {
        key: "2026-W32",
        commits: [
          {
            hash: "newest",
            authoredAt: "2026-08-07T10:00:00Z",
            title: "feat: add realms",
            description: "Adds realm matchmaking.",
          },
          {
            hash: "older",
            authoredAt: "2026-08-06T10:00:00Z",
            title: "fix: preserve drops",
            description: "Keeps drops through reconnects.",
          },
        ],
        groupedCategories: [],
        projectInitialized: false,
      },
    ]);

    expect(prompt).toContain(
      "Prioritize completeness for features and bugfixes",
    );
    expect(prompt).toContain("regardless of its position in the log");
    expect(prompt).toContain(
      "features for new player-facing functionality, bugfixes for fixed bugs",
    );
    expect(prompt).toContain("performance for what became faster");
    expect(prompt).toContain("balance for tuning");
    expect(prompt).toContain("ux for design or experience changes");
    expect(prompt).toContain(
      "graphics for rendering, visual-presentation, sound-effect, or music work",
    );
    expect(prompt).toContain(
      "visual and audio presentation work into the dedicated Graphics & Sounds category",
    );
    expect(prompt).toContain(
      "Every distinct player-facing feature and every distinct fixed problem must appear",
    );
    expect(prompt).toContain(
      "preserve important standalone systems such as authentication",
    );
    expect(prompt).toContain(
      "For performance, balance, ux, and graphics, provide an abstract higher-level recap",
    );
    expect(prompt).toContain("Use no more than three concise lines per bucket");
    expect(prompt).toContain("only its primary player-facing bucket");
    expect(prompt).toContain("All six bucket keys belong inside summary");
    expect(prompt).toContain(
      "never return empty strings or empty arrays as placeholders",
    );
    expect(prompt).toContain("feat: add realms");
    expect(prompt).toContain("fix: preserve drops");
  });

  test("schema-validates structured summary buckets", () => {
    expect(
      extractPeriods(
        '{"periods":[{"key":"2026-W32","title":"Realm work","summary":{"features":["Added realms."],"bugfixes":["Preserved drops."]}}]}',
      ),
    ).toEqual([
      {
        key: "2026-W32",
        title: "Realm work",
        summary: {
          features: ["Added realms."],
          bugfixes: ["Preserved drops."],
        },
      },
    ]);
    expect(() =>
      extractPeriods(
        '{"periods":[{"key":"2026-W32","title":"Realm work","summary":{}}]}',
      ),
    ).toThrow("llama.cpp returned invalid changelog JSON");
    expect(() =>
      extractPeriods(
        '{"periods":[{"key":"2026-W32","title":"Realm work","summary":{"other":["Unstructured update."]}}]}',
      ),
    ).toThrow('Unrecognized key: "other"');
  });

  test("normalizes observed llama.cpp bucket shape drift", () => {
    expect(
      extractPeriods(
        '{"periods":[{"key":"2026-W28","title":"Started","summary":{"features":["Project initialized"],"bugfixes":[""],"performance":[],"balance":["  "],"ux":[],"graphics":[]}}]}',
      ),
    ).toEqual([
      {
        key: "2026-W28",
        title: "Started",
        summary: { features: ["Project initialized"] },
      },
    ]);
    expect(
      extractPeriods(
        '{"periods":[{"key":"2026-W31","title":"Systems","summary":{"features":"Added realms"},"performance":"Faster rendering","balance":["Tuned waves"],"ux":"","graphics":[]}]}',
      ),
    ).toEqual([
      {
        key: "2026-W31",
        title: "Systems",
        summary: {
          features: ["Added realms"],
          performance: ["Faster rendering"],
          balance: ["Tuned waves"],
        },
      },
    ]);
    expect(
      extractPeriods(
        '{"periods":[{"periods":[{"key":"2026-W31","title":"Systems","summary":{"features":["Added realms"]}}]}]}',
      ),
    ).toEqual([
      {
        key: "2026-W31",
        title: "Systems",
        summary: { features: ["Added realms"] },
      },
    ]);
  });

  test("uses only the configured changelog model for generation", async () => {
    const attempts: string[] = [];
    const result = await generatePeriods(
      [
        {
          key: "2026-W32",
          commits: [
            {
              hash: "feature",
              authoredAt: "2026-08-07T10:00:00Z",
              title: "feat: added realms",
              description: "",
            },
          ],
          groupedCategories: [],
          projectInitialized: false,
        },
      ],
      async (model, _messages) => {
        attempts.push(model);
        return '{"periods":[{"key":"2026-W32","title":"Started","summary":{"features":["Initialized the project."]}}]}';
      },
    );

    expect(attempts).toEqual([CHANGELOG_MODEL]);
    expect(result.models.get("2026-W32")).toBe(CHANGELOG_MODEL);
  });

  test("retries malformed llama.cpp output with the chat reference", async () => {
    let attempts = 0;
    const conversations: Array<Array<{ role: string; content: string }>> = [];
    const result = await generatePeriods(
      [
        {
          key: "2026-W32",
          commits: [
            {
              hash: "feature",
              authoredAt: "2026-08-07T10:00:00Z",
              title: "feat: added realms",
              description: "",
            },
          ],
          groupedCategories: [],
          projectInitialized: false,
        },
      ],
      async (_model, messages) => {
        attempts += 1;
        conversations.push(messages.map((message) => ({ ...message })));
        return attempts === 1
          ? '{"periods":["invalid"]}'
          : '{"periods":[{"key":"2026-W32","title":"Started","summary":{"features":["Added realms."]}}]}';
      },
    );

    expect(attempts).toBe(2);
    expect(conversations[0]).toHaveLength(1);
    expect(conversations[0][0].role).toBe("user");
    expect(conversations[0][0].content).not.toContain(
      "previous response failed validation",
    );
    expect(conversations[1]).toHaveLength(3);
    expect(conversations[1][1].role).toBe("assistant");
    expect(conversations[1][1].content).toBe('{"periods":["invalid"]}');
    expect(conversations[1][2].role).toBe("user");
    expect(conversations[1][2].content).toContain(
      "previous response failed validation",
    );
    expect(conversations[1][2].content).toContain("invalid changelog JSON");
    expect(result.periods.get("2026-W32")?.title).toBe("Started");
  });

  test("generates an initialization-only week without a model call", async () => {
    let calls = 0;
    const result = await generatePeriods(
      [
        {
          key: "2026-W28",
          commits: [projectInitializationCommit("2026-07-07T10:00:00Z")],
          groupedCategories: [],
          projectInitialized: true,
        },
      ],
      async () => {
        calls += 1;
        return "not used";
      },
    );

    expect(calls).toBe(0);
    expect(result.models.get("2026-W28")).toBe(PROJECT_INITIALIZATION_MODEL);
    expect(result.periods.get("2026-W28")).toEqual({
      key: "2026-W28",
      title: "Initialized project",
      summary: { features: ["Established the project foundation."] },
    });
  });

  test("fails clearly when the changelog model rejects the week", async () => {
    let attempts = 0;
    await expect(
      generatePeriods(
        [
          {
            key: "2026-W32",
            commits: [
              {
                hash: "feature",
                authoredAt: "2026-08-07T10:00:00Z",
                title: "feat: added realms",
                description: "",
              },
            ],
            groupedCategories: [],
            projectInitialized: false,
          },
        ],
        async () => {
          attempts += 1;
          return "not json";
        },
      ),
    ).rejects.toThrow(
      `Changelog generation failed for 2026-W32 with ${CHANGELOG_MODEL} after ${CHANGELOG_MAX_ATTEMPTS} attempts`,
    );
    expect(attempts).toBe(CHANGELOG_MAX_ATTEMPTS);
  });

  test("generates independent weeks concurrently", async () => {
    const reportableWeek = (key: string) => ({
      key,
      commits: [
        {
          hash: "feature",
          authoredAt: "2026-08-07T10:00:00Z",
          title: "feat: added realms",
          description: "",
        },
      ],
      groupedCategories: [] as string[],
      projectInitialized: false,
    });
    let inFlight = 0;
    let maxInFlight = 0;
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
      setTimeout(resolve, 1000);
    });
    const result = await generatePeriods(
      [reportableWeek("2026-W32"), reportableWeek("2026-W33")],
      async (_model, messages) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (inFlight === 2) resolveGate();
        await gate;
        inFlight -= 1;
        const key = messages[0].content.match(/\d{4}-W\d{2}/)?.[0];
        return JSON.stringify({
          periods: [
            {
              key,
              title: "Started",
              summary: { features: [`Added work for ${key}.`] },
            },
          ],
        });
      },
    );

    expect(maxInFlight).toBe(2);
    expect(result.periods.get("2026-W32")?.title).toBe("Started");
    expect(result.periods.get("2026-W33")?.title).toBe("Started");
  });

  test("fails the week when the model returns empty content", async () => {
    const originalFetch = globalThis.fetch;
    const requests: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(input);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      await expect(
        generatePeriods([
          {
            key: "2026-W32",
            commits: [
              {
                hash: "feature",
                authoredAt: "2026-08-07T10:00:00Z",
                title: "feat: added realms",
                description: "",
              },
            ],
            groupedCategories: [],
            projectInitialized: false,
          },
        ]),
      ).rejects.toThrow("empty completion content");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(requests).toHaveLength(CHANGELOG_MAX_ATTEMPTS);
  });

  test("aborts hung model requests after the client timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      })) as typeof fetch;
    try {
      await expect(
        runLLM(CHANGELOG_MODEL, [{ role: "user", content: "test" }], 25),
      ).rejects.toThrow("timed out");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("concatenates streamed completion chunks into the response", async () => {
    const originalFetch = globalThis.fetch;
    const sse =
      "data: " +
      JSON.stringify({ choices: [{ delta: { content: '{"periods":' } }] }) +
      "\n\n" +
      "data: " +
      JSON.stringify({
        choices: [
          {
            delta: {
              content:
                '[{"key":"2026-W32","title":"Started","summary":{"features":["Added realms."]}}]}',
            },
          },
        ],
      }) +
      "\n\ndata: [DONE]\n\n";
    globalThis.fetch = (async () =>
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })) as typeof fetch;
    try {
      const result = await generatePeriods([
        {
          key: "2026-W32",
          commits: [
            {
              hash: "feature",
              authoredAt: "2026-08-07T10:00:00Z",
              title: "feat: added realms",
              description: "",
            },
          ],
          groupedCategories: [],
          projectInitialized: false,
        },
      ]);

      expect(result.periods.get("2026-W32")?.title).toBe("Started");
      expect(result.periods.get("2026-W32")?.summary.features).toEqual([
        "Added realms.",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("serializes the summary before its source commits", () => {
    const week = {
      key: "2026-W32",
      commits: [projectInitializationCommit("2026-08-07T10:00:00Z")],
      groupedCategories: [],
      projectInitialized: true,
    };
    const document = buildDocument(
      week,
      new Date(2026, 7, 3),
      new Map([
        [
          week.key,
          {
            key: week.key,
            title: "Started the project",
            summary: {
              features: ["Initialized the complete project foundation."],
              graphics: ["Established the arena presentation."],
            },
          },
        ],
      ]),
    );
    const periodKeys = Object.keys(document.periods[0]);

    expect(periodKeys.indexOf("summaryTitle")).toBeLessThan(
      periodKeys.indexOf("commits"),
    );
    expect(periodKeys.indexOf("summary")).toBeLessThan(
      periodKeys.indexOf("commits"),
    );
    expect(document.periods[0].categories).toEqual([
      "Features",
      "Graphics & Sounds",
    ]);
  });

  test("parses commit titles and descriptions without diff content", () => {
    expect(
      parseGitLog(
        "\u001eabc\u001f2026-08-06T10:00:00Z\u001fImprove UI\u001fExplains the HUD change.\n",
      ),
    ).toEqual([
      {
        hash: "abc",
        authoredAt: "2026-08-06T10:00:00Z",
        title: "Improve UI",
        description: "Explains the HUD change.",
      },
    ]);
  });

  test("computes ISO calendar week boundaries across years", () => {
    const newYear = startOfWeek(new Date(2026, 0, 1, 12));
    const nextWeek = startOfWeek(new Date(2026, 0, 5, 12));
    expect(newYear).toEqual(new Date(2025, 11, 29));
    expect(weekKey(newYear)).toBe("2026-W01");
    expect(weekKey(nextWeek)).toBe("2026-W02");
  });

  test("lists every ISO calendar week between two dates", () => {
    expect(
      weekStartsBetween(new Date(2025, 11, 28), new Date(2026, 0, 6)).map(
        weekKey,
      ),
    ).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
  });

  test("represents repository creation as a reportable first-week entry", () => {
    expect(projectInitializationCommit("2026-07-07T18:01:40-04:00")).toEqual({
      hash: "project-initialization",
      authoredAt: "2026-07-07T18:01:40-04:00",
      title: "Initialized project",
      description: "",
    });
  });

  test("keeps player-facing semantic changes and groups maintenance work", () => {
    const entry = (title: string) => ({
      hash: title,
      authoredAt: "2026-08-06T10:00:00Z",
      title,
      description: "details",
    });
    const selected = selectChangelogCommits([
      entry("feat(spells): add nova"),
      entry("fix: stop duplicate drops"),
      entry("docs(readme): explain matchmaking"),
      entry("chore: update tooling"),
      entry("test: cover drops"),
      entry("refactor(server): split wave builder"),
    ]);

    expect(selected.commits.map(({ title }) => title)).toEqual([
      "feat(spells): add nova",
      "fix: stop duplicate drops",
    ]);
    expect(selected.groupedCategories).toEqual(["General fixes", "Refactor"]);
    expect(semanticCommitType("ux(hud): improve layout")).toBe("ux");
  });
});
