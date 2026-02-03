const { chromium, webkit, firefox } = require('playwright');
const lighthouse = require('lighthouse/core/index.cjs');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs-extra');
const { URL } = require('url');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const cron = require('node-cron');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// ============================================================================
// CONFIGURATION
// ============================================================================
const DEFAULT_CONFIG = {
    maxPagesPerSite: 20,
    pageTimeout: 30000,
    slowAssetThreshold: 3000, // 3 seconds
    concurrency: 1,
    historyDir: './data/history',
    reportsDir: './reports',
    sitesFile: './data/sites.json',
};

// Security headers to check
const SECURITY_HEADERS = [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'x-xss-protection',
    'referrer-policy',
    'permissions-policy',
];

// ============================================================================
// CLI ARGUMENTS PARSING
// ============================================================================
const argv = yargs(hideBin(process.argv))
    .option('site', {
        alias: 's',
        type: 'string',
        description: 'Single site URL to audit'
    })
    .option('name', {
        alias: 'n',
        type: 'string',
        description: 'Name for the single site (used with --site)'
    })
    .option('config', {
        alias: 'c',
        type: 'string',
        description: 'Path to custom config file'
    })
    .option('max-pages', {
        alias: 'm',
        type: 'number',
        default: DEFAULT_CONFIG.maxPagesPerSite,
        description: 'Maximum pages to crawl per site'
    })
    .option('concurrency', {
        type: 'number',
        default: DEFAULT_CONFIG.concurrency,
        description: 'Number of concurrent site audits'
    })
    .option('schedule', {
        type: 'string',
        description: 'Cron expression for scheduled audits (default: "0 13 * * *" = 9PM GMT+8)'
    })
    .option('history', {
        type: 'boolean',
        default: true,
        description: 'Enable historical tracking'
    })
    .help()
    .alias('help', 'h')
    .argv;

// ============================================================================
// NETWORK ANALYSIS
// ============================================================================
async function analyzeNetworkRequests(page, url) {
    const networkData = {
        failedRequests: [],
        slowAssets: [],
        totalRequests: 0,
        totalSize: 0,
    };

    const requestTimes = new Map();

    page.on('request', request => {
        requestTimes.set(request.url(), Date.now());
    });

    page.on('response', async response => {
        networkData.totalRequests++;
        const requestUrl = response.url();
        const status = response.status();
        const startTime = requestTimes.get(requestUrl);
        const duration = startTime ? Date.now() - startTime : 0;

        try {
            const headers = response.headers();
            const contentLength = parseInt(headers['content-length'] || '0', 10);
            networkData.totalSize += contentLength;
        } catch (e) {
            // Ignore size calculation errors
        }

        // Track failed requests (4xx, 5xx)
        if (status >= 400) {
            networkData.failedRequests.push({
                url: requestUrl,
                status,
                statusText: response.statusText(),
            });
        }

        // Track slow assets
        if (duration > DEFAULT_CONFIG.slowAssetThreshold) {
            networkData.slowAssets.push({
                url: requestUrl,
                duration,
                type: response.headers()['content-type'] || 'unknown',
            });
        }
    });

    page.on('requestfailed', request => {
        networkData.failedRequests.push({
            url: request.url(),
            status: 0,
            statusText: request.failure()?.errorText || 'Request failed',
        });
    });

    return networkData;
}

// ============================================================================
// SECURITY HEADERS CHECK
// ============================================================================
async function checkSecurityHeaders(url) {
    const results = {
        url,
        headers: {},
        missing: [],
        score: 0,
    };

    try {
        const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
        const headers = response.headers;

        SECURITY_HEADERS.forEach(header => {
            const value = headers.get(header);
            if (value) {
                results.headers[header] = value;
            } else {
                results.missing.push(header);
            }
        });

        // Calculate score (percentage of headers present)
        results.score = Math.round(
            ((SECURITY_HEADERS.length - results.missing.length) / SECURITY_HEADERS.length) * 100
        );
    } catch (error) {
        results.error = error.message;
    }

    return results;
}

// ============================================================================
// URL CANONICALIZATION CHECK
// ============================================================================
async function checkCanonicalUrl(baseUrl) {
    const results = {
        httpsRedirect: false,
        wwwConsistency: null,
        canonicalUrl: null,
        issues: [],
    };

    try {
        const parsedUrl = new URL(baseUrl);
        const domain = parsedUrl.hostname.replace(/^www\./, '');

        // Check HTTP to HTTPS redirect
        const httpUrl = `http://${parsedUrl.hostname}${parsedUrl.pathname}`;
        try {
            const httpResponse = await fetch(httpUrl, { redirect: 'manual' });
            if (httpResponse.status >= 300 && httpResponse.status < 400) {
                const location = httpResponse.headers.get('location');
                if (location && location.startsWith('https://')) {
                    results.httpsRedirect = true;
                }
            }
        } catch (e) {
            // HTTP might not be available
        }

        // Check www vs non-www consistency
        const wwwUrl = `https://www.${domain}${parsedUrl.pathname}`;
        const nonWwwUrl = `https://${domain}${parsedUrl.pathname}`;

        try {
            const [wwwResponse, nonWwwResponse] = await Promise.all([
                fetch(wwwUrl, { redirect: 'follow' }).catch(() => null),
                fetch(nonWwwUrl, { redirect: 'follow' }).catch(() => null),
            ]);

            if (wwwResponse && nonWwwResponse) {
                const wwwFinal = wwwResponse.url;
                const nonWwwFinal = nonWwwResponse.url;
                results.wwwConsistency = wwwFinal === nonWwwFinal;
                results.canonicalUrl = wwwFinal;
            }
        } catch (e) {
            results.issues.push('Could not verify www consistency');
        }

        if (!results.httpsRedirect) {
            results.issues.push('HTTP does not redirect to HTTPS');
        }
        if (results.wwwConsistency === false) {
            results.issues.push('www and non-www URLs resolve to different locations');
        }
    } catch (error) {
        results.error = error.message;
    }

    return results;
}

// ============================================================================
// HTTP/3 (QUIC) SUPPORT DETECTION
// ============================================================================
async function checkHttp3Support(url) {
    const results = {
        supportsHttp3: false,
        altSvc: null,
        protocol: null,
    };

    try {
        const response = await fetch(url);
        const altSvc = response.headers.get('alt-svc');

        if (altSvc) {
            results.altSvc = altSvc;
            // Check for h3 (HTTP/3) in alt-svc header
            if (altSvc.includes('h3') || altSvc.includes('quic')) {
                results.supportsHttp3 = true;
            }
        }

        // Note: Browser fetch doesn't expose the actual protocol used
        // This is a best-effort detection based on alt-svc header
    } catch (error) {
        results.error = error.message;
    }

    return results;
}

