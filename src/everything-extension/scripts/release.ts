/**
 * Releases the extension to the Chrome Web Store and Firefox Add-ons (AMO).
 * The steps, the credentials and what still needs a browser are described in
 * docs/extension-release.md.
 *
 *   bun run release-ext package          build the store packages and the AMO source archive
 *   bun run release-ext chrome-store-copy  add a store copy next to every built Chrome zip (used by CI)
 *   bun run release-ext firefox-listing  set AMO's homepage, icon and screenshots (live at once)
 *   bun run release-ext firefox-submit   upload the Firefox package to AMO for review
 *   bun run release-ext chrome-upload    upload the Chrome package as a draft
 *   bun run release-ext chrome-status    show the state of the draft and of the live version
 *   bun run release-ext chrome-publish   submit the uploaded draft for review
 */
import { createHmac, createSign, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";

const EXTENSION_DIR = path.resolve(import.meta.dir, "..");
const REPO_ROOT = path.resolve(EXTENSION_DIR, "../..");
const OUTPUT_DIR = path.join(EXTENSION_DIR, ".output");
const STORE_ASSETS_DIR = path.join(EXTENSION_DIR, "store-assets");
const SCREENSHOTS_DIR = path.join(STORE_ASSETS_DIR, "screenshots");

const HOMEPAGE_URL = "https://commonnotes.net";
const AMO_ADDON_ID = "extension@commonnotes.net";
const AMO_API = "https://addons.mozilla.org/api/v5";
const CHROME_ITEM_ID = "jodkhmefbcmgldokmeicpdogkepmcnij";
const CHROME_API = "https://chromewebstore.googleapis.com";
const CHROME_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// AMO rejects a token that lives longer than five minutes. Google allows an hour.
const AMO_TOKEN_LIFETIME_SECONDS = 60;
const GOOGLE_TOKEN_LIFETIME_SECONDS = 600;
const POLL_INTERVAL_MS = 5_000;
// A package's unpacked code is a few megabytes, more than execFileSync's
// default output limit of one megabyte.
const PACKAGE_CODE_MAX_BYTES = 64 * 1024 * 1024;
const MAX_POLLS = 60;

type ReleaseFiles = { chromeZip: string; firefoxZip: string; sourceZip: string };

/** The version of the last production build, which `package` makes. */
function extensionVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(OUTPUT_DIR, "chrome-mv3-prod-backend/manifest.json"), "utf8"));
  return manifest.version;
}

