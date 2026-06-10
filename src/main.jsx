import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

if (import.meta.env.DEV && !window.__workbenchFirstRenderTimingStarted) {
  window.__workbenchFirstRenderTimingStarted = true;
  console.time("workbench:first-render");
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
