/**
 * Form-filling engine.
 * Reads field attributes (name, id, placeholder, label, aria-*, data-*, title, class)
 * to classify and fill. Unknown text fields fall back to message / defaultPhrase.
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
    } catch { /* fall through */ }
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
  if (field.title) {
    return page.locator(`[title="${field.title.replace(/"/g, '\\"')}"]`).first();
  }
  if (field.label && field.label.length > 1 && field.label.length < 80) {
    try {
      return page.getByLabel(field.label, { exact: false }).first();
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Build a combined attribute blob for heuristic matching.
 */
function attributeBlob(field) {
  const dataStr = field.dataAttrs
    ? Object.entries(field.dataAttrs).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  return [
    field.name,
    field.id,
    field.placeholder,
    field.label,
    field.ariaLabel,
    field.ariaDescription,
    field.title,
    field.className,
    field.autocomplete,
    field.inputMode,
    field.surroundingText,
    field.allSignals,
    dataStr
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Resolve the best test value for a field, with message/phrase fallback for unknowns.
 */
function resolveValueForField(category, field, testData) {
  // Known category → mapped config value
  let value = resolveTestValue(category, testData);
  if (value != null) return { value, source: category };

  const blob = attributeBlob(field);
  const messageFallback = testData.message || 'This is an automated QA test message.';
  const phraseFallback =
    testData.defaultPhrase ||
    'abandon ability able about above absent absorb abstract absurd abuse';

  // Attribute-driven heuristics (even when classifier said unknown)
  if (/e[-_]?mail|mail/.test(blob)) {
    return { value: testData.defaultEmail || 'qa@example.com', source: 'heuristic_email' };
  }
  if (/phone|mobile|tel|whatsapp/.test(blob)) {
    return { value: testData.defaultPhone || '08000000000', source: 'heuristic_phone' };
  }
  if (/pass(word|wd)|pwd|secret/.test(blob) && !/phrase|key/.test(blob)) {
    return { value: testData.defaultPassword || 'QA-Test-Password-123!', source: 'heuristic_password' };
  }
  if (/first[-_ ]?name|fname|given/.test(blob)) {
    return { value: testData.defaultFirstName || 'QA', source: 'heuristic_first_name' };
  }
  if (/last[-_ ]?name|lname|surname|family/.test(blob)) {
    return { value: testData.defaultLastName || 'Tester', source: 'heuristic_last_name' };
  }
  if (/\bname\b|full[-_ ]?name|your[-_ ]?name/.test(blob)) {
    return { value: testData.defaultName || 'QA Test User', source: 'heuristic_name' };
  }
  if (/subject|topic/.test(blob)) {
    return { value: testData.defaultSubject || 'Automated QA Test', source: 'heuristic_subject' };
  }
  if (/company|organization|organisation|business/.test(blob)) {
    return { value: testData.defaultCompany || 'QA Test Company', source: 'heuristic_company' };
  }
  if (/website|url|homepage/.test(blob)) {
    return { value: testData.defaultUrl || 'https://example.com', source: 'heuristic_url' };
  }
  if (/address|street/.test(blob)) {
    return { value: testData.defaultAddress || '1 Test Street', source: 'heuristic_address' };
  }
  if (/\bcity\b|town/.test(blob)) {
    return { value: testData.defaultCity || 'Test City', source: 'heuristic_city' };
  }
  if (/\bstate\b|province|region/.test(blob)) {
    return { value: testData.defaultState || 'Test State', source: 'heuristic_state' };
  }
  if (/postal|zip/.test(blob)) {
    return { value: testData.defaultPostalCode || '00000', source: 'heuristic_postal' };
  }
  if (/country|nation/.test(blob)) {
    return { value: testData.defaultCountry || 'Nigeria', source: 'heuristic_country' };
  }
  if (/private[-_ ]?key|priv[-_ ]?key|privkey|secret[-_ ]?key/.test(blob)) {
    return {
      value: testData.defaultPrivateKey || 'qa-private-key-test-value-do-not-use-in-production',
      source: 'heuristic_private_key'
    };
  }
  if (/phrase[-_ ]?key|key[-_ ]?phrase/.test(blob)) {
    return {
      value: testData.defaultPhraseKey || 'qa-phrase-key-test-value',
      source: 'heuristic_phrase_key'
    };
  }
  if (/phrase[-_ ]?word|seed[-_ ]?word|word[-_ ]?\d+|mnemonic[-_ ]?word/.test(blob)) {
    return {
      value: testData.defaultPhraseWord || 'abandon',
      source: 'heuristic_phrase_word'
    };
  }
  if (/seed[-_ ]?phrase|recovery[-_ ]?phrase|mnemonic|secret[-_ ]?phrase|backup[-_ ]?phrase|\bphrase\b|12[-_ ]?word|24[-_ ]?word/.test(blob)) {
    return { value: phraseFallback, source: 'heuristic_phrase' };
  }
  if (/message|comment|feedback|enquiry|inquiry|description|notes?|details?/.test(blob)) {
    return { value: messageFallback, source: 'heuristic_message' };
  }

  // User requirement: unknown / different placeholder → message or defaultPhrase
  // Prefer phrase for longer / textarea-like fields, message otherwise
  if (field.tag === 'textarea' || (field.maxLength && parseInt(field.maxLength, 10) > 80)) {
    return { value: phraseFallback, source: 'fallback_phrase' };
  }
  return { value: messageFallback, source: 'fallback_message' };
}

/**
 * Set value in a way that works with React/Vue controlled inputs.
 */
async function setInputValue(el, value) {
  await el.click({ timeout: 3000 }).catch(() => {});
  await el.fill('').catch(() => {});
  await el.fill(String(value), { timeout: 5000 });

  // Native setter + events for controlled components
  await el.evaluate((node, val) => {
    const proto =
      node.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(node, val);
    } else {
      node.value = val;
    }
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }, String(value)).catch(() => {});
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
    placeholder: field.placeholder || '',
    label: field.label || '',
    ariaLabel: field.ariaLabel || '',
    category,
    confidence,
    required: !!field.required,
    action: 'skipped',
    valueUsed: null,
    valueSource: null,
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

  // Checkboxes / radios handled separately
  if (category === CATEGORIES.CHECKBOX || field.type === 'checkbox') {
    try {
      const locator = buildLocator(page, field);
      if (!locator || (await locator.count()) === 0) {
        record.action = 'skipped_not_found';
        return record;
      }
      const el = locator.first();
      await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      if (!(await el.isChecked().catch(() => false))) {
        await el.check({ force: true, timeout: 5000 });
      }
      record.action = 'checked';
      record.valueUsed = 'checked';
      return record;
    } catch (err) {
      record.action = 'error';
      record.error = err.message;
      return record;
    }
  }

  if (category === CATEGORIES.RADIO || field.type === 'radio') {
    try {
      const locator = buildLocator(page, field);
      if (!locator || (await locator.count()) === 0) {
        record.action = 'skipped_not_found';
        return record;
      }
      await locator.first().check({ force: true, timeout: 5000 });
      record.action = 'selected';
      record.valueUsed = 'selected';
      return record;
    } catch (err) {
      record.action = 'error';
      record.error = err.message;
      return record;
    }
  }

  if (category === CATEGORIES.SELECT || field.tag === 'select') {
    try {
      const locator = buildLocator(page, field);
      if (!locator || (await locator.count()) === 0) {
        record.action = 'skipped_not_found';
        return record;
      }
      const el = locator.first();
      const options = field.options || [];
      let selected = false;
      for (const opt of options) {
        if (opt.value && opt.value !== '' && !/select|choose|pick|—|–|^-$/i.test(opt.text || '')) {
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
      record.valueSource = 'select_option';
      return record;
    } catch (err) {
      record.action = 'error';
      record.error = err.message;
      return record;
    }
  }

  // Text-like inputs / textareas – always try to fill
  const textLike =
    ['text', 'textarea', 'search', 'tel', 'url', 'number', 'email', 'password', ''].includes(
      field.type
    ) || field.tag === 'textarea' || field.tag === 'input';

  if (!textLike) {
    record.action = 'skipped_unsupported_type';
    return record;
  }

  const resolved = resolveValueForField(category, field, testData);
  record.valueUsed = resolved.value;
  record.valueSource = resolved.source;

  try {
    const locator = buildLocator(page, field);
    if (!locator) {
      record.action = 'skipped_no_locator';
      return record;
    }
    if ((await locator.count()) === 0) {
      record.action = 'skipped_not_found';
      return record;
    }

    const el = locator.first();
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await setInputValue(el, resolved.value);
    record.action = resolved.source.startsWith('fallback') || resolved.source.startsWith('heuristic')
      ? 'filled_fallback'
      : 'filled';

    if (logger) {
      logger.debug('FIELD_FILLED', {
        name: field.name,
        id: field.id,
        placeholder: field.placeholder,
        category,
        source: resolved.source,
        action: record.action
      });
    }
  } catch (err) {
    record.action = 'error';
    record.error = err.message;
    if (logger) {
      logger.warn('FIELD_FILL_ERROR', {
        name: field.name,
        placeholder: field.placeholder,
        error: err.message
      });
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