function releaseFiles(): ReleaseFiles {
  const releaseDir = path.join(OUTPUT_DIR, `release-${extensionVersion()}`);
  return {
    chromeZip: path.join(releaseDir, "chrome-store.zip"),
    firefoxZip: path.join(releaseDir, "firefox.zip"),
    sourceZip: path.join(releaseDir, "source.zip"),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See docs/extension-release.md, section "Credentials".`);
  return value;
}

function run(command: string, args: string[], cwd = REPO_ROOT): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** Mozilla's reviewers rebuild the add-on from the source archive and compare
 *  the result with the package. So the archive must be exactly the committed
 *  tree the package was built from, and an uncommitted change would make the
 *  two differ. */
function assertCleanTree(): void {
  const changes = run("git", ["status", "--porcelain", "--untracked-files=no"]).trim();
  if (changes) throw new Error(`Commit these changes first, the source archive is built from HEAD:\n${changes}`);
}

/** The manifest's `key` pins the extension ID for unpacked installs. The store
 *  item already owns that ID, and the Web Store refuses packages that carry a
 *  key. So the store copy goes without it. */
function writeChromeStoreZip(builtZip: string, target: string): void {
  copyFileSync(builtZip, target);
  const workDir = mkdtempSync(path.join(tmpdir(), "cn-release-"));
  const manifest = JSON.parse(run("unzip", ["-p", target, "manifest.json"]));
  delete manifest.key;
  writeFileSync(path.join(workDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  run("zip", [target, "manifest.json"], workDir);
}

/** Version 0.4.0 went to both stores pointing at the local database (GOO-356).
 *  So every store package must contain the production address from
 *  .env.prod-backend before it can be uploaded. */
function assertBuiltForProduction(zipPath: string): void {
  const productionUrl = parse(readFileSync(path.join(REPO_ROOT, ".env.prod-backend"))).VITE_SUPABASE_URL;
  if (!productionUrl) throw new Error(".env.prod-backend has no VITE_SUPABASE_URL");
  const code = execFileSync("unzip", ["-p", zipPath, "*.js"], { encoding: "utf8", maxBuffer: PACKAGE_CODE_MAX_BYTES });
  if (!code.includes(productionUrl)) {
    throw new Error(`${zipPath} does not talk to the production database ${productionUrl}. Do not upload it.`);
  }
}

function packageRelease(): void {
  assertCleanTree();
  run("bun", ["run", "zip-ext"]);
  const version = extensionVersion();
  const files = releaseFiles();
  mkdirSync(path.dirname(files.chromeZip), { recursive: true });
  writeChromeStoreZip(path.join(OUTPUT_DIR, `everything-extension-${version}-chrome.zip`), files.chromeZip);
  copyFileSync(path.join(OUTPUT_DIR, `everything-extension-${version}-firefox.zip`), files.firefoxZip);
  assertBuiltForProduction(files.chromeZip);
  assertBuiltForProduction(files.firefoxZip);
  run("git", ["archive", "--format=zip", "-o", files.sourceZip, "HEAD"]);
  console.log(`Version ${version} packaged in ${path.dirname(files.chromeZip)}`);
}

/** Writes a Web Store copy, without the manifest key, next to every Chrome zip
 *  `wxt zip` left in the output folder. The Build Extension workflow runs this,
 *  so the extension-latest GitHub release carries a package the store
 *  accepts as it is. */
function writeChromeStoreCopies(): void {
  const builtZips = readdirSync(OUTPUT_DIR).filter((name) => name.endsWith("-chrome.zip"));
  if (builtZips.length === 0) throw new Error(`No *-chrome.zip in ${OUTPUT_DIR}. Run wxt zip first.`);
  for (const name of builtZips) {
    const target = path.join(OUTPUT_DIR, name.replace(/-chrome\.zip$/, "-chrome-store.zip"));
    writeChromeStoreZip(path.join(OUTPUT_DIR, name), target);
    console.log(`Wrote ${target}`);
  }
}

function amoAuthHeader(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: requireEnv("AMO_JWT_ISSUER"),
    jti: randomUUID(),
    iat: now,
    exp: now + AMO_TOKEN_LIFETIME_SECONDS,
  }));
  const signature = createHmac("sha256", requireEnv("AMO_JWT_SECRET")).update(`${header}.${payload}`).digest("base64url");
  return `JWT ${header}.${payload}.${signature}`;
}

async function amoRequest<T>(method: string, apiPath: string, body?: FormData | object): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`${AMO_API}${apiPath}`, {
    method,
    headers: { Authorization: amoAuthHeader(), ...(body && !isForm ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`AMO ${method} ${apiPath} failed with ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

function fileField(filePath: string, type: string): Blob {
  return new Blob([readFileSync(filePath)], { type });
}

const amoAddonPath = `/addons/addon/${encodeURIComponent(AMO_ADDON_ID)}`;

async function replaceAmoPreviews(): Promise<void> {
  const addon = await amoRequest<{ previews: { id: number }[] }>("GET", `${amoAddonPath}/`);
  for (const preview of addon.previews) await amoRequest("DELETE", `${amoAddonPath}/previews/${preview.id}/`);
  const screenshots = readdirSync(SCREENSHOTS_DIR).filter((name) => name.endsWith(".png")).sort();
  for (const [position, name] of screenshots.entries()) {
    const form = new FormData();
    form.append("image", fileField(path.join(SCREENSHOTS_DIR, name), "image/png"), name);
    form.append("position", String(position));
    await amoRequest("POST", `${amoAddonPath}/previews/`, form);
    console.log(`AMO screenshot ${position + 1}: ${name}`);
  }
}

async function updateFirefoxListing(): Promise<void> {
  await amoRequest("PATCH", `${amoAddonPath}/`, { homepage: { "en-US": HOMEPAGE_URL } });
  const iconForm = new FormData();
  iconForm.append("icon", fileField(path.join(EXTENSION_DIR, "assets/store-icon-128-full.png"), "image/png"), "icon.png");
  await amoRequest("PATCH", `${amoAddonPath}/`, iconForm);
  console.log(`AMO homepage is ${HOMEPAGE_URL}, and the icon is replaced`);
  await replaceAmoPreviews();
}

type AmoUpload = { uuid: string; processed: boolean; valid: boolean; validation: unknown };

async function waitForAmoValidation(uuid: string): Promise<AmoUpload> {
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const upload = await amoRequest<AmoUpload>("GET", `/addons/upload/${uuid}/`);
    if (upload.processed) return upload;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`AMO had not validated upload ${uuid} after ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000} seconds`);
}

async function submitFirefoxVersion(): Promise<void> {
  const files = releaseFiles();
  const uploadForm = new FormData();
  uploadForm.append("upload", fileField(files.firefoxZip, "application/zip"), "firefox.zip");
  uploadForm.append("channel", "listed");
  const { uuid } = await amoRequest<AmoUpload>("POST", "/addons/upload/", uploadForm);
  const upload = await waitForAmoValidation(uuid);
  if (!upload.valid) throw new Error(`AMO rejected the package:\n${JSON.stringify(upload.validation, null, 2)}`);

  const versionForm = new FormData();
  versionForm.append("upload", uuid);
  versionForm.append("source", fileField(files.sourceZip, "application/zip"), "source.zip");
  versionForm.append("approval_notes", readFileSync(path.join(STORE_ASSETS_DIR, "amo-reviewer-notes.txt"), "utf8"));
  const version = await amoRequest<{ version: string; file: { status: string } }>("POST", `${amoAddonPath}/versions/`, versionForm);
  console.log(`AMO version ${version.version} submitted, file status ${version.file.status}`);
}

async function googleAccessToken(): Promise<string> {
  const key = JSON.parse(readFileSync(requireEnv("CWS_SERVICE_ACCOUNT_KEY_FILE"), "utf8")) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: key.client_email,
    scope: CHROME_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + GOOGLE_TOKEN_LIFETIME_SECONDS,
  }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key, "base64url");
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google refused the service account: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function chromeRequest(method: string, url: string, body?: BodyInit, contentType?: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await googleAccessToken()}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    body,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Chrome Web Store ${method} ${url} failed with ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

