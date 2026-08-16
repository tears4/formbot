/**
 * URL normalization, deduplication, and link prioritization.
 */

/**
 * Normalize a URL string.
 * - Trims whitespace
 * - Ensures protocol
 * - Removes trailing slash (except root)
 * - Lowercases hostname
 * - Removes hash fragments
 * - Removes common tracking params
 */
export function normalizeUrl(raw, base = null) {
  if (!raw || typeof raw !== 'string') return null;
  let urlStr = raw.trim();
  if (!urlStr || urlStr.startsWith('#') || urlStr.startsWith('javascript:') || urlStr.startsWith('mailto:') || urlStr.startsWith('tel:')) {
    return null;
  }

  try {
    let url;
    if (base) {
      url = new URL(urlStr, base);
    } else {
      if (!/^https?:\/\//i.test(urlStr)) {
        urlStr = 'https://' + urlStr;
      }
      url = new URL(urlStr);
    }

    // Only http/https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    // Lowercase host
    url.hostname = url.hostname.toLowerCase();

    // Remove hash
    url.hash = '';

    // Strip common tracking params
    const tracking = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
    tracking.forEach(p => url.searchParams.delete(p));

    // Normalize path: remove trailing slash except for root
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    url.pathname = path || '/';

    return url.href;
  } catch {
    return null;
  }
}

/**
 * Extract hostname for same-origin checks.
 */
export function getOrigin(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Check if two URLs share the same origin.
 */
export function isSameOrigin(urlA, urlB) {
  const a = getOrigin(urlA);
  const b = getOrigin(urlB);
  return a && b && a === b;
}

/**
 * Score a link for form-page likelihood based on URL path and anchor text.
 */
export function scoreLink(urlStr, anchorText = '', priorityKeywords = []) {
  let score = 0;
  const lowerUrl = (urlStr || '').toLowerCase();
  const lowerText = (anchorText || '').toLowerCase();
  const combined = lowerUrl + ' ' + lowerText;

  for (const kw of priorityKeywords) {
    const k = kw.toLowerCase();
    if (lowerUrl.includes(k)) score += 10;
    if (lowerText.includes(k)) score += 8;
  }

  // Bonus for short, clean paths that look like dedicated pages
  try {
    const u = new URL(urlStr);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length <= 2) score += 2;
  } catch { /* ignore */ }

  return score;
}

/**
 * Pure function: parse lines into unique normalized URLs.
 * - Ignores blank lines
 * - Ignores lines starting with #
 * - Normalizes and deduplicates
 */
export function parseLinkLines(lines) {
  const seen = new Set();
  const result = [];

  for (const line of lines) {
    const trimmed = (line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = normalizeUrl(trimmed);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/**
 * Deduplicate an array of URLs (already normalized).
 */
export function dedupeUrls(urls) {
  const seen = new Set();
  return urls.filter(u => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}
