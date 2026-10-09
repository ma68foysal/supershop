import { AssistantError, runAssistant, type Audio } from "@/lib/assistant/agent";
import type { ChatTurn } from "@/lib/assistant/proposals";
import { DICTS } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";
import { createClient } from "@/lib/supabase/server";
import type { Settings, Staff } from "@/lib/types";

// A turn can take a few model round trips
export const maxDuration = 60;

export async function POST(request: Request) {
  const lang = await getLang();
  const t = DICTS[lang];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: t.aiSignIn }, { status: 401 });

  const [{ data: me }, { data: settings }] = await Promise.all([
    supabase.from("staff").select("id,name,role,active").eq("id", user.id).maybeSingle(),
    supabase.from("settings").select("*").eq("id", 1).single(),
  ]);
  if (!me?.active) return Response.json({ error: t.inactive }, { status: 403 });

  let history: ChatTurn[];
  let audio: Audio | undefined;
  try {
    const body = await request.json();
    // A voice message: a short WAV recording (about 30 s at most)
    if (body.audio && typeof body.audio.data === "string" && body.audio.mimeType === "audio/wav") {
      if (body.audio.data.length > 2_500_000) return Response.json({ error: t.aiTooLong }, { status: 413 });
      audio = { mimeType: "audio/wav", data: body.audio.data };
    }
    history = (Array.isArray(body.history) ? body.history : [])
      .filter((m: ChatTurn) => (m.role === "user" || m.role === "model") && typeof m.text === "string")
      .map((m: ChatTurn) => ({ role: m.role, text: m.text.slice(0, 2000) }));
  } catch {
    return Response.json({ error: t.genericError }, { status: 400 });
  }
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: t.genericError }, { status: 400 });
  }

  try {
    const result = await runAssistant(history, {
      supabase,
      me: me as Staff,
      settings: settings as Settings,
      lang,
    }, audio);
    return Response.json(result);
  } catch (e) {
    const code = e instanceof AssistantError ? e.code : "failed";
    const message = { quota: t.aiQuota, busy: t.aiBusy, config: t.aiConfig, failed: t.aiFailed }[code];
    return Response.json({ error: message }, { status: code === "quota" ? 429 : 503 });
  }
}
