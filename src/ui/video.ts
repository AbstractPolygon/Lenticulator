/** Pulling evenly spaced still frames out of a video file (also the MOV half of an iPhone Live Photo). */

export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv)$/i;

export function isVideo(blob: Blob, name: string): boolean {
  return blob.type.startsWith('video/') || VIDEO_EXT.test(name);
}

function once(el: HTMLMediaElement, ok: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error('the video took too long to load')); }, timeoutMs);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('this video format can\'t be played here (try MP4 / H.264)')); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, done); el.removeEventListener('error', fail); };
    el.addEventListener(ok, done);
    el.addEventListener('error', fail);
  });
}

/** `count` frames spread evenly over the video (the middle of each equal slice of time). */
export async function videoFrames(blob: Blob, count: number, onProgress?: (done: number, total: number) => void): Promise<ImageBitmap[]> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const loaded = once(video, 'loadeddata');
    video.src = url;
    await loaded;
    const d = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const n = Math.max(1, Math.round(count));
    const out: ImageBitmap[] = [];
    for (let i = 0; i < n; i++) {
      const t = d ? (d * (i + 0.5)) / n : 0;
      if (Math.abs(video.currentTime - t) > 1e-3) {
        const seeked = once(video, 'seeked');
        video.currentTime = t;
        await seeked;
      }
      out.push(await createImageBitmap(video));
      onProgress?.(i + 1, n);
    }
    return out;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
