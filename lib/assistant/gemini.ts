import "server-only";
import { ApiError } from "@google/genai";

/**
 * Shared by the assistant and the product scan: which Gemini models to try, in order, and
 * which ones are resting after running out of free quota or failing.
 *
 * The "lite" models get far more free requests a day than the full ones (gemini-3.5-flash
 * allows only 20), and gemini-3.5-flash-lite answers a sale in about a second.
 */
export const MODELS = (
  process.env.GEMINI_MODELS ??
  "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.8-flash"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export const retryable = (e: unknown) =>
  !(e instanceof ApiError) || [404, 408, 429, 500, 502, 503, 504].includes(e.status);
// Google puts the details in the error text: which limit was hit, and when to retry
export const isDailyLimit = (e: unknown) => e instanceof ApiError && e.status === 429 && /PerDay/i.test(e.message);
export const retryAfterMs = (e: unknown) => {
  const m = e instanceof ApiError ? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(e.message) : null;
  return m ? Number(m[1]) * 1000 : null;
};
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Models that are out of quota or failing are skipped until this time. Lives as long as the
 * server instance, so a used-up model isn't retried on every message.
 */
const resting = new Map<string, number>();

export function rest(model: string, e: unknown) {
  const wait =
    e instanceof ApiError && e.status === 429
      ? (retryAfterMs(e) ?? 60_000)
      : e instanceof ApiError && e.status === 404
        ? 24 * 3600_000
        : 30_000; // busy, timed out or unreachable
  resting.set(model, Date.now() + wait);
}

/** Models to try now, best first (all of them if every one is resting). */
export function readyModels() {
  const ready = MODELS.filter((m) => (resting.get(m) ?? 0) <= Date.now());
  return ready.length ? ready : MODELS;
}

/** True when every model is out for more than an hour, i.e. the daily free limit is used up. */
export const allOutForToday = () => MODELS.every((m) => (resting.get(m) ?? 0) - Date.now() > 3600_000);
