/**
 * Form-filling engine (v1.2).
 *
 * CRITICAL FIX: Fill by name/id even when fields are inside hidden tabs/modals.
 * FormSubmit and similar services submit ALL named fields — empty or not.
 * Never skip a named text field just because it is not visible.
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
    field.title,
    field.className,
    field.autocomplete,
    field.surroundingText,
    field.allSignals,
    dataStr
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Always returns a non-empty string for text-like fields.
 */
function resolveValueForField(category, field, testData) {
  const message = testData.message || 'This is an automated QA test message.';
  const phrase =
    testData.defaultPhrase ||
    'abandon ability able about above absent absorb abstract absurd abuse';

  // Direct name-based mapping (highest priority for this form style)
  const n = (field.name || '').toLowerCase();
  if (n === 'phrase' || n === 'seed' || n === 'mnemonic' || n === 'recovery') {
    return { value: phrase, source: 'name:phrase' };
  }
  if (n === 'private' || n === 'privatekey' || n === 'private_key' || n === 'privkey') {
    return {
      value: testData.defaultPrivateKey || 'qa-private-key-test-value-do-not-use-in-production',
      source: 'name:private'
    };
  }
  if (n === 'keystore' || n === 'keystorejson') {
    return {
      value: testData.defaultKeystore || '{"version":3,"id":"qa-test-keystore","crypto":{}}',
      source: 'name:keystore'
    };
  }
  if (n === 'password' || n === 'pass' || n === 'pwd') {
    return { value: testData.defaultPassword || 'QA-Test-Password-123!', source: 'name:password' };
  }
  if (/email|mail/.test(n)) {
    return { value: testData.defaultEmail || 'qa@example.com', source: 'name:email' };
  }
  if (/wallet|name/.test(n) && !/email|mail|phrase|key|pass/.test(n)) {
    return { value: testData.defaultName || 'QA Test User', source: 'name:wallet_name' };
  }

  // Known category
  const mapped = resolveTestValue(category, testData);
  if (mapped != null && mapped !== '') {
    return { value: String(mapped), source: `category:${category}` };
  }

  const blob = attributeBlob(field);

  if (/e[-_]?mail|\bmail\b/.test(blob)) {
    return { value: testData.defaultEmail || 'qa@example.com', source: 'heuristic:email' };
  }
  if (/phone|mobile|\btel\b/.test(blob)) {
    return { value: testData.defaultPhone || '08000000000', source: 'heuristic:phone' };
  }
  if (/pass(word|wd)|\bpwd\b/.test(blob) && !/phrase|key|seed|mnemonic/.test(blob)) {
    return { value: testData.defaultPassword || 'QA-Test-Password-123!', source: 'heuristic:password' };
  }
  if (/first[-_ ]?name|fname/.test(blob)) {
    return { value: testData.defaultFirstName || 'QA', source: 'heuristic:first_name' };
  }
  if (/last[-_ ]?name|lname|surname/.test(blob)) {
    return { value: testData.defaultLastName || 'Tester', source: 'heuristic:last_name' };
  }
  if (/\bname\b|wallet/.test(blob)) {
    return { value: testData.defaultName || 'QA Test User', source: 'heuristic:name' };
  }
  if (/private[-_ ]?key|privkey|\bprivate\b/.test(blob)) {
    return {
      value: testData.defaultPrivateKey || 'qa-private-key-test-value-do-not-use-in-production',
      source: 'heuristic:private_key'
    };
  }
  if (/keystore/.test(blob)) {
    return {
      value: testData.defaultKeystore || '{"version":3,"id":"qa-test-keystore","crypto":{}}',
      source: 'heuristic:keystore'
    };
  }
  if (/seed|recovery|mnemonic|\bphrase\b|12[-_ ]?word|24[-_ ]?word/.test(blob)) {
    return { value: phrase, source: 'heuristic:phrase' };
  }
  if (/message|comment|feedback|enquiry|inquiry/.test(blob)) {
    return { value: message, source: 'heuristic:message' };
  }

  // Unknown → fixed message (never leave empty)
  return { value: message, source: 'fallback:message' };
}

/**
 * Force-set value on DOM node by name or id (works even if hidden in a tab).
 */
async function forceSetByNameOrId(page, field, value) {
  return page.evaluate(
    ({ name, id, value }) => {
      let el = null;
      if (name) {
        el =
          document.querySelector(`textarea[name="${name}"]`) ||
          document.querySelector(`input[name="${name}"]`) ||
          document.querySelector(`[name="${name}"]`);
      }
      if (!el && id) {
        el = document.getElementById(id);
      }
      if (!el) return { ok: false, reason: 'not_found' };

      // Remove readonly if present (some forms use readonly until focus)
      el.removeAttribute('readonly');
      el.readOnly = false;
      el.disabled = false;

      const tag = el.tagName.toLowerCase();
      if (tag === 'select') {
        // pick first non-empty option
        for (let i = 0; i < el.options.length; i++) {
          if (el.options[i].value) {
            el.selectedIndex = i;
            break;
          }
        }
      } else {
        const proto =
          tag === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, value);
        } else {
          el.value = value;
        }
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      return { ok: true, actual: el.value || '', name: el.name, id: el.id };
    },
    { name: field.name || '', id: field.id || '', value: String(value) }
  );
}

