import type { APIRequestContext, APIResponse } from 'playwright-core';
import type { EnvName } from '../../shared/types';
import { matchesBlocked } from '../guard';

export type SeverityLevel = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Finding {
  severity: SeverityLevel;
  check: string;
  url: string;
  evidence: string;
  fix: string;
}

/** Local and Dev get every check; Test and Live only those that cannot change data or lock accounts. */
export const isFullScan = (env: EnvName) => env === 'local' || env === 'dev';

export const isLoopback = (url: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Requests per second for active checks; Live is the gentlest. */
export const rateFor = (env: EnvName) => (env === 'live' ? 2 : env === 'test' ? 5 : 10);

const FIREWALL_HEADER = /cf-mitigated|x-sucuri-block|x-datadome|x-amzn-waf/i;
const FIREWALL_BODY = /attack detected|request blocked|web application firewall|access denied by|automated requests|captcha/i;

/** The site's firewall stopped the scan; remaining active checks are reported unverified. */
export class ScanBlocked extends Error {}

/** Does this response look like a firewall or rate limiter rather than the app? */
export const looksBlocked = (status: number, headers: Record<string, string>, body: string) => {
  if (status === 429) return true;
  if (![403, 406, 503].includes(status)) return false;
  return Object.keys(headers).some((h) => FIREWALL_HEADER.test(h)) || FIREWALL_BODY.test(body);
};

/**
 * Every HTTP request of the active checks goes through here. It refuses other
 * domains and blocked endpoints, sends GET only, spaces requests out, and stops
 * the scan on the first sign of a firewall.
 */
export class SafeClient {
  blockedBy: string | null = null;
  requests = 0;
  private next = 0;

  constructor(
    private request: APIRequestContext,
    private ownOrigins: string[],
    private blockedEndpoints: string[],
    private rps: number,
    private shared?: SafeClient,
  ) {}

  allowed(url: string) {
    try {
      const u = new URL(url);
      return this.ownOrigins.includes(u.origin) && !matchesBlocked(u.pathname, this.blockedEndpoints);
    } catch {
      return false;
    }
  }

  private async throttle() {
    const owner = this.shared ?? this;
    const now = Date.now();
    const at = Math.max(now, owner.next);
    owner.next = at + 1000 / this.rps;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  /** GET without following redirects (a redirect target is read, never visited). */
  async get(url: string, headers?: Record<string, string>): Promise<{ res: APIResponse; body: string } | null> {
    const owner = this.shared ?? this;
    if (owner.blockedBy) throw new ScanBlocked(owner.blockedBy);
    if (!this.allowed(url)) return null;
    await this.throttle();
    owner.requests++;
    const res = await this.request.get(url, { maxRedirects: 0, timeout: 15_000, failOnStatusCode: false, headers }).catch(() => null);
    if (!res) return null;
    const body = await res.text().catch(() => '');
    if (looksBlocked(res.status(), res.headers(), body)) {
      owner.blockedBy = `${url} answered HTTP ${res.status()} like a firewall or rate limiter`;
      throw new ScanBlocked(owner.blockedBy);
    }
    return { res, body };
  }
}
