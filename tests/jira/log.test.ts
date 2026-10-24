// The service log is the host's raw copy of the service's stdout (design §12.7, §14): whatever the
// service writes there — an SDK error quoting a request, a token response, a URL with a code —
// leaves without the credential in it.
import { expect, spyOn, test } from "bun:test";
import { log, redact, remember } from "../../tools/jira/src/service/log";

test("credentials in headers, OAuth bodies and URLs are taken out of what the service logs; the rest stays", () => {
  const cases: [string, string][] = [
    ["Authorization: Bearer at-abcdefghijklmnop", "Authorization: Bearer [redacted]"],
    ['{"authorization":"Basic dXNlcjpzZWNyZXQtdG9rZW4="}', '{"authorization":"Basic [redacted]"}'],
    ['{"access_token":"at-1234567890","token_type":"Bearer","refresh_token":"rt-0987654321"}', '{"access_token":"[redacted]","token_type":"Bearer","refresh_token":"[redacted]"}'],
    ["grant_type=refresh_token&refresh_token=rt-xyz&client_id=client-1", "grant_type=refresh_token&refresh_token=[redacted]&client_id=client-1"],
    ["http://127.0.0.1:5555/callback?code=code-abc&state=st-1", "http://127.0.0.1:5555/callback?code=[redacted]&state=[redacted]"],
    ["code_verifier=v-123 sent", "code_verifier=[redacted] sent"],
    // Not credentials: a page token and an error code stay readable.
    ['{"nextPageToken":"page-2","code":403}', '{"nextPageToken":"page-2","code":403}'],
  ];
  for (const [raw, want] of cases) expect(redact(raw)).toBe(want);
});

test("a kept token is taken out wherever it shows up, even unlabelled", () => {
  const write = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    remember("at-kept-secret-value-123");
    log("the server said", new Error("bad token at-kept-secret-value-123 in request"));
    expect(String(write.mock.calls[0]![0])).toBe("[jira] the server said bad token [redacted] in request\n");
  } finally {
    write.mockRestore();
  }
});
