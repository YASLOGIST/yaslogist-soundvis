import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

/**
 * NOTE — StrictMode is intentionally disabled.
 *
 * This is a real-time WebGL + Web Audio application. StrictMode's deliberate
 * double-invocation of effects would mount the R3F canvas twice per reload,
 * recompiling every GLSL program, re-allocating ~200k particle attributes and
 * double-arming the Web Audio graph. For deterministic, allocation-free
 * rendering we mount exactly once.
 */
createRoot(document.getElementById("root")!).render(<App />);
