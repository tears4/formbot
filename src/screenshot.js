/**
 * Safe screenshot utilities.
 */

import fs from 'fs';
import path from 'path';

/**
 * Sanitize a string for use in filenames.
 */
export function safeFilename(str, maxLen = 60) {
  return String(str || 'unknown')
    .replace(/https?:\/\//gi, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen) || 'page';
}

/**
 * Capture a screenshot and return relative path.
 */
export async function captureScreenshot(page, screenshotsDir, meta = {}) {
  const domain = safeFilename(meta.domain || 'site', 40);
  const pagePart = safeFilename(meta.pageHint || 'page', 40);
  const formPart = meta.formIndex != null ? `form${meta.formIndex}` : 'page';
  const ts = Date.now();
  const stage = meta.stage || 'capture';

  const filename = `${domain}__${pagePart}__${formPart}__${stage}__${ts}.png`;
  const fullPath = path.join(screenshotsDir, filename);

  try {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    await page.screenshot({
      path: fullPath,
      fullPage: meta.fullPage !== false,
      timeout: 10000
    });
    return {
      success: true,
      path: fullPath,
      relative: path.join('screenshots', filename),
      filename
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      filename
    };
  }
}
