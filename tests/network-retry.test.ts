import { test, expect } from "bun:test";
import { isNetworkError, withNetworkRetry } from "../src/lib/network-retry";

test("'Failed to fetch' counts as a connection failure, wrong password does not", () => {
  expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  expect(isNetworkError({ name: "AuthRetryableFetchError", message: "x" })).toBe(true);
  expect(isNetworkError({ message: "Invalid login credentials", status: 400 })).toBe(false);
});

test("retries after a connection failure and returns the later success", async () => {
  let calls = 0;
  const r = await withNetworkRetry(async () => {
    calls += 1;
    return calls < 3 ? { error: new TypeError("Failed to fetch") } : { error: null, ok: true };
  }, 4, 1);
  expect(calls).toBe(3);
  expect(r.error).toBeNull();
});

test("does not retry a wrong password", async () => {
  let calls = 0;
  await withNetworkRetry(async () => { calls += 1; return { error: { message: "Invalid login credentials", status: 400 } }; }, 4, 1);
  expect(calls).toBe(1);
});
