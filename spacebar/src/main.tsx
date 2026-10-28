import { createRoot } from "react-dom/client";
import "@vscode/codicons/dist/codicon.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./lib/monaco";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
