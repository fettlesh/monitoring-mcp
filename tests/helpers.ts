import type { ToolEntry } from "../src/contract.js";
import { loadContract } from "../src/contract.js";

export const contract = loadContract();

export function tool(name: string): ToolEntry {
  const entry = contract.tools.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(`the vendored contract has no tool '${name}'`);
  }
  return entry;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  redirect: string | undefined;
}

export interface StubResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw body text, for the cases where the payload is not JSON at all. */
  text?: string;
}

export interface FetchStub {
  impl: typeof fetch;
  calls: RecordedRequest[];
}

/** A `fetch` that records what it was asked and answers a canned response. */
export function stubFetch(responses: StubResponse | StubResponse[]): FetchStub {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: RecordedRequest[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
      redirect: init?.redirect,
    });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    const text =
      next.text ?? (next.body === undefined ? "" : JSON.stringify(next.body));
    // 204/205/304 must be constructed with a null body — the Response
    // constructor throws otherwise, which would look like a network failure
    // rather than the empty success it is meant to stand for.
    const bodyless = next.status === 204 || next.status === 205 || next.status === 304;
    return new Response(bodyless || text === "" ? null : text, {
      status: next.status,
      headers: { "Content-Type": "application/json", ...(next.headers ?? {}) },
    });
  }) as typeof fetch;
  return { impl, calls };
}

/** A `fetch` that fails the way a network failure does: by throwing. */
export function throwingFetch(error: Error): typeof fetch {
  return (async () => {
    throw error;
  }) as typeof fetch;
}
