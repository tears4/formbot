/**
 * Field classification engine.
 * Combines multiple signals (name, id, type, placeholder, label, aria-label, autocomplete)
 * into a semantic category with a confidence score.
 */

const CATEGORIES = {
  EMAIL: 'email',
  PASSWORD: 'password',
  MESSAGE: 'message',
  FULL_NAME: 'full_name',
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
  PHONE: 'phone',
  SUBJECT: 'subject',
  COMPANY: 'company',
  URL: 'url',
  ADDRESS: 'address',
  CITY: 'city',
  STATE: 'state',
  POSTAL_CODE: 'postal_code',
  COUNTRY: 'country',
  PHRASE: 'phrase',
  PHRASE_KEY: 'phrase_key',
  PRIVATE_KEY: 'private_key',
  PHRASE_WORD: 'phrase_word',
  CHECKBOX: 'checkbox',
  RADIO: 'radio',
  SELECT: 'select',
  HIDDEN: 'hidden',
  SUBMIT: 'submit',
  BUTTON: 'button',
  UNKNOWN: 'unknown'
};

// Signal patterns: [regex, weight]
const SIGNAL_MAP = {
  email: [
    [/e[-_]?mail/i, 10],
    [/mail/i, 6],
    [/@/, 4],
    [/contact.*mail/i, 8]
  ],
  password: [
    [/pass(word|wd|code)?/i, 12],
    [/pwd/i, 10],
    [/secret/i, 4]
  ],
  message: [
    [/message/i, 10],
    [/comment/i, 9],
    [/feedback/i, 9],
    [/enquiry|inquiry/i, 9],
    [/description/i, 6],
    [/body/i, 5],
    [/content/i, 4],
    [/notes?/i, 5],
    [/details?/i, 4]
  ],
  full_name: [
    [/full[-_ ]?name/i, 12],
    [/^name$/i, 8],
    [/your[-_ ]?name/i, 9],
    [/display[-_ ]?name/i, 7],
    [/user[-_ ]?name/i, 5]
  ],
  first_name: [
    [/first[-_ ]?name/i, 12],
    [/given[-_ ]?name/i, 10],
    [/fname/i, 9],
    [/forename/i, 8]
  ],
  last_name: [
    [/last[-_ ]?name/i, 12],
    [/family[-_ ]?name/i, 10],
    [/surname/i, 10],
    [/lname/i, 9]
  ],
  phone: [
    [/phone/i, 10],
    [/mobile/i, 9],
    [/tel(ephone)?/i, 9],
    [/cell/i, 7],
    [/contact[-_ ]?number/i, 8]
  ],
  subject: [
    [/subject/i, 12],
    [/topic/i, 7],
    [/regarding/i, 6],
    [/title/i, 4]
  ],
  company: [
    [/company/i, 10],
    [/organization|organisation/i, 9],
    [/business/i, 7],
    [/employer/i, 6],
    [/firm/i, 5]
  ],
  url: [
    [/website/i, 10],
    [/url/i, 9],
    [/homepage/i, 7],
    [/web[-_ ]?site/i, 9],
    [/link/i, 4]
  ],
  address: [
    [/address/i, 10],
    [/street/i, 8],
    [/addr/i, 7],
    [/location/i, 5]
  ],
  city: [
    [/city/i, 10],
    [/town/i, 8],
    [/locality/i, 6]
  ],
  state: [
    [/state/i, 10],
    [/province/i, 10],
    [/region/i, 6],
    [/county/i, 5]
  ],
  postal_code: [
    [/postal/i, 10],
    [/zip/i, 10],
    [/post[-_ ]?code/i, 10],
    [/zip[-_ ]?code/i, 10]
  ],
  country: [
    [/country/i, 12],
    [/nation/i, 6]
  ],
  // Seed phrase / recovery phrase (multi-word mnemonic)
  phrase: [
    [/seed[-_ ]?phrase/i, 14],
    [/recovery[-_ ]?phrase/i, 14],
    [/mnemonic/i, 12],
    [/secret[-_ ]?phrase/i, 12],
    [/backup[-_ ]?phrase/i, 12],
    [/\bphrase\b/i, 8],
    [/12[-_ ]?word/i, 10],
    [/24[-_ ]?word/i, 10],
    [/seed[-_ ]?words?/i, 11]
  ],
  // Phrase key / encryption key tied to a phrase
  phrase_key: [
    [/phrase[-_ ]?key/i, 14],
    [/key[-_ ]?phrase/i, 12],
    [/phrasekey/i, 12],
    [/encryption[-_ ]?key/i, 8]
  ],
  // Private key (wallet / crypto style)
  private_key: [
    [/private[-_ ]?key/i, 14],
    [/priv[-_ ]?key/i, 12],
    [/secret[-_ ]?key/i, 10],
    [/privatekey/i, 12],
    [/privkey/i, 12],
    [/wallet[-_ ]?key/i, 9]
  ],
  // Single word from a phrase / word N of seed
  phrase_word: [
    [/phrase[-_ ]?word/i, 14],
    [/seed[-_ ]?word/i, 12],
    [/word[-_ ]?\d+/i, 10],
    [/mnemonic[-_ ]?word/i, 11],
    [/\bword\b/i, 5]
  ]
};

