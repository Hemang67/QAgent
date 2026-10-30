# Demo shop

The site the in-app tour tests. QAgent serves it from this folder on a local port; nothing is sent anywhere.
Planted problems for the tour to point at:

- `orders.html` throws a script error, so Full regression fails it.
- `contact.html` has a missing image and a link to a page that does not exist (Broken links), and inputs without labels and an image without alt text (Accessibility).
