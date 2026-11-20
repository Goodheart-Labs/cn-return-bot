/** Runs the site checks whose names match the pattern given as the first
 *  argument, in one browser without the proxy, and prints each outcome. */
import { launchWithExtension } from "../../everything-extension/scripts/browser";
import { extensionChecks, watchPageChecks } from "../../site-checks/extensionChecks";

const pattern = new RegExp(process.argv[2] ?? ".", "i");
const context = await launchWithExtension();
for (const check of [...extensionChecks(context), ...watchPageChecks(context)].filter((c) => pattern.test(c.name))) {
  const outcome = await check.run().then((saw) => `passed: ${saw}`, (err: Error) => `${err.constructor.name}: ${err.message}`);
  console.log(`${check.site}: ${check.name}\n  ${outcome}`);
}
await context.close();
