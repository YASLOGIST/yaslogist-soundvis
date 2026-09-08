/**
 * Pop-out Projector Window — dual-screen output for live setups.
 *
 * Mirrors the WebGL canvas into a borderless secondary window via
 * `canvas.captureStream()` at 60 fps: the projector shows the visuals while
 * the operator keeps the HUD, dock and analysis console on the laptop screen.
 * One render, one GPU pipeline — the mirror costs virtually nothing compared
 * to running a second WebGL context.
 */

export interface OutputHandle {
  readonly window: Window;
  close(): void;
}

const STREAM_FPS = 60;
const WINDOW_NAME = "yaslogist-soundvis-output";

/** Open a mirroring output window for the given canvas, or `null` if blocked. */
export function openOutputWindow(canvas: HTMLCanvasElement): OutputHandle | null {
  const output = window.open("", WINDOW_NAME, "popup=true,width=960,height=540");
  if (!output) return null;

  const doc = output.document;
  doc.open();
  doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>YASLOGIST SOUNDVIS — OUTPUT</title>
  <style>
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
    video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hint {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      font: 500 11px/1 "JetBrains Mono", ui-monospace, monospace;
      letter-spacing: 0.24em; color: #00f0ff; opacity: 0.65;
      background: rgba(0,0,0,0.55); border: 1px solid rgba(0,240,255,0.25);
      padding: 8px 14px; border-radius: 999px; pointer-events: none;
      transition: opacity 0.6s ease; text-transform: uppercase;
    }
  </style>
</head>
<body>
  <video autoplay muted playsinline></video>
  <div class="hint">CLICK FOR FULLSCREEN · CLOSE THIS WINDOW TO END OUTPUT</div>
  <script>
    const v = document.querySelector("video");
    document.addEventListener("click", () => {
      (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    });
    document.addEventListener("mousemove", () => {
      const h = document.querySelector(".hint");
      if (!h) return;
      h.style.opacity = "0.65";
      clearTimeout(window.__hintTimer);
      window.__hintTimer = setTimeout(() => (h.style.opacity = "0"), 2600);
    });
  </script>
</body>
</html>`);
  doc.close();

  const video = doc.querySelector("video");
  const stream = canvas.captureStream(STREAM_FPS);
  if (video) {
    video.srcObject = stream;
    // autoplay policy: the muted attribute plus an explicit play() covers all engines
    void video.play().catch(() => {});
  }

  const handle: OutputHandle = {
    window: output,
    close() {
      stream.getTracks().forEach((track) => track.stop());
      try {
        output.close();
      } catch {
        /* already gone */
      }
    },
  };
  return handle;
}
