"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ScannedProduct } from "@/lib/assistant/scan";
import { useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";
import { cropThumb } from "@/lib/frames";
import { normalize } from "@/lib/search";
import { downsample, encodeWav, merge, toBase64 } from "@/lib/wav-recorder";

/** A product found live, with the picture it was found in. */
export type LiveFound = ScannedProduct & { thumb: string | null };

/** One line of the running transcript: what was said, and the price taken from it. */
type Heard = { id: number; text: string | null; result: string | null; ok: boolean };

const EVERY_MS = 4000; // a picture at least this often, even when nobody speaks
const LONG_SIDE = 768;
const VOICE = 0.02; // loudness that counts as someone speaking
const PAUSE_MS = 700; // this long quiet after speaking = they finished saying the price: send now
const AUDIO_RATE = 16000; // clearer speech than 8 kHz, still small

/**
 * Full-screen camera: every few seconds a picture and the sound since the last one go to the
 * assistant; found products appear at the bottom straight away. "Done" hands them over for checking.
 */
export default function LiveScan({ onDone, onClose }: { onDone: (found: LiveFound[]) => void; onClose: () => void }) {
  const { t, f } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; chunks: Float32Array[]; rate: number } | null>(null);
  // The end of the last piece of sound, sent again with the next one so no sentence is cut in half
  const tailRef = useRef<Float32Array>(new Float32Array(0));
  // The picture before this one: the product may be put down by the time its price is said
  const prevFrameRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const lastSentRef = useRef(0);
  // when the person last spoke, and whether that talk has been sent yet
  const voiceRef = useRef({ at: 0, unsent: false });
  const meterRef = useRef<HTMLSpanElement>(null);
  const pausedRef = useRef(false);
  const foundRef = useRef(new Map<string, LiveFound>());

  const [found, setFound] = useState<LiveFound[]>([]);
  const [status, setStatus] = useState<"starting" | "looking" | "sending" | "paused" | "slow">("starting");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [heard, setHeard] = useState<Heard[]>([]);
  const [hasMic, setHasMic] = useState(false);
  useReportBusy(status === "sending");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    void audioRef.current?.ctx.close();
    audioRef.current = null;
  }, []);

  // Camera (back camera) and, if allowed, the microphone
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const video = { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video });
        } catch {
          if (!cancelled) setError(t.liveCameraDenied);
          return;
        }
      }
      if (cancelled) return stream.getTracks().forEach((tr) => tr.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      if (stream.getAudioTracks().length) {
        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        // phones may start the sound suspended; it records nothing until resumed
        await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const node = ctx.createScriptProcessor(4096, 1, 1);
        const state = { ctx, chunks: [] as Float32Array[], rate: ctx.sampleRate };
        node.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += data[i] * data[i];
          const level = Math.sqrt(sum / (data.length / 4));
          // the microphone bar moves with your voice, so you can see it is listening
          meterRef.current?.style.setProperty("--level", String(Math.min(1, level * 12)));
          if (pausedRef.current) return;
          state.chunks.push(new Float32Array(data));
          if (level > VOICE) voiceRef.current = { at: Date.now(), unsent: true };
        };
        source.connect(node);
        node.connect(ctx.destination);
        audioRef.current = state;
        setHasMic(true);
      }
      setStatus("looking");
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop, t.liveCameraDenied]);

  // One picture + the sound since last time
  const tick = useCallback(async () => {
    const video = videoRef.current;
    if (busyRef.current || pausedRef.current || !video || !video.videoWidth) return;
    busyRef.current = true;
    lastSentRef.current = Date.now();
    voiceRef.current.unsent = false;
    setStatus("sending");
    try {
      const scale = Math.min(1, LONG_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = canvas.toDataURL("image/jpeg", 0.65).split(",")[1];

      let clip: string | undefined;
      const audio = audioRef.current;
      if (audio && audio.chunks.length) {
        const fresh = downsample(merge(audio.chunks.splice(0)), audio.rate, AUDIO_RATE).slice(-AUDIO_RATE * 8);
        const pcm = merge([tailRef.current, fresh]);
        tailRef.current = fresh.slice(-AUDIO_RATE * 4);
        let peak = 0;
        for (let i = 0; i < pcm.length; i += 8) peak = Math.max(peak, Math.abs(pcm[i]));
        if (peak > 0.02) clip = toBase64(encodeWav(pcm, AUDIO_RATE)); // only when someone spoke
      }

      // The transcript line shows up straight away, filled in when the answer comes
      const lineId = Date.now();
      if (clip) setHeard((all) => [...all.slice(-4), { id: lineId, text: null, result: null, ok: false }]);
      const fill = (patch: Partial<Heard>) =>
        setHeard((all) => all.map((h) => (h.id === lineId ? { ...h, ...patch } : h)));

      const res = await fetch("/api/products/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: prevFrameRef.current ? [prevFrameRef.current, frame] : [frame], clip, live: true }),
      });
      const images = prevFrameRef.current ? [prevFrameRef.current, frame] : [frame];
      prevFrameRef.current = frame;
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
      if (!res.ok || !data) fill({ text: "", result: t.liveSlow });
      if (res.status === 429) {
        setError(data?.error ?? t.aiQuota);
        pausedRef.current = true;
        setStatus("paused");
        return;
      }
      if (!res.ok || !data) {
        setStatus("slow");
        return;
      }

      const added: string[] = [];
      for (const p of data.products as ScannedProduct[]) {
        const key = normalize(p.name).replace(/\s+/g, ""); // "200ml" and "200 ml" are the same
        const seen = foundRef.current.get(key);
        if (!seen) {
          const thumb = p.frame !== null && images[p.frame] ? await cropThumb(images[p.frame], p.box).catch(() => null) : null;
          foundRef.current.set(key, { ...p, thumb });
          added.push(`${p.name_bn || p.name}${p.price ? ` ${f.money(p.price)}` : ""}`);
        } else if (p.price !== null && (seen.price === null || (p.price_source === "spoken" && seen.price_source !== "spoken"))) {
          seen.price = p.price;
          seen.price_source = p.price_source;
          added.push(`${seen.name_bn || seen.name} ${f.money(p.price)}`);
        }
      }
      // What it heard, and which price it took from that, so you can check it understood
      if (clip) {
        const said = typeof data.heard === "string" ? data.heard : "";
        const priced = (data.products as ScannedProduct[])
          .filter((p) => p.price !== null && p.price_source === "spoken")
          .map((p) => `${p.name_bn || p.name} ${f.money(p.price!)}`);
        fill({
          text: said,
          result: priced.length ? "✓ " + priced.join(", ") : said ? t.liveNoPrice : t.liveHeardNothing,
          ok: priced.length > 0,
        });
      }
      if (added.length) {
        setFound([...foundRef.current.values()]);
        setFlash("+ " + added.join(", "));
        setTimeout(() => setFlash(null), 3000);
      }
      setStatus(pausedRef.current ? "paused" : "looking");
    } catch {
      setStatus("slow");
      setHeard((all) => all.map((h) => (h.text === null ? { ...h, text: "", result: t.liveSlow } : h)));
    } finally {
      busyRef.current = false;
    }
  }, [f, t]);

  // Send right after the person stops talking, otherwise every few seconds
  useEffect(() => {
    if (status === "starting" || error) return;
    const id = setInterval(() => {
      const now = Date.now();
      const v = voiceRef.current;
      if ((v.unsent && now - v.at > PAUSE_MS) || now - lastSentRef.current > EVERY_MS) void tick();
    }, 200);
    return () => clearInterval(id);
  }, [status === "starting", error, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    if (!pausedRef.current) {
      // don't send talk from the pause
      audioRef.current?.chunks.splice(0);
      tailRef.current = new Float32Array(0);
    }
    setStatus(pausedRef.current ? "paused" : "looking");
  };

  const finish = () => {
    stop();
    onDone([...foundRef.current.values()]);
  };

  const label =
    status === "starting"
      ? t.liveStarting
      : status === "paused"
        ? t.livePaused
        : status === "sending"
          ? t.liveReading
        : status === "slow"
          ? t.liveSlow
          : hasMic
            ? t.liveLookingTalk
            : t.liveLooking;

  // Drawn on the page itself: inside the sliding sheet "full screen" would only fill the sheet
  return createPortal(
    <div className="live" role="dialog" aria-modal="true" aria-label={t.liveScan}>
      <video ref={videoRef} className="live-video" playsInline muted />
      <div className={"live-frame" + (status === "sending" ? " sending" : "")} aria-hidden="true" />

      <div className="live-top">
        <button className="live-icon" onClick={() => { stop(); onClose(); }} aria-label={t.liveClose}>
          ×
        </button>
        <div className="live-status" role="status">
          {hasMic && status !== "paused" ? (
            <span className="live-meter" ref={meterRef} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span className={"rec-dot" + (status === "paused" ? " off" : "")} aria-hidden="true" />
          )}
          {label}
        </div>
        <span className="live-count">{t.liveFound(f.num(found.length))}</span>
      </div>

      {flash && <div className="live-flash">{flash}</div>}
      {error && <div className="live-error">{error}</div>}

      <div className="live-bottom">
        {heard.length > 0 && (
          <ul className="live-feed" aria-live="polite">
            {heard.map((h) => (
              <li key={h.id} className={h.ok ? "ok" : ""}>
                <span>🎤 {h.text === null ? t.liveHeardWait : h.text || "…"}</span>
                {h.result && <small>{h.result}</small>}
              </li>
            ))}
          </ul>
        )}
        {found.length > 0 && (
          <ul className="live-list">
            {[...found].reverse().map((p) => (
              <li key={p.name}>
                {p.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumb} alt="" />
                ) : (
                  <span className="live-noimg" aria-hidden="true" />
                )}
                <b>{p.name_bn || p.name}</b>
                <small>{p.price ? f.money(p.price) : t.noPriceYet}</small>
              </li>
            ))}
          </ul>
        )}
        <div className="live-actions">
          <button className="secondary" onClick={togglePause} disabled={status === "starting" || Boolean(error && !found.length)}>
            {status === "paused" ? t.liveResume : t.livePause}
          </button>
          <button className="primary" onClick={finish} disabled={!found.length}>
            {t.liveDone(f.num(found.length))}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
