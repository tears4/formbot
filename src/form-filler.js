/**
 * Form-filling engine.
 * Fills classified fields with configured test data using Playwright.
 */

import { classifyField, resolveTestValue, CATEGORIES } from './field-classifier.js';

/**
 * Build a Playwright locator for a field using multiple strategies.
 */
function escapeCssIdent(value) {
  return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function buildLocator(page, field) {
  // Prefer id
  if (field.id) {
    return page.locator(`#${escapeCssIdent(field.id)}`);
  }
  // name attribute
  if (field.name) {
    const tag = field.tag || 'input';
    return page.locator(`${tag}[name="${field.name.replace(/"/g, '\\"')}"]`).first();
  }
  // placeholder
  if (field.placeholder) {
    return page.locator(`[placeholder="${field.placeholder.replace(/"/g, '\\"')}"]`).first();
  }
  // aria-label
  if (field.ariaLabel) {
    return page.locator(`[aria-label="${field.ariaLabel.replace(/"/g, '\\"')}"]`).first();
  }
  // Fallback: type + index is fragile; return null
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

  const value = resolveTestValue(category, testData);

  // Controlled fallback for unknown required fields only
  if (value == null) {
    if (field.required && category === CATEGORIES.UNKNOWN) {
      // Minimal safe fallback for required unknown text-like fields
      if (['text', 'textarea', 'search', ''].includes(field.type) || field.tag === 'textarea') {
        record.valueUsed = 'QA-Test';
        record.action = 'filled_fallback';
      } else {
        record.action = 'skipped_unknown';
        return record;
      }
    } else {
      record.action = 'skipped_no_value';
      return record;
    }
  } else {
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

    // Scroll into view
    await locator.first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

    if (category === CATEGORIES.CHECKBOX) {
      const isChecked = await locator.first().isChecked().catch(() => false);
      if (!isChecked) {
        await locator.first().check({ force: true, timeout: 5000 });
      }
      record.action = 'checked';
    } else if (category === CATEGORIES.RADIO) {
      await locator.first().check({ force: true, timeout: 5000 });
      record.action = 'selected';
    } else if (category === CATEGORIES.SELECT || field.tag === 'select') {
      // Prefer first non-empty option
      const options = field.options || [];
      let selected = false;
      for (const opt of options) {
        if (opt.value && opt.value !== '' && !/select|choose|pick/i.test(opt.text || '')) {
          await locator.first().selectOption({ value: opt.value }, { timeout: 5000 });
          record.valueUsed = opt.value;
          selected = true;
          break;
        }
      }
      if (!selected && options.length > 1) {
        await locator.first().selectOption({ index: 1 }, { timeout: 5000 });
        record.valueUsed = options[1]?.value || 'index:1';
      }
      record.action = 'selected';
    } else {
      // Text-like inputs
      await locator.first().click({ timeout: 3000 }).catch(() => {});
      await locator.first().fill(String(record.valueUsed), { timeout: 5000 });
      record.action = 'filled';
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
 * Returns { filled, skipped, errors, fieldResults }
 */
export async function fillForm(page, formMeta, testData, logger) {
  const fieldResults = [];
  let filled = 0;
  let skipped = 0;
  let errors = 0;

  // Sort: required first, then by confidence
  const fields = [...(formMeta.fields || [])].sort((a, b) => {
    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;
    return 0;
  });

  for (const field of fields) {
    const result = await fillOneField(page, field, testData, logger);
    fieldResults.push(result);

    if (result.action.startsWith('filled') || result.action === 'checked' || result.action === 'selected') {
      filled++;
    } else if (result.action === 'error') {
      errors++;
    } else {
      skipped++;
    }
  }

  return { filled, skipped, errors, fieldResults };
}
