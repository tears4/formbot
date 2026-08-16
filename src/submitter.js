/**
 * Form submission module.
 * Locates submit controls and performs the submit action.
 */

/**
 * Find the best submit control for a form.
 */
export async function findSubmitControl(page, formMeta) {
  // Strategy 1: inside the form by index / known selectors
  const candidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Send")',
    'button:has-text("Send Message")',
    'button:has-text("Contact")',
    'button:has-text("Register")',
    'button:has-text("Sign Up")',
    'button:has-text("Sign up")',
    'button:has-text("Apply")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button:has-text("Save")',
    'button:has-text("Book")',
    'button:has-text("Request")',
    '[type="submit"]',
    'button.btn-primary',
    'button.btn-submit',
    '.submit-button',
    '[data-action="submit"]'
  ];

  for (const sel of candidates) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        return loc;
      }
    } catch {
      // continue
    }
  }

  // Fallback: any button that looks like submit from field metadata
  const submitFields = (formMeta.fields || []).filter(
    f => f.type === 'submit' || (f.tag === 'button' && /submit|send|save|register|apply|continue|next/i.test(
      (f.name || '') + (f.id || '') + (f.innerText || '') + (f.value || '')
    ))
  );

  for (const f of submitFields) {
    if (f.id) {
      const loc = page.locator(`#${f.id}`);
      if ((await loc.count()) > 0) return loc.first();
    }
    if (f.name) {
      const loc = page.locator(`[name="${f.name}"]`);
      if ((await loc.count()) > 0) return loc.first();
    }
  }

  return null;
}

/**
 * Detect multi-step "Next" / "Continue" buttons.
 */
export async function findNextButton(page) {
  const nextSelectors = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Proceed")',
    'a:has-text("Next")',
    'a:has-text("Continue")',
    '[data-step="next"]',
    '.next-step',
    '.btn-next'
  ];

  for (const sel of nextSelectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        return loc;
      }
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Submit the form and return basic timing info.
 */
export async function submitForm(page, formMeta, timeouts = {}) {
  const submitWait = timeouts.submitWaitTimeout || 10000;
  const interactionTimeout = timeouts.interactionTimeout || 15000;

  const submitBtn = await findSubmitControl(page, formMeta);
  if (!submitBtn) {
    return { submitted: false, reason: 'NO_SUBMIT_CONTROL', finalUrl: page.url() };
  }

  const urlBefore = page.url();

  try {
    // Prefer click; fall back to form.requestSubmit via evaluate if needed
    await Promise.race([
      submitBtn.click({ timeout: interactionTimeout }),
      page.waitForTimeout(interactionTimeout)
    ]);

    // Wait for possible navigation or network idle
    await Promise.race([
      page.waitForNavigation({ timeout: submitWait, waitUntil: 'domcontentloaded' }).catch(() => null),
      page.waitForLoadState('networkidle', { timeout: submitWait }).catch(() => null),
      page.waitForTimeout(Math.min(submitWait, 4000))
    ]);

    return {
      submitted: true,
      reason: null,
      urlBefore,
      finalUrl: page.url(),
      navigated: page.url() !== urlBefore
    };
  } catch (err) {
    return {
      submitted: false,
      reason: 'SUBMIT_ERROR',
      error: err.message,
      urlBefore,
      finalUrl: page.url()
    };
  }
}
