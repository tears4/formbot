/**
 * Form detection module.
 * Discovers forms and form-like structures on a page, including dynamically rendered controls.
 */

/**
 * Extract all forms and standalone form-like field groups from the current page.
 * Runs inside the browser context via page.evaluate.
 */
export async function detectForms(page) {
  return page.evaluate(() => {
    const results = [];

    function getLabelText(el) {
      if (!el) return '';
      // Explicit label[for]
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return (lab.textContent || '').trim();
      }
      // Parent label
      const parentLabel = el.closest('label');
      if (parentLabel) return (parentLabel.textContent || '').trim();
      // aria-labelledby
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/).map(id => {
          const n = document.getElementById(id);
          return n ? (n.textContent || '').trim() : '';
        });
        return parts.filter(Boolean).join(' ');
      }
      // Previous sibling text
      let prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
        return (prev.textContent || '').trim().slice(0, 120);
      }
      return '';
    }

    function getSurroundingText(el) {
      const parent = el.closest('div, p, li, td, fieldset, section') || el.parentElement;
      if (!parent) return '';
      return (parent.textContent || '').trim().slice(0, 200);
    }

    function collectField(el, formIndex) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text')).toLowerCase();
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;

      return {
        formIndex,
        tag,
        type,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        label: getLabelText(el),
        ariaLabel: el.getAttribute('aria-label') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        required: el.required || el.getAttribute('aria-required') === 'true',
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        readonly: el.readOnly || el.getAttribute('readonly') !== null,
        hidden: type === 'hidden' || !visible,
        value: el.value || '',
        innerText: (el.innerText || '').trim().slice(0, 80),
        role: el.getAttribute('role') || '',
        surroundingText: getSurroundingText(el),
        options: tag === 'select'
          ? Array.from(el.options || []).map(o => ({ value: o.value, text: o.text }))
          : undefined
      };
    }

    // 1. Standard <form> elements
    const forms = Array.from(document.querySelectorAll('form'));
    forms.forEach((form, formIndex) => {
      const fields = [];
      const controls = form.querySelectorAll('input, textarea, select, button');
      controls.forEach(el => {
        fields.push(collectField(el, formIndex));
      });

      // Also pick up role=button / [type=submit] that may be outside but associated
      results.push({
        index: formIndex,
        kind: 'form',
        action: form.getAttribute('action') || '',
        method: (form.getAttribute('method') || 'get').toLowerCase(),
        id: form.id || '',
        name: form.getAttribute('name') || '',
        fieldCount: fields.length,
        fields
      });
    });

    // 2. Form-like containers without <form> tag (common in modern SPAs)
    // Look for containers that have multiple inputs + a submit-like button
    const candidates = document.querySelectorAll(
      '[role="form"], .contact-form, .form, form, [class*="form"], [id*="form"], [class*="contact"], [id*="contact"]'
    );

    let extraIndex = forms.length;
    const seenRoots = new Set(forms);

    candidates.forEach(container => {
      if (seenRoots.has(container) || container.closest('form')) return;
      const inputs = container.querySelectorAll('input:not([type="hidden"]), textarea, select');
      const buttons = container.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
      if (inputs.length < 1) return;
      if (buttons.length < 1 && inputs.length < 2) return;

      // Avoid nested duplicates
      let alreadyCovered = false;
      for (const r of results) {
        if (r.kind === 'form-like' && container.contains(document.querySelector(`[data-sfqa-root="${r.index}"]`))) {
          alreadyCovered = true;
          break;
        }
      }
      if (alreadyCovered) return;

      container.setAttribute('data-sfqa-root', String(extraIndex));
      const fields = [];
      container.querySelectorAll('input, textarea, select, button').forEach(el => {
        fields.push(collectField(el, extraIndex));
      });

      results.push({
        index: extraIndex,
        kind: 'form-like',
        action: '',
        method: 'post',
        id: container.id || '',
        name: container.getAttribute('name') || container.className || '',
        fieldCount: fields.length,
        fields
      });
      extraIndex++;
      seenRoots.add(container);
    });

    return results;
  });
}

/**
 * Extract internal links from the page for crawling.
 */
export async function extractLinks(page, baseUrl, maxLinks = 40) {
  const links = await page.evaluate((limit) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors.slice(0, limit * 3).map(a => ({
      href: a.href,
      text: (a.innerText || a.textContent || '').trim().slice(0, 100)
    }));
  }, maxLinks);

  return links;
}
