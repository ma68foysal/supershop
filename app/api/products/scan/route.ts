import { scanImages, transcribe, type SpokenNote } from "@/lib/assistant/scan";
import { DICTS } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";
import { createClient } from "@/lib/supabase/server";

// Reading a batch of shelf pictures, or a stretch of sound, takes a few seconds
export const maxDuration = 60;

const MAX_IMAGES = 12;
const MAX_BYTES = 3_500_000; // keeps the request under the hosting limit

/**
 * Two steps of the shelf scan:
 *  { audio, offset }            → what was said while filming, with times
 *  { images, times?, notes? }   → the products in those pictures
 *  { images, clip }             → live scan: the last two camera pictures plus the sound recorded over them
 */
export async function POST(request: Request) {
  const t = DICTS[await getLang()];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: t.aiSignIn }, { status: 401 });

  let body: {
    audio?: unknown;
    offset?: unknown;
    images?: unknown;
    times?: unknown;
    notes?: unknown;
    clip?: unknown;
    live?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: t.genericError }, { status: 400 });
  }

  let result;
  if (typeof body.audio === "string") {
    if (body.audio.length > MAX_BYTES) return Response.json({ error: t.aiTooLong }, { status: 413 });
    result = await transcribe(body.audio, Number(body.offset) || 0);
  } else {
    const images = (Array.isArray(body.images) ? body.images : []).filter((x): x is string => typeof x === "string");
    if (!images.length || images.length > MAX_IMAGES || images.join("").length > MAX_BYTES) {
      return Response.json({ error: t.genericError }, { status: 400 });
    }
    const times = (Array.isArray(body.times) ? body.times : []).map((x) => (typeof x === "number" ? x : null));
    const notes = (Array.isArray(body.notes) ? body.notes : [])
      .filter((n): n is SpokenNote => typeof n?.text === "string" && typeof n?.at === "number")
      .slice(0, 300)
      .map((n) => ({ at: n.at, text: n.text.slice(0, 300) }));
    const clip = typeof body.clip === "string" && body.clip.length < 800_000 ? body.clip : undefined;
    result = await scanImages(images, times, notes, clip, body.live === true);
  }

  if (!("error" in result)) return Response.json(result);
  const message = { quota: t.aiQuota, busy: t.aiBusy, config: t.aiConfig, failed: t.aiFailed }[result.error];
  return Response.json({ error: message }, { status: result.error === "quota" ? 429 : 503 });
}