// ============================================================================
// GOOGLE SERVICES DETECTION
// ============================================================================
async function detectGoogleServices(page) {
    const results = {
        googleAnalytics: { detected: false, version: null, viaTM: false },
        googleTagManager: { detected: false, containerId: null },
        recaptcha: { detected: false, version: null },
    };

    try {
        // Get page content and scripts
        const pageContent = await page.content();
        const scripts = await page.$$eval('script', scripts =>
            scripts.map(s => ({ src: s.src, content: s.innerHTML }))
        );

        // Check for Google Tag Manager
        const gtmPattern = /googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/i;
        const gtmMatch = pageContent.match(gtmPattern) || scripts.some(s => s.src?.match(gtmPattern));
        if (gtmMatch) {
            results.googleTagManager.detected = true;
            const idMatch = pageContent.match(/GTM-[A-Z0-9]+/i);
            results.googleTagManager.containerId = idMatch ? idMatch[0] : 'Unknown';
        }

        // Check for Google Analytics
        const ga4Pattern = /gtag\('config',\s*'(G-[A-Z0-9]+)'/i;
        const uaPattern = /gtag\('config',\s*'(UA-[0-9]+-[0-9]+)'/i;
        const ga4Match = pageContent.match(ga4Pattern);
        const uaMatch = pageContent.match(uaPattern);

        if (ga4Match) {
            results.googleAnalytics.detected = true;
            results.googleAnalytics.version = 'GA4';
            results.googleAnalytics.viaTM = results.googleTagManager.detected;
        } else if (uaMatch) {
            results.googleAnalytics.detected = true;
            results.googleAnalytics.version = 'Universal Analytics';
        }

        // Also check for analytics.js or gtag.js directly
        const hasGtagJs = scripts.some(s => s.src?.includes('googletagmanager.com/gtag/js'));
        const hasAnalyticsJs = scripts.some(s => s.src?.includes('google-analytics.com/analytics.js'));

        if (hasGtagJs && !results.googleAnalytics.detected) {
            results.googleAnalytics.detected = true;
            results.googleAnalytics.version = 'gtag.js';
        } else if (hasAnalyticsJs && !results.googleAnalytics.detected) {
            results.googleAnalytics.detected = true;
            results.googleAnalytics.version = 'analytics.js';
        }

        // Check for reCAPTCHA
        const recaptchaV2 = pageContent.includes('google.com/recaptcha/api.js') ||
            scripts.some(s => s.src?.includes('google.com/recaptcha/api.js'));
        const recaptchaV3 = pageContent.includes('google.com/recaptcha/api.js?render=') ||
            scripts.some(s => s.src?.includes('recaptcha/api.js?render='));
        const recaptchaEnterprise = pageContent.includes('recaptcha/enterprise.js') ||
            scripts.some(s => s.src?.includes('recaptcha/enterprise.js'));

        if (recaptchaEnterprise) {
            results.recaptcha.detected = true;
            results.recaptcha.version = 'Enterprise';
        } else if (recaptchaV3) {
            results.recaptcha.detected = true;
            results.recaptcha.version = 'v3';
        } else if (recaptchaV2) {
            results.recaptcha.detected = true;
            results.recaptcha.version = 'v2';
        }
    } catch (error) {
        results.error = error.message;
    }

    return results;
}

// ============================================================================
// WORDPRESS/CMS DETECTION
// ============================================================================
async function detectWordPress(page, baseUrl, response) {
    const wappalyzer = require('simple-wappalyzer');
    const results = {
        isWordPress: false,
        version: null,
        loginUrlProtected: null,
        detectionMethods: [],
        cms: null,
    };

    try {
        const html = await page.content();
        const headers = response.headers();
        const statusCode = response.status();
        const url = page.url();

        // Try Wappalyzer first
        try {
            const wappalyzerResult = await wappalyzer({ url, html, statusCode, headers });

            const wordpress = wappalyzerResult.applications.find(app => app.name === 'WordPress');
            if (wordpress) {
                results.isWordPress = true;
                results.version = wordpress.version;
                results.detectionMethods.push('wappalyzer');
            }

            const cms = wappalyzerResult.applications.find(app => app.categories.some(cat => Object.values(cat).includes('CMS')));
            if (cms) {
                results.cms = cms.name;
            }
        } catch (wapErr) {
            console.log(`  ⚠️ Wappalyzer detection failed: ${wapErr.message}`);
        }

        // Manual WordPress detection fallbacks (run even if Wappalyzer found it, to get version)

        // 1. Check for wp-content or wp-includes in HTML
        if (html.includes('/wp-content/') || html.includes('/wp-includes/')) {
            if (!results.isWordPress) {
                results.isWordPress = true;
                results.detectionMethods.push('wp-content-path');
            }
            if (!results.cms) results.cms = 'WordPress';
        }

        // 2. Check meta generator tag for WordPress and version
        const generatorMatch = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']WordPress\s*([\d.]*)?["']/i);
        if (generatorMatch) {
            if (!results.isWordPress) {
                results.isWordPress = true;
                results.detectionMethods.push('meta-generator');
            }
            if (generatorMatch[1] && !results.version) {
                results.version = generatorMatch[1];
            }
            if (!results.cms) results.cms = 'WordPress';
        }

        // 3. Check for wp-json REST API link
        if (html.includes('/wp-json/') || html.includes('wp-json')) {
            if (!results.isWordPress) {
                results.isWordPress = true;
                results.detectionMethods.push('wp-json-api');
            }
            if (!results.cms) results.cms = 'WordPress';
        }

        // 4. Check for common WordPress scripts
        const wpScripts = ['wp-embed.min.js', 'wp-emoji-release.min.js', 'jquery.min.js?ver='];
        for (const script of wpScripts) {
            if (html.includes(script)) {
                if (!results.isWordPress) {
                    results.isWordPress = true;
                    results.detectionMethods.push('wp-scripts');
                }
                if (!results.cms) results.cms = 'WordPress';
                break;
            }
        }

        // 5. Check response headers for WordPress indicators
        const xPoweredBy = headers['x-powered-by'] || '';
        const link = headers['link'] || '';
        if (xPoweredBy.toLowerCase().includes('wordpress') || link.includes('wp-json')) {
            if (!results.isWordPress) {
                results.isWordPress = true;
                results.detectionMethods.push('response-headers');
            }
            if (!results.cms) results.cms = 'WordPress';
        }

        // 6. Check for WordPress login/admin URLs accessibility (also serves as detection)
        const loginUrls = ['/wp-login.php', '/wp-admin/'];
        for (const loginPath of loginUrls) {
            try {
                const loginUrl = new URL(loginPath, baseUrl).href;
                const loginResponse = await fetch(loginUrl, { redirect: 'manual' });

                // If we get any response (not a network error), WordPress likely exists
                if (loginResponse.status === 200) {
                    if (!results.isWordPress) {
                        results.isWordPress = true;
                        results.detectionMethods.push('login-url-check');
                    }
                    results.loginUrlProtected = false;
                    if (!results.cms) results.cms = 'WordPress';
                } else if (loginResponse.status === 403 ||
                    (loginResponse.status >= 300 && loginResponse.status < 400)) {
                    // Redirect or forbidden usually means WP is there but protected
                    if (!results.isWordPress) {
                        results.isWordPress = true;
                        results.detectionMethods.push('login-url-check');
                    }
                    results.loginUrlProtected = true;
                    if (!results.cms) results.cms = 'WordPress';
                }
                // Only break if we found something definitive
                if (results.loginUrlProtected !== null) break;
            } catch (e) {
                // Login URL check failed - network error, continue
            }
        }
    } catch (error) {
        results.error = error.message;
    }

    return results;
}

// ============================================================================
// BROKEN LINK CHECKER
// ============================================================================
async function checkBrokenLinks(links, baseUrl) {
    const results = {
        total: links.length,
        checked: 0,
        broken: [],
        working: 0,
    };

    const uniqueLinks = [...new Set(links)].slice(0, 50); // Limit to 50 links

    for (const link of uniqueLinks) {
        try {
            const absoluteUrl = new URL(link, baseUrl).href;

            // Skip non-HTTP links
            if (!absoluteUrl.startsWith('http')) continue;

            results.checked++;

            const response = await fetch(absoluteUrl, {
                method: 'HEAD',
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            });

            if (response.status >= 400) {
                results.broken.push({
                    url: absoluteUrl,
                    status: response.status,
                });
            } else {
                results.working++;
            }
        } catch (error) {
            results.broken.push({
                url: link,
                status: 0,
                error: error.message,
            });
        }
    }

    return results;
}

// ============================================================================
// PAGE AUDIT (with network analysis)
// ============================================================================
async function runPageAudit(browser, url) {
    const page = await browser.newPage();
    const consoleErrors = [];
    const networkData = {
        failedRequests: [],
        slowAssets: [],
        totalRequests: 0,
    };
    const requestTimes = new Map();

    page.on('console', msg => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });

    // Network monitoring
    page.on('request', request => {
        requestTimes.set(request.url(), Date.now());
        networkData.totalRequests++;
    });

    page.on('response', async response => {
        const requestUrl = response.url();
        const status = response.status();
        const startTime = requestTimes.get(requestUrl);
        const duration = startTime ? Date.now() - startTime : 0;

        if (status >= 400) {
            networkData.failedRequests.push({
                url: requestUrl,
                status,
            });
        }

        if (duration > DEFAULT_CONFIG.slowAssetThreshold) {
            networkData.slowAssets.push({
                url: requestUrl,
                duration,
            });
        }
    });

    let navigationError = null;
    try {
        // Use domcontentloaded for faster response, then wait a bit for JS to render
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_CONFIG.pageTimeout });
        // Give JS time to render content after DOM is ready
        await page.waitForTimeout(2000);
    } catch (error) {
        console.error(`Error navigating to ${url}: ${error.message}`);
        navigationError = error.message;
        // Don't return early - try to extract links from whatever loaded
    }

    // Try to extract links even if navigation had issues
    let links = [];
    try {
        links = await page.$$eval('a[href]', (anchors) =>
            anchors.map((anchor) => anchor.href)
        );
    } catch (e) {
        console.error(`Error extracting links from ${url}: ${e.message}`);
    }

    if (navigationError) {
        consoleErrors.push(`Navigation failed: ${navigationError}`);
    }

    await page.close();
    return { consoleErrors, discoveredLinks: links, networkData };
}

