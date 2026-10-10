/** Text-only native JSON transport. No retries, payload logs or persistence. */
export function evaluationNativeIoCode(message: string): string {
  if (/certificate|ssl|tls|handshake/i.test(message))
    return "EVAL_NETWORK_TLS_ERROR";
  if (/unable to resolve host|unknownhost|dns/i.test(message))
    return "EVAL_NETWORK_DNS_ERROR";
  if (
    /stream was reset|streamreset|http_1_1_required|protocol error/i.test(
      message,
    )
  )
    return "EVAL_NETWORK_PROTOCOL_ERROR";
  if (/unexpected end|eofexception|connection reset|broken pipe/i.test(message))
    return "EVAL_NETWORK_CONNECTION_CLOSED";
  if (/cancell?ed|abort/i.test(message)) return "EVAL_NETWORK_CANCELLED";
  if (/timed? ?out|timeout/i.test(message)) return "EVAL_REQUEST_TIMEOUT";
  if (
    /failed to connect|connectexception|network is unreachable/i.test(message)
  )
    return "EVAL_NETWORK_CONNECT_ERROR";
  return "EVAL_NETWORK_REQUEST_FAILED";
}

/** MWA may foreground the app while Android still caches a failed DNS lookup.
 * Probe only a public GET before the FIRST submission. Never retry a POST,
 * ask for another signature, persist a packet, or extend its original expiry. */
export async function waitForEvaluationNetwork(
  deadline: number,
  probe = () =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://cmarket-nine.vercel.app/", true);
      xhr.responseType = "text";
      xhr.timeout = 3500;
      xhr.onload = () =>
        xhr.status === 200
          ? resolve()
          : reject(Error("EVAL_NETWORK_REQUEST_FAILED"));
      xhr.onerror = () =>
        reject(Error(evaluationNativeIoCode(xhr.responseText)));
      xhr.ontimeout = () => reject(Error("EVAL_REQUEST_TIMEOUT"));
      xhr.send();
    }),
  wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (now() + 4000 >= deadline) throw Error("EVAL_OWNER_REQUEST_EXPIRED");
    try {
      await probe();
      return;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code !== "EVAL_NETWORK_DNS_ERROR" || attempt === 2) throw error;
      if (now() + 15000 >= deadline) throw Error("EVAL_OWNER_REQUEST_EXPIRED");
      await wait(11000);
    }
  }
}

export function nativeEvaluationPost(
  url: string,
  body: string,
  token?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    xhr.open("POST", url, true);
    // RN's fetch selects Blob responses and hides the native IOException.
    // Text gives JSON directly and allows safe classification of IO failures.
    xhr.responseType = "text";
    xhr.timeout = 50000;
    xhr.setRequestHeader("Content-Type", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.onload = () =>
      finish(() => resolve({ status: xhr.status, text: xhr.responseText }));
    xhr.onerror = () =>
      finish(() => {
        let nativeMessage = "";
        try {
          nativeMessage = xhr.responseText;
        } catch {
          /* No diagnostic body. */
        }
        reject(Error(evaluationNativeIoCode(nativeMessage)));
      });
    xhr.ontimeout = () => finish(() => reject(Error("EVAL_REQUEST_TIMEOUT")));
    xhr.onabort = () => finish(() => reject(Error("EVAL_NETWORK_CANCELLED")));
    xhr.send(body);
  });
}
