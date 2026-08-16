/**
 * Result / outcome detection after form submission.
 */

/**
 * Classify the outcome of a form submission attempt.
 */
export async function detectOutcome(page, submitResult, settings = {}) {
  const successIndicators = settings.successIndicators || [
    'thank you', 'thanks', 'success', 'submitted', 'received',
    'confirmation', 'we will get back', 'message sent', 'successfully', 'appreciate your'
  ];
  const errorIndicators = settings.errorIndicators || [
    'error', 'invalid', 'required', 'please fill', 'please enter',
    'must be', 'failed', 'try again', 'captcha', 'recaptcha'
  ];
  const captchaSelectors = settings.captchaSelectors || [
    'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
    '.g-recaptcha', '#recaptcha', '[data-sitekey]', '.h-captcha'
  ];

  if (!submitResult.submitted) {
    if (submitResult.reason === 'NO_SUBMIT_CONTROL') {
      return { outcome: 'FORM_NOT_FILLABLE', details: 'No submit control found' };
    }
    return {
      outcome: 'SUBMISSION_FAILED',
      details: submitResult.error || submitResult.reason || 'Submit action failed'
    };
  }

  // Captcha check
  for (const sel of captchaSelectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const visible = await page.locator(sel).first().isVisible().catch(() => true);
        if (visible) {
          return { outcome: 'CAPTCHA_REQUIRED', details: `Captcha detected via ${sel}` };
        }
      }
    } catch { /* continue */ }
  }

  // Auth walls
  const authSignals = await page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    const hasLogin =
      text.includes('sign in') ||
      text.includes('log in') ||
      text.includes('login required') ||
      !!document.querySelector('input[type="password"]');
    return { hasLogin, textSnippet: text.slice(0, 1500) };
  }).catch(() => ({ hasLogin: false, textSnippet: '' }));

  if (authSignals.hasLogin && /password|login|sign in/i.test(authSignals.textSnippet)) {
    // Only flag if we just submitted and suddenly see auth
    // (heuristic – avoid false positives on contact pages that happen to have login links)
  }

  // Collect page text + validation messages
  const pageState = await page.evaluate((successList, errorList) => {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    const html = (document.body?.innerHTML || '').toLowerCase();

    // Common validation / error element selectors
    const errorEls = document.querySelectorAll(
      '.error, .errors, .field-error, .invalid-feedback, .help-block, [class*="error"], [role="alert"], .alert-danger, .text-danger, .validation-error'
    );
    const errorTexts = Array.from(errorEls)
      .map(e => (e.innerText || '').trim())
      .filter(Boolean)
      .slice(0, 10);

    const successEls = document.querySelectorAll(
      '.success, .alert-success, .thank-you, [class*="success"], [class*="thank"]'
    );
    const successTexts = Array.from(successEls)
      .map(e => (e.innerText || '').trim())
      .filter(Boolean)
      .slice(0, 5);

    let successScore = 0;
    let errorScore = 0;

    for (const s of successList) {
      if (bodyText.includes(s.toLowerCase())) successScore += 2;
    }
    for (const e of errorList) {
      if (bodyText.includes(e.toLowerCase())) errorScore += 2;
    }
    if (errorTexts.length) errorScore += errorTexts.length * 3;
    if (successTexts.length) successScore += successTexts.length * 3;

    // Form still present?
    const formsStillVisible = document.querySelectorAll('form').length;

    return {
      bodySnippet: bodyText.slice(0, 800),
      errorTexts,
      successTexts,
      successScore,
      errorScore,
      formsStillVisible,
      title: document.title || ''
    };
  }, successIndicators, errorIndicators).catch(() => ({
    bodySnippet: '',
    errorTexts: [],
    successTexts: [],
    successScore: 0,
    errorScore: 0,
    formsStillVisible: 1,
    title: ''
  }));

  // Decision tree
  if (pageState.errorScore >= 4 && pageState.errorScore > pageState.successScore) {
    return {
      outcome: 'VALIDATION_ERROR',
      details: pageState.errorTexts.slice(0, 3).join(' | ') || 'Validation messages detected',
      scores: { success: pageState.successScore, error: pageState.errorScore }
    };
  }

  if (pageState.successScore >= 3 || pageState.successTexts.length > 0) {
    return {
      outcome: 'SUCCESS',
      details: pageState.successTexts[0] || 'Success indicators found',
      scores: { success: pageState.successScore, error: pageState.errorScore }
    };
  }

  // URL changed significantly and no strong errors → likely success
  if (submitResult.navigated && pageState.errorScore < 3) {
    return {
      outcome: 'SUCCESS',
      details: 'Navigation occurred after submit without strong error signals',
      scores: { success: pageState.successScore, error: pageState.errorScore }
    };
  }

  // Form disappeared without error signals
  if (pageState.formsStillVisible === 0 && pageState.errorScore < 2) {
    return {
      outcome: 'SUCCESS',
      details: 'Form no longer present after submission',
      scores: { success: pageState.successScore, error: pageState.errorScore }
    };
  }

  // Still on same page with form → ambiguous
  if (pageState.errorScore > 0) {
    return {
      outcome: 'VALIDATION_ERROR',
      details: pageState.errorTexts[0] || 'Possible validation issues',
      scores: { success: pageState.successScore, error: pageState.errorScore }
    };
  }

  return {
    outcome: 'UNKNOWN',
    details: 'Could not confidently determine submission result',
    scores: { success: pageState.successScore, error: pageState.errorScore },
    snippet: pageState.bodySnippet.slice(0, 200)
  };
}
