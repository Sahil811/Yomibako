import { browser, sleep } from "../util.js";

const DEFAULT_TIMEOUTS = Object.freeze({
  default: 8000,
  jpdbApi: 10000,
  jpdbPage: 10000,
  immersionKit: 7000,
  kanji: 5000,
  gemini: 45000,
  media: 12000,
});

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const telemetryHooks = new Set();

function createAbortError(message = "Request aborted") {
  try {
    return new DOMException(message, "AbortError");
  } catch {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }
}

function createTimedSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let didTimeout = false;
  let timeoutId = null;

  const onParentAbort = () => controller.abort(parentSignal.reason ?? createAbortError());

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason ?? createAbortError());
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  if (Number.isFinite(timeoutMs)) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort(createAbortError(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (parentSignal && !parentSignal.aborted) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    },
    didTimeout() {
      return didTimeout;
    },
  };
}

function maybeEmitTelemetry(event) {
  for (const hook of telemetryHooks) {
    try {
      hook(event);
    } catch (error) {
      console.error("Request telemetry hook failed:", error);
    }
  }

  if (event.outcome === "failure") {
    console.warn("[api] request failed", event);
  } else if (event.outcome === "success" && event.durationMs >= 1500) {
    console.debug("[api] slow request", event);
  }
}

function computeBackoff(attempt) {
  return 250 * 2 ** attempt;
}

function isRetryableError(error) {
  if (error instanceof RequestError) {
    if (error.status !== null) return RETRYABLE_STATUS_CODES.has(error.status);
    return error.retriable;
  }
  return true;
}

function shouldRetry({ error, safeToRetry, retries, attempt }) {
  if (!safeToRetry || attempt >= retries) return false;
  if (isAbortError(error)) return false;
  return isRetryableError(error);
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function parseResponse(response, parseAs) {
  switch (parseAs) {
    case "text":
      return await response.text();
    case "arrayBuffer":
      return await response.arrayBuffer();
    case "json": {
      const text = await response.text();
      return text.trim().length === 0 ? null : JSON.parse(text);
    }
    default:
      throw new Error(`Unsupported parse mode "${parseAs}"`);
  }
}

function jpdbErrorMessage(responseText) {
  if (!responseText) return null;
  try {
    return JSON.parse(responseText)?.error_message ?? null;
  } catch {
    return null;
  }
}

export class RequestError extends Error {
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "RequestError";
    this.service = details.service ?? "request";
    this.operation = details.operation ?? "request";
    this.url = details.url ?? "";
    this.status = details.status ?? null;
    this.code = details.code ?? "REQUEST_FAILED";
    this.retriable = Boolean(details.retriable);
    this.responseText = details.responseText ?? "";
    this.durationMs = details.durationMs ?? null;
  }
}

export function isAbortError(error) {
  return error?.name === "AbortError";
}

export function addRequestTelemetryHook(hook) {
  telemetryHooks.add(hook);
  return () => telemetryHooks.delete(hook);
}

export function addErrorContext(error, context) {
  if (!(error instanceof Error)) return new Error(context);

  const wrapped = new Error(`${error.message} ${context}`, { cause: error });
  wrapped.name = error.name;

  for (const key of ["service", "operation", "url", "status", "code", "retriable", "responseText", "durationMs"]) {
    if (key in error) wrapped[key] = error[key];
  }

  return wrapped;
}

export async function showRequestErrorToast(error, options = {}) {
  if (isAbortError(error)) return;

  const { showToast } = await import(browser.runtime.getURL("/content/toast.js"));
  showToast(options.kind ?? "Error", options.message ?? error.message ?? "Request failed.", {
    timeout: options.timeout ?? 5000,
  });
}

