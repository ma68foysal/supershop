/**
 * Prepares a shelf video (or photos) for the product scan on the phone itself: still pictures,
 * and the sound as small 8 kHz WAV pieces. Only these are uploaded, never the video, so a
 * 100 MB phone video is no problem.
 */
import { encodeWav, toBase64 } from "./wav-recorder";

const LONG_SIDE = 900;
const QUALITY = 0.65;
export const MAX_FRAMES = 36;
const EVERY_SECONDS = 1.5;

/** A still picture: base64 JPEG, and the second of the video it came from (null for photos). */
export type Frame = { data: string; at: number | null };

function toJpeg(source: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, LONG_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALITY).split(",")[1];
}

/** Pictures every 1.5 s through the video, spread evenly if it's long. */
export async function videoFrames(file: File, onProgress: (done: number, total: number) => void): Promise<Frame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video"));
    });
    // Some videos don't say how long they are until you jump far ahead
    if (!Number.isFinite(video.duration)) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = 1e9;
      });
    }
    const duration = Number.isFinite(video.duration) ? video.duration : video.currentTime || 0;
    const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(duration / EVERY_SECONDS)));
    const frames: Frame[] = [];
    for (let i = 0; i < count; i++) {
      const at = Math.max(0, Math.min(duration - 0.05, ((i + 0.5) * duration) / count));
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = at;
      });
      frames.push({ data: toJpeg(video, video.videoWidth, video.videoHeight), at: Math.round(at * 10) / 10 });
      onProgress(i + 1, count);
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function photoFrames(files: File[]): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const file of files.slice(0, MAX_FRAMES)) {
    const bitmap = await createImageBitmap(file);
    frames.push({ data: toJpeg(bitmap, bitmap.width, bitmap.height), at: null });
    bitmap.close();
  }
  return frames;
}

const AUDIO_RATE = 8000; // plenty for speech, and keeps each piece small
const PIECE_SECONDS = 90;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/**
 * The video's sound as 90-second WAV pieces, for "এটা লাক্স, ৬০ টাকা" said while filming.
 * Returns nothing when the video has no sound, nobody spoke, or the phone can't decode it.
 */
export async function videoAudio(file: File): Promise<{ data: string; offset: number }[]> {
  if (file.size > MAX_AUDIO_BYTES) return [];
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    void ctx.close();

    // Mix down to mono at 8 kHz
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * AUDIO_RATE), AUDIO_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const samples = (await offline.startRendering()).getChannelData(0);

    // Silent video (no talking): skip, it would only use up the free quota
    let peak = 0;
    for (let i = 0; i < samples.length; i += 8) peak = Math.max(peak, Math.abs(samples[i]));
    if (peak < 0.05) return [];

    const pieces: { data: string; offset: number }[] = [];
    const size = PIECE_SECONDS * AUDIO_RATE;
    for (let start = 0; start < samples.length; start += size) {
      pieces.push({ data: toBase64(encodeWav(samples.subarray(start, start + size), AUDIO_RATE)), offset: start / AUDIO_RATE });
    }
    return pieces;
  } catch {
    return [];
  }
}

/** A small square-ish picture of one product, cut from the frame it was found in. */
export async function cropThumb(frame: string, box: [number, number, number, number] | null): Promise<string> {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${frame}`;
  await img.decode();
  const [y0, x0, y1, x1] = box ?? [0, 0, 1000, 1000];
  const sx = (x0 / 1000) * img.width;
  const sy = (y0 / 1000) * img.height;
  const sw = Math.max(8, ((x1 - x0) / 1000) * img.width);
  const sh = Math.max(8, ((y1 - y0) / 1000) * img.height);
  const scale = 112 / Math.max(sw, sh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}
