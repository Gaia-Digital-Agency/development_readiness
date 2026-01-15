const { chromium, webkit } = require('playwright');
const lighthouse = require('lighthouse/core/index.cjs');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs-extra');
const { URL } = require('url');

// Configuration
const MAX_PAGES_PER_SITE = 20;  // Limit pages to crawl per site
const PAGE_TIMEOUT = 30000;     // 30 second timeout for page loads

async function runPageAudit(browser, url) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT });
    } catch (error) {
        // Log goto error and continue
        console.error(`Error navigating to ${url}: ${error.message}`);
        // Return empty errors and links, but add a specific error message
        return { consoleErrors: [`Navigation failed: ${error.message}`], discoveredLinks: [] };
    }
    

    const links = await page.$$eval('a[href]', (anchors) =>
        anchors.map((anchor) => anchor.href)
    );

    await page.close();
    return { consoleErrors, discoveredLinks: links };
}

async function crawlAndAuditSite(site) {
    const siteUrl = new URL(site.url);
    const visited = new Set();
    const queue = [site.url];
    const results = {
        siteName: site.name,
        baseUrl: site.url,
        pages: [],
    };

    // Launch Chrome for Lighthouse using chrome-launcher
    const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
    });

    // Launch Playwright browsers for console error capture
    const chromiumBrowser = await chromium.launch({ headless: true });
    const webkitBrowser = await webkit.launch({ headless: true });

    console.log(`\n📊 Starting audit for: ${site.name} (${site.url})`);

    while (queue.length > 0 && results.pages.length < MAX_PAGES_PER_SITE) {
        const currentUrl = queue.shift();
        if (visited.has(currentUrl) || new URL(currentUrl).hostname !== siteUrl.hostname) {
            continue;
        }
        visited.add(currentUrl);
        console.log(`  [${results.pages.length + 1}/${MAX_PAGES_PER_SITE}] Auditing: ${currentUrl}`);

        try {
            // Run Lighthouse audit using chrome-launcher's port
            const { lhr } = await lighthouse(currentUrl, {
                port: chrome.port,
                output: 'json',
                onlyCategories: ['performance'],
                logLevel: 'error',  // Reduce console noise
            });

            // Run Playwright audit for console errors and links
            const [chromiumData, webkitData] = await Promise.all([
                runPageAudit(chromiumBrowser, currentUrl),
                runPageAudit(webkitBrowser, currentUrl),
            ]);

            results.pages.push({
                url: currentUrl,
                performance: lhr.categories.performance.score * 100,
                lcp: lhr.audits['largest-contentful-paint']?.displayValue || 'N/A',
                cls: lhr.audits['cumulative-layout-shift']?.displayValue || 'N/A',
                inp: lhr.audits['interaction-to-next-paint']?.displayValue || 'N/A',
                chromeErrors: chromiumData.consoleErrors,
                safariErrors: webkitData.consoleErrors,
            });

            // Add new, unvisited links to the queue (skip hash-only links and anchors)
            chromiumData.discoveredLinks.forEach((link) => {
                try {
                    const parsedUrl = new URL(link, site.url);
                    // Skip hash-only navigations and javascript: links
                    if (parsedUrl.hash && parsedUrl.pathname === new URL(currentUrl).pathname) {
                        return; // Skip same-page anchor links
                    }
                    if (parsedUrl.protocol === 'javascript:' || parsedUrl.protocol === 'mailto:' || parsedUrl.protocol === 'tel:') {
                        return; // Skip non-http links
                    }
                    const cleanUrl = parsedUrl.origin + parsedUrl.pathname + parsedUrl.search;
                    if (!visited.has(cleanUrl)) {
                        queue.push(cleanUrl);
                    }
                } catch {
                    // Skip invalid URLs
                }
            });

        } catch (error) {
            console.error(`Failed to audit ${currentUrl}:`, error);
            results.pages.push({
                url: currentUrl,
                error: error.message,
                chromeErrors: [], // ensure these fields exist even on error
                safariErrors: []  // ensure these fields exist even on error
            });
        }
    }

    // Cleanup browsers
    try {
        await chromiumBrowser.close();
        await webkitBrowser.close();
        await chrome.kill();
    } catch (cleanupError) {
        console.error('Warning: Error during browser cleanup:', cleanupError.message);
    }

    console.log(`✅ Completed ${site.name}: ${results.pages.length} pages audited`);
    return results;
}

