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

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SLIDES_MIME = "application/vnd.google-apps.presentation";

export type DriveUploadResult = {
  id: string;
  name: string;
  webViewLink: string;
};

export function isDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_DRIVE_FOLDER_ID,
  );
}

/**
 * Upload `deck` to the configured folder, converting to Google Slides.
 * Returns the new file's id and edit link.
 */
export async function uploadDeckToDrive(
  deck: Buffer,
  name: string,
): Promise<DriveUploadResult> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey || !folderId) {
    throw new Error("Google Drive is not configured.");
  }

  // Vercel env vars store the PEM with literal \n sequences.
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new JWT({ email, key: privateKey, scopes: [SCOPE] });
  const { token } = await auth.getAccessToken();
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

  const response = await fetch(
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

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
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
