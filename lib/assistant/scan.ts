import "server-only";
import type { Part } from "@google/genai";
import { UNITS } from "../types";
import { allOutForToday, clientFor, hasKey, isDailyLimit, readyTargets, rest, retryable } from "./gemini";

export type ScannedProduct = {
  name: string;
  name_bn: string;
  category: string;
  unit: (typeof UNITS)[number];
  price: number | null;
  /** where the price came from: said aloud while filming, or printed on the pack */
  price_source: "spoken" | "pack" | null;
  confidence: "high" | "medium" | "low";
  /** picture (index within the batch) where the product shows best, and its box in 0–1000 units */
  frame: number | null;
  box: [number, number, number, number] | null;
};

/** Something said while filming, with the second it was said. */
export type SpokenNote = { at: number; text: string };

export type ScanError = { error: "quota" | "busy" | "config" | "failed" };

const PRODUCTS_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "English: brand, product and size, e.g. Lux Soap 100g" },
          name_bn: { type: "string", description: "Bangla, as people in the shop say it, e.g. লাক্স সাবান ১০০ গ্রাম" },
          category: { type: "string", description: "Short English group, e.g. Soap, Oil, Spices, Snacks, Drinks, Biscuits, Rice & dal, Toiletries" },
          unit: { type: "string", enum: UNITS },
          price: { type: ["number", "null"], description: "Selling price in taka per unit" },
          price_source: { type: "string", enum: ["spoken", "pack", "none"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          frame: { type: ["integer", "null"], description: "Index of the picture where this product is clearest" },
          box: {
            type: ["array", "null"],
            items: { type: "integer" },
            description: "[ymin, xmin, ymax, xmax] of the product in that picture, each 0 to 1000",
          },
        },
        required: ["name", "name_bn", "category", "unit", "price", "price_source", "confidence", "frame", "box"],
      },
    },
  },
  required: ["products"],
};

const PRODUCTS_PROMPT = `These pictures are frames from a video (or photos) of the shelves of a small grocery shop in Bangladesh. Each picture is labelled with its index and, for video, the second it was taken.
List every distinct product you can identify from its packaging.
- One entry per product and size: the same product seen in several pictures is listed once; different sizes are separate products.
- name: English, brand + product + size (e.g. "Pran Chanachur 150g", "Rupchanda Soybean Oil 1L").
- name_bn: the Bangla name as shop staff would say it (e.g. "প্রাণ চানাচুর ১৫০ গ্রাম").
- unit: how the shop SELLS it, not the pack size. Every packed item (a 100g soap, a 1 litre bottle, a 1 kg salt packet) is "pcs". Only loose goods weighed out for customers (rice, dal, sugar, onions from a sack) are "kg"; eggs are "dozen" or "hali".
- price: if the person filming named this product and said its price (in the spoken notes or the recorded sound), use it and set price_source "spoken" — that is the shop's real price and wins over the pack. Otherwise the maximum retail price printed on the pack when clearly readable, price_source "pack". Otherwise null and "none". Never guess a price.
- Only use a spoken price when the product's name is said together with it ("Pran chanachur, 55 taka"). A price heard without a product name (the start of the sentence may be cut off) belongs to nobody: ignore it.
- A product that was only spoken about (not visible) can be listed too, with frame and box null.
- frame and box: the picture where the product is clearest, and its bounding box there as [ymin, xmin, ymax, xmax] scaled 0–1000.
- confidence: how sure you are about the name and size.
- Skip anything you cannot read or recognise. Don't invent products.`;

const NOTES_SCHEMA = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          seconds: { type: "number", description: "When it was said, in seconds from the start of this audio" },
          text: { type: "string", description: "What was said, as spoken (Bangla or English)" },
        },
        required: ["seconds", "text"],
      },
    },
  },
  required: ["notes"],
};

const NOTES_PROMPT = `This is the sound of a video filmed in a small grocery shop in Bangladesh while walking along the shelves.
Write down everything the person says about products: names, sizes and prices (e.g. "এটা লাক্স সাবান, ৬০ টাকা", "চাল ৭২ টাকা কেজি"), with the second each was said.
Keep their words, in the language they used. Ignore background noise and talk that is not about products. If nobody speaks, return no notes.`;

/**
 * A pack with its size in the name ("Lux Soap 100g", "Soybean Oil 1 Litre") is sold per piece,
 * whatever unit the model gave; grams and millilitres are never a selling unit here.
 */
