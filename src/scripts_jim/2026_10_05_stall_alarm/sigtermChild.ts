/** Starts the fetcher's socket server as main.ts does under systemd, launches
 *  the shared browser as the first headless fetch would, and reports that it
 *  is ready. */
import { getBrowser } from "../../pipeline/utils/browserManager";
import { startFetchService } from "../../service/fetch/main";

startFetchService(process.env.FETCH_SERVICE_SOCKET!);
if (!process.env.SKIP_BROWSER) await getBrowser();
console.log("READY");