export async function request(service, operation, url, options = {}) {
  const {
    method = "GET",
    headers,
    body,
    credentials,
    signal,
    timeoutMs = DEFAULT_TIMEOUTS.default,
    parseAs = "json",
    safeToRetry = method === "GET",
    retries = safeToRetry ? 1 : 0,
    extractErrorMessage,
  } = options;

  let attempt = 0;

  while (true) {
    const startedAt = performance.now();
    const timer = createTimedSignal(signal, timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        credentials,
        signal: timer.signal,
      });

      if (!response.ok) {
        const responseText = await readResponseText(response);
        const message =
          extractErrorMessage?.(responseText, response) ??
          `${service} ${operation} failed with HTTP ${response.status}`;

        throw new RequestError(message, {
          service,
          operation,
          url,
          status: response.status,
          code: "HTTP_ERROR",
          retriable: RETRYABLE_STATUS_CODES.has(response.status),
          responseText,
          durationMs: performance.now() - startedAt,
        });
      }

      const data = await parseResponse(response, parseAs);

      maybeEmitTelemetry({
        outcome: "success",
        service,
        operation,
        url,
        method,
        durationMs: performance.now() - startedAt,
        attempt,
        status: response.status,
      });

      return data;
    } catch (error) {
      let normalizedError = error;
      const durationMs = performance.now() - startedAt;

      if (timer.didTimeout()) {
        normalizedError = new RequestError(`${service} ${operation} timed out after ${timeoutMs}ms`, {
          service,
          operation,
          url,
          code: "TIMEOUT",
          retriable: true,
          durationMs,
          cause: error,
        });
      } else if (!(error instanceof RequestError) && !isAbortError(error)) {
        normalizedError = new RequestError(error?.message ?? `${service} ${operation} failed`, {
          service,
          operation,
          url,
          code: "NETWORK_ERROR",
          retriable: true,
          durationMs,
          cause: error,
        });
      }

      maybeEmitTelemetry({
        outcome: isAbortError(normalizedError) ? "aborted" : "failure",
        service,
        operation,
        url,
        method,
        durationMs,
        attempt,
        status: normalizedError instanceof RequestError ? normalizedError.status : null,
        error: normalizedError instanceof Error ? normalizedError.message : String(normalizedError),
      });

      if (shouldRetry({ error: normalizedError, safeToRetry, retries, attempt })) {
        timer.cleanup();
        await sleep(computeBackoff(attempt));
        attempt += 1;
        continue;
      }

      throw normalizedError;
    } finally {
      timer.cleanup();
    }
  }
}

function jpdbHeaders(apiToken) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
  };
}

export const jpdbApi = {
  parse({ text, apiToken, signal }) {
    return request("JPDB", "parse", "https://jpdb.io/api/v1/parse", {
      method: "POST",
      headers: jpdbHeaders(apiToken),
      body: JSON.stringify({
        text,
        position_length_encoding: "utf16",
        token_fields: ["vocabulary_index", "position", "length", "furigana"],
        vocabulary_fields: [
          "vid",
          "sid",
          "rid",
          "spelling",
          "reading",
          "frequency_rank",
          "part_of_speech",
          "meanings_chunks",
          "meanings_part_of_speech",
          "card_state",
          "pitch_accent",
        ],
      }),
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbApi,
      safeToRetry: false, // P0: POST parse is not idempotent — never retry (could double-charge?)
      retries: 0,
      signal,
      extractErrorMessage: jpdbErrorMessage,
    });
  },

  addVocabulary({ deckId, vocabulary, apiToken, signal }) {
    return request("JPDB", "add vocabulary", "https://jpdb.io/api/v1/deck/add-vocabulary", {
      method: "POST",
      headers: jpdbHeaders(apiToken),
      body: JSON.stringify({ id: deckId, vocabulary }),
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbApi,
      safeToRetry: false,
      signal,
      extractErrorMessage: jpdbErrorMessage,
    });
  },

  removeVocabulary({ deckId, vocabulary, apiToken, signal }) {
    return request("JPDB", "remove vocabulary", "https://jpdb.io/api/v1/deck/remove-vocabulary", {
      method: "POST",
      headers: jpdbHeaders(apiToken),
      body: JSON.stringify({ id: deckId, vocabulary }),
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbApi,
      safeToRetry: false,
      signal,
      extractErrorMessage: jpdbErrorMessage,
    });
  },

  setCardSentence({ vid, sid, sentence, translation, apiToken, signal }) {
    const body = { vid, sid };
    if (sentence) body.sentence = sentence;
    if (translation) body.translation = translation;

    return request("JPDB", "set card sentence", "https://jpdb.io/api/v1/set-card-sentence", {
      method: "POST",
      headers: jpdbHeaders(apiToken),
      body: JSON.stringify(body),
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbApi,
      safeToRetry: false,
      signal,
      extractErrorMessage: jpdbErrorMessage,
    });
  },

  lookupVocabulary({ list, fields, apiToken, signal }) {
    return request("JPDB", "lookup vocabulary", "https://jpdb.io/api/v1/lookup-vocabulary", {
      method: "POST",
      headers: jpdbHeaders(apiToken),
      body: JSON.stringify({ list, fields }),
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbApi,
      safeToRetry: true,
      retries: 2,
      signal,
      extractErrorMessage: jpdbErrorMessage,
    });
  },

  fetchReviewPage({ vid, sid, signal }) {
    return request("JPDB", "review page", `https://jpdb.io/review?c=vf%2C${vid}%2C${sid}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "*/*" },
      parseAs: "text",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbPage,
      safeToRetry: true,
      retries: 2,
      signal,
    });
  },

  submitReview({ vid, sid, reviewNo, grade, signal }) {
    return request("JPDB", "submit review", "https://jpdb.io/review", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `c=vf%2C${vid}%2C${sid}&r=${reviewNo}&g=${grade}`,
      parseAs: "text",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbPage,
      safeToRetry: false,
      signal,
    });
  },

  prioritize({ vid, sid, signal }) {
    return request("JPDB", "prioritize", "https://jpdb.io/prioritize", {
      method: "POST",
      credentials: "include",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/110.0",
        Accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `v=${vid}&s=${sid}&origin=/`,
      parseAs: "text",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbPage,
      safeToRetry: false,
      signal,
    });
  },

  deprioritize({ vid, sid, signal }) {
    return request("JPDB", "deprioritize", "https://jpdb.io/deprioritize", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `v=${vid}&s=${sid}&origin=`,
      parseAs: "text",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbPage,
      safeToRetry: false,
      signal,
    });
  },

  fetchVocabularyPage({ vid, spelling, signal }) {
    return request("JPDB", "vocabulary page", `https://jpdb.io/vocabulary/${vid}/${encodeURIComponent(spelling)}`, {
      method: "GET",
      credentials: "include",
      parseAs: "text",
      timeoutMs: DEFAULT_TIMEOUTS.jpdbPage,
      safeToRetry: true,
      retries: 2,
      signal,
    });
  },

  fetchAudioBytes({ hash, signal }) {
    return request("JPDB", "audio bytes", `https://jpdb.io/static/v/${hash}`, {
      method: "GET",
      headers: { "X-Access": "please don't steal these files" },
      parseAs: "arrayBuffer",
      timeoutMs: DEFAULT_TIMEOUTS.media,
      safeToRetry: true,
      retries: 2,
      signal,
    });
  },
};

