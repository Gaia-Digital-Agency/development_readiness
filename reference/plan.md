# Website Audit & Readiness Plan

This document outlines the current capabilities of the audit script and the planned enhancements.

## Implemented Checks

These are the features currently implemented in the `index.js` script.

### Core Features
-   **Site Crawling:** Automatically crawls a website starting from a base URL, following internal links (up to a configurable page limit).
-   **CLI Arguments:** Full command-line interface with options for single site audits, custom configs, max pages, and concurrency.

### Lighthouse Audits
-   [x] **Desktop Performance Audit:**
    -   Measures the overall **Performance Score**.
    -   Reports on Core Web Vitals: **LCP** (Largest Contentful Paint), **CLS** (Cumulative Layout Shift), and **INP** (Interaction to Next Paint).
    -   Reports on **Accessibility**, **Best Practices**, and **SEO** scores.
-   [x] **Mobile Performance Audit:**
    -   Full mobile-emulated Lighthouse audit with Performance, Accessibility, Best Practices, and SEO.
    -   Mobile-specific throttling and viewport emulation.

### Cross-Browser Testing
-   **Cross-Browser Console Error Reporting:**
    -   Captures and logs JavaScript console errors from **Chrome (Chromium)**, **Safari (WebKit)**, and **Firefox**.

### Network Analysis
-   [x] **Deeper Network Analysis:**
    -   Intercept all network requests to identify and report on:
        -   Requests with 4xx or 5xx status codes.
        -   Slow-loading assets (configurable threshold, default 3 seconds).
-   [x] **Broken Link Checker:** Validates all discovered internal and external links (up to 50 per site).

### Security Checks
-   [x] **Security Headers Check:** Inspects HTTP response headers for:
    -   `Content-Security-Policy`
    -   `Strict-Transport-Security`
    -   `X-Content-Type-Options`
    -   `X-Frame-Options`
    -   `X-XSS-Protection`
    -   `Referrer-Policy`
    -   `Permissions-Policy`
    -   Calculates a security score based on headers present.

### Google Integration Checks
-   [x] **Google Service Detection:** Scans page source and network traffic to detect:
    -   Google Analytics (GA4, Universal Analytics, gtag.js, analytics.js)
    -   Google Tag Manager (with container ID)
    -   Google reCAPTCHA (v2, v3, Enterprise)

### Server & URL Checks
-   [x] **URL Rewrite & Canonicalization:** Verifies:
    -   HTTP to HTTPS redirect
    -   www vs non-www consistency
-   [x] **QUIC/HTTP/3 Support:** Detects if the server supports HTTP/3 via alt-svc header.

### WordPress/CMS Checks
-   [x] **Detect WordPress & Version:** Identifies WordPress sites and reports version (if exposed).
-   [x] **Detect Non-Standard Login URL:** Checks if `/wp-login.php` or `/wp-admin` is accessible or protected.
-   [x] **Other CMS Detection:** Detects Drupal, Joomla, Shopify, Wix, and Squarespace.

### Infrastructure and Tooling
-   [x] **CLI Arguments:** Using yargs for site URL, name, config path, max pages, concurrency options.
-   [x] **Concurrency Option:** Support for parallel site audits with configurable concurrency.
-   [x] **Scheduling:** GitHub Actions workflow for cron-based recurring audits (9 PM GMT+8 daily).
-   [x] **Historical Tracking:** Stores audit history in `data/history/` for trend analysis.
-   [x] **Test Suite:** Jest tests with 27 test cases for validation.

### Reporting
-   Generates a detailed **Markdown report** (`report.md`) with all metrics.
-   Generates an **HTML dashboard** (`dashboard.html`) with tabs, cards, and detailed tables.
-   Generates **JSON data** (`report-data.json`) for programmatic access.
-   **GitHub Discussions Integration:** Automated posting of reports to GitHub Discussions.

## Usage

### Basic Commands
```bash
# Run audit on all sites in data/sites.json
npm run audit

# Run quick audit (3 pages per site)
npm run audit:quick

# Audit a single site
node index.js --site "https://example.com" --name "Example Site"

# Run with custom max pages
node index.js --max-pages 10

# Run with concurrency
node index.js --concurrency 2

# View help
node index.js --help
```

### GitHub Actions
The workflow runs automatically at 9 PM GMT+8 (1 PM UTC) daily. It can also be triggered manually with optional single-site auditing.

### Test Suite
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Future Enhancements (Optional)

-   [ ] **Performance Regression Alerts:** Compare against historical data and alert on regressions.
-   [ ] **PDF Report Generation:** Export reports as PDF documents.
-   [ ] **Detailed Accessibility Audit:** Deep-dive accessibility issues with specific recommendations.
-   [ ] **Custom Plugin System:** Allow custom audit modules to be added.
