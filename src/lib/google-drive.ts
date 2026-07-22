import { JWT } from "google-auth-library";

/**
 * Uploads a generated .pptx to Google Drive as a native Google Slides deck.
 *
 * Drive performs the conversion on upload (source mimeType pptx, target
 * mimeType application/vnd.google-apps.presentation), so the result is a fully
 * editable Slides file rather than an attached binary.
 *
 * Auth is a service account: no per-user OAuth consent screen and no refresh
 * tokens to babysit, which suits a shared internal tool. The trade-off is that
 * the service account has its own (zero-quota) Drive, so it can only write into
 * a folder that a human has explicitly shared with its email address — hence
 * GOOGLE_DRIVE_FOLDER_ID being required rather than optional.
 *
 * Gated on the env vars below; when they're absent the export route falls back
 * to a plain .pptx download.
 */

// NOT drive.file: that scope is limited to files the app itself created, so a
// folder a human made and shared with the service account is invisible under it
// and resolves as a 404. Writing into an existing shared folder needs the full
// drive scope. The service account still only reaches what's explicitly shared
// with it, so the real blast radius is that one folder.
const SCOPE = "https://www.googleapis.com/auth/drive";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SLIDES_MIME = "application/vnd.google-apps.presentation";

export type DriveUploadResult = {
  id: string;
  name: string;
  webViewLink: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDriveConfigured(): boolean {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    return false;
  }
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        process.env.GOOGLE_PRIVATE_KEY),
  );
}

/**
 * Resolve the service-account credentials from the environment, tolerating the
 * shapes a key realistically arrives in when it's moved by hand through a
 * dashboard.
 *
 * Accepts either GOOGLE_SERVICE_ACCOUNT_JSON (the whole downloaded key file,
 * pasted as-is — the least error-prone option) or the split
 * GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY pair. The key itself may
 * carry surrounding quotes, escaped \n, or real newlines; all three are
 * normalised to a PEM block here rather than relying on a perfect paste.
 */
function loadCredentials(): { email: string; privateKey: string } {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the entire downloaded key file, including the outermost { }.",
      );
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.",
      );
    }
    return {
      email: parsed.client_email,
      privateKey: normalisePrivateKey(parsed.private_key),
    };
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim().replace(
    /^["']|["']$/g,
    "",
  );
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Google Drive credentials are not configured.");
  }
  return { email, privateKey: normalisePrivateKey(rawKey) };
}

/** Coerce a pasted key into a real PEM block, or explain what's wrong with it. */
function normalisePrivateKey(raw: string): string {
  let key = raw.trim();

  // Someone pasted the whole JSON file into GOOGLE_PRIVATE_KEY.
  if (key.startsWith("{")) {
    try {
      const parsed = JSON.parse(key) as { private_key?: string };
      if (parsed.private_key) {
        key = parsed.private_key.trim();
      }
    } catch {
      // fall through to the checks below
    }
  }

  // Strip a wrapping pair of quotes carried over from the JSON value.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  // Escaped newlines (how the JSON stores them, and how Vercel single-line
  // values keep them) become real ones. Also normalise CRLF.
  key = key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();

  if (!key.includes("-----BEGIN") || !key.includes("PRIVATE KEY-----")) {
    throw new Error(
      "The Google private key isn't a PEM block — it should begin with -----BEGIN PRIVATE KEY-----. Copy the private_key value out of the downloaded JSON without the surrounding quotes, or set GOOGLE_SERVICE_ACCOUNT_JSON to the whole file instead.",
    );
  }
  // A PEM must end with a newline for the OpenSSL decoder.
  return key.endsWith("\n") ? key : `${key}\n`;
}

/**
 * Upload `deck` to the configured folder, converting to Google Slides.
 * Returns the new file's id and edit link.
 */
export async function uploadDeckToDrive(
  deck: Buffer,
  name: string,
): Promise<DriveUploadResult> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim().replace(
    /^["']|["']$/g,
    "",
  );
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set.");
  }

  const { email, privateKey } = loadCredentials();

  const auth = new JWT({ email, key: privateKey, scopes: [SCOPE] });
  let token: string | null | undefined;
  try {
    ({ token } = await auth.getAccessToken());
  } catch (error) {
    // Key-parse and clock/JWT failures surface here as opaque OpenSSL codes;
    // say which half of the setup is at fault.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Google rejected the service-account credentials (${detail}). This is the key or the account, not the Drive folder.`,
    );
  }
  if (!token) {
    throw new Error("Could not obtain a Google access token.");
  }

  const metadata = {
    name,
    mimeType: SLIDES_MIME, // ask Drive to convert on ingest
    parents: [folderId],
  };

  // Drive's multipart upload: a JSON metadata part, then the binary part.
  const boundary = `66media-${Math.random().toString(36).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${PPTX_MIME}\r\n\r\n`,
    ),
    deck,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  // Drive converts the .pptx to Slides during ingest, and its gateway
  // intermittently 502/503s mid-conversion — a transient failure, not a bad
  // request. Retry those (and network drops) a few times with backoff; let
  // 4xx (auth, sharing, bad request) fail immediately since retrying won't
  // help. The whole thing stays inside the route's 60s budget.
  const RETRY_STATUSES = new Set([500, 502, 503, 504]);
  const MAX_ATTEMPTS = 3;
  let response: Response | null = null;
  let lastTransient = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: new Uint8Array(body),
        },
      );
    } catch (error) {
      // Network-level failure (connection reset, DNS, socket hang-up).
      lastTransient = error instanceof Error ? error.message : String(error);
      response = null;
      if (attempt < MAX_ATTEMPTS) {
        await delay(attempt * 1500);
        continue;
      }
      throw new Error(
        `Drive upload failed after ${MAX_ATTEMPTS} attempts (network): ${lastTransient}`,
      );
    }

    if (response.ok || !RETRY_STATUSES.has(response.status)) {
      break; // success, or a non-retryable error handled below
    }

    lastTransient = `HTTP ${response.status}`;
    if (attempt < MAX_ATTEMPTS) {
      await delay(attempt * 1500);
    }
  }

  if (!response) {
    throw new Error(`Drive upload failed (network): ${lastTransient}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 404/403 on the parent folder is a sharing problem, not a broken upload —
    // name the folder and the account that needs access, since the raw Drive
    // message only quotes an opaque id.
    if (response.status === 404 || response.status === 403) {
      throw new Error(
        `Drive can't see folder ${folderId} as ${email}. Open that folder in Drive, Share it with ${email} as Editor, and confirm GOOGLE_DRIVE_FOLDER_ID is the part of the folder URL after /folders/.`,
      );
    }
    if (RETRY_STATUSES.has(response.status)) {
      throw new Error(
        `Google Drive is temporarily unavailable (HTTP ${response.status}) — it returned a server error while converting the deck, even after ${MAX_ATTEMPTS} tries. This is on Google's side; try again in a minute, or use the .pptx download.`,
      );
    }
    throw new Error(
      `Drive upload failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const file = (await response.json()) as Partial<DriveUploadResult>;
  if (!file.id) {
    throw new Error("Drive upload returned no file id.");
  }

  return {
    id: file.id,
    name: file.name ?? name,
    webViewLink:
      file.webViewLink ?? `https://docs.google.com/presentation/d/${file.id}/edit`,
  };
}
