/**
 * Tests for the production HTTP transport against a real local server.
 * Loopback only (127.0.0.1, ephemeral port); the server is closed after each run.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModelAbortedError, ModelNetworkError, ModelTimeoutError } from "../src/lib/model/errors";
import { fetchTransport } from "../src/lib/model/transport";

/** The port a listening server ended up on. */
function boundPort(server: Server): number {
  const address = server.address();
  if (typeof address === "object" && address !== null) return address.port;
  throw new Error("test server is not bound to a port");
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

/** Close a server, dropping even connections that never got a response. */
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/** A port that was just freed, so nothing is listening on it. */
async function closedPort(): Promise<number> {
  const probe = createServer();
  await listen(probe);
  const port = boundPort(probe);
  await close(probe);
  return port;
}

describe("fetchTransport", () => {
  let server!: Server;
  let baseUrl!: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/hang") return; // never answers: forces a client timeout
      if (req.url === "/error") {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "7" });
        res.end(JSON.stringify({ error: { message: "slow down" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "retry-after": "3" });
      res.end(JSON.stringify({ ok: true }));
    });
    await listen(server);
    baseUrl = `http://127.0.0.1:${boundPort(server)}`;
  });

  afterAll(async () => {
    await close(server);
  });

  it("returns the status, body text and retry-after header", async () => {
    const response = await fetchTransport.post({
      url: `${baseUrl}/ok`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
      timeoutMs: 5000,
    });
    expect(response.status).toBe(200);
    expect(response.text).toBe(JSON.stringify({ ok: true }));
    expect(response.retryAfter).toBe("3");
  });

  it("returns a non-2xx status instead of throwing", async () => {
    const response = await fetchTransport.post({
      url: `${baseUrl}/error`,
      headers: { "content-type": "application/json" },
      body: "{}",
      timeoutMs: 5000,
    });
    expect(response.status).toBe(429);
    expect(response.text).toContain("slow down");
    expect(response.retryAfter).toBe("7");
  });

  it("throws ModelTimeoutError when the server never answers", async () => {
    await expect(
      fetchTransport.post({
        url: `${baseUrl}/hang`,
        headers: { "content-type": "application/json" },
        body: "{}",
        timeoutMs: 50,
      }),
    ).rejects.toThrow(ModelTimeoutError);
  });

  it("throws ModelAbortedError when the caller's signal is already aborted", async () => {
    await expect(
      fetchTransport.post({
        url: `${baseUrl}/ok`,
        headers: { "content-type": "application/json" },
        body: "{}",
        timeoutMs: 5000,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(ModelAbortedError);
  });

  it("throws ModelNetworkError when nothing is listening", async () => {
    const port = await closedPort();
    await expect(
      fetchTransport.post({
        url: `http://127.0.0.1:${port}/ok`,
        headers: { "content-type": "application/json" },
        body: "{}",
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(ModelNetworkError);
  });
});
