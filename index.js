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

        const wappalyzerResult = await wappalyzer({ url, html, statusCode, headers });

        const wordpress = wappalyzerResult.applications.find(app => app.name === 'WordPress');
        if (wordpress) {
            results.isWordPress = true;
            results.version = wordpress.version;
            results.detectionMethods.push('wappalyzer');
        }

        const cms = wappalyzerResult.applications.find(app => app.categories.some(cat => Object.values(cat).includes('CMS')));
        if(cms) {
            results.cms = cms.name;
        }


        // Check if WordPress login URL is accessible
        if (results.isWordPress) {
            const loginUrls = ['/wp-login.php', '/wp-admin/'];
            for (const loginPath of loginUrls) {
                try {
                    const loginUrl = new URL(loginPath, baseUrl).href;
                    const response = await fetch(loginUrl, { redirect: 'manual' });

                    if (response.status === 200) {
                        results.loginUrlProtected = false;
                    } else if (response.status === 403 || response.status === 404 ||
                        (response.status >= 300 && response.status < 400)) {
                        results.loginUrlProtected = true;
                    }
                    break;
                } catch (e) {
                    // Login URL check failed
                }
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

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: DEFAULT_CONFIG.pageTimeout });
    } catch (error) {
        console.error(`Error navigating to ${url}: ${error.message}`);
        await page.close();
        return { consoleErrors: [`Navigation failed: ${error.message}`], discoveredLinks: [], networkData };
    }

    const links = await page.$$eval('a[href]', (anchors) =>
        anchors.map((anchor) => anchor.href)
    );

    await page.close();
    return { consoleErrors, discoveredLinks: links, networkData };
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
            performance: Math.round((desktopLhr.categories.performance?.score || 0) * 100),
            accessibility: Math.round((desktopLhr.categories.accessibility?.score || 0) * 100),
            bestPractices: Math.round((desktopLhr.categories['best-practices']?.score || 0) * 100),
            seo: Math.round((desktopLhr.categories.seo?.score || 0) * 100),
            lcp: desktopLhr.audits['largest-contentful-paint']?.displayValue || 'N/A',
            cls: desktopLhr.audits['cumulative-layout-shift']?.displayValue || 'N/A',
            inp: desktopLhr.audits['interaction-to-next-paint']?.displayValue || 'N/A',
            fcp: desktopLhr.audits['first-contentful-paint']?.displayValue || 'N/A',
            tbt: desktopLhr.audits['total-blocking-time']?.displayValue || 'N/A',
            speedIndex: desktopLhr.audits['speed-index']?.displayValue || 'N/A',
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
            performance: Math.round((mobileLhr.categories.performance?.score || 0) * 100),
            accessibility: Math.round((mobileLhr.categories.accessibility?.score || 0) * 100),
            bestPractices: Math.round((mobileLhr.categories['best-practices']?.score || 0) * 100),
            seo: Math.round((mobileLhr.categories.seo?.score || 0) * 100),
            lcp: mobileLhr.audits['largest-contentful-paint']?.displayValue || 'N/A',
            cls: mobileLhr.audits['cumulative-layout-shift']?.displayValue || 'N/A',
            inp: mobileLhr.audits['interaction-to-next-paint']?.displayValue || 'N/A',
            fcp: mobileLhr.audits['first-contentful-paint']?.displayValue || 'N/A',
            tbt: mobileLhr.audits['total-blocking-time']?.displayValue || 'N/A',
            speedIndex: mobileLhr.audits['speed-index']?.displayValue || 'N/A',
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

            // Collect all discovered links
            allDiscoveredLinks.push(...chromiumData.discoveredLinks);

            // Detect Google services and WordPress on first page only
            if (results.pages.length === 0) {
                const detectPage = await chromiumBrowser.newPage();
                try {
                    const response = await detectPage.goto(currentUrl, { waitUntil: 'networkidle', timeout: config.pageTimeout });
                    console.log(`  🔍 Detecting Google services...`);
                    results.siteLevel.googleServices = await detectGoogleServices(detectPage);
                    console.log(`  📝 Detecting CMS/WordPress...`);
                    results.siteLevel.wordpress = await detectWordPress(detectPage, site.url, response);
                } catch (e) {
                    console.error(`  Error detecting services: ${e.message}`);
                } finally {
                    await detectPage.close();
                }
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
                    <th>LCP</th>
                    <th>CLS</th>
                    <th>Errors</th>
                    <th>Failed Requests</th>
                </tr>`;

        site.pages.forEach(page => {
            const desktopPerf = page.desktop?.performance || 0;
            const mobilePerf = page.mobile?.performance || 0;
            const accessibility = page.desktop?.accessibility || page.mobile?.accessibility || 0;
            const seo = page.desktop?.seo || page.mobile?.seo || 0;
            const bestPractices = page.desktop?.bestPractices || page.mobile?.bestPractices || 0;
            const totalErrors = (page.chromeErrors?.length || 0) + (page.safariErrors?.length || 0) + (page.firefoxErrors?.length || 0);
            const failedRequests = page.networkAnalysis?.failedRequests?.length || 0;

            html += `
            <tr>
                <td><a href="${page.url}" target="_blank">${page.url.replace(site.baseUrl, '/') || '/'}</a></td>
                <td class="${desktopPerf >= 90 ? 'perf-good' : desktopPerf >= 50 ? 'perf-ok' : 'perf-bad'}">${page.error ? 'Error' : desktopPerf}</td>
                <td class="${mobilePerf >= 90 ? 'perf-good' : mobilePerf >= 50 ? 'perf-ok' : 'perf-bad'}">${page.error ? 'Error' : mobilePerf}</td>
                <td class="${accessibility >= 90 ? 'perf-good' : accessibility >= 50 ? 'perf-ok' : 'perf-bad'}">${accessibility}</td>
                <td class="${seo >= 90 ? 'perf-good' : seo >= 50 ? 'perf-ok' : 'perf-bad'}">${seo}</td>
                <td class="${bestPractices >= 90 ? 'perf-good' : bestPractices >= 50 ? 'perf-ok' : 'perf-bad'}">${bestPractices}</td>
                <td>${page.desktop?.lcp || page.mobile?.lcp || 'N/A'}</td>
                <td>${page.desktop?.cls || page.mobile?.cls || 'N/A'}</td>
                <td class="${totalErrors > 0 ? 'errors' : 'no-errors'}">${totalErrors}</td>
                <td class="${failedRequests > 0 ? 'errors' : 'no-errors'}">${failedRequests}</td>
            </tr>`;
        });

        html += `</table></div></div>`;
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

#### Page Results

| URL | Desktop | Mobile | A11y | SEO | Best Pr. | LCP | CLS | Errors |
|-----|---------|--------|------|-----|----------|-----|-----|--------|
`;

        site.pages.forEach(page => {
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            const desktopPerf = page.desktop?.performance || 0;
            const mobilePerf = page.mobile?.performance || 0;
            const a11y = page.desktop?.accessibility || page.mobile?.accessibility || 0;
            const seo = page.desktop?.seo || page.mobile?.seo || 0;
            const bp = page.desktop?.bestPractices || page.mobile?.bestPractices || 0;
            const totalErrors = (page.chromeErrors?.length || 0) + (page.safariErrors?.length || 0) + (page.firefoxErrors?.length || 0);

            if (page.error) {
                md += `| ${urlShort} | Error | Error | - | - | - | - | - | - |\n`;
            } else {
                md += `| ${urlShort} | ${desktopPerf} | ${mobilePerf} | ${a11y} | ${seo} | ${bp} | ${page.desktop?.lcp || 'N/A'} | ${page.desktop?.cls || 'N/A'} | ${totalErrors} |\n`;
            }
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

        // Console errors
        const pagesWithErrors = site.pages.filter(p =>
            (p.chromeErrors?.length > 0) || (p.safariErrors?.length > 0) || (p.firefoxErrors?.length > 0));

        if (pagesWithErrors.length > 0) {
            md += `\n#### Console Errors\n\n`;
            pagesWithErrors.forEach(page => {
                const urlShort = page.url.replace(site.baseUrl, '/') || '/';
                if (page.chromeErrors?.length > 0) {
                    md += `**${urlShort}** (Chrome):\n`;
                    page.chromeErrors.slice(0, 3).forEach(err => {
                        md += `- \`${err.substring(0, 100)}${err.length > 100 ? '...' : ''}\`\n`;
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
- **LCP (Largest Contentful Paint):** Should be < 2.5s
- **CLS (Cumulative Layout Shift):** Should be < 0.1
- **INP (Interaction to Next Paint):** Should be < 200ms

### Security Headers
- **Content-Security-Policy:** Prevents XSS attacks
- **Strict-Transport-Security:** Enforces HTTPS
- **X-Frame-Options:** Prevents clickjacking
- **X-Content-Type-Options:** Prevents MIME sniffing

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
