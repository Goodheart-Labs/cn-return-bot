/** Reproduces the cn-fetch stop hang (GOO-361): starts the fetcher with a
 *  launched browser, sends it SIGTERM, and measures how long it takes to exit.
 *
 *   bun run src/scripts_jim/2026_10_05_stall_alarm/sigtermRepro.ts
 */
import { homedir } from "node:os";

const GIVE_UP_AFTER_MS = 15_000;
const SOCKET = `/tmp/cn-fetch-sigterm-repro-${process.pid}.sock`;

const child = Bun.spawn(["bun", "run", new URL("./sigtermChild.ts", import.meta.url).pathname], {
  env: {
    ...process.env,
    FETCH_SERVICE_SOCKET: SOCKET,
    LD_LIBRARY_PATH: `${homedir()}/.cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu`,
  },
  stdout: "pipe",
  stderr: "inherit",
});
const reader = child.stdout.getReader();
let output = "";
while (!output.includes("READY")) {
  const { value, done } = await reader.read();
  if (done) throw new Error(`child exited before it was ready: ${output}`);
  output += new TextDecoder().decode(value);
}
const sentAt = Date.now();
child.kill("SIGTERM");
const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(GIVE_UP_AFTER_MS).then(() => false)]);
if (exited) {
  console.log(`exited ${Date.now() - sentAt} ms after SIGTERM (code ${child.exitCode}, signal ${child.signalCode})`);
} else {
  console.log(`still running ${GIVE_UP_AFTER_MS / 1000} s after SIGTERM: this is the hang`);
  child.kill("SIGKILL");
}
