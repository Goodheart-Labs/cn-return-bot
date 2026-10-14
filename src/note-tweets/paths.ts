import { mkdir } from "node:fs/promises";

export const INPUT_DIR = import.meta.dir;
export const STATE_DIR = `${INPUT_DIR}/.state`;
export async function ensureState() {
  await mkdir(`${STATE_DIR}/shots`, { recursive: true });
}