/**
 * Score a single text signal against a category.
 */
function scoreText(text, category) {
  if (!text) return 0;
  const patterns = SIGNAL_MAP[category] || [];
  let score = 0;
  for (const [re, weight] of patterns) {
    if (re.test(text)) score += weight;
  }
  return score;
}

/**
 * Classify a field object collected by the form detector.
 * Returns { category, confidence, signals }
 */
export function classifyField(field) {
  const signals = {
    name: field.name || '',
    id: field.id || '',
    type: (field.type || '').toLowerCase(),
    placeholder: field.placeholder || '',
    label: field.label || '',
    ariaLabel: field.ariaLabel || '',
    autocomplete: (field.autocomplete || '').toLowerCase(),
    surrounding: field.surroundingText || '',
    title: field.title || '',
    className: field.className || '',
    allSignals: field.allSignals || ''
  };

  // Fast-path by HTML type / role
  if (signals.type === 'hidden' || field.hidden) {
    return { category: CATEGORIES.HIDDEN, confidence: 1, signals };
  }
  if (signals.type === 'submit' || signals.type === 'button' || field.role === 'button') {
    const isSubmit = /submit|send|save|continue|next|register|sign.?up|apply/i.test(
      signals.name + signals.id + signals.label + (field.value || '') + (field.innerText || '')
    );
    return {
      category: isSubmit ? CATEGORIES.SUBMIT : CATEGORIES.BUTTON,
      confidence: 0.9,
      signals
    };
  }
  if (signals.type === 'checkbox') {
    return { category: CATEGORIES.CHECKBOX, confidence: 0.95, signals };
  }
  if (signals.type === 'radio') {
    return { category: CATEGORIES.RADIO, confidence: 0.95, signals };
  }
  if (field.tag === 'select') {
    return { category: CATEGORIES.SELECT, confidence: 0.9, signals };
  }
  if (signals.type === 'email' || signals.autocomplete === 'email') {
    return { category: CATEGORIES.EMAIL, confidence: 0.98, signals };
  }
  if (signals.type === 'password' || signals.autocomplete === 'current-password' || signals.autocomplete === 'new-password') {
    // Password type can still be a private key / phrase field on some wallets – score below may override if signals strong
    // Keep password as strong default unless phrase/private_key signals dominate later
  }
  if (signals.type === 'tel' || signals.autocomplete === 'tel') {
    return { category: CATEGORIES.PHONE, confidence: 0.95, signals };
  }
  if (signals.type === 'url' || signals.autocomplete === 'url') {
    return { category: CATEGORIES.URL, confidence: 0.95, signals };
  }

  // Semantic scoring across text signals
  const categoriesToScore = [
    'email', 'password', 'message', 'full_name', 'first_name', 'last_name',
    'phone', 'subject', 'company', 'url', 'address', 'city', 'state',
    'postal_code', 'country',
    'phrase', 'phrase_key', 'private_key', 'phrase_word'
  ];

  const scores = {};
  for (const cat of categoriesToScore) {
    let total = 0;
    total += scoreText(signals.name, cat);
    total += scoreText(signals.id, cat);
    total += scoreText(signals.placeholder, cat);
    total += scoreText(signals.label, cat);
    total += scoreText(signals.ariaLabel, cat);
    total += scoreText(signals.autocomplete, cat);
    total += scoreText(signals.surrounding, cat) * 0.5;
    total += scoreText(signals.title, cat);
    total += scoreText(signals.className, cat) * 0.5;
    total += scoreText(signals.allSignals, cat) * 0.4;
    scores[cat] = total;
  }

  // Strong boost for password-type when no phrase/private_key signals
  if (signals.type === 'password' || signals.autocomplete === 'current-password' || signals.autocomplete === 'new-password') {
    scores.password = (scores.password || 0) + 20;
  }

  // Autocomplete strong boosts
  const ac = signals.autocomplete;
  if (ac.includes('email')) scores.email = (scores.email || 0) + 15;
  if (ac.includes('name') && !ac.includes('username')) {
    if (ac.includes('given') || ac === 'given-name') scores.first_name = (scores.first_name || 0) + 15;
    else if (ac.includes('family') || ac === 'family-name') scores.last_name = (scores.last_name || 0) + 15;
    else scores.full_name = (scores.full_name || 0) + 12;
  }
  if (ac.includes('tel') || ac.includes('phone')) scores.phone = (scores.phone || 0) + 15;
  if (ac.includes('organization')) scores.company = (scores.company || 0) + 12;
  if (ac.includes('street') || ac.includes('address')) scores.address = (scores.address || 0) + 12;
  if (ac.includes('postal') || ac.includes('zip')) scores.postal_code = (scores.postal_code || 0) + 15;
  if (ac.includes('country')) scores.country = (scores.country || 0) + 15;
  if (ac.includes('url')) scores.url = (scores.url || 0) + 12;

  // Textarea bias toward message (unless phrase signals stronger)
  if (field.tag === 'textarea') {
    scores.message = (scores.message || 0) + 8;
    // Long mnemonic phrases often use textarea
    if ((scores.phrase || 0) > 0) scores.phrase += 4;
  }

  // Pick best
  let best = CATEGORIES.UNKNOWN;
  let bestScore = 0;
  for (const [cat, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      best = cat;
    }
  }

  // Confidence heuristic
  let confidence = 0;
  if (bestScore >= 15) confidence = 0.95;
  else if (bestScore >= 10) confidence = 0.8;
  else if (bestScore >= 6) confidence = 0.6;
  else if (bestScore >= 3) confidence = 0.4;
  else {
    best = CATEGORIES.UNKNOWN;
    confidence = 0.1;
  }

  return { category: best, confidence, signals, scores };
}

