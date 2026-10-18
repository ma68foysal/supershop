import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";

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

/**
 * The main key, then backup keys (GEMINI_BACKUP_API_KEYS, comma separated). A backup key is
 * only used when every model on the keys before it is busy or out for the day. Note: Google's
 * terms limit using extra accounts to get past free-tier limits; the shop owner chose to keep
 * backups for emergencies knowing that.
 */
const KEYS = [process.env.GEMINI_API_KEY, ...(process.env.GEMINI_BACKUP_API_KEYS ?? "").split(",")]
  .map((k) => k?.trim())
  .filter((k): k is string => Boolean(k));

export const hasKey = () => KEYS.length > 0;

const clients = new Map<string, GoogleGenAI>();
/** One Gemini client per key and time limit. */
export function clientFor(key: number, timeoutMs: number) {
  const id = `${key}:${timeoutMs}`;
  let c = clients.get(id);
  if (!c) {
    c = new GoogleGenAI({ apiKey: KEYS[key], httpOptions: { timeout: timeoutMs } });
    clients.set(id, c);
  }
  return c;
}

/** A model on a key: what each attempt is made with. */
export type Target = { key: number; model: string };

/** The key itself is wrong, deleted or blocked: skip that key, a backup may still work. */
const keyProblem = (e: unknown) =>
  e instanceof ApiError && (e.status === 401 || e.status === 403 || (e.status === 400 && /api.?key/i.test(e.message)));

export const retryable = (e: unknown) =>
  !(e instanceof ApiError) || keyProblem(e) || [404, 408, 429, 500, 502, 503, 504].includes(e.status);
// Google puts the details in the error text: which limit was hit, and when to retry
export const isDailyLimit = (e: unknown) => e instanceof ApiError && e.status === 429 && /PerDay/i.test(e.message);
export const retryAfterMs = (e: unknown) => {
  const m = e instanceof ApiError ? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(e.message) : null;
  return m ? Number(m[1]) * 1000 : null;
};
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Models that are out of quota or failing are skipped until this time, per key. Lives as long
 * as the server instance, so a used-up model isn't retried on every message.
 */
const resting = new Map<string, number>();
const restKey = (t: Target) => `${t.key}:${t.model}`;

export function rest(target: Target, e: unknown) {
  const wait =
    e instanceof ApiError && e.status === 429
      ? (retryAfterMs(e) ?? 60_000)
      : (e instanceof ApiError && e.status === 404) || keyProblem(e)
        ? 24 * 3600_000
        : 30_000; // busy, timed out or unreachable
  resting.set(restKey(target), Date.now() + wait);
}

const allTargets = (): Target[] => KEYS.flatMap((_, key) => MODELS.map((model) => ({ key, model })));

/** What to try now, best first: every model on the main key, then on each backup key. */
export function readyTargets() {
  const all = allTargets();
  const ready = all.filter((t) => (resting.get(restKey(t)) ?? 0) <= Date.now());
  return ready.length ? ready : all;
}

/** True when every model on every key is out for more than an hour: the daily free limit is used up. */
export const allOutForToday = () => allTargets().every((t) => (resting.get(restKey(t)) ?? 0) - Date.now() > 3600_000);
