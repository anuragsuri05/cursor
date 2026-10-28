// Desktop shell: starts the Spacebar server and opens it in a native window.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = process.env.PORT || "4317";
let server;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: "#141414",
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 12, y: 10 },
    webPreferences: { contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  const load = () => win.loadURL(`http://127.0.0.1:${PORT}`).catch(() => setTimeout(load, 300));
  load();
}

app.whenReady().then(() => {
  const root = path.resolve(__dirname, "..");
  server = spawn(process.execPath.includes("Electron") ? "npx" : process.execPath, ["tsx", "server/index.ts", ...process.argv.slice(2)], {
    cwd: root, env: { ...process.env, NODE_ENV: "production", PORT, ELECTRON_RUN_AS_NODE: "" }, stdio: "inherit", shell: true,
  });
  createWindow();
});
app.on("window-all-closed", () => { server?.kill(); app.quit(); });
