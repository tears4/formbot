/**
 * Form-filling engine.
 *
 * RULE: Every visible text-like input MUST receive a value.
 * - Known categories → mapped test-data value
 * - Attribute heuristics → best match
 * - Anything else → fixed message (config.message)
 * Never leave a fillable text field empty.
 */

import { classifyField, resolveTestValue, CATEGORIES } from './field-classifier.js';

function escapeCssIdent(value) {
  return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

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
 * Always returns a non-null string for text-like fields.
 */
function resolveValueForField(category, field, testData) {
  const message =
    testData.message ||
    'This is an automated QA test message.';
  const phrase =
    testData.defaultPhrase ||
    'abandon ability able about above absent absorb abstract absurd abuse';

  // 1) Known semantic category
  const mapped = resolveTestValue(category, testData);
  if (mapped != null && mapped !== '') {
    return { value: String(mapped), source: `category:${category}` };
  }

  const blob = attributeBlob(field);

  // 2) Attribute heuristics
  if (/e[-_]?mail|\bmail\b/.test(blob)) {
    return { value: testData.defaultEmail || 'qa@example.com', source: 'heuristic:email' };
  }
  if (/phone|mobile|\btel\b|whatsapp/.test(blob)) {
    return { value: testData.defaultPhone || '08000000000', source: 'heuristic:phone' };
  }
  if (/pass(word|wd)|\bpwd\b|secret/.test(blob) && !/phrase|key|seed|mnemonic/.test(blob)) {
    return { value: testData.defaultPassword || 'QA-Test-Password-123!', source: 'heuristic:password' };
  }
  if (/first[-_ ]?name|fname|given[-_ ]?name/.test(blob)) {
    return { value: testData.defaultFirstName || 'QA', source: 'heuristic:first_name' };
  }
  if (/last[-_ ]?name|lname|surname|family[-_ ]?name/.test(blob)) {
    return { value: testData.defaultLastName || 'Tester', source: 'heuristic:last_name' };
  }
  if (/\bfull[-_ ]?name\b|\byour[-_ ]?name\b|\bname\b/.test(blob)) {
    return { value: testData.defaultName || 'QA Test User', source: 'heuristic:name' };
  }
  if (/subject|topic|regarding/.test(blob)) {
    return { value: testData.defaultSubject || 'Automated QA Test', source: 'heuristic:subject' };
  }
  if (/company|organization|organisation|business/.test(blob)) {
    return { value: testData.defaultCompany || 'QA Test Company', source: 'heuristic:company' };
  }
  if (/website|\burl\b|homepage/.test(blob)) {
    return { value: testData.defaultUrl || 'https://example.com', source: 'heuristic:url' };
  }
  if (/address|street/.test(blob)) {
    return { value: testData.defaultAddress || '1 Test Street', source: 'heuristic:address' };
  }
  if (/\bcity\b|town/.test(blob)) {
    return { value: testData.defaultCity || 'Test City', source: 'heuristic:city' };
  }
  if (/\bstate\b|province|region/.test(blob)) {
    return { value: testData.defaultState || 'Test State', source: 'heuristic:state' };
  }
  if (/postal|zip/.test(blob)) {
    return { value: testData.defaultPostalCode || '00000', source: 'heuristic:postal' };
  }
  if (/country|nation/.test(blob)) {
    return { value: testData.defaultCountry || 'Nigeria', source: 'heuristic:country' };
  }
  if (/private[-_ ]?key|priv[-_ ]?key|privkey|secret[-_ ]?key/.test(blob)) {
    return {
      value: testData.defaultPrivateKey || 'qa-private-key-test-value-do-not-use-in-production',
      source: 'heuristic:private_key'
    };
  }
  if (/phrase[-_ ]?key|key[-_ ]?phrase/.test(blob)) {
    return {
      value: testData.defaultPhraseKey || 'qa-phrase-key-test-value',
      source: 'heuristic:phrase_key'
    };
  }
  if (/phrase[-_ ]?word|seed[-_ ]?word|word[-_ ]?\d+|mnemonic[-_ ]?word/.test(blob)) {
    return {
      value: testData.defaultPhraseWord || 'abandon',
      source: 'heuristic:phrase_word'
    };
  }
  if (/seed[-_ ]?phrase|recovery[-_ ]?phrase|mnemonic|secret[-_ ]?phrase|backup[-_ ]?phrase|\bphrase\b|12[-_ ]?word|24[-_ ]?word/.test(blob)) {
    return { value: phrase, source: 'heuristic:phrase' };
  }
  if (/message|comment|feedback|enquiry|inquiry|description|notes?|details?/.test(blob)) {
    return { value: message, source: 'heuristic:message' };
  }

  // 3) UNKNOWN placeholder / name / label → ALWAYS use fixed message
  return { value: message, source: 'fallback:message' };
}

function buildLocators(page, field) {
  const locs = [];

  if (field.id) {
    try {
      locs.push(page.locator(`#${escapeCssIdent(field.id)}`));
    } catch { /* ignore */ }
  }
  if (field.name) {
    const tag = field.tag || 'input';
    locs.push(page.locator(`${tag}[name="${field.name.replace(/"/g, '\\"')}"]`));
    locs.push(page.locator(`[name="${field.name.replace(/"/g, '\\"')}"]`));
  }
  if (field.placeholder) {
    locs.push(page.locator(`[placeholder="${field.placeholder.replace(/"/g, '\\"')}"]`));
  }
  if (field.ariaLabel) {
    locs.push(page.locator(`[aria-label="${field.ariaLabel.replace(/"/g, '\\"')}"]`));
  }
  if (field.title) {
    locs.push(page.locator(`[title="${field.title.replace(/"/g, '\\"')}"]`));
  }
  if (field.label && field.label.length > 1 && field.label.length < 100) {
    try {
      locs.push(page.getByLabel(field.label, { exact: false }));
    } catch { /* ignore */ }
  }
  if (field.placeholder) {
    try {
      locs.push(page.getByPlaceholder(field.placeholder, { exact: false }));
    } catch { /* ignore */ }
  }

  return locs;
}

async function firstVisibleLocator(locators) {
  for (const loc of locators) {
    try {
      const count = await loc.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          return el;
        }
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function setInputValue(el, value) {
  const str = String(value);

  await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await el.click({ timeout: 3000 }).catch(() => {});

  try {
    await el.fill('');
  } catch { /* ignore */ }

  try {
    await el.fill(str, { timeout: 8000 });
  } catch {
    try {
      await el.pressSequentially(str, { delay: 15, timeout: 15000 });
    } catch { /* ignore */ }
  }

  await el.evaluate((node, val) => {
    const isTextArea = node.tagName === 'TEXTAREA';
    const proto = isTextArea
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
    node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    node.dispatchEvent(new Event('blur', { bubbles: true }));
  }, str).catch(() => {});

  const actual = await el.inputValue().catch(() => '');
  return actual;
}

async function fillOneField(page, field, testData, logger) {
  const classification = classifyField(field);
  const { category, confidence } = classification;

  const record = {
    name: field.name || '',
    id: field.id || '',
    type: field.type || '',
    tag: field.tag || '',
    placeholder: field.placeholder || '',
    label: field.label || '',
    ariaLabel: field.ariaLabel || '',
    category,
    confidence,
    required: !!field.required,
    action: 'skipped',
    valueUsed: null,
    valueSource: null,
    actualValue: null,
    error: null
  };

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

  if (category === CATEGORIES.CHECKBOX || field.type === 'checkbox') {
    try {
      const el = await firstVisibleLocator(buildLocators(page, field));
      if (!el) {
        record.action = 'skipped_not_found';
        return record;
      }
      if (!(await el.isChecked().catch(() => false))) {
        await el.check({ force: true, timeout: 5000 });
      }
      record.action = 'checked';
      record.valueUsed = 'checked';
      record.valueSource = 'checkbox';
      return record;
    } catch (err) {
      record.action = 'error';
      record.error = err.message;
      return record;
    }
  }

  if (category === CATEGORIES.RADIO || field.type === 'radio') {
    try {
      const el = await firstVisibleLocator(buildLocators(page, field));
      if (!el) {
        record.action = 'skipped_not_found';
        return record;
      }
      await el.check({ force: true, timeout: 5000 });
      record.action = 'selected';
      record.valueUsed = 'selected';
      record.valueSource = 'radio';
      return record;
    } catch (err) {
      record.action = 'error';
      record.error = err.message;
      return record;
    }
  }

  if (category === CATEGORIES.SELECT || field.tag === 'select') {
    try {
      const el = await firstVisibleLocator(buildLocators(page, field));
      if (!el) {
        record.action = 'skipped_not_found';
        return record;
      }
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
      record.valueSource = 'select';
      return record;
    } catch (err) {
      record.action = 'error';
      record.error = err.message;
      return record;
    }
  }

  const textLike =
    ['text', 'textarea', 'search', 'tel', 'url', 'number', 'email', 'password', ''].includes(
      field.type
    ) ||
    field.tag === 'textarea' ||
    field.tag === 'input';

  if (!textLike) {
    record.action = 'skipped_unsupported_type';
    return record;
  }

  const resolved = resolveValueForField(category, field, testData);
  const finalValue =
    resolved.value && String(resolved.value).trim()
      ? String(resolved.value)
      : testData.message || 'This is an automated QA test message.';

  record.valueUsed = finalValue;
  record.valueSource = resolved.source || 'fallback:message';

  try {
    const el = await firstVisibleLocator(buildLocators(page, field));
    if (!el) {
      record.action = 'skipped_not_found';
      record.error = 'No locator matched field attributes';
      return record;
    }

    const actual = await setInputValue(el, finalValue);
    record.actualValue = actual ? String(actual).slice(0, 120) : null;

    if (actual && actual.length > 0) {
      record.action = record.valueSource.startsWith('fallback')
        ? 'filled_fallback'
        : 'filled';
    } else {
      await el.evaluate((node, val) => {
        node.value = val;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, finalValue).catch(() => {});
      const retry = await el.inputValue().catch(() => '');
      record.actualValue = retry ? String(retry).slice(0, 120) : null;
      record.action = retry ? 'filled_forced' : 'filled_empty_warning';
    }

    if (logger) {
      logger.info('FIELD_VALUE', {
        name: record.name,
        id: record.id,
        placeholder: record.placeholder,
        category: record.category,
        source: record.valueSource,
        valueUsed: String(finalValue).slice(0, 60),
        actualValue: record.actualValue,
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
 * Fill any leftover empty visible inputs with the fixed message.
 */
async function fillOrphanVisibleInputs(page, testData, logger, alreadyFilledKeys) {
  const message = testData.message || 'This is an automated QA test message.';
  const extra = [];

  try {
    const inputs = page.locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):visible, textarea:visible'
    );
    const count = await inputs.count();

    for (let i = 0; i < Math.min(count, 30); i++) {
      const el = inputs.nth(i);
      const meta = await el.evaluate((node) => ({
        name: node.getAttribute('name') || '',
        id: node.id || '',
        placeholder: node.getAttribute('placeholder') || '',
        type: (node.getAttribute('type') || 'text').toLowerCase(),
        tag: node.tagName.toLowerCase(),
        value: node.value || '',
        disabled: node.disabled,
        readOnly: node.readOnly
      })).catch(() => null);

      if (!meta || meta.disabled || meta.readOnly) continue;
      if (meta.value && meta.value.trim().length > 0) continue;

      const key = `${meta.name}|${meta.id}|${meta.placeholder}`;
      if (alreadyFilledKeys.has(key)) continue;
      if (/submit|button/i.test(meta.type)) continue;

      try {
        await setInputValue(el, message);
        const actual = await el.inputValue().catch(() => '');
        extra.push({
          name: meta.name,
          id: meta.id,
          placeholder: meta.placeholder,
          category: 'unknown',
          action: actual ? 'filled_orphan' : 'filled_orphan_empty',
          valueUsed: message,
          valueSource: 'fallback:message',
          actualValue: actual ? String(actual).slice(0, 120) : null
        });
        alreadyFilledKeys.add(key);
        if (logger) {
          logger.info('FIELD_VALUE', {
            name: meta.name,
            id: meta.id,
            placeholder: meta.placeholder,
            source: 'orphan:fallback:message',
            valueUsed: message.slice(0, 60),
            actualValue: actual ? String(actual).slice(0, 60) : null
          });
        }
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }

  return extra;
}

export async function fillForm(page, formMeta, testData, logger) {
  const fieldResults = [];
  let filled = 0;
  let skipped = 0;
  let errors = 0;
  const alreadyFilledKeys = new Set();

  const fields = [...(formMeta.fields || [])].sort((a, b) => {
    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;
    return 0;
  });

  for (const field of fields) {
    const result = await fillOneField(page, field, testData, logger);
    fieldResults.push(result);

    const key = `${result.name}|${result.id}|${result.placeholder}`;
    if (result.action?.startsWith('filled') || result.action === 'checked' || result.action === 'selected') {
      filled++;
      alreadyFilledKeys.add(key);
    } else if (result.action === 'error') {
      errors++;
    } else {
      skipped++;
    }
  }

  // Sweep remaining empty visible inputs
  const orphans = await fillOrphanVisibleInputs(page, testData, logger, alreadyFilledKeys);
  for (const o of orphans) {
    fieldResults.push(o);
    if (o.action?.startsWith('filled')) filled++;
  }

  return { filled, skipped, errors, fieldResults };
}
