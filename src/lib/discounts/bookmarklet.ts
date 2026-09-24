/**
 * Generates the "Send to Discount scanner" bookmarklet — a `javascript:` URL
 * that, when clicked on a shop page, opens this app's Discount section in a
 * new tab and hands it that page's own HTML, so a bot-walled or
 * JavaScript-rendered site (Akamai etc — see blocked.ts) can still be
 * scanned using the user's own, already-authenticated browser instead of a
 * server-side fetch that would just get walled the same way.
 *
 * The generated code loads no external script — the string built below IS
 * the entire bookmarklet. It talks to the popup it opens purely via
 * `postMessage`, using the same message-type constants the receiver
 * (DiscountSection's `receive=1` handler) imports from this file, so the two
 * sides can never drift out of sync on the wire format.
 */

/** Sent popup → opener once the receiver has mounted and is listening. */
export const READY_MESSAGE_TYPE = "ec-discount-ready";
/** Sent opener → popup with the scraped page. */
export const PAGE_MESSAGE_TYPE = "ec-discount-page";

/**
 * Cap on the HTML handed over by the bookmarklet. Deliberately under
 * DiscountSection's PASTE_CONTENT_MAX_CHARS (400,000, the server's actual
 * cap) to leave headroom for the JSON envelope (`url`, `title`, message
 * type) added on top of the raw `html` field before it's ever compared
 * against that cap.
 */
export const BOOKMARKLET_HTML_MAX_CHARS = 390_000;

/** How long the bookmarklet keeps its popup open waiting for the ready handshake. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * Returns the bookmarklet's `javascript:` URL for `appOrigin` (pass
 * `window.location.origin` verbatim — no trailing slash expected).
 *
 * The script body below is written with no `//` line comments, and avoids
 * `%`/`#` characters, since it gets collapsed to a single line for the
 * `javascript:` URL: a `//` would swallow everything after it once the
 * surrounding newlines disappear, and `%`/`#` don't survive a URL bar/stored
 * bookmark href intact. `encodeURI()` below is what makes it safe to embed
 * as a URL in the first place (escaping spaces, quotes, braces, etc.) while
 * leaving `appOrigin` itself readable — browsers percent-decode a
 * `javascript:` href back to source text before running it, exactly like
 * every other bookmarklet generator's `encodeURI(code)` output.
 */
export function buildBookmarklet(appOrigin: string): string {
  const body = `
    (function () {
      var APP = ${JSON.stringify(appOrigin)};
      var READY = ${JSON.stringify(READY_MESSAGE_TYPE)};
      var PAGE = ${JSON.stringify(PAGE_MESSAGE_TYPE)};
      var MAX = ${BOOKMARKLET_HTML_MAX_CHARS};
      var TIMEOUT = ${HANDSHAKE_TIMEOUT_MS};
      function extractHtml() {
        var html = document.documentElement.outerHTML;
        if (html.length <= MAX) return html;
        var main = document.querySelector('main');
        if (main && main.outerHTML.length <= MAX) return main.outerHTML;
        var body = document.body ? document.body.outerHTML : html;
        return body.slice(0, MAX);
      }
      function fallbackToClipboard() {
        var text = document.body ? document.body.innerText : document.title;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            alert('Your pop-up was blocked. The page text was copied instead \\u2014 paste it into the Discount scanner\\u2019s "Paste page" dialog.');
          }, function () {
            alert('Your pop-up was blocked, and the page text could not be copied automatically. Please allow pop-ups for this site and try again.');
          });
        } else {
          alert('Your pop-up was blocked. Please allow pop-ups for this site and try again.');
        }
      }
      var popup = window.open(APP + '/tickets?section=discounts&receive=1', 'ec_discount_scanner');
      if (!popup) { fallbackToClipboard(); return; }
      var handled = false;
      var pollTimer = null;
      function cleanup() {
        handled = true;
        window.removeEventListener('message', onMessage);
        if (pollTimer) clearInterval(pollTimer);
      }
      function onMessage(event) {
        if (handled) return;
        if (event.source !== popup || event.origin !== APP) return;
        if (!event.data || event.data.type !== READY) return;
        popup.postMessage({ type: PAGE, v: 1, url: location.href, title: document.title, html: extractHtml() }, APP);
        cleanup();
      }
      window.addEventListener('message', onMessage);
      var waitedMs = 0;
      pollTimer = setInterval(function () {
        waitedMs += 500;
        if (handled) return;
        if (popup.closed || waitedMs >= TIMEOUT) {
          var timedOut = !popup.closed;
          cleanup();
          if (timedOut) alert('Could not reach the Discount scanner tab \\u2014 give it a moment to finish loading, then click the bookmarklet again.');
        }
      }, 500);
    })();
  `;
  const collapsed = body.replace(/\s+/g, " ").trim();
  return `javascript:${encodeURI(collapsed)}`;
}
