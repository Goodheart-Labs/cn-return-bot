/**
 * The X accounts our Community Notes go out from (GOO-851).
 *
 * `stilt` is the first notewriter account. X shows it under the alias
 * wholesome-raspberry-stilt. The X run on GitHub Actions writes its notes.
 * `wsdm` is the WSDM Cup account. The cn-x-watch daemon on the services box
 * writes its notes (src/x-watch/).
 *
 * A process works for exactly one account, named by the environment variable
 * X_ACCOUNT. Without it the process works for `stilt`, so the X run, the
 * feedback job and the Signal bot need no change. Every row of pipeline_runs,
 * notes and note_submission_claims says which account it belongs to (migration
 * 196), and each process reads and writes only its own account's rows.
 *
 * The value is the prefix of the account's four X keys in the environment,
 * for example X_WSDM_API_KEY.
 */
export const X_ACCOUNT_KEY_PREFIX = { stilt: "X", wsdm: "X_WSDM" } as const;

export type XAccount = keyof typeof X_ACCOUNT_KEY_PREFIX;

const isXAccount = (name: string): name is XAccount => Object.hasOwn(X_ACCOUNT_KEY_PREFIX, name);

export function currentXAccount(): XAccount {
  const name = process.env.X_ACCOUNT ?? "stilt";
  if (!isXAccount(name)) throw new Error(`Unknown X_ACCOUNT "${name}". Known accounts: ${Object.keys(X_ACCOUNT_KEY_PREFIX).join(", ")}`);
  return name;
}
