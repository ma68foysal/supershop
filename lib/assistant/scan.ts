import "server-only";
import { GoogleGenAI } from "@google/genai";
import { UNITS } from "../types";
import { allOutForToday, isDailyLimit, readyModels, rest, retryable } from "./gemini";

export type ScannedProduct = {
  name: string;
  name_bn: string;
  category: string;
  unit: (typeof UNITS)[number];
  price: number | null;
  confidence: "high" | "medium" | "low";
};

const SCHEMA = {
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
          price: { type: ["number", "null"], description: "Retail price in taka printed on the pack (MRP), only if clearly readable" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "name_bn", "category", "unit", "price", "confidence"],
      },
    },
  },
  required: ["products"],
};

const PROMPT = `These pictures are frames from a video (or photos) of the shelves of a small grocery shop in Bangladesh.
List every distinct product you can identify from its packaging.
- One entry per product and size: the same product seen in several pictures is listed once; different sizes are separate products.
- name: English, brand + product + size (e.g. "Pran Chanachur 150g", "Rupchanda Soybean Oil 1L").
- name_bn: the Bangla name as shop staff would say it (e.g. "প্রাণ চানাচুর ১৫০ গ্রাম").
- unit: how the shop SELLS it, not the pack size. Every packed item (a 100g soap, a 1 litre bottle, a 1 kg salt packet) is "pcs". Only loose goods weighed out for customers (rice, dal, sugar, onions from a sack) are "kg"; eggs are "dozen" or "hali".
- price: the maximum retail price printed on the pack, in taka, only when you can clearly read it; otherwise null. Never guess a price.
- confidence: how sure you are about the name and size.
- Skip anything you cannot read or recognise. Don't invent products.`;

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

/** Reads shelf pictures (JPEG, base64) into a product list, trying the next model if one is busy. */
export async function scanImages(images: string[]): Promise<{ products: ScannedProduct[] } | { error: "quota" | "busy" | "config" | "failed" }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "config" };
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 45_000 } });
  const contents = [
    {
      role: "user",
      parts: [...images.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })), { text: PROMPT }],
    },
  ];

  let lastError: unknown;
  for (const model of readyModels()) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents,
        config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA },
      });
      const parsed = JSON.parse(res.text ?? "{}") as { products?: ScannedProduct[] };
      const products = (parsed.products ?? [])
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          name_bn: (p.name_bn ?? "").trim(),
          category: (p.category ?? "").trim(),
          unit: sellingUnit(p.name, p.unit),
          price: typeof p.price === "number" && p.price > 0 ? Math.round(p.price * 100) / 100 : null,
          confidence: p.confidence ?? "medium",
        }));
      return { products };
    } catch (e) {
      lastError = e;
      if (e instanceof SyntaxError) continue; // unreadable reply: try the next model
      if (!retryable(e)) return { error: "failed" };
      rest(model, e);
    }
  }
  return { error: isDailyLimit(lastError) && allOutForToday() ? "quota" : "busy" };
}