function sellingUnit(name: string, unit: string): ScannedProduct["unit"] {
  if (!UNITS.includes(unit as ScannedProduct["unit"])) return "pcs";
  if (unit === "g" || unit === "ml") return "pcs";
  const hasSize = /\d\s*(g|gm|kg|ml|l|ltr|litre|liter|গ্রাম|কেজি|লিটার|মিলি)/i.test(name);
  if ((unit === "kg" || unit === "L") && hasSize) return "pcs";
  return unit as ScannedProduct["unit"];
}

/** One JSON request, trying the next model when one is busy or out of free quota. */
async function generateJson<T>(parts: Part[], schema: object): Promise<T | ScanError> {
  if (!hasKey()) return { error: "config" };
  let lastError: unknown;
  for (const target of readyTargets()) {
    try {
      const res = await clientFor(target.key, 50_000).models.generateContent({
        model: target.model,
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json", responseJsonSchema: schema },
      });
      return JSON.parse(res.text ?? "{}") as T;
    } catch (e) {
      lastError = e;
      if (e instanceof SyntaxError) continue; // unreadable reply: try the next model
      if (!retryable(e)) return { error: "failed" };
      rest(target, e);
    }
  }
  return { error: isDailyLimit(lastError) && allOutForToday() ? "quota" : "busy" };
}

const isError = (r: unknown): r is ScanError => typeof r === "object" && r !== null && "error" in r;

/** Writes down what was said while filming (8 kHz WAV, base64), with times shifted by `offset` seconds. */
export async function transcribe(audio: string, offset: number): Promise<{ notes: SpokenNote[] } | ScanError> {
  const r = await generateJson<{ notes?: { seconds: number; text: string }[] }>(
    [{ inlineData: { mimeType: "audio/wav", data: audio } }, { text: NOTES_PROMPT }],
    NOTES_SCHEMA,
  );
  if (isError(r)) return r;
  return {
    notes: (r.notes ?? [])
      .filter((n) => n && typeof n.text === "string" && n.text.trim())
      .map((n) => ({ at: Math.round(((Number(n.seconds) || 0) + offset) * 10) / 10, text: n.text.trim() })),
  };
}

/** Reads shelf pictures (JPEG, base64) into a product list, using what was said while filming. */
export async function scanImages(
  images: string[],
  times: (number | null)[] = [],
  notes: SpokenNote[] = [],
  /** live scan: the sound recorded while this picture was taken (8 kHz WAV, base64) */
  clip?: string,
): Promise<{ products: ScannedProduct[] } | ScanError> {
  const parts: Part[] = [];
  images.forEach((data, i) => {
    parts.push({ text: `Picture ${i}${typeof times[i] === "number" ? ` (at ${times[i]} s)` : ""}:` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data } });
  });
  if (clip) {
    parts.push({ text: "Sound recorded while this picture was being taken (what the person said about the products):" });
    parts.push({ inlineData: { mimeType: "audio/wav", data: clip } });
  } else {
    parts.push({
      text: notes.length
        ? `Spoken notes while filming:\n${notes.map((n) => `${n.at} s: ${n.text}`).join("\n")}`
        : "Nothing was said while filming.",
    });
  }
  parts.push({ text: PRODUCTS_PROMPT });

  const r = await generateJson<{ products?: Partial<ScannedProduct & { price_source: string }>[] }>(parts, PRODUCTS_SCHEMA);
  if (isError(r)) return r;
  const products = (r.products ?? [])
    .filter((p) => p && typeof p.name === "string" && p.name.trim())
    .map((p): ScannedProduct => {
      const price = typeof p.price === "number" && p.price > 0 ? Math.round(p.price * 100) / 100 : null;
      const frame = typeof p.frame === "number" && p.frame >= 0 && p.frame < images.length ? p.frame : null;
      const box =
        Array.isArray(p.box) && p.box.length === 4 && p.box.every((v) => typeof v === "number")
          ? (p.box.map((v) => Math.max(0, Math.min(1000, v))) as ScannedProduct["box"])
          : null;
      return {
        name: p.name!.trim(),
        name_bn: (p.name_bn ?? "").trim(),
        category: (p.category ?? "").trim(),
        unit: sellingUnit(p.name!, String(p.unit)),
        price,
        price_source: price === null ? null : p.price_source === "spoken" ? "spoken" : "pack",
        confidence: p.confidence === "high" || p.confidence === "low" ? p.confidence : "medium",
        frame,
        box: frame === null ? null : box,
      };
    });
  return { products };
}
