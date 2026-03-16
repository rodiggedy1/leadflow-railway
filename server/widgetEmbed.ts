/**
 * Widget Embed Script
 *
 * Serves GET /api/widget.js — a self-contained vanilla JS snippet that renders
 * the Maids in Black SMS chat widget on any external website.
 *
 * Usage on maidsinblack.com:
 *   <script src="https://quote.maidinblack.com/api/widget.js" async></script>
 *
 * Design: uses 100% inline styles so no external CSS can override it.
 * Icons: emoji-based so no SVG rendering issues on WordPress themes.
 */

import type { Express } from "express";

// Increment this version string whenever the widget script changes.
// Embedding sites should reference the script as:
//   <script src="https://quote.maidinblack.com/api/widget.js?v=WIDGET_VERSION" async></script>
// The version is also embedded in the script itself so you can verify
// which build is running via the browser console.
const WIDGET_VERSION = "2.3.0";

export function registerWidgetEmbedRoute(app: Express) {
  app.get("/api/widget.js", (_req, res) => {
    const API_BASE = "https://quote.maidinblack.com";
    const script = buildWidgetScript(API_BASE, WIDGET_VERSION);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Never cache — always serve the latest version.
    // Embedding sites can optionally append ?v=X.Y.Z to bust CDN caches.
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(script);
  });
}

