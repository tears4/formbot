# Smart Form QA Bot

Production-ready, intelligent automated web-form QA/testing bot built with **Node.js** and **Playwright**.

The bot reads a list of target websites from a text file, crawls each site intelligently to discover forms (including modern JavaScript-rendered ones), classifies fields semantically, fills them with configurable test data, submits the forms, and produces detailed JSON/CSV reports with screenshots.

**Primary targets:** GitHub (source) + Railway (runtime).

---

## Features

- **External URL list** – `input/links.txt` (no hard-coded sites)
- **Intelligent crawler** – prioritizes contact / register / apply / feedback style pages
- **Form detection beyond `<form>` tags** – inputs, textareas, selects, ARIA, dynamic controls
- **Semantic field classification** – multi-signal scoring (name, id, type, label, placeholder, autocomplete, surrounding text)
- **Configurable test data** – JSON + environment variable overrides
- **Reserved placeholders** – `{{MESSAGE}}`, `{{EMAIL}}`, `{{NAME}}`, etc.
- **Outcome classification** – SUCCESS, VALIDATION_ERROR, CAPTCHA_REQUIRED, etc.
- **Multi-step form support** (basic Next/Continue handling)
- **Screenshots** at key stages
- **Structured logging** and per-run result directories
- **Railway-ready** Docker image based on official Playwright image
- **Unit tests** for URL utils and field classification

---

## Project Structure

```
smart-form-qa-bot/
├── bot.js                 # Entry point
├── package.json
├── Dockerfile
├── railway.toml
├── README.md
├── .gitignore
├── .dockerignore
├── .env.example
├── input/
│   └── links.txt          # One URL per line
├── config/
│   ├── test-data.json     # Test values
│   └── settings.json      # Crawler / timeout / keyword settings
├── src/
│   ├── crawler.js
│   ├── url-manager.js
│   ├── form-detector.js
│   ├── field-classifier.js
│   ├── form-filler.js
│   ├── submitter.js
│   ├── result-detector.js
│   ├── screenshot.js
│   ├── reporter.js
│   └── logger.js
├── tests/
│   ├── url-manager.test.js
│   └── field-classifier.test.js
└── results/               # Generated at runtime (gitignored)
```

---

## Quick Start (Local)

### Prerequisites

- Node.js **20+**
- npm

### Install

```bash
cd smart-form-qa-bot
npm install
npx playwright install chromium
```

### Configure

1. Edit `input/links.txt` – add one authorized target URL per line.
2. Edit `config/test-data.json` – set the message and other default values you want submitted.
3. (Optional) Adjust crawl limits in `config/settings.json`.

### Run

```bash
npm start
```

Results appear under `results/<timestamp>/`:

- `report.json` – full structured report
- `report.csv` – one row per form
- `run.log` – structured event log
- `screenshots/` – PNG captures

### Run tests

```bash
npm test
```

---

## Configuration

### `config/test-data.json`

```json
{
  "message": "This is an automated QA test message.",
  "defaultEmail": "qa@example.com",
  "defaultPassword": "QA-Test-Password-123!",
  "defaultName": "QA Test User",
  "defaultFirstName": "QA",
  "defaultLastName": "Tester",
  "defaultPhone": "08000000000",
  "defaultSubject": "Automated QA Test",
  "defaultCompany": "QA Test Company",
  "defaultUrl": "https://example.com",
  "defaultAddress": "1 Test Street",
  "defaultCity": "Test City",
  "defaultState": "Test State",
  "defaultPostalCode": "00000",
  "defaultCountry": "Nigeria"
}
```

### Reserved placeholders

You can use these tokens inside configuration strings:

| Placeholder       | Maps to              |
|-------------------|----------------------|
| `{{MESSAGE}}`     | `message`            |
| `{{EMAIL}}`       | `defaultEmail`       |
| `{{PASSWORD}}`    | `defaultPassword`    |
| `{{NAME}}`        | `defaultName`        |
| `{{FIRST_NAME}}`  | `defaultFirstName`   |
| `{{LAST_NAME}}`   | `defaultLastName`    |
| `{{PHONE}}`       | `defaultPhone`       |
| `{{SUBJECT}}`     | `defaultSubject`     |
| `{{COMPANY}}`     | `defaultCompany`     |
| `{{URL}}`         | `defaultUrl`         |
| `{{ADDRESS}}`     | `defaultAddress`     |
| `{{CITY}}`        | `defaultCity`        |
| `{{STATE}}`       | `defaultState`       |
| `{{POSTAL_CODE}}` | `defaultPostalCode`  |
| `{{COUNTRY}}`     | `defaultCountry`     |

### Environment variable overrides

| Variable              | Purpose                          |
|-----------------------|----------------------------------|
| `NODE_ENV`            | Environment name                 |
| `LOG_LEVEL`           | `debug` / `info` / `warn` / `error` |
| `HEADLESS`            | `true` / `false`                 |
| `TEST_MESSAGE`        | Override message                 |
| `TEST_EMAIL`          | Override email                   |
| `TEST_PASSWORD`       | Override password                |
| `TEST_NAME`           | Override full name               |
| `TEST_PHONE`          | Override phone                   |
| `MAX_PAGES`           | Max pages per site               |
| `MAX_CRAWL_DEPTH`     | Max link depth                   |
| `NAVIGATION_TIMEOUT`  | ms                               |
| `INTERACTION_TIMEOUT` | ms                               |
| `SAME_ORIGIN_ONLY`    | `true` / `false`                 |
| `LINKS_FILE`          | Custom path to links file        |

---

## Input file rules (`input/links.txt`)

- One URL per line
- Blank lines ignored
- Lines starting with `#` treated as comments
- URLs normalized (protocol, host casing, trailing slash, tracking params stripped)
- Duplicates removed automatically
- Each site processed independently – a failure on one site does not stop the batch

---

## Outcome classes

| Outcome               | Meaning                                      |
|-----------------------|----------------------------------------------|
| `SUCCESS`             | Confirmation / navigation / form disappeared |
| `VALIDATION_ERROR`    | Client- or server-side validation messages   |
| `SUBMISSION_FAILED`   | Submit action itself failed                  |
| `FORM_NOT_FILLABLE`   | No usable submit control                     |
| `CAPTCHA_REQUIRED`    | reCAPTCHA / hCaptcha detected                |
| `AUTHENTICATION_REQUIRED` | Login wall detected                      |
| `TIMEOUT`             | Navigation / interaction timeout             |
| `PAGE_ERROR`          | Unexpected page-level error                  |
| `UNKNOWN`             | Could not classify confidently               |

---

## Deploy to Railway

1. Push this repository to **GitHub**.
2. In [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Railway will detect the `Dockerfile` and build using the official Playwright image.
4. Set any desired environment variables in the Railway dashboard (`TEST_EMAIL`, `MAX_PAGES`, etc.).
5. Deploy. The service runs `node bot.js` once and exits (batch job).

### Notes for Railway

- The Docker image is based on `mcr.microsoft.com/playwright:v1.49.0-jammy` so Chromium and system dependencies are already present.
- Mount or persist the `results/` directory if you need to keep artifacts across runs (e.g. Railway volume).
- For scheduled runs, use Railway’s cron jobs or an external scheduler that triggers a redeploy / run.

---

## Important legal / ethical notice

**Only test websites you own or have explicit permission to test.**

Automated form submission can be abusive or illegal if performed against third-party sites without authorization. Use this tool responsibly.

---

## License

MIT