function generateHtmlReport(data) {
    const timestamp = new Date().toLocaleString();
    const totalPages = data.reduce((acc, site) => acc + site.pages.length, 0);
    const totalErrors = data.reduce((acc, site) =>
        acc + site.pages.reduce((pAcc, p) =>
            pAcc + (p.chromeErrors?.length || 0) + (p.safariErrors?.length || 0), 0), 0);

    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Development Readiness Report</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background-color: #f4f4f9; color: #333; }
            h1, h2 { color: #444; }
            .header-info { color: #666; font-size: 14px; margin-bottom: 20px; }
            .stats { display: flex; gap: 20px; margin-bottom: 20px; }
            .stat-card { background: white; padding: 15px 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .stat-card h3 { margin: 0; font-size: 24px; }
            .stat-card p { margin: 5px 0 0; color: #666; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            th, td { padding: 12px; border: 1px solid #ddd; text-align: left; }
            th { background-color: #007bff; color: white; }
            tr:nth-child(even) { background-color: #f2f2f2; }
            .site-summary { background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .errors { color: #d9534f; }
            .no-errors { color: #5cb85c; }
            .perf-good { color: #5cb85c; font-weight: bold; }
            .perf-ok { color: #f0ad4e; font-weight: bold; }
            .perf-bad { color: #d9534f; font-weight: bold; }
            a { color: #007bff; }
        </style>
    </head>
    <body>
        <h1>Development Readiness Report</h1>
        <p class="header-info">Generated: ${timestamp}</p>
        <div class="stats">
            <div class="stat-card"><h3>${data.length}</h3><p>Sites Audited</p></div>
            <div class="stat-card"><h3>${totalPages}</h3><p>Pages Scanned</p></div>
            <div class="stat-card"><h3 class="${totalErrors > 0 ? 'errors' : 'no-errors'}">${totalErrors}</h3><p>Console Errors</p></div>
        </div>`;

    // Summary Table
    html += `<h2>Overall Site Summary</h2><div class="site-summary"><table>
        <tr><th>Site Name</th><th>Average Performance</th></tr>`;
    data.forEach(site => {
        const avgPerf = site.pages.reduce((acc, p) => acc + (p.performance || 0), 0) / site.pages.length;
        html += `<tr><td>${site.siteName}</td><td class="${avgPerf >= 90 ? 'perf-good' : avgPerf >= 50 ? 'perf-ok' : 'perf-bad'}">${avgPerf.toFixed(2)}</td></tr>`;
    });
    html += `</table></div>`;

    // Detailed Reports
    data.forEach(site => {
        html += `<h2>${site.siteName}</h2>`;
        html += `<table>
            <tr>
                <th>URL</th>
                <th>Performance</th>
                <th>LCP</th>
                <th>CLS</th>
                <th>INP</th>
                <th>Chrome Errors</th>
                <th>Safari Errors</th>
            </tr>`;
        site.pages.forEach(page => {
            const perfScore = page.performance || 0;
            html += `
            <tr>
                <td><a href="${page.url}" target="_blank">${page.url}</a></td>
                <td class="${perfScore >= 90 ? 'perf-good' : perfScore >= 50 ? 'perf-ok' : 'perf-bad'}">${page.error ? 'Error' : perfScore.toFixed(2)}</td>
                <td>${page.lcp || 'N/A'}</td>
                <td>${page.cls || 'N/A'}</td>
                <td>${page.inp || 'N/A'}</td>
                <td class="${page.chromeErrors.length > 0 ? 'errors' : 'no-errors'}">${page.chromeErrors.length}</td>
                <td class="${page.safariErrors.length > 0 ? 'errors' : 'no-errors'}">${page.safariErrors.length}</td>
            </tr>`;
             if (page.error) {
                html += `<tr><td colspan="7" class="errors"><strong>Error:</strong> ${page.error}</td></tr>`;
            }
        });
        html += `</table>`;
    });

    html += `
        <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
            <p>Generated by Development Readiness Monitor | Powered by Lighthouse & Playwright</p>
        </footer>
    </body></html>`;
    return html;
}

function generateMarkdownReport(data) {
    const timestamp = new Date().toLocaleString();
    const totalPages = data.reduce((acc, site) => acc + site.pages.length, 0);
    const totalErrors = data.reduce((acc, site) =>
        acc + site.pages.reduce((pAcc, p) =>
            pAcc + (p.chromeErrors?.length || 0) + (p.safariErrors?.length || 0), 0), 0);

    let md = `# Development Readiness Report

**Generated:** ${timestamp}

---

## Summary

| Metric | Value |
|--------|-------|
| Sites Audited | ${data.length} |
| Pages Scanned | ${totalPages} |
| Console Errors | ${totalErrors} |

---

## Overall Site Performance

| Site Name | Avg Performance | Status |
|-----------|-----------------|--------|
`;

    data.forEach(site => {
        const avgPerf = site.pages.reduce((acc, p) => acc + (p.performance || 0), 0) / site.pages.length;
        const status = avgPerf >= 90 ? 'Good' : avgPerf >= 50 ? 'Needs Work' : 'Poor';
        md += `| ${site.siteName} | ${avgPerf.toFixed(2)} | ${status} |\n`;
    });

    md += `\n---\n\n## Detailed Results\n`;

    data.forEach(site => {
        const avgPerf = site.pages.reduce((acc, p) => acc + (p.performance || 0), 0) / site.pages.length;
        const siteErrors = site.pages.reduce((acc, p) =>
            acc + (p.chromeErrors?.length || 0) + (p.safariErrors?.length || 0), 0);

        md += `\n### ${site.siteName}

- **Base URL:** ${site.baseUrl}
- **Pages Audited:** ${site.pages.length}
- **Average Performance:** ${avgPerf.toFixed(2)}
- **Total Console Errors:** ${siteErrors}

| URL | Perf | LCP | CLS | INP | Chrome Errors | Safari Errors |
|-----|------|-----|-----|-----|---------------|---------------|
`;

        site.pages.forEach(page => {
            const perfScore = page.performance || 0;
            const urlShort = page.url.replace(site.baseUrl, '/') || '/';
            if (page.error) {
                md += `| ${urlShort} | Error | - | - | - | - | - |\n`;
            } else {
                md += `| ${urlShort} | ${perfScore.toFixed(0)} | ${page.lcp || 'N/A'} | ${page.cls || 'N/A'} | ${page.inp || 'N/A'} | ${page.chromeErrors.length} | ${page.safariErrors.length} |\n`;
            }
        });

        // List errors if any
        const pagesWithErrors = site.pages.filter(p =>
            (p.chromeErrors?.length > 0) || (p.safariErrors?.length > 0));

        if (pagesWithErrors.length > 0) {
            md += `\n**Console Errors Found:**\n\n`;
            pagesWithErrors.forEach(page => {
                const urlShort = page.url.replace(site.baseUrl, '/') || '/';
                if (page.chromeErrors?.length > 0) {
                    md += `- **${urlShort}** (Chrome):\n`;
                    page.chromeErrors.forEach(err => {
                        md += `  - \`${err.substring(0, 100)}${err.length > 100 ? '...' : ''}\`\n`;
                    });
                }
                if (page.safariErrors?.length > 0) {
                    md += `- **${urlShort}** (Safari):\n`;
                    page.safariErrors.forEach(err => {
                        md += `  - \`${err.substring(0, 100)}${err.length > 100 ? '...' : ''}\`\n`;
                    });
                }
            });
        }
    });

    md += `\n---\n\n## Performance Score Guide

| Score | Rating | Description |
|-------|--------|-------------|
| 90-100 | Good | Page is well optimized |
| 50-89 | Needs Work | Page has optimization opportunities |
| 0-49 | Poor | Page has significant performance issues |

## Core Web Vitals

- **LCP (Largest Contentful Paint):** Measures loading performance. Should be under 2.5s.
- **CLS (Cumulative Layout Shift):** Measures visual stability. Should be under 0.1.
- **INP (Interaction to Next Paint):** Measures interactivity. Should be under 200ms.

---

*Generated by Development Readiness Monitor | Powered by Lighthouse & Playwright*
`;

    return md;
}

(async () => {
    try {
        const sites = await fs.readJson('./data/sites.json');
        const allReports = [];

        console.log(`\n🚀 Starting Development Readiness Audit for ${sites.length} sites...\n`);

        // Run site audits sequentially to avoid Lighthouse race conditions
        for (const site of sites) {
            try {
                const report = await crawlAndAuditSite(site);
                allReports.push(report);
            } catch (siteError) {
                console.error(`❌ Failed to audit ${site.name}:`, siteError.message);
                allReports.push({
                    siteName: site.name,
                    baseUrl: site.url,
                    pages: [{
                        url: site.url,
                        error: siteError.message,
                        chromeErrors: [],
                        safariErrors: []
                    }]
                });
            }
        }

        // Write JSON report
        await fs.outputJson('./reports/report-data.json', allReports, { spaces: 2 });
        console.log('\n✅ Site audits complete. Data saved to reports/report-data.json');

        // Generate and write HTML report
        const htmlReport = generateHtmlReport(allReports);
        await fs.writeFile('./reports/dashboard.html', htmlReport);
        console.log('✅ HTML report generated at reports/dashboard.html');

        // Generate and write Markdown report
        const mdReport = generateMarkdownReport(allReports);
        await fs.writeFile('./reports/report.md', mdReport);
        console.log('✅ Markdown report generated at reports/report.md');

    } catch (error) {
        console.error('❌ An error occurred during the audit process:', error);
    }
})();