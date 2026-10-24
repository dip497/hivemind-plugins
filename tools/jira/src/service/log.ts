// The service log is the host's raw copy of stdout (`services.ts` appends it to a file), so
// nothing the service writes may carry a credential: every line goes through `redact` first.

/** Header values, OAuth fields and URL parameters that hold a credential. */
const PATTERNS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*"?)(bearer|basic)\s+[^\s",}]+/gi, "$1$2 [redacted]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]"],
  [/((?<![A-Za-z_])"?(?:access_token|refresh_token|id_token|client_secret|code_verifier|apiToken|token|password)"?\s*[:=]\s*"?)[^\s"&,}]+/gi, "$1[redacted]"],
  [/([?&](?:code|state|access_token|refresh_token|code_verifier)=)[^&\s"]+/gi, "$1[redacted]"],
];

/** `text` with every credential it holds replaced by `[redacted]`. */
export function redact(text: string): string {
  let out = text;
  for (const [re, by] of PATTERNS) out = out.replace(re, by);
  return out;
}

/** Secrets known at run time (the stored sign-in), redacted wherever they appear verbatim. */
const known = new Set<string>();
export function forget(secret: string | undefined | null): void {
  if (secret) known.delete(secret);
}
export function remember(secret: string | undefined | null): void {
  if (secret && secret.length >= 8) known.add(secret);
}

function scrub(text: string): string {
  let out = text;
  for (const s of known) out = out.split(s).join("[redacted]");
  return redact(out);
}

export type Logger = (message: string, detail?: unknown) => void;

/** One line on stdout, `[jira] …`, with credentials taken out. */
export const log: Logger = (message, detail) => {
  const extra = detail === undefined ? "" : ` ${detail instanceof Error ? detail.message : typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  process.stdout.write(`${scrub(`[jira] ${message}${extra}`)}\n`);
};
