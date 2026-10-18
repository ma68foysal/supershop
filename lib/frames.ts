/**
 * Turns a shelf video (or photos) into small JPEG pictures for the product scan. Only the
 * pictures are uploaded, never the video, so a 100 MB phone video is no problem.
 */
const LONG_SIDE = 900;
const QUALITY = 0.65;
export const MAX_FRAMES = 36;
const EVERY_SECONDS = 1.5;

function toJpeg(source: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, LONG_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALITY).split(",")[1];
}

/** Pictures every 1.5 s through the video, spread evenly if it's long. */
export async function videoFrames(file: File, onProgress: (done: number, total: number) => void) {
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
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(duration / EVERY_SECONDS)));
    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      const at = Math.min(duration - 0.05, ((i + 0.5) * duration) / count);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = Math.max(0, at);
      });
      frames.push(toJpeg(video, video.videoWidth, video.videoHeight));
      onProgress(i + 1, count);
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function photoFrames(files: File[]) {
  const frames: string[] = [];
  for (const file of files.slice(0, MAX_FRAMES)) {
    const bitmap = await createImageBitmap(file);
    frames.push(toJpeg(bitmap, bitmap.width, bitmap.height));
    bitmap.close();
  }
  return frames;
}