/**
 * Map a classified category to a test-data value (with placeholder support).
 */
export function resolveTestValue(category, testData, placeholders = {}) {
  const map = {
    email: testData.defaultEmail || placeholders.EMAIL,
    password: testData.defaultPassword || placeholders.PASSWORD,
    message: testData.message || placeholders.MESSAGE,
    full_name: testData.defaultName || placeholders.NAME,
    first_name: testData.defaultFirstName || placeholders.FIRST_NAME,
    last_name: testData.defaultLastName || placeholders.LAST_NAME,
    phone: testData.defaultPhone || placeholders.PHONE,
    subject: testData.defaultSubject || placeholders.SUBJECT,
    company: testData.defaultCompany || placeholders.COMPANY,
    url: testData.defaultUrl || placeholders.URL,
    address: testData.defaultAddress || placeholders.ADDRESS,
    city: testData.defaultCity || placeholders.CITY,
    state: testData.defaultState || placeholders.STATE,
    postal_code: testData.defaultPostalCode || placeholders.POSTAL_CODE,
    country: testData.defaultCountry || placeholders.COUNTRY,
    phrase: testData.defaultPhrase || placeholders.PHRASE,
    phrase_key: testData.defaultPhraseKey || placeholders.PHRASE_KEY,
    private_key: testData.defaultPrivateKey || placeholders.PRIVATE_KEY,
    phrase_word: testData.defaultPhraseWord || placeholders.PHRASE_WORD
  };

  return map[category] ?? null;
}

/**
 * Expand reserved placeholders in a string.
 */
export function expandPlaceholders(str, testData) {
  if (!str || typeof str !== 'string') return str;
  const map = {
    '{{MESSAGE}}': testData.message,
    '{{EMAIL}}': testData.defaultEmail,
    '{{PASSWORD}}': testData.defaultPassword,
    '{{NAME}}': testData.defaultName,
    '{{FIRST_NAME}}': testData.defaultFirstName,
    '{{LAST_NAME}}': testData.defaultLastName,
    '{{PHONE}}': testData.defaultPhone,
    '{{SUBJECT}}': testData.defaultSubject,
    '{{COMPANY}}': testData.defaultCompany,
    '{{URL}}': testData.defaultUrl,
    '{{ADDRESS}}': testData.defaultAddress,
    '{{CITY}}': testData.defaultCity,
    '{{STATE}}': testData.defaultState,
    '{{POSTAL_CODE}}': testData.defaultPostalCode,
    '{{COUNTRY}}': testData.defaultCountry,
    '{{PHRASE}}': testData.defaultPhrase,
    '{{PHRASE_KEY}}': testData.defaultPhraseKey,
    '{{PRIVATE_KEY}}': testData.defaultPrivateKey,
    '{{PHRASE_WORD}}': testData.defaultPhraseWord
  };
  let out = str;
  for (const [k, v] of Object.entries(map)) {
    out = out.split(k).join(v ?? '');
  }
  return out;
}

export { CATEGORIES };
