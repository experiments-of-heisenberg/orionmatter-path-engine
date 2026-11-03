/** Helpers for API tests: build requests, read event streams, and install fake services. */
import { parseEnv } from "../../src/lib/env";
import { createServices, setServices, type Services } from "../../src/lib/api/services";
import { parseSse, type SseEvent } from "../../src/lib/api/sse";
import type { ModelClient } from "../../src/lib/model";

export const BASE = "http://localhost/api";

export const person = {
  profile: {
    roleFamily: "backend",
    level: "L5",
    yearsExperience: 7,
    stack: ["go", "kubernetes"],
    region: "IN-south",
  },
  goal: { targetLevel: "L6", label: "Staff Engineer" },
};

/** A POST request with a JSON body. */
export function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

/** Read an event stream to the end. */
export async function readEvents(response: Response): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  if (!response.body) return events;
  for await (const event of parseSse(response.body)) events.push(event);
  return events;
}

export interface TestServices {
  services: Services;
  logs: string[];
  clock: { now: number };
}

/** Install fake services (and return them) for one test. */
export function installServices(client: ModelClient, env: Record<string, string> = {}): TestServices {
  const logs: string[] = [];
  const clock = { now: 1_000_000 };
  const services = createServices({
    env: parseEnv({ MODEL_API_KEY: "test-key-not-real", LOG_LEVEL: "debug", ...env }),
    client,
    logSink: (line) => logs.push(line),
    now: () => clock.now,
  });
  setServices(services);
  return { services, logs, clock };
}

export function resetServices(): void {
  setServices(undefined);
}
