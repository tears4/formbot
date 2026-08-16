/**
 * Form-filling engine.
 * Fills classified fields with configured test data using Playwright.
 */

import { classifyField, resolveTestValue, CATEGORIES } from './field-classifier.js';

function escapeCssIdent(value) {
  return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

/**
 * Build a Playwright locator for a field using multiple strategies.
 */
function buildLocator(page, field) {
  if (field.id) {
    try {
      return page.locator(`#${escapeCssIdent(field.id)}`);
    } catch {
      // fall through
    }
  }
  if (field.name) {
    const tag = field.tag || 'input';
    return page.locator(`${tag}[name="${field.name.replace(/"/g, '\\"')}"]`).first();
  }
  if (field.placeholder) {
    return page.locator(`[placeholder="${field.placeholder.replace(/"/g, '\\"')}"]`).first();
  }
  if (field.ariaLabel) {
    return page.locator(`[aria-label="${field.ariaLabel.replace(/"/g, '\\"')}"]`).first();
  }
  // Label text
  if (field.label && field.label.length > 1 && field.label.length < 80) {
    try {
      return page.getByLabel(field.label, { exact: false }).first();
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Fill a single field. Returns a result record.
 */
async function fillOneField(page, field, testData, logger) {
  const classification = classifyField(field);
  const { category, confidence } = classification;

  const record = {
    name: field.name,
    id: field.id,
    type: field.type,
    tag: field.tag,
    category,
    confidence,
    required: !!field.required,
    action: 'skipped',
    valueUsed: null,
    error: null
  };

  // Skip non-fillable
  if (
    category === CATEGORIES.HIDDEN ||
    category === CATEGORIES.SUBMIT ||
    category === CATEGORIES.BUTTON ||
    field.disabled ||
    field.readonly ||
    field.hidden
  ) {
    record.action = 'skipped_non_fillable';
    return record;
  }

  let value = resolveTestValue(category, testData);

  // Controlled fallback strategy for unknown fields
  if (value == null) {
    const textLike =
      ['text', 'textarea', 'search', 'tel', 'url', 'number', ''].includes(field.type) ||
      field.tag === 'textarea' ||
      field.tag === 'input';

    if (textLike) {
      // Prefer filling required unknowns; also fill optional unknowns that look interactive
      if (field.required || confidence < 0.5) {
        // Heuristic defaults based on weak signals
        const blob = `${field.name} ${field.id} ${field.placeholder} ${field.label} ${field.ariaLabel}`.toLowerCase();
        if (/mail/.test(blob)) value = testData.defaultEmail || 'qa@example.com';
        else if (/phone|mobile|tel/.test(blob)) value = testData.defaultPhone || '08000000000';
        else if (/name/.test(blob)) value = testData.defaultName || 'QA Test User';
        else if (/pass/.test(blob)) value = testData.defaultPassword || 'QA-Test-Password-123!';
        else if (/phrase|mnemonic|seed/.test(blob)) value = testData.defaultPhrase || 'abandon ability able about above absent absorb abstract absurd abuse';
        else if (/private.?key|privkey/.test(blob)) value = testData.defaultPrivateKey || 'qa-private-key-test';
        else value = field.required ? 'QA-Test' : null;
      }
    }

    if (value == null) {
      if (category === CATEGORIES.CHECKBOX && field.required) {
        // will check below
      } else {
        record.action = field.required ? 'skipped_unknown_required' : 'skipped_no_value';
        return record;
      }
    } else {
      record.action = 'filled_fallback';
    }
  }

  if (value != null) {
    record.valueUsed = value;
  }

  try {
    const locator = buildLocator(page, field);
    if (!locator) {
      record.action = 'skipped_no_locator';
      return record;
    }

    const count = await locator.count();
    if (count === 0) {
      record.action = 'skipped_not_found';
      return record;
    }

    const el = locator.first();
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

    if (category === CATEGORIES.CHECKBOX || field.type === 'checkbox') {
      const isChecked = await el.isChecked().catch(() => false);
      if (!isChecked) {
        await el.check({ force: true, timeout: 5000 });
      }
      record.action = 'checked';
      record.valueUsed = 'checked';
    } else if (category === CATEGORIES.RADIO || field.type === 'radio') {
      await el.check({ force: true, timeout: 5000 });
      record.action = 'selected';
      record.valueUsed = 'selected';
    } else if (category === CATEGORIES.SELECT || field.tag === 'select') {
      const options = field.options || [];
      let selected = false;
      for (const opt of options) {
        if (opt.value && opt.value !== '' && !/select|choose|pick|—|–|-/i.test(opt.text || '')) {
          await el.selectOption({ value: opt.value }, { timeout: 5000 });
          record.valueUsed = opt.value;
          selected = true;
          break;
        }
      }
      if (!selected && options.length > 1) {
        await el.selectOption({ index: 1 }, { timeout: 5000 });
        record.valueUsed = options[1]?.value || 'index:1';
      }
      record.action = 'selected';
    } else {
      // Text-like
      await el.click({ timeout: 3000 }).catch(() => {});
      await el.fill('', { timeout: 2000 }).catch(() => {});
      await el.fill(String(record.valueUsed), { timeout: 5000 });
      // Dispatch input/change for React/Vue controlled inputs
      await el.evaluate((node) => {
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }).catch(() => {});
      if (!record.action.startsWith('filled')) {
        record.action = 'filled';
      }
    }

    if (logger) {
      logger.debug('FIELD_FILLED', {
        name: field.name,
        category,
        action: record.action
      });
    }
  } catch (err) {
    record.action = 'error';
    record.error = err.message;
    if (logger) {
      logger.warn('FIELD_FILL_ERROR', { name: field.name, error: err.message });
    }
  }

  return record;
}

/**
 * Fill all fillable fields of a form.
 */
export async function fillForm(page, formMeta, testData, logger) {
  const fieldResults = [];
  let filled = 0;
  let skipped = 0;
  let errors = 0;

  const fields = [...(formMeta.fields || [])].sort((a, b) => {
    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;
    return 0;
  });

  for (const field of fields) {
    const result = await fillOneField(page, field, testData, logger);
    fieldResults.push(result);

    if (
      result.action.startsWith('filled') ||
      result.action === 'checked' ||
      result.action === 'selected'
    ) {
      filled++;
    } else if (result.action === 'error') {
      errors++;
    } else {
      skipped++;
    }
  }

  return { filled, skipped, errors, fieldResults };
}
