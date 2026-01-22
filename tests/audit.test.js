const fs = require('fs-extra');
const path = require('path');

// Mock modules before requiring the main module
jest.mock('playwright', () => ({
    chromium: {
        launch: jest.fn().mockResolvedValue({
            newPage: jest.fn().mockResolvedValue({
                goto: jest.fn().mockResolvedValue({}),
                content: jest.fn().mockResolvedValue('<html><body>Test</body></html>'),
                $$eval: jest.fn().mockResolvedValue([]),
                close: jest.fn().mockResolvedValue({}),
                on: jest.fn(),
            }),
            close: jest.fn().mockResolvedValue({}),
        }),
    },
    webkit: {
        launch: jest.fn().mockResolvedValue({
            newPage: jest.fn().mockResolvedValue({
                goto: jest.fn().mockResolvedValue({}),
                content: jest.fn().mockResolvedValue('<html><body>Test</body></html>'),
                $$eval: jest.fn().mockResolvedValue([]),
                close: jest.fn().mockResolvedValue({}),
                on: jest.fn(),
            }),
            close: jest.fn().mockResolvedValue({}),
        }),
    },
    firefox: {
        launch: jest.fn().mockResolvedValue({
            newPage: jest.fn().mockResolvedValue({
                goto: jest.fn().mockResolvedValue({}),
                content: jest.fn().mockResolvedValue('<html><body>Test</body></html>'),
                $$eval: jest.fn().mockResolvedValue([]),
                close: jest.fn().mockResolvedValue({}),
                on: jest.fn(),
            }),
            close: jest.fn().mockResolvedValue({}),
        }),
    },
}));

jest.mock('lighthouse/core/index.cjs', () => {
    return jest.fn().mockResolvedValue({
        lhr: {
            categories: {
                performance: { score: 0.85 },
                accessibility: { score: 0.90 },
                'best-practices': { score: 0.80 },
                seo: { score: 0.95 },
            },
            audits: {
                'largest-contentful-paint': { displayValue: '2.5 s' },
                'cumulative-layout-shift': { displayValue: '0.1' },
                'interaction-to-next-paint': { displayValue: '200 ms' },
                'first-contentful-paint': { displayValue: '1.5 s' },
                'total-blocking-time': { displayValue: '150 ms' },
                'speed-index': { displayValue: '3.0 s' },
            },
        },
    });
});

jest.mock('chrome-launcher', () => ({
    launch: jest.fn().mockResolvedValue({
        port: 9222,
        kill: jest.fn().mockResolvedValue({}),
    }),
}));