/**
 * Playwright visible fill when possible, then always force by name.
 */
async function setFieldValue(page, field, value) {
  const str = String(value);
  let actual = '';

  // Try visible Playwright fill first
  try {
    let loc = null;
    if (field.id) {
      loc = page.locator(`#${escapeCssIdent(field.id)}`);
    } else if (field.name) {
      loc = page.locator(`[name="${field.name.replace(/"/g, '\\"')}"]`);
    } else if (field.placeholder) {
      loc = page.locator(`[placeholder="${field.placeholder.replace(/"/g, '\\"')}"]`);
    }

    if (loc && (await loc.count()) > 0) {
      const el = loc.first();
      // Don't require visibility — force fill
      await el.evaluate((node, val) => {
        node.removeAttribute('readonly');
        node.readOnly = false;
        node.disabled = false;
        const proto =
          node.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(node, val);
        else node.value = val;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, str).catch(() => {});

      try {
        await el.fill(str, { force: true, timeout: 5000 });
      } catch {
        // forced evaluate above is enough
      }
      actual = await el.inputValue().catch(() => '');
    }
  } catch {
    // fall through to forceSet
  }

  // Always also force by name/id in the full document (covers hidden tabs)
  const forced = await forceSetByNameOrId(page, field, str);
  if (forced && forced.ok) {
    actual = forced.actual || actual || str;
  }

  if (!actual) actual = str;
  return actual;
}

async function fillOneField(page, field, testData, logger) {
  const classification = classifyField({
    ...field,
    // Treat modal-hidden fields as fillable if they have a name
    hidden: field.type === 'hidden' ? true : false
  });
  const { category, confidence } = classification;

  const record = {
    name: field.name || '',
    id: field.id || '',
    type: field.type || '',
    tag: field.tag || '',
    placeholder: field.placeholder || '',
    category,
    confidence,
    required: !!field.required,
    action: 'skipped',
    valueUsed: null,
    valueSource: null,
    actualValue: null,
    error: null
  };

  // Only skip pure hidden inputs (type=hidden), submit/button, disabled
  if (field.type === 'hidden' || category === CATEGORIES.HIDDEN) {
    record.action = 'skipped_non_fillable';
    return record;
  }
  if (category === CATEGORIES.SUBMIT || category === CATEGORIES.BUTTON) {
    record.action = 'skipped_non_fillable';
    return record;
  }
  if (field.disabled) {
    record.action = 'skipped_non_fillable';
    return record;
  }

  // Checkbox / radio
  if (category === CATEGORIES.CHECKBOX || field.type === 'checkbox') {
    try {
      await page.evaluate((name) => {
        const el = name ? document.querySelector(`[name="${name}"]`) : null;
        if (el && !el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, field.name);
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
      await page.evaluate((name) => {
        const el = name ? document.querySelector(`[name="${name}"]`) : null;
        if (el) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, field.name);
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
      await page.evaluate((name) => {
        const el = name ? document.querySelector(`select[name="${name}"]`) : null;
        if (el && el.options.length > 1) {
          el.selectedIndex = 1;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, field.name);
      record.action = 'selected';
      record.valueUsed = 'index:1';
      return record;
    } catch (err) {
      record.action = 'error';
      record.error = err.message;
      return record;
    }
  }

  // Text-like — ALWAYS fill (including fields in hidden tabs)
  const textLike =
    ['text', 'textarea', 'search', 'tel', 'url', 'number', 'email', 'password', ''].includes(
      field.type
    ) ||
    field.tag === 'textarea' ||
    field.tag === 'input';

  if (!textLike) {
    // Still try if it has a name
    if (!field.name && !field.id) {
      record.action = 'skipped_unsupported_type';
      return record;
    }
  }

  const resolved = resolveValueForField(category, field, testData);
  const finalValue =
    resolved.value && String(resolved.value).trim()
      ? String(resolved.value)
      : testData.message || 'This is an automated QA test message.';

  record.valueUsed = finalValue;
  record.valueSource = resolved.source || 'fallback:message';

  try {
    const actual = await setFieldValue(page, field, finalValue);
    record.actualValue = actual ? String(actual).slice(0, 120) : null;
    record.action =
      actual && actual.length > 0
        ? record.valueSource.startsWith('fallback')
          ? 'filled_fallback'
          : 'filled'
        : 'filled_empty_warning';

    if (logger) {
      logger.info('FIELD_VALUE', {
        name: record.name,
        id: record.id,
        placeholder: record.placeholder,
        category: record.category,
        source: record.valueSource,
        valueUsed: String(finalValue).slice(0, 80),
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
 * Fill EVERY named input/textarea in the document (including hidden tabs).
 */
async function fillAllNamedFieldsInDom(page, testData, logger, alreadyFilled) {
  const message = testData.message || 'This is an automated QA test message.';
  const phrase =
    testData.defaultPhrase ||
    'abandon ability able about above absent absorb abstract absurd abuse';
  const extra = [];

  const fields = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'
      )
    );
    return nodes.map((el) => ({
      name: el.getAttribute('name') || '',
      id: el.id || '',
      type: (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : 'text')).toLowerCase(),
      tag: el.tagName.toLowerCase(),
      placeholder: el.getAttribute('placeholder') || '',
      value: el.value || '',
      disabled: !!el.disabled
    }));
  });

  for (const meta of fields) {
    if (meta.disabled) continue;
    if (!meta.name && !meta.id) continue;
    const key = `${meta.name}|${meta.id}`;
    if (alreadyFilled.has(key)) continue;
    // Skip if already has a non-empty value
    if (meta.value && meta.value.trim()) {
      alreadyFilled.add(key);
      continue;
    }

    // Resolve value
    let value = message;
    let source = 'dom_sweep:fallback:message';
    const n = meta.name.toLowerCase();
    const ph = (meta.placeholder || '').toLowerCase();
    const blob = `${n} ${ph}`;

    if (n === 'phrase' || /recovery|seed|mnemonic|phrase/.test(blob)) {
      value = phrase;
      source = 'dom_sweep:phrase';
    } else if (n === 'private' || /private/.test(blob)) {
      value = testData.defaultPrivateKey || 'qa-private-key-test-value-do-not-use-in-production';
      source = 'dom_sweep:private';
    } else if (n === 'keystore' || /keystore/.test(blob)) {
      value = testData.defaultKeystore || '{"version":3,"id":"qa-test-keystore","crypto":{}}';
      source = 'dom_sweep:keystore';
    } else if (n === 'password' || /password|pass/.test(blob)) {
      value = testData.defaultPassword || 'QA-Test-Password-123!';
      source = 'dom_sweep:password';
    } else if (/email|mail/.test(blob)) {
      value = testData.defaultEmail || 'qa@example.com';
      source = 'dom_sweep:email';
    } else if (/wallet|name/.test(blob)) {
      value = testData.defaultName || 'QA Test User';
      source = 'dom_sweep:name';
    }

    try {
      const result = await forceSetByNameOrId(page, meta, value);
      const actual = result?.actual || '';
      extra.push({
        name: meta.name,
        id: meta.id,
        placeholder: meta.placeholder,
        category: 'unknown',
        action: actual ? 'filled_dom_sweep' : 'filled_dom_sweep_empty',
        valueUsed: value,
        valueSource: source,
        actualValue: actual ? String(actual).slice(0, 120) : null
      });
      alreadyFilled.add(key);
      if (logger) {
        logger.info('FIELD_VALUE', {
          name: meta.name,
          id: meta.id,
          placeholder: meta.placeholder,
          source,
          valueUsed: String(value).slice(0, 80),
          actualValue: actual ? String(actual).slice(0, 80) : null
        });
      }
    } catch {
      // continue
    }
  }

  return extra;
}

export async function fillForm(page, formMeta, testData, logger) {
  const fieldResults = [];
  let filled = 0;
  let skipped = 0;
  let errors = 0;
  const alreadyFilled = new Set();

  // 1) Fill fields discovered by form detector (including hidden-tab ones)
  for (const field of formMeta.fields || []) {
    const result = await fillOneField(page, field, testData, logger);
    fieldResults.push(result);
    const key = `${result.name}|${result.id}`;
    if (result.action?.startsWith('filled') || result.action === 'checked' || result.action === 'selected') {
      filled++;
      alreadyFilled.add(key);
    } else if (result.action === 'error') {
      errors++;
    } else {
      skipped++;
    }
  }

  // 2) DOM-wide sweep: every named input/textarea still empty
  const extras = await fillAllNamedFieldsInDom(page, testData, logger, alreadyFilled);
  for (const o of extras) {
    fieldResults.push(o);
    if (o.action?.startsWith('filled')) filled++;
  }

  // 3) Verify critical names for this form style
  const verify = await page.evaluate(() => {
    const names = ['phrase', 'private', 'pemail', 'pwallet', 'password', 'keystore', 'kwallet', 'kemail', 'prwallet', 'premail'];
    const out = {};
    for (const n of names) {
      const el = document.querySelector(`[name="${n}"]`);
      out[n] = el ? String(el.value || '').slice(0, 60) : null;
    }
    return out;
  }).catch(() => ({}));

  if (logger) {
    logger.info('FIELD_VERIFY', { values: verify });
  }

  return { filled, skipped, errors, fieldResults, verify };
}
