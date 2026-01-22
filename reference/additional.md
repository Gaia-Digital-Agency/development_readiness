Deeper Network Analysis:
Goal: Catch all failing or slow network requests, not just those that log a console error.
Method: Use Playwright to intercept all network responses and log any with a 4xx or 5xx status code, or requests that take too long to complete.

Accessibility Audit:
Goal: Ensure the site is usable by people with disabilities.
Method: Integrate an automated accessibility scanner like axe-core into the script to run on each page.

SEO Best Practices:
Goal: Verify that pages have basic on-page SEO elements.
Method: Check for the presence, content, and length of crucial tags like <title>, <meta name="description">, and a single <h1>.

Broken Link Checker:
Goal: Find and report all dead (404) links on the site.
Method: For every link (<a> tag) found, send a quick HEAD request to verify that it returns a success status (like 200 OK).

Security Headers:
Goal: Check if the server is configured with recommended security headers (e.g., Content-Security-Policy).
Method: Inspect the response headers of the main page request.

Mobile GPSI Performance	
Mobile GPSI Accessibility
Mobile GPSI Best Practices
Mobile GPSI SEO	
Desktop GPSI Performance	
Desktop GPSI Accessibility	
Desktop GPSI Best Practices	
Desktop GPSI SEO	
PHP	version
PHP-FPM
cPanel Site Quality
WP Core	version
WP Plugin Update required	
WP Theme Update	required
WP Smart Update	required
WP Hostinger Plugin	Update required
WP LightSpeed
WP Object Cache	
WP Security Measures		
WP Login /teameditor
WP LS Cache	
WP QUIC	
QUIC DNS
Google reCaptcha version
Google Tag Manager
Google Analytics presence
Google Analytics Attached to Tag Manager - Yes/No