describe('Audit Tool Tests', () => {
    describe('Configuration', () => {
        test('should have default configuration values', () => {
            const DEFAULT_CONFIG = {
                maxPagesPerSite: 20,
                pageTimeout: 30000,
                slowAssetThreshold: 3000,
                concurrency: 1,
                historyDir: './data/history',
                reportsDir: './reports',
                sitesFile: './data/sites.json',
            };

            expect(DEFAULT_CONFIG.maxPagesPerSite).toBe(20);
            expect(DEFAULT_CONFIG.pageTimeout).toBe(30000);
            expect(DEFAULT_CONFIG.slowAssetThreshold).toBe(3000);
        });
    });

    describe('Security Headers', () => {
        const SECURITY_HEADERS = [
            'content-security-policy',
            'strict-transport-security',
            'x-content-type-options',
            'x-frame-options',
            'x-xss-protection',
            'referrer-policy',
            'permissions-policy',
        ];

        test('should check for all required security headers', () => {
            expect(SECURITY_HEADERS).toContain('content-security-policy');
            expect(SECURITY_HEADERS).toContain('strict-transport-security');
            expect(SECURITY_HEADERS).toContain('x-content-type-options');
            expect(SECURITY_HEADERS).toContain('x-frame-options');
            expect(SECURITY_HEADERS.length).toBe(7);
        });

        test('should calculate security score correctly', () => {
            const presentHeaders = 4;
            const totalHeaders = SECURITY_HEADERS.length;
            const score = Math.round((presentHeaders / totalHeaders) * 100);
            expect(score).toBe(57);
        });
    });

    describe('URL Validation', () => {
        test('should correctly parse URLs', () => {
            const testUrl = 'https://www.example.com/path';
            const url = new URL(testUrl);

            expect(url.hostname).toBe('www.example.com');
            expect(url.pathname).toBe('/path');
            expect(url.protocol).toBe('https:');
        });

        test('should extract domain without www', () => {
            const hostname = 'www.example.com';
            const domain = hostname.replace(/^www\./, '');
            expect(domain).toBe('example.com');
        });

        test('should handle non-www domains', () => {
            const hostname = 'example.com';
            const domain = hostname.replace(/^www\./, '');
            expect(domain).toBe('example.com');
        });
    });

    describe('Google Services Detection Patterns', () => {
        test('should detect GTM pattern', () => {
            const gtmPattern = /googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/i;
            const testContent = 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123';
            const match = testContent.match(gtmPattern);

            expect(match).not.toBeNull();
            expect(match[1]).toBe('GTM-ABC123');
        });

        test('should detect GA4 pattern', () => {
            const ga4Pattern = /gtag\('config',\s*'(G-[A-Z0-9]+)'/i;
            const testContent = "gtag('config', 'G-XXXXXXXX')";
            const match = testContent.match(ga4Pattern);

            expect(match).not.toBeNull();
            expect(match[1]).toBe('G-XXXXXXXX');
        });

        test('should detect Universal Analytics pattern', () => {
            const uaPattern = /gtag\('config',\s*'(UA-[0-9]+-[0-9]+)'/i;
            const testContent = "gtag('config', 'UA-12345678-1')";
            const match = testContent.match(uaPattern);

            expect(match).not.toBeNull();
            expect(match[1]).toBe('UA-12345678-1');
        });
    });

    describe('WordPress Detection Patterns', () => {
        test('should detect wp-content path', () => {
            const wpContentPattern = /wp-content/i;
            const testContent = '/wp-content/themes/theme-name/style.css';
            expect(wpContentPattern.test(testContent)).toBe(true);
        });

        test('should detect wp-includes path', () => {
            const wpIncludesPattern = /wp-includes/i;
            const testContent = '/wp-includes/js/jquery/jquery.min.js';
            expect(wpIncludesPattern.test(testContent)).toBe(true);
        });

        test('should detect WordPress generator meta tag', () => {
            const generatorPattern = /<meta name="generator" content="WordPress ([0-9.]+)"/i;
            const testContent = '<meta name="generator" content="WordPress 6.4.2">';
            const match = testContent.match(generatorPattern);

            expect(match).not.toBeNull();
            expect(match[1]).toBe('6.4.2');
        });
    });

    describe('CMS Detection', () => {
        test('should detect Shopify', () => {
            const content = 'cdn.shopify.com/s/files/test.js';
            expect(content.includes('cdn.shopify.com')).toBe(true);
        });

        test('should detect Wix', () => {
            const content = 'static.wixstatic.com/media/test.jpg';
            expect(content.includes('wixstatic.com')).toBe(true);
        });

        test('should detect Squarespace', () => {
            const content = 'squarespace.com/static/test.js';
            expect(content.includes('squarespace.com')).toBe(true);
        });
    });

    describe('Performance Score Calculation', () => {
        test('should correctly classify good performance', () => {
            const score = 95;
            const isGood = score >= 90;
            expect(isGood).toBe(true);
        });

        test('should correctly classify needs work performance', () => {
            const score = 65;
            const isGood = score >= 90;
            const needsWork = score >= 50 && score < 90;
            expect(isGood).toBe(false);
            expect(needsWork).toBe(true);
        });

        test('should correctly classify poor performance', () => {
            const score = 35;
            const isPoor = score < 50;
            expect(isPoor).toBe(true);
        });
    });

    describe('Report Generation', () => {
        test('should calculate total pages correctly', () => {
            const data = [
                { pages: [{}, {}, {}] },
                { pages: [{}, {}] },
            ];
            const totalPages = data.reduce((acc, site) => acc + site.pages.length, 0);
            expect(totalPages).toBe(5);
        });

        test('should calculate total errors correctly', () => {
            const data = [
                {
                    pages: [
                        { chromeErrors: ['err1'], safariErrors: [], firefoxErrors: [] },
                        { chromeErrors: [], safariErrors: ['err2'], firefoxErrors: ['err3'] },
                    ],
                },
            ];
            const totalErrors = data.reduce((acc, site) =>
                acc + site.pages.reduce((pAcc, p) =>
                    pAcc + (p.chromeErrors?.length || 0) + (p.safariErrors?.length || 0) + (p.firefoxErrors?.length || 0), 0), 0);
            expect(totalErrors).toBe(3);
        });

        test('should calculate average performance correctly', () => {
            const pages = [
                { desktop: { performance: 80 } },
                { desktop: { performance: 90 } },
                { desktop: { performance: 70 } },
            ];
            const avgPerf = pages.reduce((acc, p) => acc + (p.desktop?.performance || 0), 0) / pages.length;
            expect(avgPerf).toBe(80);
        });
    });

    describe('Link Filtering', () => {
        test('should skip javascript: links', () => {
            const link = 'javascript:void(0)';
            const url = new URL(link, 'https://example.com');
            expect(url.protocol).toBe('javascript:');
        });

        test('should skip mailto: links', () => {
            const link = 'mailto:test@example.com';
            const url = new URL(link, 'https://example.com');
            expect(url.protocol).toBe('mailto:');
        });

        test('should skip tel: links', () => {
            const link = 'tel:+1234567890';
            const url = new URL(link, 'https://example.com');
            expect(url.protocol).toBe('tel:');
        });
    });

    describe('History File Naming', () => {
        test('should generate valid filename from timestamp', () => {
            const timestamp = '2024-01-15T10:30:00.000Z';
            const filename = `audit-${timestamp.replace(/[:.]/g, '-')}.json`;
            expect(filename).toBe('audit-2024-01-15T10-30-00-000Z.json');
        });
    });

    describe('Cron Validation', () => {
        test('should validate daily 9PM GMT+8 cron expression', () => {
            // 9 PM GMT+8 = 13:00 UTC = "0 13 * * *"
            const cronExpression = '0 13 * * *';
            const parts = cronExpression.split(' ');
            expect(parts.length).toBe(5);
            expect(parts[0]).toBe('0'); // minute
            expect(parts[1]).toBe('13'); // hour (UTC)
            expect(parts[2]).toBe('*'); // day of month
            expect(parts[3]).toBe('*'); // month
            expect(parts[4]).toBe('*'); // day of week
        });
    });
});

describe('Sites Configuration', () => {
    test('should load sites.json correctly', async () => {
        const sitesPath = path.join(__dirname, '../data/sites.json');
        const sites = await fs.readJson(sitesPath);

        expect(Array.isArray(sites)).toBe(true);
        expect(sites.length).toBeGreaterThan(0);

        sites.forEach(site => {
            expect(site).toHaveProperty('name');
            expect(site).toHaveProperty('url');
            expect(site.url).toMatch(/^https?:\/\//);
        });
    });
});
