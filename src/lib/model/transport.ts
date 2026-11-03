/**
 * transport.ts: the only module in the model layer that touches the network.
 *
 * Why an interface: everything above this file (retries, parsing, agents) is tested
 * offline by swapping in a fake transport that returns canned responses. Production uses
 * `fetchTransport`, a thin wrapper over fetch that adds timeouts and maps failures to
 * typed errors.
 */
import { ModelAbortedError, ModelNetworkError, ModelTimeoutError } from "./errors";

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  /** Already-serialised JSON body. */
  body: string;
  timeoutMs: number;
  /** Caller cancellation. */
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Raw response body. Parsing and validation happen in the client. */
  text: string;
  /** Raw Retry-After header value, if the server sent one. */
  retryAfter: string | null;
}

export interface HttpTransport {
  /** POST and return the response, whatever its status. Throws only for failures with no response. */
  post(request: TransportRequest): Promise<TransportResponse>;
}

/** Production transport built on the platform `fetch`. */
export const fetchTransport: HttpTransport = {
  async post(request) {
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal,
      });
      return {
        status: response.status,
        text: await response.text(),
        retryAfter: response.headers.get("retry-after"),
      };
    } catch (error) {
      // Order matters: a caller abort takes precedence over our own timeout.
      if (request.signal?.aborted) throw new ModelAbortedError();
      if (timeout.aborted) throw new ModelTimeoutError(request.timeoutMs);
      throw new ModelNetworkError(error instanceof Error ? error.message : String(error));
    }
  },
};
