import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { bootstrap } from "./bootstrap.js";
import "./styles.css";

/**
 * All Firebase SDK initialization happens inside this side panel page context
 * via bootstrap() — never in the MV3 service worker (AGENTS.md).
 */
void bootstrap().then((boot) => {
  const host = document.getElementById("root");
  if (!host) throw new Error("Root element missing");
  createRoot(host).render(
    <StrictMode>
      <App boot={boot} />
    </StrictMode>,
  );
});