// ============================================================================
// FUNCTIONAL TESTS (Site Behavior Testing)
// ============================================================================
async function runFunctionalTests(browser, url) {
    const results = {
        linksTest: { passed: 0, failed: 0, errors: [] },
        buttonsTest: { passed: 0, failed: 0, errors: [] },
        formsTest: { passed: 0, failed: 0, errors: [] },
        imagesTest: { passed: 0, failed: 0, errors: [] },
        navigationTest: { passed: 0, failed: 0, errors: [] },
        interactiveTest: { passed: 0, failed: 0, errors: [] },
        summary: { totalTests: 0, passed: 0, failed: 0 },
    };

    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_CONFIG.pageTimeout });
        await page.waitForTimeout(2000);

        // Test 1: Links Test - Check internal links are clickable
        console.log(`    🔗 Testing links...`);
        try {
            const links = await page.$$eval('a[href]', anchors =>
                anchors.map(a => ({
                    href: a.href,
                    text: a.textContent?.trim().substring(0, 50) || '[no text]',
                    isVisible: a.offsetParent !== null,
                    hasValidHref: !a.href.startsWith('javascript:') && a.href !== '#',
                }))
            );

            const validLinks = links.filter(l => l.hasValidHref && l.isVisible);
            results.linksTest.passed = validLinks.length;

            const invalidLinks = links.filter(l => !l.hasValidHref || !l.isVisible);
            invalidLinks.slice(0, 5).forEach(l => {
                results.linksTest.errors.push(`Link "${l.text}" - ${!l.hasValidHref ? 'invalid href' : 'not visible'}`);
            });
            results.linksTest.failed = invalidLinks.length;
        } catch (e) {
            results.linksTest.errors.push(`Links test error: ${e.message}`);
        }

        // Test 2: Buttons Test - Check buttons are clickable
        console.log(`    🔘 Testing buttons...`);
        try {
            const buttons = await page.$$eval('button, input[type="button"], input[type="submit"], [role="button"]', btns =>
                btns.map(b => ({
                    text: b.textContent?.trim().substring(0, 50) || b.value || '[no text]',
                    isVisible: b.offsetParent !== null,
                    isDisabled: b.disabled,
                    type: b.tagName.toLowerCase(),
                }))
            );

            const clickableButtons = buttons.filter(b => b.isVisible && !b.isDisabled);
            results.buttonsTest.passed = clickableButtons.length;

            const problematicButtons = buttons.filter(b => !b.isVisible || b.isDisabled);
            problematicButtons.slice(0, 5).forEach(b => {
                results.buttonsTest.errors.push(`Button "${b.text}" - ${b.isDisabled ? 'disabled' : 'not visible'}`);
            });
            results.buttonsTest.failed = problematicButtons.length;
        } catch (e) {
            results.buttonsTest.errors.push(`Buttons test error: ${e.message}`);
        }

        // Test 3: Forms Test - Check forms have proper structure
        console.log(`    📝 Testing forms...`);
        try {
            const forms = await page.$$eval('form', forms =>
                forms.map(f => {
                    const inputs = f.querySelectorAll('input, textarea, select');
                    const labels = f.querySelectorAll('label');
                    const submitBtn = f.querySelector('button[type="submit"], input[type="submit"]');
                    return {
                        action: f.action || '[no action]',
                        method: f.method || 'get',
                        inputCount: inputs.length,
                        labelCount: labels.length,
                        hasSubmit: !!submitBtn,
                        isVisible: f.offsetParent !== null,
                    };
                })
            );

            forms.forEach(f => {
                if (f.isVisible && f.hasSubmit && f.inputCount > 0) {
                    results.formsTest.passed++;
                } else {
                    results.formsTest.failed++;
                    if (!f.hasSubmit) results.formsTest.errors.push(`Form missing submit button`);
                    if (!f.isVisible) results.formsTest.errors.push(`Form not visible`);
                    if (f.inputCount === 0) results.formsTest.errors.push(`Form has no inputs`);
                }
            });

            if (forms.length === 0) {
                results.formsTest.passed = 1; // No forms is OK
            }
        } catch (e) {
            results.formsTest.errors.push(`Forms test error: ${e.message}`);
        }

        // Test 4: Images Test - Check images load correctly
        console.log(`    🖼️ Testing images...`);
        try {
            const images = await page.$$eval('img', imgs =>
                imgs.map(img => ({
                    src: img.src?.substring(0, 100) || '[no src]',
                    alt: img.alt || '[no alt]',
                    hasAlt: !!img.alt,
                    isLoaded: img.complete && img.naturalWidth > 0,
                    isVisible: img.offsetParent !== null,
                }))
            );

            const loadedImages = images.filter(i => i.isLoaded);
            const brokenImages = images.filter(i => !i.isLoaded && i.isVisible);
            const missingAlt = images.filter(i => !i.hasAlt && i.isVisible);

            results.imagesTest.passed = loadedImages.length;
            results.imagesTest.failed = brokenImages.length;

            brokenImages.slice(0, 3).forEach(i => {
                results.imagesTest.errors.push(`Broken image: ${i.src}`);
            });
            missingAlt.slice(0, 3).forEach(i => {
                results.imagesTest.errors.push(`Missing alt text: ${i.src}`);
            });
        } catch (e) {
            results.imagesTest.errors.push(`Images test error: ${e.message}`);
        }

        // Test 5: Navigation Test - Check nav menus work
        console.log(`    🧭 Testing navigation...`);
        try {
            const navElements = await page.$$eval('nav, [role="navigation"], .nav, .navbar, .menu', navs =>
                navs.map(nav => ({
                    linkCount: nav.querySelectorAll('a').length,
                    isVisible: nav.offsetParent !== null,
                    hasDropdown: nav.querySelector('.dropdown, [class*="dropdown"], .submenu') !== null,
                }))
            );

            navElements.forEach(nav => {
                if (nav.isVisible && nav.linkCount > 0) {
                    results.navigationTest.passed++;
                } else {
                    results.navigationTest.failed++;
                    if (!nav.isVisible) results.navigationTest.errors.push(`Navigation not visible`);
                    if (nav.linkCount === 0) results.navigationTest.errors.push(`Navigation has no links`);
                }
            });

            if (navElements.length === 0) {
                results.navigationTest.passed = 1; // No explicit nav is OK for some sites
            }
        } catch (e) {
            results.navigationTest.errors.push(`Navigation test error: ${e.message}`);
        }

        // Test 6: Interactive Elements Test - Check dropdowns, modals, etc.
        console.log(`    🎛️ Testing interactive elements...`);
        try {
            const interactiveElements = await page.$$eval(
                '.dropdown, .accordion, .modal, .tab, .carousel, [data-toggle], [data-bs-toggle], .slider',
                elements => elements.map(el => ({
                    type: el.className.split(' ').find(c => ['dropdown', 'accordion', 'modal', 'tab', 'carousel', 'slider'].includes(c)) || 'interactive',
                    isVisible: el.offsetParent !== null || el.classList.contains('modal'),
                }))
            );

            interactiveElements.forEach(el => {
                results.interactiveTest.passed++; // Interactive elements found
            });

            if (interactiveElements.length === 0) {
                results.interactiveTest.passed = 1; // No interactive elements is OK
            }
        } catch (e) {
            results.interactiveTest.errors.push(`Interactive elements test error: ${e.message}`);
        }

        // Calculate summary
        const tests = [results.linksTest, results.buttonsTest, results.formsTest,
                       results.imagesTest, results.navigationTest, results.interactiveTest];
        results.summary.passed = tests.reduce((sum, t) => sum + t.passed, 0);
        results.summary.failed = tests.reduce((sum, t) => sum + t.failed, 0);
        results.summary.totalTests = results.summary.passed + results.summary.failed;

    } catch (error) {
        results.summary.errors = [`Functional test failed: ${error.message}`];
    } finally {
        await page.close();
    }

    return results;
}

