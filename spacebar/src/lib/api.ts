// REST + WebSocket client for the Spacebar server.

async function req<T = any>(method: string, url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  get: <T = any>(url: string) => req<T>("GET", url),
  post: <T = any>(url: string, body?: any) => req<T>("POST", url, body ?? {}),
  q: (o: Record<string, any>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString(),
};

export async function streamText(url: string, body: any, onText: (d: string) => void, signal?: AbortSignal) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const t = dec.decode(value, { stream: true });
    const err = t.indexOf("\u0000ERROR:");
    if (err >= 0) { if (err > 0) onText(t.slice(0, err)); throw new Error(t.slice(err + 7)); }
    onText(t);
  }
}

type Listener = (msg: any) => void;

class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: string[] = [];
  connected = false;

  connect() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      for (const m of this.queue) ws.send(m);
      this.queue = [];
      this.emit({ type: "socket.open" });
    };
    ws.onmessage = (e) => { try { this.emit(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onclose = () => {
      this.connected = false;
      this.emit({ type: "socket.close" });
      setTimeout(() => this.connect(), 1000);
    };
  }
  send(msg: any) {
    const s = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }
  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(m: any) { for (const l of this.listeners) l(m); }
}

export const socket = new Socket();
socket.connect();
