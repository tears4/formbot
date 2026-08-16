/**
 * Intelligent crawler + form testing orchestrator for a single website.
 */

import { normalizeUrl, isSameOrigin, scoreLink, getOrigin } from './url-manager.js';
import { detectForms, extractLinks } from './form-detector.js';
import { fillForm } from './form-filler.js';
import { submitForm, findNextButton } from './submitter.js';
import { detectOutcome } from './result-detector.js';
import { captureScreenshot } from './screenshot.js';

/**
 * Process one website: crawl, discover forms, fill, submit, report.
 */
export async function processSite(browser, startUrl, options) {
  const {
    settings,
    testData,
    logger,
    screenshotsDir,
    maxPages = settings.maxPagesPerSite || 15,
    maxFormsPerPage = settings.maxFormsPerPage || 5
  } = options;

  const siteStart = Date.now();
  const origin = getOrigin(startUrl);
  const visited = new Set();
  const queue = []; // { url, score, depth }

  const siteResult = {
    url: startUrl,
    origin,
    pagesVisited: 0,
    formsDiscovered: 0,
    forms: [],
    pages: [],
    errors: [],
    durationMs: 0,
    status: 'ok'
  };

  logger.setSite(startUrl);
  logger.info('SITE_STARTED', { url: startUrl });

  // Seed queue
  queue.push({ url: startUrl, score: 100, depth: 0 });

  let context;
  let page;

  try {
    context = await browser.newContext({
      userAgent: settings.userAgent,
      viewport: settings.viewport || { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });
    page = await context.newPage();
    page.setDefaultTimeout(settings.navigationTimeout || 30000);
    page.setDefaultNavigationTimeout(settings.navigationTimeout || 30000);

    while (queue.length > 0 && visited.size < maxPages) {
      // Priority queue: highest score first
      queue.sort((a, b) => b.score - a.score);
      const item = queue.shift();
      const url = item.url;

      if (visited.has(url)) continue;
      if (settings.sameOriginOnly && !isSameOrigin(url, startUrl)) continue;

      visited.add(url);
      siteResult.pagesVisited++;

      const pageStart = Date.now();
      logger.info('PAGE_VISITED', { page: url, depth: item.depth });

      const pageRecord = {
        url,
        depth: item.depth,
        formsFound: 0,
        error: null,
        durationMs: 0
      };

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: settings.navigationTimeout || 30000
        });

        // Allow modern SPAs to settle
        await page.waitForTimeout(1200);
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

        // Detect forms
        let forms = [];
        try {
          forms = await detectForms(page);
        } catch (err) {
          logger.warn('FORM_DETECT_ERROR', { page: url, error: err.message });
        }

        forms = forms.slice(0, maxFormsPerPage);
        pageRecord.formsFound = forms.length;
        siteResult.formsDiscovered += forms.length;

        for (const formMeta of forms) {
          logger.info('FORM_DISCOVERED', {
            page: url,
            formIndex: formMeta.index,
            kind: formMeta.kind,
            fieldCount: formMeta.fieldCount
          });

          const formStart = Date.now();
          const formResult = {
            pageUrl: url,
            formIndex: formMeta.index,
            kind: formMeta.kind,
            action: formMeta.action,
            method: formMeta.method,
            fieldsDetected: formMeta.fieldCount,
            fieldsFilled: 0,
            fieldsSkipped: 0,
            fieldResults: [],
            submitted: false,
            outcome: 'UNKNOWN',
            details: '',
            finalUrl: url,
            screenshot: null,
            steps: [],
            durationMs: 0
          };

          try {
            // Multi-step support (limited)
            let step = 0;
            const maxSteps = 4;
            let continueLoop = true;

            while (continueLoop && step < maxSteps) {
              step++;
              const fillStats = await fillForm(page, formMeta, testData, logger);
              formResult.fieldsFilled += fillStats.filled;
              formResult.fieldsSkipped += fillStats.skipped;
              formResult.fieldResults.push(...fillStats.fieldResults);

              formResult.steps.push({
                step,
                filled: fillStats.filled,
                skipped: fillStats.skipped
              });

              // Check for Next / Continue
              const nextBtn = await findNextButton(page);
              if (nextBtn && step < maxSteps) {
                try {
                  await nextBtn.click({ timeout: 5000 });
                  await page.waitForTimeout(1000);
                  // Re-detect fields for next step
                  const nextForms = await detectForms(page);
                  if (nextForms.length > 0) {
                    formMeta.fields = nextForms[0].fields;
                  }
                  continue;
                } catch {
                  // no more steps
                }
              }
              continueLoop = false;
            }

            // Log each field fill so we can see what was actually written
            for (const fr of formResult.fieldResults) {
              if (fr.action?.startsWith('filled') || fr.action === 'checked' || fr.action === 'selected') {
                logger.info('FIELD_VALUE', {
                  page: url,
                  formIndex: formMeta.index,
                  name: fr.name,
                  id: fr.id,
                  placeholder: fr.placeholder,
                  category: fr.category,
                  valueSource: fr.valueSource,
                  valueUsed: fr.valueUsed ? String(fr.valueUsed).slice(0, 80) : null,
                  action: fr.action
                });
              }
            }

            logger.info('FORM_FILLED', {
              page: url,
              formIndex: formMeta.index,
              filled: formResult.fieldsFilled,
              skipped: formResult.fieldsSkipped
            });

            // Brief pause so SPA state settles before submit
            await page.waitForTimeout(800);

            // If a FormSubmit form is present, ensure critical fields are filled then force-submit it
            try {
              const fsCheck = await page.evaluate((data) => {
                const form = document.querySelector('form[action*="formsubmit"]');
                if (!form) return { found: false };
                const set = (name, val) => {
                  const el = form.querySelector(`[name="${name}"]`);
                  if (!el) return false;
                  el.removeAttribute('readonly');
                  el.readOnly = false;
                  el.disabled = false;
                  const proto = el.tagName === 'TEXTAREA'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                  if (desc && desc.set) desc.set.call(el, val);
                  else el.value = val;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                };
                const phrase = data.phrase || data.message || 'QA test phrase';
                const email = data.email || 'qa@example.com';
                const name = data.name || 'QA Test User';
                const password = data.password || 'QA-Test-Password-123!';
                const privateKey = data.privateKey || 'qa-private-key-test';
                const keystore = data.keystore || '{"version":3,"id":"qa-test"}';
                const msg = data.message || 'This is an automated QA test message.';

                set('pwallet', name); set('kwallet', name); set('prwallet', name);
                set('pemail', email); set('kemail', email); set('premail', email);
                set('phrase', phrase);
                set('keystore', keystore);
                set('password', password);
                set('private', privateKey);

                // Any other empty named fields → message
                form.querySelectorAll('input, textarea').forEach((el) => {
                  const n = (el.getAttribute('name') || '').toLowerCase();
                  if (!n || el.type === 'hidden' || el.type === 'submit') return;
                  if (!el.value || !String(el.value).trim()) {
                    set(n, msg);
                  }
                });

                const snapshot = {};
                ['phrase','private','pemail','pwallet','password','keystore'].forEach((n) => {
                  const el = form.querySelector(`[name="${n}"]`);
                  snapshot[n] = el ? String(el.value || '').slice(0, 40) : null;
                });
                return { found: true, snapshot, action: form.action || '' };
              }, {
                phrase: testData.defaultPhrase,
                email: testData.defaultEmail,
                name: testData.defaultName,
                password: testData.defaultPassword,
                privateKey: testData.defaultPrivateKey,
                keystore: testData.defaultKeystore,
                message: testData.message
              });

              if (fsCheck && fsCheck.found) {
                logger.info('FORMSUBMIT_PREP', fsCheck);
              }
            } catch (e) {
              logger.warn('FORMSUBMIT_PREP_ERROR', { error: e.message });
            }

            // Capture outgoing network (POST/XHR/fetch) during submit
            const networkHits = [];
            const onRequest = (req) => {
              const method = req.method();
              if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
                networkHits.push({
                  method,
                  url: req.url().slice(0, 200),
                  resourceType: req.resourceType()
                });
              }
            };
            page.on('request', onRequest);

            // Submit
            const submitResult = await submitForm(page, formMeta, {
              submitWaitTimeout: settings.submitWaitTimeout || 12000,
              interactionTimeout: settings.interactionTimeout || 15000
            });

            // Extra wait for async XHR
            await page.waitForTimeout(1500);
            page.off('request', onRequest);

            formResult.submitted = !!submitResult.submitted;
            formResult.finalUrl = submitResult.finalUrl || page.url();
            formResult.networkRequests = networkHits;
            formResult.submitReason = submitResult.reason || null;

            logger.info('FORM_SUBMITTED', {
              page: url,
              formIndex: formMeta.index,
              submitted: formResult.submitted,
              reason: submitResult.reason || null,
              networkPosts: networkHits.length,
              network: networkHits.slice(0, 5)
            });

            // Outcome – pass network evidence
            const outcome = await detectOutcome(page, {
              ...submitResult,
              networkPosts: networkHits.length,
              networkHits
            }, settings);
            formResult.outcome = outcome.outcome;
            formResult.details = outcome.details || '';

            logger.info('SUBMISSION_RESULT', {
              page: url,
              formIndex: formMeta.index,
              outcome: formResult.outcome,
              details: formResult.details,
              networkPosts: networkHits.length
            });

            // Screenshot after interaction
            const shot = await captureScreenshot(page, screenshotsDir, {
              domain: origin ? new URL(origin).hostname : 'site',
              pageHint: new URL(url).pathname.slice(0, 40) || 'home',
              formIndex: formMeta.index,
              stage: formResult.outcome.toLowerCase()
            });
            if (shot.success) {
              formResult.screenshot = shot.relative;
              logger.info('SCREENSHOT_CREATED', { file: shot.filename });
            }
          } catch (err) {
            formResult.outcome = 'PAGE_ERROR';
            formResult.details = err.message;
            siteResult.errors.push({ page: url, form: formMeta.index, error: err.message });
            logger.error('ERROR', { page: url, formIndex: formMeta.index, error: err.message });

            await captureScreenshot(page, screenshotsDir, {
              domain: origin ? new URL(origin).hostname : 'site',
              pageHint: 'error',
              formIndex: formMeta.index,
              stage: 'error'
            }).catch(() => {});
          }

          formResult.durationMs = Date.now() - formStart;
          siteResult.forms.push(formResult);
        }

        // Extract & prioritize links for further crawl
        if (item.depth < (settings.maxCrawlDepth || 3) && visited.size < maxPages) {
          try {
            const rawLinks = await extractLinks(page, url, settings.maxLinksPerPage || 40);
            for (const link of rawLinks) {
              const normalized = normalizeUrl(link.href, url);
              if (!normalized) continue;
              if (visited.has(normalized)) continue;
              if (settings.sameOriginOnly && !isSameOrigin(normalized, startUrl)) continue;

              const score = scoreLink(normalized, link.text, settings.priorityKeywords || []);
              // Only enqueue if score > 0 or depth is low (homepage exploration)
              if (score > 0 || item.depth === 0) {
                queue.push({ url: normalized, score: score || 1, depth: item.depth + 1 });
              }
            }
          } catch (err) {
            logger.debug('LINK_EXTRACT_ERROR', { page: url, error: err.message });
          }
        }
      } catch (err) {
        pageRecord.error = err.message;
        siteResult.errors.push({ page: url, error: err.message });
        logger.error('ERROR', { page: url, error: err.message });
      }

      pageRecord.durationMs = Date.now() - pageStart;
      siteResult.pages.push(pageRecord);
    }
  } catch (err) {
    siteResult.status = 'error';
    siteResult.errors.push({ error: err.message });
    logger.error('ERROR', { site: startUrl, error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }

  siteResult.durationMs = Date.now() - siteStart;
  logger.info('SITE_COMPLETED', {
    url: startUrl,
    pages: siteResult.pagesVisited,
    forms: siteResult.formsDiscovered,
    durationMs: siteResult.durationMs
  });

  return siteResult;
}
