/** Whether an address is a web address, http or https. The pipeline fetches
 *  nothing else. A file:// address, for one, would read this machine's disk. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
