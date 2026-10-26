// The service's line to the host: the drive socket (`HIVE_DRIVE_SOCK`), one JSON message a line.
// It says hello with its grant's token (`HIVE_DRIVE_TOKEN`) for one workspace, then calls methods
// (`{id, method, params}` → `{id, result | error}`), sends notices (`{method, params}`), and hears
// events (`{event, params}`): `plugin.called` and `options.changed`. A line may hold a list of
// messages: the host batches the events of one moment.
import net from "node:net";

export class DriveError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface Welcome {
  api: string;
  as: { client?: string; role?: string; workspace: string };
}

type Waiting = { resolve(v: unknown): void; reject(e: unknown): void };
type Message = { hello?: Welcome; id?: number; result?: unknown; error?: { code?: string; message?: string }; event?: string; params?: unknown[] };

export class DriveClient {
  private socket?: net.Socket;
  private buf = "";
  private next = 1;
  private readonly waiting = new Map<number, Waiting>();
  private readonly listeners = new Map<string, ((params: unknown[]) => void)[]>();
  private closedResolve!: () => void;
  /** Settles when the connection is gone. */
  readonly closed = new Promise<void>((r) => (this.closedResolve = r));

  constructor(private readonly sock: string, private readonly token: string) {}

  /** Connect and say hello for the workspace at `workspace` (its folder). */
  connect(workspace?: string): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.sock);
      this.socket = s;
      let welcomed = false;
      s.setEncoding("utf8");
      s.on("connect", () => s.write(JSON.stringify({ hello: { token: this.token, ...(workspace ? { workspace } : {}) } }) + "\n"));
      s.on("error", (e) => { if (!welcomed) reject(e); });
      s.on("close", () => {
        for (const w of this.waiting.values()) w.reject(new DriveError("UNAVAILABLE", "the drive connection closed"));
        this.waiting.clear();
        if (!welcomed) reject(new DriveError("UNAVAILABLE", "the drive closed before it said hello"));
        this.closedResolve();
      });
      s.on("data", (chunk: string) => {
        this.buf += chunk;
        for (let i; (i = this.buf.indexOf("\n")) >= 0;) {
          const line = this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 1);
          let frame: unknown;
          try { frame = JSON.parse(line); } catch { continue; }
          // The host sends the events of one moment as one frame, a list: each is heard.
          for (const m of (Array.isArray(frame) ? frame : [frame]) as Message[]) {
            if (!m || typeof m !== "object") continue;
            if (!welcomed) {
              if (m.hello) { welcomed = true; resolve(m.hello); }
              else reject(new DriveError(m.error?.code ?? "FAILED", m.error?.message ?? "the drive refused the hello"));
              continue;
            }
            if (typeof m.id === "number" && this.waiting.has(m.id)) {
              const w = this.waiting.get(m.id)!;
              this.waiting.delete(m.id);
              if (m.error) w.reject(new DriveError(m.error.code ?? "FAILED", m.error.message ?? "refused"));
              else w.resolve(m.result);
            } else if (m.event) {
              for (const f of this.listeners.get(m.event) ?? []) f(m.params ?? []);
            }
          }
        }
      });
    });
  }

  call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new DriveError("UNAVAILABLE", "not connected to the drive"));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket!.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  notice(method: string, ...params: unknown[]): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(JSON.stringify({ method, params }) + "\n");
  }

  on(event: string, f: (params: unknown[]) => void): void {
    const l = this.listeners.get(event) ?? [];
    l.push(f);
    this.listeners.set(event, l);
  }

  close(): void {
    this.socket?.end();
  }
}
