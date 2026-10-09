/**
 * Forgiving search for shop names typed in a hurry, in Bangla or English letters:
 * পেয়াজ finds পেঁয়াজ, লিচু finds লিচি, "peyaj" finds পেঁয়াজ, "chini" finds চিনি.
 */
import { toAsciiDigits } from "./format";

/* ---------- Bangla spelling variants people mix up ---------- */
// Dropped: chandrabindu, nukta, hasanta, joiners
const BN_DROP = /[ঁ়্‌‍]/g;
// Letters folded together: long/short vowels, sibilants, nasals, aspirated/unaspirated, র/ড়/ঢ়, জ/য
const BN_FOLD: Record<string, string> = {
  "ী": "ি", "ূ": "ু", "ঈ": "ই", "ঊ": "উ",
  "ণ": "ন", "ষ": "স", "শ": "স", "ঙ": "ং", "ৎ": "ত",
  "খ": "ক", "ঘ": "গ", "ছ": "চ", "ঝ": "জ", "য": "জ", "ঠ": "ট", "থ": "ত", "ধ": "দ", "ফ": "প", "ভ": "ব",
  "ড": "র", "ঢ": "র",
};

/** Same spelling-insensitive form for the name and what was typed. */
export function normalize(s: string) {
  return toAsciiDigits(s.normalize("NFC"))
    .toLowerCase()
    .replace(BN_DROP, "")
    .replace(/[ঀ-৿]/g, (c) => BN_FOLD[c] ?? c)
    // keep letters, vowel signs (marks) and digits; anything else separates words
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/* ---------- how a word sounds, so English letters can find Bangla names ---------- */
const ROMAN: Record<string, string> = {
  "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u", "ঋ": "ri", "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri", "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
  "ক": "k", "খ": "k", "গ": "g", "ঘ": "g", "ঙ": "ng", "চ": "c", "ছ": "c", "জ": "j", "ঝ": "j", "ঞ": "n",
  "ট": "t", "ঠ": "t", "ড": "d", "ঢ": "d", "ণ": "n", "ত": "t", "থ": "t", "দ": "d", "ধ": "d", "ন": "n",
  "প": "p", "ফ": "f", "ব": "b", "ভ": "b", "ম": "m", "য": "j", "র": "r", "ল": "l", "শ": "s", "ষ": "s", "স": "s", "হ": "h",
  "ৎ": "t", "ং": "ng", "ঃ": "", "ঁ": "", "্": "",
};

function romanize(s: string) {
  return toAsciiDigits(s.normalize("NFC"))
    .replace(/ড়|ঢ়|ড়|ঢ়/g, "r")
    .replace(/য়|য়/g, "y")
    .replace(/[ঀ-৿]/g, (c) => ROMAN[c] ?? "");
}

/** Spelling-blind sound key: "peyaj", "piyaz", পেঁয়াজ → "piaj". */
function soundKey(word: string) {
  return romanize(word)
    .toLowerCase()
    .replace(/ch|sh|kh|gh|jh|th|dh|bh|ph/g, (m) => ({ ch: "c", sh: "s", kh: "k", gh: "g", jh: "j", th: "t", dh: "d", bh: "b", ph: "f" })[m]!)
    .replace(/z/g, "j")
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/v/g, "b")
    .replace(/w/g, "o")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/[ey]/g, "i")
    .replace(/h/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/** Edit distance (letters added, removed or changed). */
function distance(a: string, b: string) {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** How many mistakes a word may have: by letters, not counting Bangla vowel signs. */
const letters = (s: string) => Array.from(s).filter((c) => !/\p{M}/u.test(c)).length;
const allowed = (len: number) => (len <= 2 ? 0 : len <= 5 ? 1 : 2);

type Prepared = { norm: string; key: string };
const prepare = (w: string): Prepared => ({ norm: normalize(w), key: soundKey(w) });

/** How well one typed word matches one word of a name (0 = not at all). */
function wordScore(q: Prepared, c: Prepared) {
  const qn = Array.from(q.norm);
  if (!qn.length) return 0;
  if (c.norm.startsWith(q.norm)) return 100;
  if (c.norm.includes(q.norm)) return 90;
  // Sounds the same ("chini" / চিনি): better than a near-miss on the letters
  if (q.key.length >= 2 && c.key === q.key) return 85;
  const tol = allowed(letters(q.norm));
  if (tol && distance(q.norm, c.norm) <= tol) return 75;
  if (q.key.length >= 2 && c.key.startsWith(q.key)) return 70;
  // Typed the start of a long word with a mistake: compare against the same length
  if (tol && qn.length >= 4 && distance(q.norm, Array.from(c.norm).slice(0, qn.length).join("")) <= tol) return 65;
  const ktol = allowed(q.key.length);
  if (ktol && c.key && distance(q.key, c.key) <= ktol) return 50;
  if (ktol && q.key.length >= 4 && distance(q.key, c.key.slice(0, q.key.length)) <= ktol) return 40;
  return 0;
}

/**
 * Items whose names match what was typed, best first. Every typed word must match
 * some word of the item (in any of its names); an empty query returns everything.
 */
export function fuzzyFilter<T>(items: T[], query: string, fields: (item: T) => (string | null | undefined)[]): T[] {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return items;
  const raw = toAsciiDigits(query).toLowerCase().trim();
  const typed = query.trim().split(/\s+/).map(prepare);

  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const texts = fields(item).filter(Boolean) as string[];
    // Whole phrase found as typed: best possible
    if (texts.some((t) => toAsciiDigits(t).toLowerCase().includes(raw))) {
      scored.push({ item, score: 1000 });
      continue;
    }
    const candidates = texts.flatMap((t) => t.split(/[\s,./()-]+/)).filter(Boolean).map(prepare);
    let total = 0;
    for (const q of typed) {
      let best = 0;
      for (const c of candidates) best = Math.max(best, wordScore(q, c));
      if (!best) {
        total = 0;
        break;
      }
      total += best;
    }
    if (total) scored.push({ item, score: total });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}
