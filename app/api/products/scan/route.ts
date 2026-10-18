import { scanImages } from "@/lib/assistant/scan";
import { DICTS } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";
import { createClient } from "@/lib/supabase/server";

// Reading a batch of shelf pictures takes a few seconds
export const maxDuration = 60;

const MAX_IMAGES = 12;
const MAX_BYTES = 3_500_000; // keeps the request under the hosting limit

export async function POST(request: Request) {
  const t = DICTS[await getLang()];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: t.aiSignIn }, { status: 401 });

  let images: string[];
  try {
    const body = await request.json();
    images = (Array.isArray(body.images) ? body.images : []).filter((x: unknown) => typeof x === "string");
  } catch {
    return Response.json({ error: t.genericError }, { status: 400 });
  }
  if (!images.length || images.length > MAX_IMAGES || images.join("").length > MAX_BYTES) {
    return Response.json({ error: t.genericError }, { status: 400 });
  }

  const result = await scanImages(images);
  if ("products" in result) return Response.json(result);
  const message = { quota: t.aiQuota, busy: t.aiBusy, config: t.aiConfig, failed: t.aiFailed }[result.error];
  return Response.json({ error: message }, { status: result.error === "quota" ? 429 : 503 });
}