const chromeItemName = () => `publishers/${requireEnv("CWS_PUBLISHER_ID")}/items/${CHROME_ITEM_ID}`;

async function uploadChromePackage(): Promise<void> {
  const result = await chromeRequest(
    "POST",
    `${CHROME_API}/upload/v2/${chromeItemName()}:upload`,
    readFileSync(releaseFiles().chromeZip),
    "application/zip",
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.uploadState === "FAILED") throw new Error("The Chrome Web Store refused the package");
  console.log(`Check the draft with: bun run release-ext chrome-status`);
}

async function publishChromeDraft(): Promise<void> {
  const result = await chromeRequest("POST", `${CHROME_API}/v2/${chromeItemName()}:publish`, JSON.stringify({ publishType: "DEFAULT_PUBLISH" }), "application/json");
  console.log(JSON.stringify(result, null, 2));
}

async function printChromeStatus(): Promise<void> {
  console.log(JSON.stringify(await chromeRequest("GET", `${CHROME_API}/v2/${chromeItemName()}:fetchStatus`), null, 2));
}

const COMMANDS: Record<string, () => void | Promise<void>> = {
  package: packageRelease,
  "chrome-store-copy": writeChromeStoreCopies,
  "firefox-listing": updateFirefoxListing,
  "firefox-submit": submitFirefoxVersion,
  "chrome-upload": uploadChromePackage,
  "chrome-status": printChromeStatus,
  "chrome-publish": publishChromeDraft,
};

const command = COMMANDS[process.argv[2] ?? ""];
if (!command) throw new Error(`Usage: bun run release-ext <${Object.keys(COMMANDS).join("|")}>`);
await command();
