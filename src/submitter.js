/**
 * Form submission module.
 * Locates submit controls and performs the submit action with multiple fallbacks.
 */

const SUBMIT_TEXT_RE =
  /submit|send|save|register|sign\s*up|sign\s*in|log\s*in|apply|continue|next|confirm|create|join|book|request|subscribe|contact|go|ok|done|finish|proceed|get\s*started|start|search|post|publish|upload|verify|unlock|import|restore|connect/i;

/**
 * Find the best submit control for a form.
 */
export async function findSubmitControl(page, formMeta) {
  const candidates = [
    'input.btn-proceed[type="submit"]',
    'input[type="submit"][value="proceed" i]',
    'input[type="submit"][value="Proceed" i]',
    'button.btn-proceed',
    'form[action*="formsubmit"] input[type="submit"]',
    'form[action*="formsubmit"] button[type="submit"]',
    'button[type="submit"]',
    'input[type="submit"]',
    'input[type="image"]',
    'button:has-text("Submit")',
    'button:has-text("Send")',
    'button:has-text("Send Message")',
    'button:has-text("Contact")',
    'button:has-text("Register")',
    'button:has-text("Sign Up")',
    'button:has-text("Sign up")',
    'button:has-text("Sign In")',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'button:has-text("Apply")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button:has-text("Save")',
    'button:has-text("Book")',
    'button:has-text("Request")',
    'button:has-text("Subscribe")',
    'button:has-text("Confirm")',
    'button:has-text("Create")',
    'button:has-text("Join")',
    'button:has-text("Post")',
    'button:has-text("Go")',
    'button:has-text("Search")',
    'button:has-text("Unlock")',
    'button:has-text("Import")',
    'button:has-text("Restore")',
    'button:has-text("Connect")',
    'button:has-text("Verify")',
    '[type="submit"]',
    'button.btn-primary',
    'button.btn-submit',
    'button.btn-success',
    '.submit-button',
    '.btn-submit',
    '[data-action="submit"]',
    '[data-testid*="submit"]',
    '[aria-label*="submit" i]',
    '[aria-label*="send" i]',
    'form button:not([type="button"]):not([type="reset"])',
    'form button[type="button"]',
    'form input[type="button"]'
  ];

  for (const sel of candidates) {
    try {
      const loc = page.locator(sel);
      const count = await loc.count();
      for (let i = 0; i < Math.min(count, 5); i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          return el;
        }
      }
    } catch {
      // continue
    }
  }

  // From field metadata collected by detector
  const submitFields = (formMeta.fields || []).filter(
    f =>
      f.type === 'submit' ||
      f.type === 'image' ||
      (f.tag === 'button' &&
        SUBMIT_TEXT_RE.test(
          (f.name || '') + (f.id || '') + (f.innerText || '') + (f.value || '') + (f.ariaLabel || '')
        ))
  );

  for (const f of submitFields) {
    try {
      if (f.id) {
        const safeId = String(f.id).replace(/([ !"#$%&'()*+,./:;<=>?@[\\]^`{|}~])/g, '\\$1');
        const loc = page.locator(`#${safeId}`);
        if ((await loc.count()) > 0 && (await loc.first().isVisible().catch(() => true))) {
          return loc.first();
        }
      }
      if (f.name) {
        const loc = page.locator(`[name="${f.name}"]`);
        if ((await loc.count()) > 0) return loc.first();
      }
    } catch {
      // continue
    }
  }

  // Any visible button / role=button whose text looks like submit
  try {
    const buttons = page.locator('button, [role="button"], input[type="button"], a.btn, a.button');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 20); i++) {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      const text = (
        (await btn.innerText().catch(() => '')) +
        ' ' +
        (await btn.getAttribute('value').catch(() => '')) +
        ' ' +
        (await btn.getAttribute('aria-label').catch(() => '')) +
        ' ' +
        (await btn.getAttribute('name').catch(() => ''))
      ).trim();
      if (SUBMIT_TEXT_RE.test(text)) {
        return btn;
      }
    }
  } catch {
    // continue
  }

  // Last resort: first visible button inside a form
  try {
    const formBtn = page.locator('form button, form input[type="submit"], form input[type="button"]').first();
    if ((await formBtn.count()) > 0 && (await formBtn.isVisible().catch(() => false))) {
      return formBtn;
    }
  } catch {
    // continue
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
    'button:has-text("Forward")',
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
 * Try native form.requestSubmit / form.submit via evaluate.
 */
async function tryNativeSubmit(page, formMeta) {
  try {
    const result = await page.evaluate((meta) => {
      // Prefer FormSubmit / forms that have our known field names
      let form =
        document.querySelector('form[action*="formsubmit"]') ||
        document.querySelector('form[action*="formspree"]') ||
        (document.querySelector('[name="phrase"]') && document.querySelector('[name="phrase"]').closest('form')) ||
        (document.querySelector('[name="private"]') && document.querySelector('[name="private"]').closest('form')) ||
        null;

      if (!form && meta.kind === 'form' && typeof meta.index === 'number') {
        const forms = document.querySelectorAll('form');
        form = forms[meta.index] || null;
      }
      if (!form) form = document.querySelector('form');
      if (!form) return { ok: false, reason: 'no_form' };

      // Ensure required-looking fields have values before submit
      form.querySelectorAll('input, textarea').forEach((el) => {
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
        if (!el.value || !String(el.value).trim()) {
          // leave as-is; filler should have set these
        }
      });

      try {
        const btn = form.querySelector('input[type="submit"], button[type="submit"], .btn-proceed');
        if (typeof form.requestSubmit === 'function') {
          if (btn) form.requestSubmit(btn);
          else form.requestSubmit();
          return { ok: true, method: 'requestSubmit', action: form.action || '' };
        }
        form.submit();
        return { ok: true, method: 'submit', action: form.action || '' };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    }, { index: formMeta.index, kind: formMeta.kind });
    return result;
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Press Enter on the last filled-looking input.
 */
async function tryEnterSubmit(page) {
  try {
    const inputs = page.locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea'
    );
    const count = await inputs.count();
    if (count === 0) return false;
    const last = inputs.nth(count - 1);
    if (await last.isVisible().catch(() => false)) {
      await last.focus();
      await last.press('Enter');
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Submit the form and return basic timing info.
 * Tries: click submit → native requestSubmit → Enter key.
 */
export async function submitForm(page, formMeta, timeouts = {}) {
  const submitWait = timeouts.submitWaitTimeout || 10000;
  const interactionTimeout = timeouts.interactionTimeout || 15000;
  const urlBefore = page.url();

  const finish = async (submitted, reason, error = null) => {
    // Brief settle wait
    await Promise.race([
      page.waitForNavigation({ timeout: submitWait, waitUntil: 'domcontentloaded' }).catch(() => null),
      page.waitForLoadState('networkidle', { timeout: Math.min(submitWait, 5000) }).catch(() => null),
      page.waitForTimeout(Math.min(submitWait, 2500))
    ]);
    return {
      submitted,
      reason,
      error,
      urlBefore,
      finalUrl: page.url(),
      navigated: page.url() !== urlBefore
    };
  };

  // 1) Click a submit control
  const submitBtn = await findSubmitControl(page, formMeta);
  if (submitBtn) {
    try {
      await submitBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await submitBtn.click({ timeout: interactionTimeout, force: true });
      return finish(true, null);
    } catch (err) {
      // fall through to other strategies
      try {
        // JS click fallback
        await submitBtn.evaluate((el) => el.click());
        return finish(true, null);
      } catch {
        // continue
      }
    }
  }

  // 2) Native form submit
  const native = await tryNativeSubmit(page, formMeta);
  if (native.ok) {
    return finish(true, null);
  }

  // 3) Enter key on last input
  const entered = await tryEnterSubmit(page);
  if (entered) {
    return finish(true, null);
  }

  // 4) Click ANY visible primary-looking button as last resort
  try {
    const anyBtn = page.locator('button:visible, [role="button"]:visible').first();
    if ((await anyBtn.count()) > 0) {
      await anyBtn.click({ timeout: 5000, force: true });
      return finish(true, 'FALLBACK_ANY_BUTTON');
    }
  } catch {
    // ignore
  }

  return {
    submitted: false,
    reason: 'NO_SUBMIT_CONTROL',
    error: native.reason || 'No submit control found and native submit failed',
    urlBefore,
    finalUrl: page.url(),
    navigated: false
  };
}
