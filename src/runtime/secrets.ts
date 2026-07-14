import type { Info } from "../colleague/types.js";

/**
 * Secret resolution. info.yaml only ever stores the *names* of secrets; the
 * actual values come from the environment (in a distributed deployment this
 * would be a real secret store — Vault, SSM, etc.). This function walks an
 * account's declared secret names and materializes them, so nothing sensitive
 * has to live in the colleague's git-tracked identity files.
 */
export interface ResolvedAccount {
  provider: string;
  address?: string;
  label?: string;
  scopes?: string[];
  /** materialized secret values, keyed the same as info.yaml's `secrets`. */
  secrets: Record<string, string>;
  /** names that were declared but not found in the environment. */
  missing: string[];
}

export function resolveAccount(
  info: Info,
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAccount {
  const acct = info.accounts[accountId];
  if (!acct) {
    throw new Error(`No account "${accountId}" declared in info.yaml`);
  }
  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, envName] of Object.entries(acct.secrets ?? {})) {
    const value = env[envName];
    if (value === undefined || value === "") {
      missing.push(envName);
    } else {
      secrets[key] = value;
    }
  }
  return {
    provider: acct.provider,
    address: acct.address,
    label: acct.label,
    scopes: acct.scopes,
    secrets,
    missing,
  };
}
