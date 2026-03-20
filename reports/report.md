# Development Readiness Report v2.0

**Generated:** 3/20/2026, 11:23:30 AM

---

## Summary

| Metric | Value |
|--------|-------|
| Sites Audited | 1 |
| Pages Scanned | 7 |
| Console Errors | 0 |

---

## Overall Site Summary

| Site | Desktop Perf | Mobile Perf | Security | SEO | Accessibility |
|------|-------------|-------------|----------|-----|---------------|
| Manual Audit | 92 | 96 | 43% | 100 | 100 |

---

## Detailed Results

### Manual Audit

**Base URL:** http://34.158.47.112/schoolcatering

#### Site-Level Checks

##### Security Headers
- **Score:** 43%
- **Missing Headers:** content-security-policy, strict-transport-security, referrer-policy, permissions-policy

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
- **Checked:** 9 links
- **Broken:** 0


##### API Endpoints
- **Tested:** 11 endpoints
- **Status:** ✅ No Error Detected

#### Page Results

| URL | Desktop | Mobile | A11y | SEO | Best Pr. |
|-----|---------|--------|------|-----|----------|
| / | 79 | 88 | 100 | 100 | 79 |
| //menu | 64 | 94 | 100 | 100 | 79 |
| //guide | 100 | 98 | 100 | 100 | 79 |
| //login | 100 | 98 | 100 | 100 | 79 |
| //register | 100 | 95 | 100 | 100 | 79 |
| //userguide | 100 | 98 | 100 | 100 | 79 |
| //rating | 98 | 99 | 100 | 100 | 79 |

##### Core Web Vitals & Performance Metrics

| URL | LCP | CLS | INP | FCP | TBT | TTFB | SI | TTI |
|-----|-----|-----|-----|-----|-----|------|----|----||
| / | 3.2 s | 0.018 | N/A | 1.1 s | 0 ms | Root document took 230 ms | 1.3 s | 3.2 s |
| //menu | 2.7 s | 0.509 | N/A | 0.7 s | 0 ms | Root document took 230 ms | 1.1 s | 2.7 s |
| //guide | 0.7 s | 0 | N/A | 0.7 s | 0 ms | Root document took 260 ms | 0.7 s | 0.7 s |
| //login | 0.7 s | 0 | N/A | 0.7 s | 0 ms | Root document took 230 ms | 0.7 s | 0.7 s |
| //register | 0.7 s | 0.013 | N/A | 0.7 s | 0 ms | Root document took 230 ms | 0.7 s | 0.7 s |
| //userguide | 0.7 s | 0 | N/A | 0.7 s | 0 ms | Root document took 240 ms | 0.7 s | 0.7 s |
| //rating | 1.0 s | 0 | N/A | 0.9 s | 0 ms | Root document took 230 ms | 0.9 s | 1.0 s |

##### Additional Performance Metrics

| URL | Max FID | Total Weight | DOM Size | JS Boot Time | Main Thread |
|-----|---------|--------------|----------|--------------|-------------|
| / | 20 ms | Total size was 249 KiB | 39 elements | 0.1 s | 0.2 s |
| //menu | 40 ms | Total size was 3,759 KiB | 387 elements | 0.1 s | 0.3 s |
| //guide | 20 ms | Total size was 130 KiB | 554 elements | N/A | 0.1 s |
| //login | 20 ms | Total size was 107 KiB | 42 elements | N/A | 0.1 s |
| //register | 20 ms | Total size was 116 KiB | 87 elements | N/A | 0.1 s |
| //userguide | 20 ms | Total size was 141 KiB | 131 elements | N/A | 0.1 s |
| //rating | 20 ms | Total size was 107 KiB | 42 elements | N/A | 0.1 s |

##### Resource Summary

| URL | Requests | Scripts | Stylesheets | Fonts | Images | Render Blocking | Redirects |
|-----|----------|---------|-------------|-------|--------|-----------------|----------|
| / | 28 | 14 | 1 | N/A | 2 | 1 | 3 |
| //menu | 56 | 9 | 1 | N/A | 40 | 1 | 0 |
| //guide | 14 | 9 | 1 | N/A | N/A | 1 | 0 |
| //login | 9 | 6 | 1 | N/A | N/A | 1 | 0 |
| //register | 13 | 8 | 1 | N/A | 1 | 1 | 0 |
| //userguide | 17 | 11 | 1 | N/A | N/A | 1 | 0 |
| //rating | 10 | 6 | 1 | N/A | N/A | 1 | 2 |

