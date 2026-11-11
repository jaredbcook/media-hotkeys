// Site-pattern normalization with the public suffix list (tldts). Only the popup and
// the options page import this module, where rules are created; the content script
// matches saved rules with `findMatchingSitePolicy` in `src/storage.ts` instead, so
// the suffix list stays out of the bundle that loads in every frame.
import { getDomain } from "tldts";
import {
  type SitePolicy,
  isLocalHostname,
  normalizePath,
  normalizeSitePoliciesWith,
  parseHttpUrl,
} from "./storage.js";

// A rule names the host the user chose, so `music.youtube.com` stays a rule for that host
// and its subdomains. The suffix list only rejects hosts that could never be one site:
// a bare public suffix from the ICANN list (`com`, `co.uk`) or a single label. Private
// suffixes (`github.io`, `vercel.app`) are accepted, and a rule for one covers every site
// hosted under it.
function isValidSiteHost(hostname: string): boolean {
  return isLocalHostname(hostname) || getDomain(hostname, { allowPrivateDomains: false }) !== null;
}

// Leading `www.` labels are dropped, because `www.youtube.com` is the same site as
// `youtube.com`, and a rule for the shorter host covers the longer one anyway. Dropping all
// of them keeps normalizing a saved rule again (every edit and popup save does) from
// changing it. Every other subdomain, `m.` included, is kept. `www.localhost` stays as it
// is, because a rule for localhost matches only localhost itself.
function getSiteHost(hostname: string): string | null {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  while (host.startsWith("www.")) {
    const withoutWww = host.slice("www.".length);
    if (isLocalHostname(withoutWww) || !isValidSiteHost(withoutWww)) {
      break;
    }
    host = withoutWww;
  }

  return isValidSiteHost(host) ? host : null;
}

export function normalizeDisabledUrlPattern(value: string): string | null {
  const parsedUrl = parseHttpUrl(value);
  if (!parsedUrl) {
    return null;
  }

  const host = getSiteHost(parsedUrl.hostname);
  if (!host) {
    return null;
  }

  return `${host}${normalizePath(parsedUrl.pathname)}`;
}

/** Normalizes rules entered by the user before they are saved. */
export function normalizeSitePolicies(policies: Partial<SitePolicy>[]): SitePolicy[] {
  return normalizeSitePoliciesWith(policies, normalizeDisabledUrlPattern);
}

/** The host rule for a page: its host with `www.` removed. */
export function getDisabledSitePrefillForUrl(url: string): string | null {
  const parsedUrl = parseHttpUrl(url);
  return parsedUrl ? getSiteHost(parsedUrl.hostname) : null;
}

export function getSitePolicySectionPatternForUrl(url: string): string | null {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) {
    return null;
  }

  const host = getSiteHost(parsedUrl.hostname);
  if (!host) {
    return null;
  }

  // Only a first segment followed by a slash is a section (/shorts/abc); /watch?v=abc is a page.
  const firstSegment = /^\/+([^/]+)\//.exec(parsedUrl.pathname)?.[1];
  return firstSegment ? `${host}/${firstSegment}` : host;
}