function buildWidgetScript(apiBase: string, version: string): string {
  return `
(function () {
  'use strict';
  // Maids in Black Widget v${version} — built ${new Date().toISOString().slice(0, 10)}
  // To verify this version in the browser console: window.__MIB_WIDGET_VERSION__
  window.__MIB_WIDGET_VERSION__ = '${version}';

  if (window.__MIB_WIDGET_LOADED__) return;
  window.__MIB_WIDGET_LOADED__ = true;

  var API_BASE = '${apiBase}';
  var CORAL = '#E8735A';
  var CORAL_DARK = '#C9563D';
  var Z_BTN = 2147483647;
  var Z_PANEL = 2147483646;

  // Inject keyframe animation for pulse ring + mobile safe-area support
  var kf = document.createElement('style');
  kf.textContent = '@keyframes mib-ping{0%{transform:scale(1);opacity:0.5}100%{transform:scale(2.2);opacity:0}}' +
    '@keyframes mib-spin{to{transform:rotate(360deg)}}' +
    // Ensure fixed positioning works even when the host page sets overflow:hidden on body (common in WordPress)
    '#mib-widget-btn,#mib-widget-panel{position:fixed!important;}';
  document.head.appendChild(kf);

  // ── State ────────────────────────────────────────────────────────────────────
  var state = {
    open: false,
    submitted: false,
    loading: false,
    error: null,
    name: '',
    phone: '',
    // dismissed: true once the visitor explicitly clicks the close button.
    // Prevents auto-open and exit-intent from re-opening the widget.
    dismissed: false,
    // consent is implicit — by submitting the form the visitor agrees to the
    // fine-print text shown below the button. No checkbox needed.
  };

  var btn, panel;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function timeLabel() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatPhone(raw) {
    var digits = raw.replace(/\\D/g, '');
    // Strip leading country code: autofill "+1 401-688-8007" becomes "14016888007" (11 digits starting with 1)
    if (digits.length === 11 && digits.charAt(0) === '1') {
      digits = digits.slice(1);
    }
    digits = digits.slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return digits.slice(0, 3) + '-' + digits.slice(3);
    return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function captureUtms() {
    var p = new URLSearchParams(window.location.search);
    return {
      utmSource: p.get('utm_source') || undefined,
      utmMedium: p.get('utm_medium') || undefined,
      utmCampaign: p.get('utm_campaign') || undefined,
      utmContent: p.get('utm_content') || undefined,
      gclid: p.get('gclid') || undefined,
    };
  }

  // ── Inline style helpers ─────────────────────────────────────────────────────
  function s(el, styles) {
    Object.keys(styles).forEach(function(k) { el.style[k] = styles[k]; });
    return el;
  }

  function el(tag, styles, attrs) {
    var e = document.createElement(tag);
    if (styles) s(e, styles);
    if (attrs) Object.keys(attrs).forEach(function(k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  // ── Build floating button ────────────────────────────────────────────────────
  function buildButton() {
    btn = el('button', {
      position: 'fixed',
      // iOS safe-area: keep button above the home indicator bar
      bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
      right: '16px',
      zIndex: String(Z_BTN),
      width: '60px',
      height: '60px',
      borderRadius: '50%',
      border: 'none',
      cursor: 'pointer',
      background: 'linear-gradient(135deg,' + CORAL + ' 0%,' + CORAL_DARK + ' 100%)',
      boxShadow: '0 4px 24px rgba(232,115,90,0.55)',
      display: '-webkit-flex',
      WebkitAlignItems: 'center',
      WebkitJustifyContent: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
      margin: '0',
      outline: 'none',
      fontSize: '26px',
      lineHeight: '1',
      overflow: 'visible',
      transition: 'transform 0.2s',
      // Prevent tap highlight flash on iOS
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
    }, { 'aria-label': 'Chat with Maids in Black', 'id': 'mib-widget-btn' });

    // Pulse ring
    var pulse = el('span', {
      position: 'absolute',
      top: '0', left: '0', right: '0', bottom: '0',
      borderRadius: '50%',
      background: CORAL,
      animation: 'mib-ping 1.8s ease-out infinite',
      opacity: '0.4',
      pointerEvents: 'none',
    });
    btn.appendChild(pulse);

    // Chat emoji icon
    var icon = el('span', {
      fontSize: '24px',
      lineHeight: '1',
      display: 'block',
      position: 'relative',
      zIndex: '1',
      pointerEvents: 'none',
    });
    icon.textContent = '\uD83D\uDCAC'; // 💬
    btn.appendChild(icon);

    btn.addEventListener('mouseover', function() { btn.style.transform = 'scale(1.1)'; });
    btn.addEventListener('mouseout', function() { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('click', function() {
      setOpen(!state.open);
    });

    // Append to <html> not <body> — many WordPress themes set overflow:hidden on
    // body which clips position:fixed children on iOS Safari.
    (document.body || document.documentElement).appendChild(btn);
  }

  // ── Build panel ──────────────────────────────────────────────────────────────
  function buildPanel() {
    // On mobile the panel takes full width minus margins; on desktop it's 340px
    var isMobile = window.innerWidth < 480;
    panel = el('div', {
      position: 'fixed',
      // Sit just above the floating button (button height 60px + gap 12px + safe area)
      bottom: 'calc(' + (isMobile ? '88px' : '96px') + ' + env(safe-area-inset-bottom, 0px))',
      right: '16px',
      // On mobile: stretch to fill the screen width minus margins
      // On desktop: fixed 340px
      left: isMobile ? '16px' : 'auto',
      width: isMobile ? 'auto' : '340px',
      maxHeight: 'calc(100vh - 120px)',
      zIndex: String(Z_PANEL),
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      display: 'none',
      flexDirection: 'column',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
      fontSize: '14px',
      lineHeight: '1.5',
      color: '#111827',
      background: '#fff',
    }, { 'id': 'mib-widget-panel' });

    // Header
    var header = el('div', {
      background: 'linear-gradient(135deg,' + CORAL + ' 0%,' + CORAL_DARK + ' 100%)',
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      flexShrink: '0',
    });

    var avatar = el('div', {
      width: '42px',
      height: '42px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.25)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontWeight: '700',
      fontSize: '18px',
      flexShrink: '0',
      position: 'relative',
    });
    avatar.textContent = 'M';

    var dot = el('span', {
      position: 'absolute',
      bottom: '0',
      right: '0',
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      background: '#22C55E',
      border: '2px solid #fff',
    });
    avatar.appendChild(dot);

    var headerText = el('div', { flex: '1', minWidth: '0' });
    var title = el('p', {
      color: '#fff',
      fontWeight: '700',
      fontSize: '15px',
      margin: '0',
      lineHeight: '1.3',
    });
    title.textContent = 'Maids in Black';
    var sub = el('p', {
      color: 'rgba(255,255,255,0.85)',
      fontSize: '12px',
      margin: '0',
    });
    sub.textContent = 'We will text you immediately!';
    headerText.appendChild(title);
    headerText.appendChild(sub);

    var closeBtn = el('button', {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'rgba(255,255,255,0.85)',
      fontSize: '22px',
      lineHeight: '1',
      padding: '4px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
    }, { 'aria-label': 'Close', 'id': 'mib-close-btn' });
    closeBtn.textContent = '\u00D7'; // ×
    closeBtn.addEventListener('mouseover', function() { closeBtn.style.background = 'rgba(255,255,255,0.2)'; });
    closeBtn.addEventListener('mouseout', function() { closeBtn.style.background = 'none'; });
    closeBtn.addEventListener('click', function() { state.dismissed = true; setOpen(false); });

    header.appendChild(avatar);
    header.appendChild(headerText);
    header.appendChild(closeBtn);

    // Body
    var body = el('div', {
      background: '#fff',
      flex: '1',
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    }, { 'id': 'mib-body' });

    // Footer
    var footer = el('div', {
      background: '#fff',
      borderTop: '1px solid #F3F4F6',
      padding: '8px',
      textAlign: 'center',
      flexShrink: '0',
    });
    var footerText = el('span', { fontSize: '10px', color: '#D1D5DB' });
    footerText.textContent = 'Powered by Maids in Black LeadFlow';
    footer.appendChild(footerText);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    (document.body || document.documentElement).appendChild(panel);
  }

  // ── Render body content ──────────────────────────────────────────────────────
  function renderBody() {
    var body = document.getElementById('mib-body');
    if (!body) return;

    // Clear
    while (body.firstChild) body.removeChild(body.firstChild);

    if (state.submitted) {
      var firstName = (state.name.trim().split(' ')[0]) || 'there';

      var bubble = el('div', {
        background: '#F3F4F6',
        borderRadius: '16px',
        borderTopLeftRadius: '4px',
        padding: '14px 16px',
        fontSize: '13px',
        color: '#1F2937',
        lineHeight: '1.6',
      });
      bubble.innerHTML = '\uD83C\uDF89 Thank you, <strong>' + escHtml(firstName) + '</strong>! Check your phone \u2014 we just texted you. We will be in touch shortly!';

      var timeEl = el('p', { fontSize: '11px', color: '#9CA3AF', margin: '4px 0 0 4px' });
      timeEl.textContent = timeLabel();

      var note = el('p', { fontSize: '12px', color: '#9CA3AF', textAlign: 'center', marginTop: '8px' });
      note.textContent = 'Did not get a text? Make sure your number is correct or call us directly.';

      body.appendChild(bubble);
      body.appendChild(timeEl);
      body.appendChild(note);
      return;
    }

    // Welcome bubble
    var welcomeBubble = el('div', {
      background: '#F3F4F6',
      borderRadius: '16px',
      borderTopLeftRadius: '4px',
      padding: '12px 16px',
      fontSize: '13px',
      color: '#1F2937',
      maxWidth: '90%',
      lineHeight: '1.5',
    });
    welcomeBubble.textContent = '\uD83D\uDC4B Hi! Drop your name and number below and we will text you right away with availability and pricing.';

    var timeEl2 = el('p', { fontSize: '11px', color: '#9CA3AF', margin: '2px 0 0 4px' });
    timeEl2.textContent = timeLabel();

    var badge = el('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '12px',
      color: '#6B7280',
      justifyContent: 'flex-end',
    });
    badge.innerHTML = '\u23F1 Average response time: <span style="color:#16A34A;font-weight:600;">&lt;1 min</span>';

    // Form
    var form = el('form', { display: 'flex', flexDirection: 'column', gap: '10px' });

    var nameInput = el('input', {
      width: '100%',
      border: '1.5px solid #E5E7EB',
      borderRadius: '10px',
      padding: '11px 14px',
      fontSize: '13px',
      outline: 'none',
      color: '#111827',
      background: '#fff',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    }, { type: 'text', placeholder: 'Your name', required: '', autocomplete: 'given-name', id: 'mib-name', value: escHtml(state.name) });
    nameInput.addEventListener('focus', function() { nameInput.style.borderColor = CORAL; nameInput.style.boxShadow = '0 0 0 3px rgba(232,115,90,0.15)'; });
    nameInput.addEventListener('blur', function() { nameInput.style.borderColor = '#E5E7EB'; nameInput.style.boxShadow = 'none'; });
    nameInput.addEventListener('input', function() { state.name = nameInput.value; });

    var phoneInput = el('input', {
      width: '100%',
      border: '1.5px solid #E5E7EB',
      borderRadius: '10px',
      padding: '11px 14px',
      fontSize: '13px',
      outline: 'none',
      color: '#111827',
      background: '#fff',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    }, { type: 'tel', placeholder: 'Phone number', required: '', autocomplete: 'tel', id: 'mib-phone', value: escHtml(state.phone) });
    phoneInput.addEventListener('focus', function() { phoneInput.style.borderColor = CORAL; phoneInput.style.boxShadow = '0 0 0 3px rgba(232,115,90,0.15)'; });
    phoneInput.addEventListener('blur', function() { phoneInput.style.borderColor = '#E5E7EB'; phoneInput.style.boxShadow = 'none'; });
    phoneInput.addEventListener('input', function() {
      var formatted = formatPhone(phoneInput.value);
      state.phone = formatted;
      phoneInput.value = formatted;
    });

    if (state.error) {
      var errEl = el('p', { fontSize: '12px', color: '#EF4444', textAlign: 'center', margin: '0' });
      errEl.textContent = state.error;
      form.appendChild(errEl);
    }

    var submitBtn = el('button', {
      width: '100%',
      padding: '13px',
      borderRadius: '10px',
      border: 'none',
      color: '#fff',
      fontWeight: '700',
      fontSize: '14px',
      cursor: state.loading ? 'not-allowed' : 'pointer',
      background: 'linear-gradient(135deg,' + CORAL + ' 0%,' + CORAL_DARK + ' 100%)',
      opacity: state.loading ? '0.6' : '1',
      fontFamily: 'inherit',
      letterSpacing: '0.01em',
    }, { type: 'submit', id: 'mib-submit' });
    submitBtn.textContent = state.loading ? 'Sending...' : 'Text Me Now \u2192';
    if (state.loading) submitBtn.setAttribute('disabled', '');

    // Static consent fine-print — consent is implicit on submit, no checkbox needed
    var consentNote = el('p', {
      fontSize: '10px',
      color: '#9CA3AF',
      textAlign: 'center',
      margin: '0',
      lineHeight: '1.5',
    });
    consentNote.textContent = 'By tapping \u201cText Me Now\u201d you consent to receive SMS messages from Maids in Black about cleaning services, estimates & scheduling. Msg & data rates may apply. Reply STOP to opt out.';

    form.appendChild(nameInput);
    form.appendChild(phoneInput);
    form.appendChild(submitBtn);
    form.appendChild(consentNote);

    form.addEventListener('submit', handleSubmit);

    body.appendChild(welcomeBubble);
    body.appendChild(timeEl2);
    body.appendChild(badge);
    body.appendChild(form);
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();
    state.error = null;

    // Consent is implicit — by submitting the form the visitor agrees to the
    // fine-print text shown below the button. No checkbox guard needed.

    var phoneDigits = state.phone.replace(/\\D/g, '');
    if (phoneDigits.length < 10) {
      state.error = 'Please enter a valid 10-digit phone number.';
      renderBody();
      return;
    }

    state.loading = true;
    renderBody();

    var utms = captureUtms();
    var payload = Object.assign({ name: state.name.trim(), phone: state.phone }, utms);

    var url = API_BASE + '/api/trpc/quotes.submitWidgetLead?batch=1';
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ '0': { json: payload } }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var item = Array.isArray(data) ? data[0] : data;
        if (item && item.error) throw new Error(item.error.message || 'Something went wrong.');
        state.loading = false;
        state.submitted = true;
        renderBody();
      })
      .catch(function(err) {
        state.loading = false;
        state.error = err.message || 'Something went wrong. Please try again.';
        renderBody();
      });
  }

  // ── Toggle open/close ────────────────────────────────────────────────────────
  function setOpen(val) {
    state.open = val;
    if (panel) panel.style.display = val ? 'flex' : 'none';
    // Update button icon
    if (btn) {
      var iconSpan = btn.querySelector('span:last-child');
      if (iconSpan) iconSpan.textContent = val ? '\u00D7' : '\uD83D\uDCAC';
    }
    if (val) renderBody();
  }

  // ── Auto-open after 15 seconds ───────────────────────────────────────────────
  // Simple approach: fire once per page load after 15 s unless the visitor
  // already dismissed the widget during this page session.
  function scheduleAutoOpen() {
    setTimeout(function() {
      // Only open if: widget is closed AND visitor has not dismissed it
      if (!state.open && !state.dismissed) {
        setOpen(true);
      }
    }, 15000);
  }

  // ── Exit-intent trigger ───────────────────────────────────────────────────────
  // Fires when the mouse leaves the browser viewport through the top edge
  // (heading toward the address bar / tabs). Uses document mouseleave which
  // is the standard cross-browser exit-intent signal.
  function setupExitIntent() {
    var exitTriggered = false;

    document.addEventListener('mouseleave', function(e) {
      if (exitTriggered) return;
      if (state.dismissed) return;
      // Only react to top-edge exits (clientY at or near 0)
      if (e.clientY > 5) return;
      exitTriggered = true;
      if (!state.open) {
        setOpen(true);
      }
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    buildButton();
    buildPanel();
    scheduleAutoOpen();
    setupExitIntent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}