##### Optimization Opportunities

| URL | Unused CSS | Unused JS | Third-Party Impact | Modern Images | Optimized Images |
|-----|------------|-----------|-------------------|---------------|------------------|
| / | N/A | N/A | Third-party code blocked the main thread for 0 ms | Est savings of 30 KiB | N/A |
| //menu | N/A | N/A | Third-party code blocked the main thread for 0 ms | N/A | N/A |
| //guide | N/A | N/A | N/A | N/A | N/A |
| //login | N/A | Est savings of 22 KiB | N/A | N/A | N/A |
| //register | N/A | N/A | N/A | N/A | N/A |
| //userguide | N/A | N/A | N/A | N/A | N/A |
| //rating | N/A | Est savings of 22 KiB | N/A | N/A | N/A |

##### Functional Tests

**/**
- **Links:** ✅ 8 passed
- **Buttons:** ⚠️ 0 passed
- **Forms:** ✅ 1 passed
- **Images:** ✅ 2 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed

**Issues Found:**
  - buttons: `Button "Menu" - not visible`

**//menu**
- **Links:** ✅ 2 passed
- **Buttons:** ⚠️ 0 passed
- **Forms:** ✅ 1 passed
- **Images:** ⚠️ 1 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed

**Issues Found:**
  - buttons: `Button "Top" - not visible`
  - images: `Broken image: https://storage.googleapis.com/gda-ce01-bucket/blossom-schoolcatering/menu-images/upload-17724232536`
  - images: `Broken image: https://storage.googleapis.com/gda-ce01-bucket/blossom-schoolcatering/menu-images/upload-17724232807`
  - images: `Broken image: https://storage.googleapis.com/gda-ce01-bucket/blossom-schoolcatering/menu-images/upload-17725064116`

**//guide**
- **Links:** ✅ 2 passed
- **Buttons:** ✅ 0 passed
- **Forms:** ✅ 1 passed
- **Images:** ✅ 0 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed
- **Overall:** ✅ No Error Detected

**//login**
- **Links:** ✅ 0 passed
- **Buttons:** ⚠️ 2 passed
- **Forms:** ✅ 1 passed
- **Images:** ✅ 0 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed

**Issues Found:**
  - buttons: `Button "Top" - not visible`

**//register**
- **Links:** ✅ 0 passed
- **Buttons:** ⚠️ 1 passed
- **Forms:** ✅ 1 passed
- **Images:** ✅ 0 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed

**Issues Found:**
  - buttons: `Button "Top" - not visible`

**//userguide**
- **Links:** ✅ 3 passed
- **Buttons:** ⚠️ 0 passed
- **Forms:** ✅ 1 passed
- **Images:** ✅ 0 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed

**Issues Found:**
  - buttons: `Button "Top" - not visible`

**//rating**
- **Links:** ✅ 0 passed
- **Buttons:** ⚠️ 2 passed
- **Forms:** ✅ 1 passed
- **Images:** ✅ 0 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed

**Issues Found:**
  - buttons: `Button "Top" - not visible`


##### Browser Console Error Testing

**/**
- **Chrome (Chromium):** ✅ No Error Detected
- **Safari (WebKit):** ✅ No Error Detected
- **Firefox (Gecko):** ✅ No Error Detected

**//menu**
- **Chrome (Chromium):** ✅ No Error Detected
- **Safari (WebKit):** ✅ No Error Detected
- **Firefox (Gecko):** ✅ No Error Detected

**//guide**
- **Chrome (Chromium):** ✅ No Error Detected
- **Safari (WebKit):** ✅ No Error Detected
- **Firefox (Gecko):** ✅ No Error Detected

**//login**
- **Chrome (Chromium):** ✅ No Error Detected
- **Safari (WebKit):** ✅ No Error Detected
- **Firefox (Gecko):** ✅ No Error Detected

**//register**
- **Chrome (Chromium):** ✅ No Error Detected
- **Safari (WebKit):** ✅ No Error Detected
- **Firefox (Gecko):** ✅ No Error Detected

**//userguide**
- **Chrome (Chromium):** ✅ No Error Detected
- **Safari (WebKit):** ✅ No Error Detected
- **Firefox (Gecko):** ✅ No Error Detected

**//rating**
- **Chrome (Chromium):** ✅ No Error Detected
- **Safari (WebKit):** ✅ No Error Detected
- **Firefox (Gecko):** ✅ No Error Detected


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
