/**
 * Report generation: JSON, CSV, and summary.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Resolve a writable base results directory.
 * Tries (in order): RESULTS_DIR env, provided base, /app/results, ./results, os.tmpdir()/smart-form-qa-results
 */
function resolveWritableBase(preferred) {
  const candidates = [
    process.env.RESULTS_DIR,
    preferred,
    path.join(process.cwd(), 'results'),
    '/app/results',
    path.join(os.tmpdir(), 'smart-form-qa-results')
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Probe write access
      const probe = path.join(dir, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      // try next
    }
  }

  // Last resort – tmp always writable for the user
  const fallback = path.join(os.tmpdir(), `smart-form-qa-results-${process.pid}`);
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

/**
 * Ensure results directory exists and return paths.
 */
export function createRunDirectory(baseResultsDir = 'results') {
  const base = resolveWritableBase(baseResultsDir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const runDir = path.join(base, ts);
  const screenshotsDir = path.join(runDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  return {
    runDir,
    screenshotsDir,
    reportJson: path.join(runDir, 'report.json'),
    reportCsv: path.join(runDir, 'report.csv'),
    runLog: path.join(runDir, 'run.log'),
    timestamp: ts,
    baseResultsDir: base
  };
}

/**
 * Build overall summary counts.
 */
export function buildSummary(siteResults) {
  const summary = {
    sitesTested: siteResults.length,
    pagesVisited: 0,
    formsDiscovered: 0,
    formsSubmitted: 0,
    successful: 0,
    validationErrors: 0,
    submissionFailures: 0,
    captchaRequired: 0,
    formNotFillable: 0,
    otherOutcomes: 0,
    totalDurationMs: 0
  };

  for (const site of siteResults) {
    summary.pagesVisited += site.pagesVisited || 0;
    summary.formsDiscovered += site.formsDiscovered || 0;
    summary.totalDurationMs += site.durationMs || 0;

    for (const form of site.forms || []) {
      if (form.submitted) summary.formsSubmitted++;
      const o = form.outcome || 'UNKNOWN';
      if (o === 'SUCCESS') summary.successful++;
      else if (o === 'VALIDATION_ERROR') summary.validationErrors++;
      else if (o === 'SUBMISSION_FAILED') summary.submissionFailures++;
      else if (o === 'CAPTCHA_REQUIRED') summary.captchaRequired++;
      else if (o === 'FORM_NOT_FILLABLE') summary.formNotFillable++;
      else summary.otherOutcomes++;
    }
  }

  return summary;
}

/**
 * Write full JSON report.
 */
export function writeJsonReport(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Write CSV report (one row per form test).
 */
export function writeCsvReport(filePath, siteResults) {
  const headers = [
    'site',
    'pageUrl',
    'formIndex',
    'formKind',
    'fieldsDetected',
    'fieldsFilled',
    'fieldsSkipped',
    'outcome',
    'details',
    'finalUrl',
    'durationMs',
    'screenshot'
  ];

  const rows = [headers.join(',')];

  function esc(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  for (const site of siteResults) {
    for (const form of site.forms || []) {
      rows.push([
        esc(site.url),
        esc(form.pageUrl),
        esc(form.formIndex),
        esc(form.kind),
        esc(form.fieldsDetected),
        esc(form.fieldsFilled),
        esc(form.fieldsSkipped),
        esc(form.outcome),
        esc(form.details),
        esc(form.finalUrl),
        esc(form.durationMs),
        esc(form.screenshot || '')
      ].join(','));
    }
  }

  fs.writeFileSync(filePath, rows.join('\n'), 'utf8');
}

/**
 * Human-readable summary string.
 */
export function formatSummaryText(summary) {
  return [
    `Sites tested: ${summary.sitesTested}`,
    `Pages visited: ${summary.pagesVisited}`,
    `Forms discovered: ${summary.formsDiscovered}`,
    `Forms submitted: ${summary.formsSubmitted}`,
    `Successful: ${summary.successful}`,
    `Validation errors: ${summary.validationErrors}`,
    `Submission failures: ${summary.submissionFailures}`,
    `Captcha required: ${summary.captchaRequired}`,
    `Form not fillable: ${summary.formNotFillable}`,
    `Other outcomes: ${summary.otherOutcomes}`,
    `Total duration (ms): ${summary.totalDurationMs}`
  ].join('\n');
}
