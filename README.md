# Development Readiness Monitor

A Node.js application that automatically crawls websites and performs comprehensive performance and cross-browser compatibility audits. It generates detailed reports to help teams detect regressions and ensure high-quality user experiences.

## Core Features

- **Recursive Crawler**: Automatically discovers and audits all internal links on a site (up to 20 pages per site).
- **Performance Audits**: Leverages Google Lighthouse v12 to measure Core Web Vitals:
  - **LCP** (Largest Contentful Paint) - Loading performance
  - **CLS** (Cumulative Layout Shift) - Visual stability
  - **INP** (Interaction to Next Paint) - Interactivity
- **Cross-Browser Testing**: Captures console errors across three browser engines:
  - Chromium (Google Chrome)
  - WebKit (Safari)
  - Firefox (Gecko)
- **Multiple Report Formats**:
  - `reports/dashboard.html` - Visual HTML dashboard
  - `reports/report.md` - Markdown report
  - `reports/report-data.json` - Raw JSON data

## Project Structure

```
/
├── data/
│   └── sites.json          # Sites to audit (configure here)
├── reports/
│   ├── dashboard.html      # Visual HTML report
│   ├── report.md           # Markdown report
│   └── report-data.json    # Raw JSON output
├── reference/
│   └── app_enhancement.md  # Development notes
├── .claude/
│   └── settings.json       # Claude Code project settings
├── index.js                # Main application script
├── package.json
├── package-lock.json
└── README.md
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install

# 3. Run the audit
npm run audit
```

## Detailed Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later
- NPM (comes with Node.js)
- Google Chrome (for Lighthouse audits)

### Configuration

Edit `data/sites.json` to add the websites you want to audit:

```json
[
  {
    "name": "My Example Site",
    "url": "https://example.com"
  },
  {
    "name": "Another Site",
    "url": "https://another-site.com"
  }
]
```

### Installation

```bash
# Install Node.js dependencies
npm install

# Install Playwright browser engines (Chromium, WebKit, Firefox)
npx playwright install
```

### Running the Audit

```bash
# Using npm scripts
npm run audit
# or
npm start

# Or directly with Node
node index.js
```

The script will:
1. Read sites from `data/sites.json`
2. Crawl each site (up to 20 pages)
3. Run Lighthouse performance audits
4. Capture console errors in Chrome, Safari, and Firefox
5. Generate reports in the `reports/` directory

### Viewing Reports

Open `reports/dashboard.html` in your web browser to view the visual dashboard with:
- Overall site performance summaries
- Per-page performance scores and Core Web Vitals
- Console error counts by browser

## Configuration Options

The following constants can be adjusted in `index.js`:

| Option | Default | Description |
|--------|---------|-------------|
| `MAX_PAGES_PER_SITE` | 20 | Maximum pages to crawl per site |
| `PAGE_TIMEOUT` | 30000 | Page load timeout in milliseconds |

## Technical Stack

- **Lighthouse v12** - Performance auditing
- **Playwright** - Cross-browser automation
- **chrome-launcher** - Chrome instance management
- **fs-extra** - File system utilities

## Troubleshooting

### Firefox browser not found

If you see an error about Firefox executable not found:

```bash
npx playwright install firefox
```

### Lighthouse race conditions

The app runs site audits sequentially to avoid Lighthouse timing conflicts. This is expected behavior.
