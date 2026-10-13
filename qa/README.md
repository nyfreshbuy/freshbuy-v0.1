# Storefront regression checks

The fixture contains the public product catalog captured on 2026-10-13. Tests inject fictional account and order data and intercept every local API request, so they cannot create production orders, send SMS, charge payments, or modify accounts.

Start the preview server with Node.js:

    node qa/preview-server.cjs

In another terminal, run with Playwright available through your local install or NODE_PATH:

    node qa/storefront.test.cjs

Checks include 320/390px phones, 768/820px portrait tablets, 1180px landscape tablets, 1280/1440/1600px desktops, ten page layouts, square image containers, navigation, WebKit, the existing native iOS shell, bilingual search, empty search results, detail navigation, stock limits, cart quantity changes, subtotal calculations and persistence. No real payment or order submission is performed.

Screenshots and `results.json` are local QA output and are ignored by Git.
