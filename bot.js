#!/usr/bin/env node
/**
 * Smart Form QA Bot – main entry point.
 * Production-ready automated form discovery, filling, and submission tester.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import Logger from './src/logger.js';
import { parseLinkLines, normalizeUrl } from './src/url-manager.js';
import { processSite } from './src/crawler.js';
import {
  createRunDirectory,
  buildSummary,
  writeJsonReport,
  writeCsvReport,
  formatSummaryText
} from './src/reporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;

// ---------------------------------------------------------------------------
// Configuration loading with environment variable overrides
// ---------------------------------------------------------------------------

function loadJson(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Failed to load ${filePath}:`, err.message);
  }
  return fallback;
}

function loadConfig() {
  const settings = loadJson(path.join(ROOT, 'config', 'settings.json'), {});
  const testData = loadJson(path.join(ROOT, 'config', 'test-data.json'), {});

  // Environment overrides
  if (process.env.TEST_MESSAGE) testData.message = process.env.TEST_MESSAGE;
  if (process.env.TEST_EMAIL) testData.defaultEmail = process.env.TEST_EMAIL;
  if (process.env.TEST_PASSWORD) testData.defaultPassword = process.env.TEST_PASSWORD;
  if (process.env.TEST_NAME) testData.defaultName = process.env.TEST_NAME;
  if (process.env.TEST_PHONE) testData.defaultPhone = process.env.TEST_PHONE;

  if (process.env.MAX_PAGES) settings.maxPagesPerSite = parseInt(process.env.MAX_PAGES, 10) || settings.maxPagesPerSite;
  if (process.env.NAVIGATION_TIMEOUT) settings.navigationTimeout = parseInt(process.env.NAVIGATION_TIMEOUT, 10) || settings.navigationTimeout;
  if (process.env.INTERACTION_TIMEOUT) settings.interactionTimeout = parseInt(process.env.INTERACTION_TIMEOUT, 10) || settings.interactionTimeout;
  if (process.env.HEADLESS !== undefined) {
    settings.headless = process.env.HEADLESS !== 'false' && process.env.HEADLESS !== '0';
  }
  if (process.env.MAX_CRAWL_DEPTH) settings.maxCrawlDepth = parseInt(process.env.MAX_CRAWL_DEPTH, 10) || settings.maxCrawlDepth;
  if (process.env.SAME_ORIGIN_ONLY !== undefined) {
    settings.sameOriginOnly = process.env.SAME_ORIGIN_ONLY !== 'false' && process.env.SAME_ORIGIN_ONLY !== '0';
  }

  return { settings, testData };
}

function loadTargetUrls() {
  const linksPath = process.env.LINKS_FILE || path.join(ROOT, 'input', 'links.txt');
  if (!fs.existsSync(linksPath)) {
    console.error(`Links file not found: ${linksPath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(linksPath, 'utf8');
  const lines = content.split(/\r?\n/);
  return parseLinkLines(lines);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let browserInstance = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'SHUTDOWN', signal }));
  try {
    if (browserInstance) await browserInstance.close();
  } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const runStart = Date.now();
  const { settings, testData } = loadConfig();
  const urls = loadTargetUrls();

  if (urls.length === 0) {
    console.error('No valid URLs found in input/links.txt');
    process.exit(1);
  }

  const runPaths = createRunDirectory(path.join(ROOT, 'results'));
  const logger = new Logger({ level: process.env.LOG_LEVEL || 'info' });
  logger.setLogFile(runPaths.runLog);

  logger.info('RUN_STARTED', {
    urls: urls.length,
    headless: settings.headless !== false,
    nodeEnv: process.env.NODE_ENV || 'production'
  });

  // Launch browser once, reuse across sites
  browserInstance = await chromium.launch({
    headless: settings.headless !== false,
    slowMo: settings.slowMo || 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const siteResults = [];

  for (const url of urls) {
    if (shuttingDown) break;

    try {
      const result = await processSite(browserInstance, url, {
        settings,
        testData,
        logger,
        screenshotsDir: runPaths.screenshotsDir,
        maxPages: settings.maxPagesPerSite,
        maxFormsPerPage: settings.maxFormsPerPage
      });
      siteResults.push(result);
    } catch (err) {
      logger.error('SITE_FATAL', { url, error: err.message });
      siteResults.push({
        url,
        pagesVisited: 0,
        formsDiscovered: 0,
        forms: [],
        pages: [],
        errors: [{ error: err.message }],
        durationMs: 0,
        status: 'fatal'
      });
    }
  }

  // Close browser
  try {
    await browserInstance.close();
  } catch { /* ignore */ }
  browserInstance = null;

  // Build & write reports
  const summary = buildSummary(siteResults);
  summary.totalDurationMs = Date.now() - runStart;

  const reportPayload = {
    executionTimestamp: new Date().toISOString(),
    runDirectory: runPaths.runDir,
    config: {
      maxPagesPerSite: settings.maxPagesPerSite,
      maxCrawlDepth: settings.maxCrawlDepth,
      navigationTimeout: settings.navigationTimeout
    },
    summary,
    sites: siteResults
  };

  writeJsonReport(runPaths.reportJson, reportPayload);
  writeCsvReport(runPaths.reportCsv, siteResults);

  const summaryText = formatSummaryText(summary);
  logger.info('RUN_COMPLETED', { summary });
  console.log('\n========== RUN SUMMARY ==========');
  console.log(summaryText);
  console.log(`Reports written to: ${runPaths.runDir}`);
  console.log('=================================\n');

  logger.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
