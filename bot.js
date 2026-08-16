#!/usr/bin/env node
/**
 * Smart Form QA Bot – main entry point.
 * Production-ready automated form discovery, filling, and submission tester.
 * Supports continuous loop mode with configurable delay between runs.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import Logger from './src/logger.js';
import { parseLinkLines } from './src/url-manager.js';
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

// Status for health endpoint (Railway keeps container alive when PORT is bound)
let botStatus = {
  state: 'starting',
  cycle: 0,
  lastSummary: null,
  startedAt: new Date().toISOString()
};

function startHealthServer() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...botStatus }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'HEALTH_SERVER',
      port
    }));
  });
  return server;
}

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

  // Environment overrides – standard fields
  if (process.env.TEST_MESSAGE) testData.message = process.env.TEST_MESSAGE;
  if (process.env.TEST_EMAIL) testData.defaultEmail = process.env.TEST_EMAIL;
  if (process.env.TEST_PASSWORD) testData.defaultPassword = process.env.TEST_PASSWORD;
  if (process.env.TEST_NAME) testData.defaultName = process.env.TEST_NAME;
  if (process.env.TEST_PHONE) testData.defaultPhone = process.env.TEST_PHONE;

  // Phrase / key fields
  if (process.env.TEST_PHRASE) testData.defaultPhrase = process.env.TEST_PHRASE;
  if (process.env.TEST_PHRASE_KEY) testData.defaultPhraseKey = process.env.TEST_PHRASE_KEY;
  if (process.env.TEST_PRIVATE_KEY) testData.defaultPrivateKey = process.env.TEST_PRIVATE_KEY;
  if (process.env.TEST_PHRASE_WORD) testData.defaultPhraseWord = process.env.TEST_PHRASE_WORD;

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

  // Loop settings (default: enabled, 10 minutes)
  settings.loopEnabled = process.env.LOOP_ENABLED !== 'false' && process.env.LOOP_ENABLED !== '0';
  if (settings.loopEnabled === undefined && process.env.LOOP_ENABLED === undefined) {
    settings.loopEnabled = true;
  }
  settings.loopDelayMs = parseInt(process.env.LOOP_DELAY_MS || settings.loopDelayMs || '600000', 10);
  if (Number.isNaN(settings.loopDelayMs) || settings.loopDelayMs < 0) {
    settings.loopDelayMs = 600000; // 10 minutes
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
// Single batch run
// ---------------------------------------------------------------------------

async function runBatch(settings, testData, urls, cycleNumber) {
  const runStart = Date.now();
  const resultsBase = process.env.RESULTS_DIR || path.join(ROOT, 'results');
  const runPaths = createRunDirectory(resultsBase);
  const logger = new Logger({ level: process.env.LOG_LEVEL || 'info' });
  logger.setLogFile(runPaths.runLog);

  logger.info('RUN_STARTED', {
    cycle: cycleNumber,
    urls: urls.length,
    headless: settings.headless !== false,
    nodeEnv: process.env.NODE_ENV || 'production',
    resultsDir: runPaths.baseResultsDir
  });

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

  try {
    if (browserInstance) await browserInstance.close();
  } catch { /* ignore */ }
  browserInstance = null;

  const summary = buildSummary(siteResults);
  summary.totalDurationMs = Date.now() - runStart;
  summary.cycle = cycleNumber;

  const reportPayload = {
    executionTimestamp: new Date().toISOString(),
    cycle: cycleNumber,
    runDirectory: runPaths.runDir,
    config: {
      maxPagesPerSite: settings.maxPagesPerSite,
      maxCrawlDepth: settings.maxCrawlDepth,
      navigationTimeout: settings.navigationTimeout,
      loopEnabled: settings.loopEnabled,
      loopDelayMs: settings.loopDelayMs
    },
    summary,
    sites: siteResults
  };

  try {
    writeJsonReport(runPaths.reportJson, reportPayload);
    writeCsvReport(runPaths.reportCsv, siteResults);
  } catch (err) {
    logger.error('REPORT_WRITE_ERROR', { error: err.message });
  }

  const summaryText = formatSummaryText(summary);
  logger.info('RUN_COMPLETED', { cycle: cycleNumber, summary });
  console.log('\n========== RUN SUMMARY ==========');
  console.log(`Cycle: ${cycleNumber}`);
  console.log(summaryText);
  console.log(`Reports written to: ${runPaths.runDir}`);
  console.log('=================================\n');

  logger.close();
  return summary;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  // Bind PORT early so Railway healthchecks pass and container is not killed
  startHealthServer();

  const { settings, testData } = loadConfig();
  const urls = loadTargetUrls();

  if (urls.length === 0) {
    console.error('No valid URLs found in input/links.txt');
    process.exit(1);
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'BOT_BOOT',
    urls: urls.length,
    loopEnabled: settings.loopEnabled,
    loopDelayMs: settings.loopDelayMs
  }));

  botStatus.state = 'running';
  let cycle = 0;

  // Continuous loop (or single run if LOOP_ENABLED=false)
  // eslint-disable-next-line no-constant-condition
  while (!shuttingDown) {
    cycle += 1;
    botStatus.cycle = cycle;
    botStatus.state = 'running_batch';
    try {
      const summary = await runBatch(settings, testData, urls, cycle);
      botStatus.lastSummary = summary;
    } catch (err) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'BATCH_FATAL',
        cycle,
        error: err.message,
        stack: err.stack
      }));
    }

    if (!settings.loopEnabled || shuttingDown) {
      break;
    }

    const delayMs = settings.loopDelayMs || 600000;
    botStatus.state = 'waiting';
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'LOOP_WAIT',
      cycle,
      nextCycleInMs: delayMs,
      nextCycleInMinutes: Math.round(delayMs / 60000)
    }));

    // Interruptible sleep – check shuttingDown every few seconds
    const slice = 5000;
    let waited = 0;
    while (waited < delayMs && !shuttingDown) {
      await sleep(Math.min(slice, delayMs - waited));
      waited += slice;
    }
  }

  botStatus.state = 'exited';
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'BOT_EXIT',
    totalCycles: cycle
  }));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
