import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initPostHog } from "./lib/analytics";
import "./index.css";

initPostHog();

createRoot(document.getElementById("root")!).render(<App />);