export const immersionKitApi = {
  fetchMetadata(signal) {
    return request("ImmersionKit", "index metadata", "https://apiv2.immersionkit.com/index_meta", {
      method: "GET",
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.immersionKit,
      safeToRetry: true,
      retries: 2,
      signal,
    });
  },

  search(word, signal) {
    const url = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(word)}&exactMatch=false&limit=50&sort=sentence_length:asc`;
    return request("ImmersionKit", "search", url, {
      method: "GET",
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.immersionKit,
      safeToRetry: true,
      retries: 2,
      signal,
    });
  },

  fetchMedia(url, signal) {
    return request("ImmersionKit", "media", url, {
      method: "GET",
      parseAs: "arrayBuffer",
      timeoutMs: DEFAULT_TIMEOUTS.media,
      safeToRetry: true,
      retries: 1,
      signal,
    });
  },
};

export const kanjiApi = {
  fetchKanji(char, signal) {
    return request("KanjiAPI", "kanji lookup", `https://kanjiapi.dev/v1/kanji/${encodeURIComponent(char)}`, {
      method: "GET",
      parseAs: "json",
      timeoutMs: DEFAULT_TIMEOUTS.kanji,
      safeToRetry: true,
      retries: 1,
      signal,
    });
  },
};

export const geminiApi = {
  async explainWord({ apiKey, prompt, signal }) {
    const data = await request(
      "Gemini",
      "word explanation",
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
        }),
        parseAs: "json",
        timeoutMs: DEFAULT_TIMEOUTS.gemini,
        safeToRetry: true,
        retries: 2,
        signal,
      }
    );

    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  },
};

export const youtubeApi = {
  fetchWatchPage(url, signal) {
    return request("YouTube", "watch page", url, {
      method: "GET",
      parseAs: "text",
      timeoutMs: DEFAULT_TIMEOUTS.default,
      safeToRetry: true,
      retries: 1,
      signal,
    });
  },

  fetchTranscript(url, signal) {
    return request("YouTube", "transcript", url, {
      method: "GET",
      parseAs: "text",
      timeoutMs: DEFAULT_TIMEOUTS.default,
      safeToRetry: true,
      retries: 1,
      signal,
    });
  },
};
