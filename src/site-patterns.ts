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

// Private suffixes (github.io, vercel.app, ...) count as public suffixes, so a rule for
// alice.github.io covers only that site instead of every site on the hosting platform.
function getRegistrableDomain(hostname: string): string | null {
  const normalizedHostname = hostname.toLowerCase();
  return (
    getDomain(normalizedHostname, { allowPrivateDomains: true }) ??
    (isLocalHostname(normalizedHostname) ? normalizedHostname : null)
  );
}

export function normalizeDisabledUrlPattern(value: string): string | null {
  const parsedUrl = parseHttpUrl(value);
  if (!parsedUrl) {
    return null;
  }

  const domain = getRegistrableDomain(parsedUrl.hostname);
  if (!domain) {
    return null;
  }

  return `${domain}${normalizePath(parsedUrl.pathname)}`;
}

/** Normalizes rules entered by the user before they are saved. */
export function normalizeSitePolicies(policies: Partial<SitePolicy>[]): SitePolicy[] {
  return normalizeSitePoliciesWith(policies, normalizeDisabledUrlPattern);
}

export function getDisabledSitePrefillForUrl(url: string): string | null {
  const parsedUrl = parseHttpUrl(url);
  return parsedUrl ? getRegistrableDomain(parsedUrl.hostname) : null;
}

export function getSitePolicySectionPatternForUrl(url: string): string | null {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) {
    return null;
  }

  const domain = getRegistrableDomain(parsedUrl.hostname);
  if (!domain) {
    return null;
  }

  // Only a first segment followed by a slash is a section (/shorts/abc); /watch?v=abc is a page.
  const firstSegment = /^\/+([^/]+)\//.exec(parsedUrl.pathname)?.[1];
  return firstSegment ? `${domain}/${firstSegment}` : domain;
}
