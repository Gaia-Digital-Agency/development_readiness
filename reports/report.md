# Development Readiness Report v2.0

**Generated:** 2/5/2026, 7:42:08 AM

---

## Summary

| Metric | Value |
|--------|-------|
| Sites Audited | 1 |
| Pages Scanned | 1 |
| Console Errors | 8 |

---

## Overall Site Summary

| Site | Desktop Perf | Mobile Perf | Security | SEO | Accessibility |
|------|-------------|-------------|----------|-----|---------------|
| Manual Audit | 71 | 72 | 71% | 92 | 77 |

---

## Detailed Results

### Manual Audit

**Base URL:** https://www.eurogirlsescort.com/   

#### Site-Level Checks

##### Security Headers
- **Score:** 71%
- **Missing Headers:** content-security-policy, x-xss-protection

##### URL Canonicalization
- **HTTPS Redirect:** ✅ Yes
- **WWW Consistency:** ⚠️ Check manually

##### HTTP/3 Support
- **QUIC/HTTP3:** ❌ Not detected

##### Google Services
- **Google Analytics:** ❌ Not detected
- **Tag Manager:** ❌ Not detected
- **reCAPTCHA:** ❌ Not detected

##### CMS Detection
- **WordPress:** ✅ Detected 
- **Login Protected:** ✅ Yes

##### Broken Links
- **Checked:** 1 links
- **Broken:** 0


##### API Endpoints
- **Tested:** 11 endpoints
- **Status:** ✅ No Error Detected

#### Page Results

| URL | Desktop | Mobile | A11y | SEO | Best Pr. |
|-----|---------|--------|------|-----|----------|
| / | 71 | 72 | 77 | 92 | 63 |

##### Core Web Vitals & Performance Metrics

| URL | LCP | CLS | INP | FCP | TBT | TTFB | SI | TTI |
|-----|-----|-----|-----|-----|-----|------|----|----||
| / | 1.6 s | 0.312 | N/A | 0.9 s | 0 ms | Root document took 1,930 ms | 2.7 s | 1.6 s |

##### Additional Performance Metrics

| URL | Max FID | Total Weight | DOM Size | JS Boot Time | Main Thread |
|-----|---------|--------------|----------|--------------|-------------|
| / | 50 ms | Total size was 1,250 KiB | 7,030 elements | 0.2 s | 0.9 s |

##### Resource Summary

| URL | Requests | Scripts | Stylesheets | Fonts | Images | Render Blocking | Redirects |
|-----|----------|---------|-------------|-------|--------|-----------------|----------|
| / | 87 | 4 | 2 | 3 | 71 | 1 | 0 |

##### Optimization Opportunities

| URL | Unused CSS | Unused JS | Third-Party Impact | Modern Images | Optimized Images |
|-----|------------|-----------|-------------------|---------------|------------------|
| / | Est savings of 31 KiB | Est savings of 131 KiB | Third-party code blocked the main thread for 0 ms | Est savings of 222 KiB | N/A |

##### Functional Tests

**/**
- **Links:** ✅ 1 passed
- **Buttons:** ✅ 0 passed
- **Forms:** ✅ 1 passed
- **Images:** ✅ 1 passed
- **Navigation:** ✅ 1 passed
- **Interactive:** ✅ 1 passed
- **Overall:** ✅ No Error Detected


##### Browser Console Error Testing

**/**
- **Chrome (Chromium):** ❌ 5 error(s) detected
  - `Failed to load resource: the server responded with a status of 403 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - ` Note that 'script-src' was not explicitly set, so 'default-src' is used as a fallback.`
- **Safari (WebKit):** ❌ 3 error(s) detected
  - `%c%d font-size:0;color:transparent rjke: Rjps`
  - `%c%d font-size:0;color:transparent rjke: Rjps`
  - `Failed to load resource: the server responded with a status of 401 (Unauthorized)`
- **Firefox (Gecko):** ✅ No Error Detected


#### Network Issues

**/** - Failed Requests:
- 403: https://www.eurogirlsescort.com/...
- 401: https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/pat/9c90c4b2af6...

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
