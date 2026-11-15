import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker registration failed", e));

    navigator.serviceWorker.ready.then((reg) => {
      setTimeout(() => {
        const urls = performance.getEntriesByType("resource").map((e) => e.name)
          .filter((u) => u.startsWith(location.origin) && /\/(assets|cesium|geo)\//.test(u));
        reg.active?.postMessage({ type: "cache-urls", urls });
      }, 4000);
    });
  });
}
