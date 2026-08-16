/**
 * Report generation: JSON, CSV, and summary.
 */

import fs from 'fs';
import path from 'path';

/**
 * Ensure results directory exists and return paths.
 */
export function createRunDirectory(baseResultsDir = 'results') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const runDir = path.join(baseResultsDir, ts);
  const screenshotsDir = path.join(runDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  return {
    runDir,
    screenshotsDir,
    reportJson: path.join(runDir, 'report.json'),
    reportCsv: path.join(runDir, 'report.csv'),
    runLog: path.join(runDir, 'run.log'),
    timestamp: ts
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
