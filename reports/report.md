# Development Readiness Report v2.0

**Generated:** 2/5/2026, 3:24:15 PM

---

## Summary

| Metric | Value |
|--------|-------|
| Sites Audited | 1 |
| Pages Scanned | 1 |
| Console Errors | 3 |

---

## Overall Site Summary

| Site | Desktop Perf | Mobile Perf | Security | SEO | Accessibility |
|------|-------------|-------------|----------|-----|---------------|
| Staging | 0 | 0 | 0% | 0 | 0 |

---

## Detailed Results

### Staging

**Base URL:** http://34.142.200.251/

#### Site-Level Checks

##### Security Headers
- **Score:** 0%
- **Missing Headers:** None

##### URL Canonicalization
- **HTTPS Redirect:** ❌ No
- **WWW Consistency:** ⚠️ Check manually

##### HTTP/3 Support
- **QUIC/HTTP3:** ❌ Not detected

##### Google Services
- **Google Analytics:** ❌ Not detected
- **Tag Manager:** ❌ Not detected
- **reCAPTCHA:** ❌ Not detected

##### CMS Detection
- No CMS detected

##### Broken Links
- **Checked:** 0 links
- **Broken:** 0


##### API Endpoints
- **Tested:** 11 endpoints
- **Errors:** ❌ 11 error(s) detected
  - `/api: The operation was aborted due to timeout`
  - `/api/v1: The operation was aborted due to timeout`
  - `/api/v2: The operation was aborted due to timeout`
  - `/wp-json: The operation was aborted due to timeout`
  - `/wp-json/wp/v2/posts: The operation was aborted due to timeout`
  - `/graphql: The operation was aborted due to timeout`
  - `/rest: The operation was aborted due to timeout`
  - `/.well-known/security.txt: The operation was aborted due to timeout`
  - `/robots.txt: The operation was aborted due to timeout`
  - `/sitemap.xml: The operation was aborted due to timeout`
  - `/favicon.ico: The operation was aborted due to timeout`

#### Page Results

| URL | Desktop | Mobile | A11y | SEO | Best Pr. |
|-----|---------|--------|------|-----|----------|
| / | 0 | 0 | 0 | 0 | 0 |

##### Core Web Vitals & Performance Metrics

| URL | LCP | CLS | INP | FCP | TBT | TTFB | SI | TTI |
|-----|-----|-----|-----|-----|-----|------|----|----||
| / | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |

##### Additional Performance Metrics

| URL | Max FID | Total Weight | DOM Size | JS Boot Time | Main Thread |
|-----|---------|--------------|----------|--------------|-------------|
| / | N/A | N/A | N/A | N/A | N/A |

##### Resource Summary

| URL | Requests | Scripts | Stylesheets | Fonts | Images | Render Blocking | Redirects |
|-----|----------|---------|-------------|-------|--------|-----------------|----------|
| / | N/A | N/A | N/A | N/A | N/A | 0 | 0 |

##### Optimization Opportunities

| URL | Unused CSS | Unused JS | Third-Party Impact | Modern Images | Optimized Images |
|-----|------------|-----------|-------------------|---------------|------------------|
| / | N/A | N/A | N/A | N/A | N/A |

##### Functional Tests

**/**
- **Links:** ✅ 0 passed
- **Buttons:** ✅ 0 passed
- **Forms:** ✅ 0 passed
- **Images:** ✅ 0 passed
- **Navigation:** ✅ 0 passed
- **Interactive:** ✅ 0 passed
- **Overall:** ✅ No Error Detected


##### Browser Console Error Testing

**/**
- **Chrome (Chromium):** ❌ 1 error(s) detected
  - `Navigation failed: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "http://34.142.2...`
- **Safari (WebKit):** ❌ 1 error(s) detected
  - `Navigation failed: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "http://34.142.2...`
- **Firefox (Gecko):** ❌ 1 error(s) detected
  - `Navigation failed: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "http://34.142.2...`


---

## Score Guide

### Performance Scores
| Score | Rating | Description |
|-------|--------|-------------|
| 90-100 | Good | Page is well optimized |
| 50-89 | Needs Work | Page has optimization opportunities |
| 0-49 | Poor | Page has significant issues |

### Core Web Vitals

| Metric | Description | Good | Needs Improvement | Poor |
|--------|-------------|------|-------------------|------|
| **LCP** | Largest Contentful Paint - loading performance | < 2.5s | 2.5s - 4.0s | > 4.0s |
| **CLS** | Cumulative Layout Shift - visual stability | < 0.1 | 0.1 - 0.25 | > 0.25 |
| **INP** | Interaction to Next Paint - responsiveness | < 200ms | 200ms - 500ms | > 500ms |

### Performance Timing Metrics

| Metric | Description | Good Threshold |
|--------|-------------|----------------|
| **FCP** | First Contentful Paint - time to first content render | < 1.8s |
| **TBT** | Total Blocking Time - time blocked by long tasks | < 200ms |
| **TTFB** | Time to First Byte - server response time | < 800ms |
| **SI** | Speed Index - how quickly content is visually displayed | < 3.4s |
| **TTI** | Time to Interactive - time until fully interactive | < 3.8s |
| **Max FID** | Max Potential First Input Delay - worst-case interactivity | < 100ms |

### Resource & Load Metrics

| Metric | Description | Recommendation |
|--------|-------------|----------------|
| **Total Weight** | Total page size (HTML, CSS, JS, images, fonts) | < 1.5 MB |
| **DOM Size** | Number of DOM elements | < 1500 elements |
| **JS Boot Time** | JavaScript execution time | < 2.0s |
| **Main Thread** | Main thread work breakdown | < 4.0s |
| **Requests** | Total network requests | Minimize |
| **Render Blocking** | Resources blocking first paint | 0 |

### Optimization Opportunities

| Metric | Description |
|--------|-------------|
| **Unused CSS** | CSS bytes that are not used on the page |
| **Unused JS** | JavaScript bytes that are not used on the page |
| **Third-Party** | Impact of third-party scripts on load time |
| **Modern Images** | Potential savings from using WebP/AVIF formats |
| **Optimized Images** | Potential savings from compressing images |

### Browser Console Error Testing
- **Chrome (Chromium):** Tests page rendering and JavaScript execution in Chromium engine
- **Safari (WebKit):** Tests page rendering and JavaScript execution in WebKit engine
- **Firefox (Gecko):** Tests page rendering and JavaScript execution in Gecko engine

### Security Headers
| Header | Purpose |
|--------|---------|
| **Content-Security-Policy** | Prevents XSS and data injection attacks |
| **Strict-Transport-Security** | Enforces HTTPS connections |
| **X-Frame-Options** | Prevents clickjacking attacks |
| **X-Content-Type-Options** | Prevents MIME type sniffing |
| **Referrer-Policy** | Controls referrer information leakage |
| **Permissions-Policy** | Controls browser feature access |

---

*Generated by Development Readiness Monitor v2.0 | Powered by Lighthouse & Playwright*
