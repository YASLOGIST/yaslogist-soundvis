/**
 * Canvas capture utilities — WebM/MP4 video recording with the source audio
 * muxed in, plus lossless PNG stills.
 *
 * The WebGL canvas is used as the video track, and the Web Audio graph exposes
 * a MediaStreamAudioDestinationNode as the audio track, so the exported file is
 * a complete, shareable clip of the performance.
 */

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=h264,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
];

export function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* continue */
    }
  }
  return null;
}

export function captureSupported(): boolean {
  const c = document.createElement("canvas");
  return (
    typeof MediaRecorder !== "undefined" &&
    pickMime() !== null &&
    typeof c.captureStream === "function"
  );
}

export interface RecorderHandle {
  stop(): void;
  readonly active: boolean;
}

export function startRecording(
  canvas: HTMLCanvasElement,
  audio: MediaStream | null,
  onTick: (seconds: number) => void,
  onDone: (blob: Blob, ext: string, seconds: number) => void,
  onError: (message: string) => void,
): RecorderHandle | null {
  const mime = pickMime();
  if (!mime || typeof canvas.captureStream !== "function") {
    onError("This browser cannot record the canvas (MediaRecorder unavailable).");
    return null;
  }

  const fps = 60;
  let video: MediaStream;
  try {
    video = canvas.captureStream(fps);
  } catch {
    onError("Canvas capture was refused by the browser.");
    return null;
  }

  const tracks = [...video.getVideoTracks()];
  if (audio) tracks.push(...audio.getAudioTracks().filter((t) => t.readyState === "live"));

  const combined = new MediaStream(tracks);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(combined, {
      mimeType: mime,
      videoBitsPerSecond: 14_000_000,
      audioBitsPerSecond: 192_000,
    });
  } catch {
    onError("The selected video codec is not available on this device.");
    return null;
  }

  const chunks: BlobPart[] = [];
  const startedAt = performance.now();
  let timer = 0;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = () => onError("Recording failed unexpectedly.");
  recorder.onstop = () => {
    window.clearInterval(timer);
    const seconds = (performance.now() - startedAt) / 1000;
    const blob = new Blob(chunks, { type: mime });
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    if (blob.size > 0) onDone(blob, ext, seconds);
    else onError("The recording came back empty — try a shorter take.");
    tracks.forEach((t) => {
      if (t.kind === "video") t.stop();
    });
  };

  recorder.start(1000);
  timer = window.setInterval(() => onTick((performance.now() - startedAt) / 1000), 250);

  return {
    active: true,
    stop() {
      if (recorder.state !== "inactive") recorder.stop();
      window.clearInterval(timer);
    },
  };
}

/** Downloads a PNG still of the current framebuffer. */
export function snapshot(canvas: HTMLCanvasElement, name: string): boolean {
  try {
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}
