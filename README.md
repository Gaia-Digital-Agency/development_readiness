# Development Readiness Monitor

This project is a Node.js application designed to monitor the development readiness of websites. It crawls a list of specified sites, performs a series of audits on each discovered page, and generates a comprehensive HTML report detailing performance, accessibility, and potential issues.

The primary goal is to provide a clear overview of a site's health, from prototype to production, allowing teams to detect regressions and ensure a high-quality user experience.

## Core Features

- **Recursive Crawler**: Automatically discovers and audits all internal links on a site.
- **Performance Audits**: Leverages Google Lighthouse to measure key performance metrics (Lighthouse Score, LCP, CLS, INP).
- **Cross-Browser Testing**: Captures console errors on both Chromium (Google Chrome) and WebKit (Safari).
- **Unified Dashboard**: Displays all results in a single, easy-to-read HTML report (`reports/dashboard.html`).

## Project Structure

```
/
├─── data/
│    └─── sites.json        # Add the websites you want to audit here
├─── reports/
│    ├─── dashboard.html    # The generated HTML report
│    └─── report-data.json  # Raw JSON output of the audit
├─── .gitignore
├─── index.js              # The main application script
├─── package.json
└─── package-lock.json
```

## How to Run

1.  **Prerequisites**:
    *   [Node.js](https://nodejs.org/) (v16 or later)
    *   NPM (comes with Node.js)

2.  **Configuration**:
    *   Open the `data/sites.json` file.
    *   Add the websites you want to audit, following the existing format:
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

3.  **Installation**:
    *   Navigate to the project directory in your terminal.
    *   Run the following command to install the necessary dependencies:
        ```bash
        npm install
        ```

4.  **Execution**:
    *   Run the main script to start the audit process:
        ```bash
        node index.js
        ```
    *   The script will log its progress in the console. This may take several minutes depending on the number and size of the sites being audited.

5.  **View the Report**:
    *   Once the script finishes, open the generated report file: `reports/dashboard.html`.
    *   You can open this file directly in your web browser to view the results.