// ============================================================================
// API ENDPOINT TESTING
// ============================================================================
async function testApiEndpoints(baseUrl) {
    const results = {
        tested: 0,
        passed: 0,
        failed: 0,
        errors: [],
    };

    // Common API endpoints to check
    const commonEndpoints = [
        '/api',
        '/api/v1',
        '/api/v2',
        '/wp-json',
        '/wp-json/wp/v2/posts',
        '/graphql',
        '/rest',
        '/.well-known/security.txt',
        '/robots.txt',
        '/sitemap.xml',
        '/favicon.ico',
    ];

    console.log(`  🔌 Testing API endpoints...`);

    for (const endpoint of commonEndpoints) {
        try {
            const url = new URL(endpoint, baseUrl).href;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json, text/xml, */*' },
                signal: AbortSignal.timeout(5000),
            });

            results.tested++;

            if (response.ok) {
                results.passed++;
            } else if (response.status >= 400 && response.status < 500) {
                // 4xx errors are expected for non-existent endpoints, don't report as errors
                results.passed++;
            } else if (response.status >= 500) {
                // Only report 5xx server errors
                results.failed++;
                results.errors.push(`${endpoint}: Server error (${response.status})`);
            }
        } catch (error) {
            results.tested++;
            // Only report actual errors (not timeouts for non-existent endpoints)
            if (error.name !== 'AbortError' && !error.message.includes('ENOTFOUND')) {
                results.failed++;
                results.errors.push(`${endpoint}: ${error.message}`);
            } else {
                results.passed++; // Timeout/not found is acceptable
            }
        }
    }

    return results;
}

// ============================================================================
// LIGHTHOUSE AUDIT (Desktop + Mobile)
// ============================================================================
async function runLighthouseAudits(url, chromePort) {
    const results = {
        desktop: null,
        mobile: null,
    };

    // Desktop audit - full categories
    try {
        const { lhr: desktopLhr } = await lighthouse(url, {
            port: chromePort,
            output: 'json',
            onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
            logLevel: 'error',
            formFactor: 'desktop',
            screenEmulation: {
                mobile: false,
                width: 1350,
                height: 940,
                deviceScaleFactor: 1,
                disabled: false,
            },
            throttling: {
                rttMs: 40,
                throughputKbps: 10240,
                cpuSlowdownMultiplier: 1,
            },
        });

        results.desktop = {
            // Category Scores
            performance: Math.round((desktopLhr.categories.performance?.score || 0) * 100),
            accessibility: Math.round((desktopLhr.categories.accessibility?.score || 0) * 100),
            bestPractices: Math.round((desktopLhr.categories['best-practices']?.score || 0) * 100),
            seo: Math.round((desktopLhr.categories.seo?.score || 0) * 100),
            // Core Web Vitals
            lcp: desktopLhr.audits['largest-contentful-paint']?.displayValue || 'N/A',
            cls: desktopLhr.audits['cumulative-layout-shift']?.displayValue || 'N/A',
            inp: desktopLhr.audits['interaction-to-next-paint']?.displayValue || 'N/A',
            fcp: desktopLhr.audits['first-contentful-paint']?.displayValue || 'N/A',
            tbt: desktopLhr.audits['total-blocking-time']?.displayValue || 'N/A',
            ttfb: desktopLhr.audits['server-response-time']?.displayValue || 'N/A',
            speedIndex: desktopLhr.audits['speed-index']?.displayValue || 'N/A',
            tti: desktopLhr.audits['interactive']?.displayValue || 'N/A',
            // Additional Performance Metrics
            maxPotentialFid: desktopLhr.audits['max-potential-fid']?.displayValue || 'N/A',
            totalByteWeight: desktopLhr.audits['total-byte-weight']?.displayValue || 'N/A',
            domSize: desktopLhr.audits['dom-size']?.displayValue || 'N/A',
            bootupTime: desktopLhr.audits['bootup-time']?.displayValue || 'N/A',
            mainthreadWork: desktopLhr.audits['mainthread-work-breakdown']?.displayValue || 'N/A',
            // Resource Counts
            numRequests: desktopLhr.audits['network-requests']?.details?.items?.length || 'N/A',
            numScripts: desktopLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Script').length || 'N/A',
            numStylesheets: desktopLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Stylesheet').length || 'N/A',
            numFonts: desktopLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Font').length || 'N/A',
            numImages: desktopLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Image').length || 'N/A',
            // Optimization Opportunities
            renderBlockingResources: desktopLhr.audits['render-blocking-resources']?.details?.items?.length || 0,
            unusedCss: desktopLhr.audits['unused-css-rules']?.displayValue || 'N/A',
            unusedJs: desktopLhr.audits['unused-javascript']?.displayValue || 'N/A',
            thirdPartySummary: desktopLhr.audits['third-party-summary']?.displayValue || 'N/A',
            redirects: desktopLhr.audits['redirects']?.details?.items?.length || 0,
            // Image Optimization
            modernImageFormats: desktopLhr.audits['modern-image-formats']?.displayValue || 'N/A',
            usesOptimizedImages: desktopLhr.audits['uses-optimized-images']?.displayValue || 'N/A',
            usesResponsiveImages: desktopLhr.audits['uses-responsive-images']?.displayValue || 'N/A',
            offscreenImages: desktopLhr.audits['offscreen-images']?.displayValue || 'N/A',
        };
    } catch (error) {
        results.desktop = { error: error.message };
    }

    // Mobile audit - full categories
    try {
        const { lhr: mobileLhr } = await lighthouse(url, {
            port: chromePort,
            output: 'json',
            onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
            logLevel: 'error',
            formFactor: 'mobile',
            screenEmulation: {
                mobile: true,
                width: 412,
                height: 823,
                deviceScaleFactor: 1.75,
                disabled: false,
            },
            throttling: {
                rttMs: 150,
                throughputKbps: 1638.4,
                cpuSlowdownMultiplier: 4,
            },
        });

        results.mobile = {
            // Category Scores
            performance: Math.round((mobileLhr.categories.performance?.score || 0) * 100),
            accessibility: Math.round((mobileLhr.categories.accessibility?.score || 0) * 100),
            bestPractices: Math.round((mobileLhr.categories['best-practices']?.score || 0) * 100),
            seo: Math.round((mobileLhr.categories.seo?.score || 0) * 100),
            // Core Web Vitals
            lcp: mobileLhr.audits['largest-contentful-paint']?.displayValue || 'N/A',
            cls: mobileLhr.audits['cumulative-layout-shift']?.displayValue || 'N/A',
            inp: mobileLhr.audits['interaction-to-next-paint']?.displayValue || 'N/A',
            fcp: mobileLhr.audits['first-contentful-paint']?.displayValue || 'N/A',
            tbt: mobileLhr.audits['total-blocking-time']?.displayValue || 'N/A',
            ttfb: mobileLhr.audits['server-response-time']?.displayValue || 'N/A',
            speedIndex: mobileLhr.audits['speed-index']?.displayValue || 'N/A',
            tti: mobileLhr.audits['interactive']?.displayValue || 'N/A',
            // Additional Performance Metrics
            maxPotentialFid: mobileLhr.audits['max-potential-fid']?.displayValue || 'N/A',
            totalByteWeight: mobileLhr.audits['total-byte-weight']?.displayValue || 'N/A',
            domSize: mobileLhr.audits['dom-size']?.displayValue || 'N/A',
            bootupTime: mobileLhr.audits['bootup-time']?.displayValue || 'N/A',
            mainthreadWork: mobileLhr.audits['mainthread-work-breakdown']?.displayValue || 'N/A',
            // Resource Counts
            numRequests: mobileLhr.audits['network-requests']?.details?.items?.length || 'N/A',
            numScripts: mobileLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Script').length || 'N/A',
            numStylesheets: mobileLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Stylesheet').length || 'N/A',
            numFonts: mobileLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Font').length || 'N/A',
            numImages: mobileLhr.audits['network-requests']?.details?.items?.filter(i => i.resourceType === 'Image').length || 'N/A',
            // Optimization Opportunities
            renderBlockingResources: mobileLhr.audits['render-blocking-resources']?.details?.items?.length || 0,
            unusedCss: mobileLhr.audits['unused-css-rules']?.displayValue || 'N/A',
            unusedJs: mobileLhr.audits['unused-javascript']?.displayValue || 'N/A',
            thirdPartySummary: mobileLhr.audits['third-party-summary']?.displayValue || 'N/A',
            redirects: mobileLhr.audits['redirects']?.details?.items?.length || 0,
            // Image Optimization
            modernImageFormats: mobileLhr.audits['modern-image-formats']?.displayValue || 'N/A',
            usesOptimizedImages: mobileLhr.audits['uses-optimized-images']?.displayValue || 'N/A',
            usesResponsiveImages: mobileLhr.audits['uses-responsive-images']?.displayValue || 'N/A',
            offscreenImages: mobileLhr.audits['offscreen-images']?.displayValue || 'N/A',
        };
    } catch (error) {
        results.mobile = { error: error.message };
    }

    return results;
}

// ============================================================================
// MAIN SITE AUDIT FUNCTION
// ============================================================================
async function crawlAndAuditSite(site, config = DEFAULT_CONFIG) {
    const siteUrl = new URL(site.url);
    const visited = new Set();
    const queue = [site.url];
    const allDiscoveredLinks = [];
    const results = {
        siteName: site.name,
        baseUrl: site.url,
        auditTimestamp: new Date().toISOString(),
        pages: [],
        siteLevel: {
            securityHeaders: null,
            canonicalization: null,
            http3Support: null,
            googleServices: null,
            wordpress: null,
            brokenLinks: null,
            apiEndpoints: null,
        },
    };

    // Launch Chrome for Lighthouse
    const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
    });

    // Launch Playwright browsers
    const chromiumBrowser = await chromium.launch({ headless: true });
    const webkitBrowser = await webkit.launch({ headless: true });
    const firefoxBrowser = await firefox.launch({ headless: true });

    console.log(`\n📊 Starting comprehensive audit for: ${site.name} (${site.url})`);

    // Run site-level checks first (only once per site)
    console.log(`  🔒 Checking security headers...`);
    results.siteLevel.securityHeaders = await checkSecurityHeaders(site.url);

    console.log(`  🔗 Checking URL canonicalization...`);
    results.siteLevel.canonicalization = await checkCanonicalUrl(site.url);

    console.log(`  ⚡ Checking HTTP/3 support...`);
    results.siteLevel.http3Support = await checkHttp3Support(site.url);

    // Test API endpoints
    results.siteLevel.apiEndpoints = await testApiEndpoints(site.url);

    // Crawl pages
    while (queue.length > 0 && results.pages.length < config.maxPagesPerSite) {
        const currentUrl = queue.shift();
        if (visited.has(currentUrl) || new URL(currentUrl).hostname !== siteUrl.hostname) {
            continue;
        }
        visited.add(currentUrl);
        console.log(`  [${results.pages.length + 1}/${config.maxPagesPerSite}] Auditing: ${currentUrl}`);

        try {
            // Run Lighthouse audits (desktop + mobile)
            const lighthouseResults = await runLighthouseAudits(currentUrl, chrome.port);

            // Run Playwright audits for console errors and links
            const [chromiumData, webkitData, firefoxData] = await Promise.all([
                runPageAudit(chromiumBrowser, currentUrl),
                runPageAudit(webkitBrowser, currentUrl),
                runPageAudit(firefoxBrowser, currentUrl),
            ]);

            // Run functional tests
            console.log(`  🧪 Running functional tests...`);
            const functionalTestResults = await runFunctionalTests(chromiumBrowser, currentUrl);

            // Collect all discovered links
            allDiscoveredLinks.push(...chromiumData.discoveredLinks);

            // Detect Google services and WordPress on first page only
            if (results.pages.length === 0) {
                const detectPage = await chromiumBrowser.newPage();
                let detectResponse = null;
                try {
                    // Use domcontentloaded instead of networkidle for faster detection on slow sites
                    detectResponse = await detectPage.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: config.pageTimeout });
                } catch (e) {
                    console.log(`  ⚠️ Detection page load incomplete: ${e.message}`);
                    // Still try to detect with whatever content loaded
                }

                try {
                    console.log(`  🔍 Detecting Google services...`);
                    results.siteLevel.googleServices = await detectGoogleServices(detectPage);
                } catch (e) {
                    console.error(`  Error detecting Google services: ${e.message}`);
                }

                try {
                    console.log(`  📝 Detecting CMS/WordPress...`);
                    // Create a mock response if navigation failed but page has content
                    const mockResponse = detectResponse || {
                        headers: () => ({}),
                        status: () => 200,
                    };
                    results.siteLevel.wordpress = await detectWordPress(detectPage, site.url, mockResponse);
                } catch (e) {
                    console.error(`  Error detecting CMS: ${e.message}`);
                }

                await detectPage.close();
            }

            results.pages.push({
                url: currentUrl,
                desktop: lighthouseResults.desktop,
                mobile: lighthouseResults.mobile,
                chromeErrors: chromiumData.consoleErrors,
                safariErrors: webkitData.consoleErrors,
                firefoxErrors: firefoxData.consoleErrors,
                networkAnalysis: {
                    failedRequests: chromiumData.networkData.failedRequests,
                    slowAssets: chromiumData.networkData.slowAssets,
                    totalRequests: chromiumData.networkData.totalRequests,
                },
                functionalTests: functionalTestResults,
            });

            // Add new links to queue
            chromiumData.discoveredLinks.forEach((link) => {
                try {
                    const parsedUrl = new URL(link, site.url);
                    if (parsedUrl.hash && parsedUrl.pathname === new URL(currentUrl).pathname) return;
                    if (['javascript:', 'mailto:', 'tel:'].includes(parsedUrl.protocol)) return;
                    const cleanUrl = parsedUrl.origin + parsedUrl.pathname + parsedUrl.search;
                    if (!visited.has(cleanUrl)) {
                        queue.push(cleanUrl);
                    }
                } catch {
                    // Skip invalid URLs
                }
            });
        } catch (error) {
            console.error(`  ❌ Failed to audit ${currentUrl}:`, error.message);
            results.pages.push({
                url: currentUrl,
                error: error.message,
                desktop: null,
                mobile: null,
                chromeErrors: [],
                safariErrors: [],
                firefoxErrors: [],
                networkAnalysis: { failedRequests: [], slowAssets: [], totalRequests: 0 },
                functionalTests: null,
            });
        }
    }

    // Check broken links (sample of discovered links)
    console.log(`  🔗 Checking for broken links...`);
    results.siteLevel.brokenLinks = await checkBrokenLinks(allDiscoveredLinks, site.url);

    // Cleanup
    try {
        await chromiumBrowser.close();
        await webkitBrowser.close();
        await firefoxBrowser.close();
        await chrome.kill();
    } catch (cleanupError) {
        console.error('Warning: Error during browser cleanup:', cleanupError.message);
    }

    console.log(`✅ Completed ${site.name}: ${results.pages.length} pages audited`);
    return results;
}

// ============================================================================
// HTML REPORT GENERATOR
// ============================================================================
function generateHtmlReport(data) {
    const timestamp = new Date().toLocaleString();
    const totalPages = data.reduce((acc, site) => acc + site.pages.length, 0);
    const totalErrors = data.reduce((acc, site) =>
        acc + site.pages.reduce((pAcc, p) =>
            pAcc + (p.chromeErrors?.length || 0) + (p.safariErrors?.length || 0) + (p.firefoxErrors?.length || 0), 0), 0);

    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Development Readiness Report v2.0</title>
        <style>
            * { box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f9; color: #333; }
            .container { max-width: 1400px; margin: 0 auto; }
            h1, h2, h3 { color: #444; }
            .header-info { color: #666; font-size: 14px; margin-bottom: 20px; }
            .stats { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 30px; }
            .stat-card { background: white; padding: 15px 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); min-width: 150px; }
            .stat-card h3 { margin: 0; font-size: 24px; }
            .stat-card p { margin: 5px 0 0; color: #666; font-size: 12px; }
            .tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
            .tab { padding: 10px 20px; background: #e0e0e0; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; }
            .tab.active { background: #007bff; color: white; }
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
            th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
            th { background-color: #007bff; color: white; position: sticky; top: 0; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .errors { color: #d9534f; }
            .no-errors { color: #5cb85c; }
            .perf-good { color: #5cb85c; font-weight: bold; }
            .perf-ok { color: #f0ad4e; font-weight: bold; }
            .perf-bad { color: #d9534f; font-weight: bold; }
            .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
            .badge-success { background: #d4edda; color: #155724; }
            .badge-warning { background: #fff3cd; color: #856404; }
            .badge-danger { background: #f8d7da; color: #721c24; }
            .badge-info { background: #d1ecf1; color: #0c5460; }
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
            .collapsible { cursor: pointer; padding: 10px; background: #f5f5f5; border: none; width: 100%; text-align: left; font-size: 14px; border-radius: 5px; margin-bottom: 5px; }
            .collapsible:hover { background: #e0e0e0; }
            .collapsible-content { display: none; padding: 10px; background: #fafafa; border-radius: 0 0 5px 5px; margin-bottom: 10px; }
            .check-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #eee; }
            .check-icon { font-size: 16px; }
            .scroll-table { overflow-x: auto; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔍 Development Readiness Report v2.0</h1>
            <p class="header-info">Generated: ${timestamp}</p>

            <div class="stats">
                <div class="stat-card"><h3>${data.length}</h3><p>Sites Audited</p></div>
                <div class="stat-card"><h3>${totalPages}</h3><p>Pages Scanned</p></div>
                <div class="stat-card"><h3 class="${totalErrors > 0 ? 'errors' : 'no-errors'}">${totalErrors}</h3><p>Console Errors</p></div>
            </div>`;

    // Site tabs
    html += `<div class="tabs">`;
    data.forEach((site, index) => {
        html += `<button class="tab ${index === 0 ? 'active' : ''}" onclick="showTab('site-${index}')">${site.siteName}</button>`;
    });
    html += `</div>`;

    // Site content
    data.forEach((site, index) => {
        const avgDesktopPerf = site.pages.reduce((acc, p) => acc + (p.desktop?.performance || 0), 0) / site.pages.length;
        const avgMobilePerf = site.pages.reduce((acc, p) => acc + (p.mobile?.performance || 0), 0) / site.pages.length;

        html += `<div id="site-${index}" class="tab-content ${index === 0 ? 'active' : ''}">`;

        // Summary cards
        html += `<div class="grid-2">`;

        // Performance Overview
        html += `<div class="card">
            <h3>📈 Performance Overview</h3>
            <div class="check-item">
                <span>Desktop Avg:</span>
                <span class="${avgDesktopPerf >= 90 ? 'perf-good' : avgDesktopPerf >= 50 ? 'perf-ok' : 'perf-bad'}">${avgDesktopPerf.toFixed(0)}</span>
            </div>
            <div class="check-item">
                <span>Mobile Avg:</span>
                <span class="${avgMobilePerf >= 90 ? 'perf-good' : avgMobilePerf >= 50 ? 'perf-ok' : 'perf-bad'}">${avgMobilePerf.toFixed(0)}</span>
            </div>
        </div>`;

        // Security Headers
        const secHeaders = site.siteLevel?.securityHeaders;
        html += `<div class="card">
            <h3>🔒 Security Headers</h3>
            <div class="check-item">
                <span>Score:</span>
                <span class="${(secHeaders?.score || 0) >= 80 ? 'perf-good' : (secHeaders?.score || 0) >= 50 ? 'perf-ok' : 'perf-bad'}">${secHeaders?.score || 0}%</span>
            </div>
            <div class="check-item">
                <span>Missing:</span>
                <span>${secHeaders?.missing?.join(', ') || 'None'}</span>
            </div>
        </div>`;

        // URL Canonicalization
        const canon = site.siteLevel?.canonicalization;
        html += `<div class="card">
            <h3>🔗 URL Canonicalization</h3>
            <div class="check-item">
                <span class="check-icon">${canon?.httpsRedirect ? '✅' : '❌'}</span>
                <span>HTTP → HTTPS Redirect</span>
            </div>
            <div class="check-item">
                <span class="check-icon">${canon?.wwwConsistency ? '✅' : '⚠️'}</span>
                <span>WWW Consistency</span>
            </div>
        </div>`;

        // HTTP/3 Support
        const http3 = site.siteLevel?.http3Support;
        html += `<div class="card">
            <h3>⚡ HTTP/3 Support</h3>
            <div class="check-item">
                <span class="check-icon">${http3?.supportsHttp3 ? '✅' : '❌'}</span>
                <span>QUIC/HTTP3 ${http3?.supportsHttp3 ? 'Supported' : 'Not Detected'}</span>
            </div>
            ${http3?.altSvc ? `<small>Alt-Svc: ${http3.altSvc.substring(0, 50)}...</small>` : ''}
        </div>`;

        // Google Services
        const google = site.siteLevel?.googleServices;
        html += `<div class="card">
            <h3>📊 Google Services</h3>
            <div class="check-item">
                <span class="check-icon">${google?.googleAnalytics?.detected ? '✅' : '❌'}</span>
                <span>Google Analytics ${google?.googleAnalytics?.version ? `(${google.googleAnalytics.version})` : ''}</span>
            </div>
            <div class="check-item">
                <span class="check-icon">${google?.googleTagManager?.detected ? '✅' : '❌'}</span>
                <span>Tag Manager ${google?.googleTagManager?.containerId || ''}</span>
            </div>
            <div class="check-item">
                <span class="check-icon">${google?.recaptcha?.detected ? '✅' : '❌'}</span>
                <span>reCAPTCHA ${google?.recaptcha?.version ? `(${google.recaptcha.version})` : ''}</span>
            </div>
        </div>`;

        // CMS Detection
        const wp = site.siteLevel?.wordpress;
        html += `<div class="card">
            <h3>📝 CMS Detection</h3>
            ${wp?.isWordPress ? `
                <div class="check-item">
                    <span class="badge badge-info">WordPress ${wp.version || ''}</span>
                </div>
                <div class="check-item">
                    <span class="check-icon">${wp.loginUrlProtected ? '✅' : '⚠️'}</span>
                    <span>Login URL ${wp.loginUrlProtected ? 'Protected' : 'Exposed'}</span>
                </div>
            ` : wp?.cms ? `
                <div class="check-item">
                    <span class="badge badge-info">${wp.cms}</span>
                </div>
            ` : `
                <div class="check-item">
                    <span>No CMS detected</span>
                </div>
            `}
        </div>`;

        // Broken Links
        const broken = site.siteLevel?.brokenLinks;
        html += `<div class="card">
            <h3>🔗 Broken Links</h3>
            <div class="check-item">
                <span>Checked:</span>
                <span>${broken?.checked || 0} links</span>
            </div>
            <div class="check-item">
                <span>Broken:</span>
                <span class="${(broken?.broken?.length || 0) > 0 ? 'errors' : 'no-errors'}">${broken?.broken?.length || 0}</span>
            </div>
        </div>`;

        // API Endpoints
        const apiEndpoints = site.siteLevel?.apiEndpoints;
        html += `<div class="card">
            <h3>🔌 API Endpoints</h3>
            <div class="check-item">
                <span>Tested:</span>
                <span>${apiEndpoints?.tested || 0} endpoints</span>
            </div>
            ${apiEndpoints?.errors?.length > 0 ? `
                <div class="check-item">
                    <span class="check-icon">❌</span>
                    <span class="errors">${apiEndpoints.errors.length} error(s)</span>
                </div>
                <details style="margin-top: 8px;"><summary style="cursor: pointer; color: #666;">View errors</summary>
                <ul style="font-size: 12px; margin-top: 5px;">
                    ${apiEndpoints.errors.map(e => `<li><code>${e}</code></li>`).join('')}
                </ul>
                </details>
            ` : `
                <div class="check-item">
                    <span class="check-icon">✅</span>
                    <span class="no-errors">No Error Detected</span>
                </div>
            `}
        </div>`;

        html += `</div>`; // End grid

        // Page Details Table
        html += `<div class="card">
            <h3>📄 Page Details</h3>
            <div class="scroll-table">
            <table>
                <tr>
                    <th>URL</th>
                    <th>Desktop Perf</th>
                    <th>Mobile Perf</th>
                    <th>Accessibility</th>
                    <th>SEO</th>
                    <th>Best Practices</th>
                    <th>Failed Requests</th>
                </tr>`;

        site.pages.forEach(page => {
            const desktopPerf = page.desktop?.performance || 0;
            const mobilePerf = page.mobile?.performance || 0;
            const accessibility = page.desktop?.accessibility || page.mobile?.accessibility || 0;
            const seo = page.desktop?.seo || page.mobile?.seo || 0;
            const bestPractices = page.desktop?.bestPractices || page.mobile?.bestPractices || 0;
            const failedRequests = page.networkAnalysis?.failedRequests?.length || 0;

            html += `
            <tr>
                <td><a href="${page.url}" target="_blank">${page.url.replace(site.baseUrl, '/') || '/'}</a></td>
                <td class="${desktopPerf >= 90 ? 'perf-good' : desktopPerf >= 50 ? 'perf-ok' : 'perf-bad'}">${page.error ? 'Error' : desktopPerf}</td>
                <td class="${mobilePerf >= 90 ? 'perf-good' : mobilePerf >= 50 ? 'perf-ok' : 'perf-bad'}">${page.error ? 'Error' : mobilePerf}</td>
                <td class="${accessibility >= 90 ? 'perf-good' : accessibility >= 50 ? 'perf-ok' : 'perf-bad'}">${accessibility}</td>
                <td class="${seo >= 90 ? 'perf-good' : seo >= 50 ? 'perf-ok' : 'perf-bad'}">${seo}</td>
                <td class="${bestPractices >= 90 ? 'perf-good' : bestPractices >= 50 ? 'perf-ok' : 'perf-bad'}">${bestPractices}</td>
                <td class="${failedRequests > 0 ? 'errors' : 'no-errors'}">${failedRequests}</td>
            </tr>`;
        });

        html += `</table></div></div>`;

        // Core Web Vitals & Performance Metrics Table
        html += `<div class="card">
            <h3>⚡ Core Web Vitals & Performance Metrics</h3>
            <div class="scroll-table">
            <table>
                <tr>
                    <th>URL</th>
                    <th>LCP</th>
                    <th>CLS</th>
                    <th>INP</th>
                    <th>FCP</th>
                    <th>TBT</th>
                    <th>TTFB</th>
                    <th>SI</th>
                    <th>TTI</th>
                </tr>`;

        site.pages.forEach(page => {
            const metrics = page.desktop || page.mobile || {};
            html += `
            <tr>
                <td><a href="${page.url}" target="_blank">${page.url.replace(site.baseUrl, '/') || '/'}</a></td>
                <td>${metrics.lcp || 'N/A'}</td>
                <td>${metrics.cls || 'N/A'}</td>
                <td>${metrics.inp || 'N/A'}</td>
                <td>${metrics.fcp || 'N/A'}</td>
                <td>${metrics.tbt || 'N/A'}</td>
                <td>${metrics.ttfb || 'N/A'}</td>
                <td>${metrics.speedIndex || 'N/A'}</td>
                <td>${metrics.tti || 'N/A'}</td>
            </tr>`;
        });

        html += `</table></div></div>`;

        // Additional Performance Metrics Table
        html += `<div class="card">
            <h3>📊 Additional Performance Metrics</h3>
            <div class="scroll-table">
            <table>
                <tr>
                    <th>URL</th>
                    <th>Max FID</th>
                    <th>Total Weight</th>
                    <th>DOM Size</th>
                    <th>JS Boot Time</th>
                    <th>Main Thread</th>
                </tr>`;

        site.pages.forEach(page => {
            const metrics = page.desktop || page.mobile || {};
            html += `
            <tr>
                <td><a href="${page.url}" target="_blank">${page.url.replace(site.baseUrl, '/') || '/'}</a></td>
                <td>${metrics.maxPotentialFid || 'N/A'}</td>
                <td>${metrics.totalByteWeight || 'N/A'}</td>
                <td>${metrics.domSize || 'N/A'}</td>
                <td>${metrics.bootupTime || 'N/A'}</td>
                <td>${metrics.mainthreadWork || 'N/A'}</td>
            </tr>`;
        });

        html += `</table></div></div>`;

        // Resource Summary Table
        html += `<div class="card">
            <h3>📦 Resource Summary</h3>
            <div class="scroll-table">
            <table>
                <tr>
                    <th>URL</th>
                    <th>Requests</th>
                    <th>Scripts</th>
                    <th>Stylesheets</th>
                    <th>Fonts</th>
                    <th>Images</th>
                    <th>Render Blocking</th>
                    <th>Redirects</th>
                </tr>`;

        site.pages.forEach(page => {
            const metrics = page.desktop || page.mobile || {};
            html += `
            <tr>
                <td><a href="${page.url}" target="_blank">${page.url.replace(site.baseUrl, '/') || '/'}</a></td>
                <td>${metrics.numRequests || 'N/A'}</td>
                <td>${metrics.numScripts || 'N/A'}</td>
                <td>${metrics.numStylesheets || 'N/A'}</td>
                <td>${metrics.numFonts || 'N/A'}</td>
                <td>${metrics.numImages || 'N/A'}</td>
                <td class="${(metrics.renderBlockingResources || 0) > 0 ? 'perf-bad' : 'perf-good'}">${metrics.renderBlockingResources || 0}</td>
                <td>${metrics.redirects || 0}</td>
            </tr>`;
        });

        html += `</table></div></div>`;

        // Optimization Opportunities Table
        html += `<div class="card">
            <h3>🎯 Optimization Opportunities</h3>
            <div class="scroll-table">
            <table>
                <tr>
                    <th>URL</th>
                    <th>Unused CSS</th>
                    <th>Unused JS</th>
                    <th>Third-Party Impact</th>
                    <th>Modern Images</th>
                    <th>Optimized Images</th>
                </tr>`;

        site.pages.forEach(page => {
            const metrics = page.desktop || page.mobile || {};
            html += `
            <tr>
                <td><a href="${page.url}" target="_blank">${page.url.replace(site.baseUrl, '/') || '/'}</a></td>
                <td>${metrics.unusedCss || 'N/A'}</td>
                <td>${metrics.unusedJs || 'N/A'}</td>
                <td>${metrics.thirdPartySummary || 'N/A'}</td>
                <td>${metrics.modernImageFormats || 'N/A'}</td>
                <td>${metrics.usesOptimizedImages || 'N/A'}</td>
            </tr>`;
        });

        html += `</table></div></div>`;

        // Functional Tests Results
        html += `<div class="card">
            <h3>🧪 Functional Tests</h3>`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            const ft = page.functionalTests;

            html += `<div style="margin-bottom: 15px; padding: 10px; background: #f9f9f9; border-radius: 5px;">
                <strong>${urlShort}</strong>`;

            if (ft) {
                const hasErrors = ft.linksTest?.errors?.length > 0 || ft.buttonsTest?.errors?.length > 0 ||
                                  ft.formsTest?.errors?.length > 0 || ft.imagesTest?.errors?.length > 0 ||
                                  ft.navigationTest?.errors?.length > 0 || ft.interactiveTest?.errors?.length > 0;

                html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 8px;">
                    <div class="check-item" style="border: none;">
                        <span class="check-icon">${ft.linksTest?.errors?.length > 0 ? '⚠️' : '✅'}</span>
                        <span>Links: ${ft.linksTest?.passed || 0} OK</span>
                    </div>
                    <div class="check-item" style="border: none;">
                        <span class="check-icon">${ft.buttonsTest?.errors?.length > 0 ? '⚠️' : '✅'}</span>
                        <span>Buttons: ${ft.buttonsTest?.passed || 0} OK</span>
                    </div>
                    <div class="check-item" style="border: none;">
                        <span class="check-icon">${ft.formsTest?.errors?.length > 0 ? '⚠️' : '✅'}</span>
                        <span>Forms: ${ft.formsTest?.passed || 0} OK</span>
                    </div>
                    <div class="check-item" style="border: none;">
                        <span class="check-icon">${ft.imagesTest?.errors?.length > 0 ? '⚠️' : '✅'}</span>
                        <span>Images: ${ft.imagesTest?.passed || 0} OK</span>
                    </div>
                    <div class="check-item" style="border: none;">
                        <span class="check-icon">${ft.navigationTest?.errors?.length > 0 ? '⚠️' : '✅'}</span>
                        <span>Navigation: ${ft.navigationTest?.passed || 0} OK</span>
                    </div>
                    <div class="check-item" style="border: none;">
                        <span class="check-icon">${ft.interactiveTest?.errors?.length > 0 ? '⚠️' : '✅'}</span>
                        <span>Interactive: ${ft.interactiveTest?.passed || 0} OK</span>
                    </div>
                </div>`;

                if (hasErrors) {
                    html += `<details style="margin-top: 8px;"><summary style="cursor: pointer; color: #666;">View test issues</summary><div style="padding: 10px; font-size: 12px;">`;
                    ['linksTest', 'buttonsTest', 'formsTest', 'imagesTest', 'navigationTest', 'interactiveTest'].forEach(testName => {
                        if (ft[testName]?.errors?.length > 0) {
                            html += `<div><strong>${testName.replace('Test', '')} issues:</strong><ul>`;
                            ft[testName].errors.slice(0, 3).forEach(err => {
                                html += `<li><code>${err}</code></li>`;
                            });
                            html += `</ul></div>`;
                        }
                    });
                    html += `</div></details>`;
                } else {
                    html += `<div style="margin-top: 5px; color: #5cb85c; font-size: 12px;">✅ No Error Detected</div>`;
                }
            } else {
                html += `<div style="margin-top: 8px; color: #666;">Functional tests not available</div>`;
            }

            html += `</div>`;
        });

        html += `</div>`;

        // Browser Console Error Testing
        html += `<div class="card">
            <h3>🌐 Browser Console Error Testing</h3>`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            html += `<div style="margin-bottom: 15px; padding: 10px; background: #f9f9f9; border-radius: 5px;">
                <strong>${urlShort}</strong>
                <div style="display: flex; gap: 20px; margin-top: 8px; flex-wrap: wrap;">`;

            // Chrome status
            const chromeHasErrors = page.chromeErrors && page.chromeErrors.length > 0;
            html += `<div class="check-item" style="border: none;">
                <span class="check-icon">${chromeHasErrors ? '❌' : '✅'}</span>
                <span><strong>Chrome (Chromium):</strong> ${chromeHasErrors ? `${page.chromeErrors.length} error(s) detected` : 'No Error Detected'}</span>
            </div>`;

            // Safari status
            const safariHasErrors = page.safariErrors && page.safariErrors.length > 0;
            html += `<div class="check-item" style="border: none;">
                <span class="check-icon">${safariHasErrors ? '❌' : '✅'}</span>
                <span><strong>Safari (WebKit):</strong> ${safariHasErrors ? `${page.safariErrors.length} error(s) detected` : 'No Error Detected'}</span>
            </div>`;

            // Firefox status
            const firefoxHasErrors = page.firefoxErrors && page.firefoxErrors.length > 0;
            html += `<div class="check-item" style="border: none;">
                <span class="check-icon">${firefoxHasErrors ? '❌' : '✅'}</span>
                <span><strong>Firefox (Gecko):</strong> ${firefoxHasErrors ? `${page.firefoxErrors.length} error(s) detected` : 'No Error Detected'}</span>
            </div>`;

            html += `</div>`;

            // Show error details if any
            if (chromeHasErrors || safariHasErrors || firefoxHasErrors) {
                html += `<details style="margin-top: 8px;"><summary style="cursor: pointer; color: #666;">View error details</summary><div style="padding: 10px; font-size: 12px;">`;
                if (chromeHasErrors) {
                    html += `<div><strong>Chrome (Chromium) errors:</strong><ul>`;
                    page.chromeErrors.slice(0, 3).forEach(err => {
                        html += `<li><code>${err.substring(0, 150)}${err.length > 150 ? '...' : ''}</code></li>`;
                    });
                    html += `</ul></div>`;
                }
                if (safariHasErrors) {
                    html += `<div><strong>Safari (WebKit) errors:</strong><ul>`;
                    page.safariErrors.slice(0, 3).forEach(err => {
                        html += `<li><code>${err.substring(0, 150)}${err.length > 150 ? '...' : ''}</code></li>`;
                    });
                    html += `</ul></div>`;
                }
                if (firefoxHasErrors) {
                    html += `<div><strong>Firefox (Gecko) errors:</strong><ul>`;
                    page.firefoxErrors.slice(0, 3).forEach(err => {
                        html += `<li><code>${err.substring(0, 150)}${err.length > 150 ? '...' : ''}</code></li>`;
                    });
                    html += `</ul></div>`;
                }
                html += `</div></details>`;
            }

            html += `</div>`;
        });

        html += `</div>`;
        html += `</div>`; // End tab content
    });

    html += `
        </div>
        <script>
            function showTab(tabId) {
                document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
                document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
                event.target.classList.add('active');
            }
        </script>
        <footer style="margin-top: 40px; padding: 20px; text-align: center; color: #666; font-size: 12px;">
            Generated by Development Readiness Monitor v2.0 | Powered by Lighthouse & Playwright
        </footer>
    </body></html>`;

    return html;
}

// ============================================================================
// MARKDOWN REPORT GENERATOR
// ============================================================================
function generateMarkdownReport(data) {
    const timestamp = new Date().toLocaleString();
    const totalPages = data.reduce((acc, site) => acc + site.pages.length, 0);
    const totalErrors = data.reduce((acc, site) =>
        acc + site.pages.reduce((pAcc, p) =>
            pAcc + (p.chromeErrors?.length || 0) + (p.safariErrors?.length || 0) + (p.firefoxErrors?.length || 0), 0), 0);

    let md = `# Development Readiness Report v2.0

**Generated:** ${timestamp}

---

## Summary

| Metric | Value |
|--------|-------|
| Sites Audited | ${data.length} |
| Pages Scanned | ${totalPages} |
| Console Errors | ${totalErrors} |

---

## Overall Site Summary

| Site | Desktop Perf | Mobile Perf | Security | SEO | Accessibility |
|------|-------------|-------------|----------|-----|---------------|
`;

    data.forEach(site => {
        const avgDesktop = site.pages.reduce((acc, p) => acc + (p.desktop?.performance || 0), 0) / site.pages.length;
        const avgMobile = site.pages.reduce((acc, p) => acc + (p.mobile?.performance || 0), 0) / site.pages.length;
        const avgSeo = site.pages.reduce((acc, p) => acc + (p.desktop?.seo || p.mobile?.seo || 0), 0) / site.pages.length;
        const avgA11y = site.pages.reduce((acc, p) => acc + (p.desktop?.accessibility || p.mobile?.accessibility || 0), 0) / site.pages.length;
        const secScore = site.siteLevel?.securityHeaders?.score || 0;

        md += `| ${site.siteName} | ${avgDesktop.toFixed(0)} | ${avgMobile.toFixed(0)} | ${secScore}% | ${avgSeo.toFixed(0)} | ${avgA11y.toFixed(0)} |\n`;
    });

    md += `\n---\n\n## Detailed Results\n`;

    data.forEach(site => {
        md += `\n### ${site.siteName}

**Base URL:** ${site.baseUrl}

#### Site-Level Checks

##### Security Headers
- **Score:** ${site.siteLevel?.securityHeaders?.score || 0}%
- **Missing Headers:** ${site.siteLevel?.securityHeaders?.missing?.join(', ') || 'None'}

##### URL Canonicalization
- **HTTPS Redirect:** ${site.siteLevel?.canonicalization?.httpsRedirect ? '✅ Yes' : '❌ No'}
- **WWW Consistency:** ${site.siteLevel?.canonicalization?.wwwConsistency ? '✅ Yes' : '⚠️ Check manually'}

##### HTTP/3 Support
- **QUIC/HTTP3:** ${site.siteLevel?.http3Support?.supportsHttp3 ? '✅ Supported' : '❌ Not detected'}

##### Google Services
- **Google Analytics:** ${site.siteLevel?.googleServices?.googleAnalytics?.detected ? `✅ Detected (${site.siteLevel.googleServices.googleAnalytics.version || 'Unknown'})` : '❌ Not detected'}
- **Tag Manager:** ${site.siteLevel?.googleServices?.googleTagManager?.detected ? `✅ ${site.siteLevel.googleServices.googleTagManager.containerId || ''}` : '❌ Not detected'}
- **reCAPTCHA:** ${site.siteLevel?.googleServices?.recaptcha?.detected ? `✅ ${site.siteLevel.googleServices.recaptcha.version || ''}` : '❌ Not detected'}

##### CMS Detection
${site.siteLevel?.wordpress?.isWordPress ? `- **WordPress:** ✅ Detected ${site.siteLevel.wordpress.version ? `(v${site.siteLevel.wordpress.version})` : ''}
- **Login Protected:** ${site.siteLevel.wordpress.loginUrlProtected ? '✅ Yes' : '⚠️ No'}` : site.siteLevel?.wordpress?.cms ? `- **CMS:** ${site.siteLevel.wordpress.cms}` : '- No CMS detected'}

##### Broken Links
- **Checked:** ${site.siteLevel?.brokenLinks?.checked || 0} links
- **Broken:** ${site.siteLevel?.brokenLinks?.broken?.length || 0}
${site.siteLevel?.brokenLinks?.broken?.length > 0 ? '\n**Broken URLs:**\n' + site.siteLevel.brokenLinks.broken.slice(0, 10).map(b => `- ${b.url} (${b.status || b.error})`).join('\n') : ''}

##### API Endpoints
- **Tested:** ${site.siteLevel?.apiEndpoints?.tested || 0} endpoints
${site.siteLevel?.apiEndpoints?.errors?.length > 0 ? `- **Errors:** ❌ ${site.siteLevel.apiEndpoints.errors.length} error(s) detected\n${site.siteLevel.apiEndpoints.errors.map(e => `  - \`${e}\``).join('\n')}` : '- **Status:** ✅ No Error Detected'}

#### Page Results

| URL | Desktop | Mobile | A11y | SEO | Best Pr. |
|-----|---------|--------|------|-----|----------|
`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            const desktopPerf = page.desktop?.performance || 0;
            const mobilePerf = page.mobile?.performance || 0;
            const a11y = page.desktop?.accessibility || page.mobile?.accessibility || 0;
            const seo = page.desktop?.seo || page.mobile?.seo || 0;
            const bp = page.desktop?.bestPractices || page.mobile?.bestPractices || 0;

            if (page.error) {
                md += `| ${urlShort} | Error | Error | - | - | - |\n`;
            } else {
                md += `| ${urlShort} | ${desktopPerf} | ${mobilePerf} | ${a11y} | ${seo} | ${bp} |\n`;
            }
        });

        // Core Web Vitals & Performance Metrics table
        md += `\n##### Core Web Vitals & Performance Metrics\n\n`;
        md += `| URL | LCP | CLS | INP | FCP | TBT | TTFB | SI | TTI |\n`;
        md += `|-----|-----|-----|-----|-----|-----|------|----|----||\n`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            if (page.error) {
                md += `| ${urlShort} | - | - | - | - | - | - | - | - |\n`;
            } else {
                const metrics = page.desktop || page.mobile || {};
                md += `| ${urlShort} | ${metrics.lcp || 'N/A'} | ${metrics.cls || 'N/A'} | ${metrics.inp || 'N/A'} | ${metrics.fcp || 'N/A'} | ${metrics.tbt || 'N/A'} | ${metrics.ttfb || 'N/A'} | ${metrics.speedIndex || 'N/A'} | ${metrics.tti || 'N/A'} |\n`;
            }
        });

        // Additional Performance Metrics table
        md += `\n##### Additional Performance Metrics\n\n`;
        md += `| URL | Max FID | Total Weight | DOM Size | JS Boot Time | Main Thread |\n`;
        md += `|-----|---------|--------------|----------|--------------|-------------|\n`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            if (page.error) {
                md += `| ${urlShort} | - | - | - | - | - |\n`;
            } else {
                const metrics = page.desktop || page.mobile || {};
                md += `| ${urlShort} | ${metrics.maxPotentialFid || 'N/A'} | ${metrics.totalByteWeight || 'N/A'} | ${metrics.domSize || 'N/A'} | ${metrics.bootupTime || 'N/A'} | ${metrics.mainthreadWork || 'N/A'} |\n`;
            }
        });

        // Resource Summary table
        md += `\n##### Resource Summary\n\n`;
        md += `| URL | Requests | Scripts | Stylesheets | Fonts | Images | Render Blocking | Redirects |\n`;
        md += `|-----|----------|---------|-------------|-------|--------|-----------------|----------|\n`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            if (page.error) {
                md += `| ${urlShort} | - | - | - | - | - | - | - |\n`;
            } else {
                const metrics = page.desktop || page.mobile || {};
                md += `| ${urlShort} | ${metrics.numRequests || 'N/A'} | ${metrics.numScripts || 'N/A'} | ${metrics.numStylesheets || 'N/A'} | ${metrics.numFonts || 'N/A'} | ${metrics.numImages || 'N/A'} | ${metrics.renderBlockingResources || 0} | ${metrics.redirects || 0} |\n`;
            }
        });

        // Optimization Opportunities table
        md += `\n##### Optimization Opportunities\n\n`;
        md += `| URL | Unused CSS | Unused JS | Third-Party Impact | Modern Images | Optimized Images |\n`;
        md += `|-----|------------|-----------|-------------------|---------------|------------------|\n`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            if (page.error) {
                md += `| ${urlShort} | - | - | - | - | - |\n`;
            } else {
                const metrics = page.desktop || page.mobile || {};
                md += `| ${urlShort} | ${metrics.unusedCss || 'N/A'} | ${metrics.unusedJs || 'N/A'} | ${metrics.thirdPartySummary || 'N/A'} | ${metrics.modernImageFormats || 'N/A'} | ${metrics.usesOptimizedImages || 'N/A'} |\n`;
            }
        });

        // Functional Tests Results
        md += `\n##### Functional Tests\n\n`;
        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            const ft = page.functionalTests;
            md += `**${urlShort}**\n`;

            if (ft) {
                const hasErrors = ft.linksTest?.errors?.length > 0 || ft.buttonsTest?.errors?.length > 0 ||
                                  ft.formsTest?.errors?.length > 0 || ft.imagesTest?.errors?.length > 0 ||
                                  ft.navigationTest?.errors?.length > 0 || ft.interactiveTest?.errors?.length > 0;

                md += `- **Links:** ${ft.linksTest?.errors?.length > 0 ? '⚠️' : '✅'} ${ft.linksTest?.passed || 0} passed\n`;
                md += `- **Buttons:** ${ft.buttonsTest?.errors?.length > 0 ? '⚠️' : '✅'} ${ft.buttonsTest?.passed || 0} passed\n`;
                md += `- **Forms:** ${ft.formsTest?.errors?.length > 0 ? '⚠️' : '✅'} ${ft.formsTest?.passed || 0} passed\n`;
                md += `- **Images:** ${ft.imagesTest?.errors?.length > 0 ? '⚠️' : '✅'} ${ft.imagesTest?.passed || 0} passed\n`;
                md += `- **Navigation:** ${ft.navigationTest?.errors?.length > 0 ? '⚠️' : '✅'} ${ft.navigationTest?.passed || 0} passed\n`;
                md += `- **Interactive:** ${ft.interactiveTest?.errors?.length > 0 ? '⚠️' : '✅'} ${ft.interactiveTest?.passed || 0} passed\n`;

                if (hasErrors) {
                    md += `\n**Issues Found:**\n`;
                    ['linksTest', 'buttonsTest', 'formsTest', 'imagesTest', 'navigationTest', 'interactiveTest'].forEach(testName => {
                        if (ft[testName]?.errors?.length > 0) {
                            ft[testName].errors.slice(0, 3).forEach(err => {
                                md += `  - ${testName.replace('Test', '')}: \`${err}\`\n`;
                            });
                        }
                    });
                } else {
                    md += `- **Overall:** ✅ No Error Detected\n`;
                }
            } else {
                md += `- Functional tests not available\n`;
            }
            md += `\n`;
        });

        // Browser Testing Results (Console Errors)
        md += `\n##### Browser Console Error Testing\n\n`;
        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            md += `**${urlShort}**\n`;

            // Chrome status
            if (!page.chromeErrors || page.chromeErrors.length === 0) {
                md += `- **Chrome (Chromium):** ✅ No Error Detected\n`;
            } else {
                md += `- **Chrome (Chromium):** ❌ ${page.chromeErrors.length} error(s) detected\n`;
                page.chromeErrors.slice(0, 3).forEach(err => {
                    md += `  - \`${err.substring(0, 100)}${err.length > 100 ? '...' : ''}\`\n`;
                });
            }

            // Safari status
            if (!page.safariErrors || page.safariErrors.length === 0) {
                md += `- **Safari (WebKit):** ✅ No Error Detected\n`;
            } else {
                md += `- **Safari (WebKit):** ❌ ${page.safariErrors.length} error(s) detected\n`;
                page.safariErrors.slice(0, 3).forEach(err => {
                    md += `  - \`${err.substring(0, 100)}${err.length > 100 ? '...' : ''}\`\n`;
                });
            }

            // Firefox status
            if (!page.firefoxErrors || page.firefoxErrors.length === 0) {
                md += `- **Firefox (Gecko):** ✅ No Error Detected\n`;
            } else {
                md += `- **Firefox (Gecko):** ❌ ${page.firefoxErrors.length} error(s) detected\n`;
                page.firefoxErrors.slice(0, 3).forEach(err => {
                    md += `  - \`${err.substring(0, 100)}${err.length > 100 ? '...' : ''}\`\n`;
                });
            }
            md += `\n`;
        });

        // Network issues
        const pagesWithNetworkIssues = site.pages.filter(p =>
            (p.networkAnalysis?.failedRequests?.length > 0) || (p.networkAnalysis?.slowAssets?.length > 0));

        if (pagesWithNetworkIssues.length > 0) {
            md += `\n#### Network Issues\n\n`;
            pagesWithNetworkIssues.forEach(page => {
                const urlShort = page.url.replace(site.baseUrl, '/') || '/';
                if (page.networkAnalysis?.failedRequests?.length > 0) {
                    md += `**${urlShort}** - Failed Requests:\n`;
                    page.networkAnalysis.failedRequests.slice(0, 5).forEach(req => {
                        md += `- ${req.status}: ${req.url.substring(0, 80)}...\n`;
                    });
                }
            });
        }

    });

    md += `\n---\n\n## Score Guide

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
`;

    return md;
}

// ============================================================================
// HISTORICAL TRACKING
// ============================================================================
async function saveToHistory(data) {
    if (!argv.history) return;

    const historyDir = DEFAULT_CONFIG.historyDir;
    await fs.ensureDir(historyDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-${timestamp}.json`;

    await fs.writeJson(path.join(historyDir, filename), data, { spaces: 2 });
    console.log(`📁 Historical data saved to ${path.join(historyDir, filename)}`);
}

async function getHistoricalTrend(siteName) {
    const historyDir = DEFAULT_CONFIG.historyDir;
    if (!await fs.pathExists(historyDir)) return null;

    const files = await fs.readdir(historyDir);
    const auditFiles = files.filter(f => f.startsWith('audit-') && f.endsWith('.json')).sort().slice(-10);

    const trends = [];
    for (const file of auditFiles) {
        const data = await fs.readJson(path.join(historyDir, file));
        const siteData = data.find(s => s.siteName === siteName);
        if (siteData) {
            const avgPerf = siteData.pages.reduce((acc, p) => acc + (p.desktop?.performance || 0), 0) / siteData.pages.length;
            trends.push({
                date: file.replace('audit-', '').replace('.json', ''),
                performance: avgPerf,
            });
        }
    }

    return trends;
}

// ============================================================================
// CONCURRENT AUDIT RUNNER
// ============================================================================
async function runConcurrentAudits(sites, concurrency = 1) {
    const results = [];

    // For simplicity, run sequentially if concurrency is 1
    if (concurrency === 1) {
        for (const site of sites) {
            try {
                const report = await crawlAndAuditSite(site);
                results.push(report);
            } catch (error) {
                console.error(`❌ Failed to audit ${site.name}:`, error.message);
                results.push({
                    siteName: site.name,
                    baseUrl: site.url,
                    pages: [{ url: site.url, error: error.message }],
                    siteLevel: {},
                });
            }
        }
        return results;
    }

    // Run with concurrency (simplified - batch processing)
    const batches = [];
    for (let i = 0; i < sites.length; i += concurrency) {
        batches.push(sites.slice(i, i + concurrency));
    }

    for (const batch of batches) {
        const batchResults = await Promise.all(
            batch.map(async site => {
                try {
                    return await crawlAndAuditSite(site);
                } catch (error) {
                    console.error(`❌ Failed to audit ${site.name}:`, error.message);
                    return {
                        siteName: site.name,
                        baseUrl: site.url,
                        pages: [{ url: site.url, error: error.message }],
                        siteLevel: {},
                    };
                }
            })
        );
        results.push(...batchResults);
    }

    return results;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function runAudit() {
    try {
        let sites;

        // Determine sites to audit
        if (argv.site) {
            sites = [{
                name: argv.name || new URL(argv.site).hostname,
                url: argv.site,
            }];
        } else if (argv.config) {
            sites = await fs.readJson(argv.config);
        } else {
            sites = await fs.readJson(DEFAULT_CONFIG.sitesFile);
        }

        console.log(`\n🚀 Starting Development Readiness Audit v2.0 for ${sites.length} site(s)...\n`);
        console.log(`📋 Features enabled: Mobile audits, Security headers, Google detection, CMS detection, Broken links\n`);

        // Run audits
        const allReports = await runConcurrentAudits(sites, argv.concurrency);

        // Write JSON report
        await fs.ensureDir(DEFAULT_CONFIG.reportsDir);
        await fs.outputJson('./reports/report-data.json', allReports, { spaces: 2 });
        console.log('\n✅ Data saved to reports/report-data.json');

        // Generate HTML report
        const htmlReport = generateHtmlReport(allReports);
        await fs.writeFile('./reports/dashboard.html', htmlReport);
        console.log('✅ HTML report: reports/dashboard.html');

        // Generate Markdown report
        const mdReport = generateMarkdownReport(allReports);
        await fs.writeFile('./reports/report.md', mdReport);
        console.log('✅ Markdown report: reports/report.md');

        // Save to history
        await saveToHistory(allReports);

        console.log('\n🎉 Audit complete!\n');

    } catch (error) {
        console.error('❌ An error occurred during the audit process:', error);
        process.exit(1);
    }
}

// ============================================================================
// SCHEDULED EXECUTION
// ============================================================================
if (argv.schedule) {
    console.log(`⏰ Scheduling audits with cron: ${argv.schedule}`);

    if (!cron.validate(argv.schedule)) {
        console.error('❌ Invalid cron expression');
        process.exit(1);
    }

    cron.schedule(argv.schedule, () => {
        console.log(`\n⏰ Running scheduled audit at ${new Date().toISOString()}`);
        runAudit();
    });

    console.log('📅 Scheduler started. Waiting for next run...');
} else {
    // Run immediately
    runAudit();
}
