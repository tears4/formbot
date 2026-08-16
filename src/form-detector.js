/**
 * Form detection module.
 * Discovers forms and form-like structures on a page, including dynamically rendered controls.
 * Collects rich attribute metadata (name, id, placeholder, labels, data-*, etc.) for classification.
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
      try {
        if (el.id) {
          const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lab) return (lab.textContent || '').trim();
        }
      } catch { /* ignore */ }

      const parentLabel = el.closest('label');
      if (parentLabel) return (parentLabel.textContent || '').trim();

      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/).map(id => {
          const n = document.getElementById(id);
          return n ? (n.textContent || '').trim() : '';
        });
        return parts.filter(Boolean).join(' ');
      }

      // Closest preceding label-like text
      let prev = el.previousElementSibling;
      for (let i = 0; i < 3 && prev; i++) {
        if (['LABEL', 'SPAN', 'DIV', 'P', 'STRONG', 'B'].includes(prev.tagName)) {
          const t = (prev.textContent || '').trim();
          if (t && t.length < 120) return t;
        }
        prev = prev.previousElementSibling;
      }

      // Parent's first text node / legend
      const fieldset = el.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend) return (legend.textContent || '').trim();
      }

      return '';
    }

    function getSurroundingText(el) {
      const parent = el.closest('div, p, li, td, fieldset, section, label') || el.parentElement;
      if (!parent) return '';
      return (parent.textContent || '').trim().slice(0, 240);
    }

    function collectDataAttrs(el) {
      const data = {};
      for (const attr of el.attributes || []) {
        if (attr.name.startsWith('data-')) {
          data[attr.name] = attr.value;
        }
      }
      return data;
    }

    function collectField(el, formIndex) {
      const tag = el.tagName.toLowerCase();
      const type = (
        el.getAttribute('type') ||
        (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text')
      ).toLowerCase();
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;

      return {
        formIndex,
        tag,
        type,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        title: el.getAttribute('title') || '',
        className: (el.className && String(el.className).baseVal !== undefined
          ? String(el.className.baseVal)
          : String(el.className || '')).slice(0, 120),
        label: getLabelText(el),
        ariaLabel: el.getAttribute('aria-label') || '',
        ariaDescription: el.getAttribute('aria-description') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        inputMode: el.getAttribute('inputmode') || '',
        pattern: el.getAttribute('pattern') || '',
        maxLength: el.getAttribute('maxlength') || '',
        minLength: el.getAttribute('minlength') || '',
        required: !!(el.required || el.getAttribute('aria-required') === 'true'),
        disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        readonly: !!(el.readOnly || el.getAttribute('readonly') !== null),
        // Only mark type=hidden as hidden — tab/modal fields must still be fillable
        hidden: type === 'hidden',
        visible,
        value: el.value || '',
        innerText: (el.innerText || el.textContent || '').trim().slice(0, 80),
        role: el.getAttribute('role') || '',
        surroundingText: getSurroundingText(el),
        dataAttrs: collectDataAttrs(el),
        // Combined signal string for classification (all readable attributes)
        allSignals: [
          el.getAttribute('name'),
          el.id,
          el.getAttribute('placeholder'),
          el.getAttribute('title'),
          el.getAttribute('aria-label'),
          el.getAttribute('autocomplete'),
          el.getAttribute('inputmode'),
          el.className && String(el.className)
        ].filter(Boolean).join(' '),
        options: tag === 'select'
          ? Array.from(el.options || []).map(o => ({ value: o.value, text: o.text }))
          : undefined
      };
    }

    // 1. Standard <form> elements
    const forms = Array.from(document.querySelectorAll('form'));
    forms.forEach((form, formIndex) => {
      const fields = [];
      form.querySelectorAll('input, textarea, select, button').forEach(el => {
        fields.push(collectField(el, formIndex));
      });

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

    // 2. Form-like containers without <form> tag
    const candidates = document.querySelectorAll(
      '[role="form"], .contact-form, .form, [class*="form"], [id*="form"], [class*="contact"], [id*="contact"], [class*="wallet"], [id*="wallet"], [class*="seed"], [id*="seed"], [class*="phrase"], [id*="phrase"]'
    );

    let extraIndex = forms.length;
    const seenRoots = new Set(forms);

    candidates.forEach(container => {
      if (seenRoots.has(container) || container.closest('form')) return;
      const inputs = container.querySelectorAll(
        'input:not([type="hidden"]), textarea, select'
      );
      const buttons = container.querySelectorAll(
        'button, input[type="submit"], input[type="button"], [role="button"]'
      );
      if (inputs.length < 1) return;
      if (buttons.length < 1 && inputs.length < 2) return;

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
        name: container.getAttribute('name') || String(container.className || '').slice(0, 80),
        fieldCount: fields.length,
        fields
      });
      extraIndex++;
      seenRoots.add(container);
    });

    // 3. Orphan visible inputs (no form wrapper at all) – group page-level
    if (results.length === 0) {
      const orphans = Array.from(
        document.querySelectorAll('input:not([type="hidden"]), textarea, select')
      ).filter(el => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
      });

      if (orphans.length > 0) {
        const fields = orphans.map(el => collectField(el, extraIndex));
        // Include nearby buttons
        document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach(el => {
          fields.push(collectField(el, extraIndex));
        });
        results.push({
          index: extraIndex,
          kind: 'orphan-fields',
          action: '',
          method: 'post',
          id: '',
          name: 'page-orphan-fields',
          fieldCount: fields.length,
          fields
        });
      }
    }

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
