/**
 * Widget Embed Script
 *
 * Serves GET /widget.js — a self-contained vanilla JS snippet that renders
 * the Maids in Black SMS chat widget on any external website.
 *
 * Usage on maidsinblack.com:
 *   <script src="https://quote.maidinblack.com/api/widget.js" async></script>
 *
 * The script:
 * - Injects its own CSS (no external dependencies)
 * - Renders the floating button + panel
 * - Auto-opens after 10 seconds (once per session via sessionStorage)
 * - POSTs to the LeadFlow tRPC endpoint to create the lead
 * - Sends admin + lead SMS via the existing processWidgetLeadInBackground flow
 */

import type { Express } from "express";

export function registerWidgetEmbedRoute(app: Express) {
  app.get("/api/widget.js", (_req, res) => {
    // The API base URL — always points to the LeadFlow backend
    const API_BASE = "https://quote.maidinblack.com";

    const script = buildWidgetScript(API_BASE);

    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    // Allow any origin to load this script (it's meant to be embedded externally)
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Cache for 5 minutes so updates roll out quickly
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(script);
  });
}

function buildWidgetScript(apiBase: string): string {
  return `
(function () {
  'use strict';

  // ── Guard: only inject once ──────────────────────────────────────────────────
  if (window.__MIB_WIDGET_LOADED__) return;
  window.__MIB_WIDGET_LOADED__ = true;

  var API_BASE = '${apiBase}';
  var CORAL = '#E8735A';
  var CORAL_DARK = '#C9563D';

  // ── Inject CSS ───────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#mib-widget-btn{position:fixed;bottom:20px;right:20px;z-index:2147483646;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,'+CORAL+' 0%,'+CORAL_DARK+' 100%);box-shadow:0 4px 20px rgba(232,115,90,0.5);display:flex;align-items:center;justify-content:center;transition:transform 0.2s;}',
    '#mib-widget-btn:hover{transform:scale(1.1);}',
    '#mib-widget-btn:active{transform:scale(0.95);}',
    '#mib-widget-btn svg{width:24px;height:24px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
    '#mib-widget-pulse{position:absolute;inset:0;border-radius:50%;background:'+CORAL+';animation:mib-ping 1.5s cubic-bezier(0,0,0.2,1) infinite;opacity:0.35;}',
    '@keyframes mib-ping{75%,100%{transform:scale(2);opacity:0;}}',
    '#mib-widget-panel{position:fixed;bottom:88px;right:20px;z-index:2147483645;width:340px;max-height:calc(100vh - 110px);border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.18);display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
    '#mib-widget-panel *{box-sizing:border-box;}',
    '.mib-header{background:linear-gradient(135deg,'+CORAL+' 0%,'+CORAL_DARK+' 100%);padding:12px 16px;display:flex;align-items:center;gap:12px;}',
    '.mib-avatar{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;flex-shrink:0;position:relative;}',
    '.mib-online-dot{position:absolute;bottom:0;right:0;width:12px;height:12px;border-radius:50%;background:#22C55E;border:2px solid #fff;}',
    '.mib-header-text{flex:1;min-width:0;}',
    '.mib-header-title{color:#fff;font-weight:600;font-size:14px;line-height:1.2;margin:0;}',
    '.mib-header-sub{color:rgba(255,255,255,0.8);font-size:12px;margin:0;}',
    '.mib-close-btn{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.8);padding:4px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background 0.15s;}',
    '.mib-close-btn:hover{background:rgba(255,255,255,0.15);color:#fff;}',
    '.mib-body{background:#fff;flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;}',
    '.mib-bubble{background:#F3F4F6;border-radius:16px;border-top-left-radius:4px;padding:12px 16px;font-size:13px;color:#1F2937;max-width:90%;line-height:1.5;}',
    '.mib-time{font-size:11px;color:#9CA3AF;padding-left:4px;margin-top:2px;}',
    '.mib-resp-badge{display:flex;align-items:center;gap:6px;font-size:12px;color:#6B7280;justify-content:flex-end;}',
    '.mib-resp-badge span.fast{color:#16A34A;font-weight:600;}',
    '.mib-form{display:flex;flex-direction:column;gap:12px;}',
    '.mib-input{width:100%;border:1.5px solid #E5E7EB;border-radius:12px;padding:11px 14px;font-size:13px;outline:none;transition:border-color 0.15s,box-shadow 0.15s;color:#111827;}',
    '.mib-input::placeholder{color:#9CA3AF;}',
    '.mib-input:focus{border-color:'+CORAL+';box-shadow:0 0 0 3px rgba(232,115,90,0.15);}',
    '.mib-consent{display:flex;align-items:flex-start;gap:8px;cursor:pointer;}',
    '.mib-consent input[type=checkbox]{margin-top:2px;flex-shrink:0;accent-color:'+CORAL+';}',
    '.mib-consent-text{font-size:11px;color:#6B7280;line-height:1.5;}',
    '.mib-submit-btn{width:100%;padding:12px;border-radius:12px;border:none;color:#fff;font-weight:600;font-size:14px;cursor:pointer;background:linear-gradient(135deg,'+CORAL+' 0%,'+CORAL_DARK+' 100%);transition:opacity 0.15s;display:flex;align-items:center;justify-content:center;gap:8px;}',
    '.mib-submit-btn:disabled{opacity:0.5;cursor:not-allowed;}',
    '.mib-error{font-size:12px;color:#EF4444;text-align:center;}',
    '.mib-success-bubble{background:#F3F4F6;border-radius:16px;border-top-left-radius:4px;padding:12px 16px;font-size:13px;color:#1F2937;line-height:1.5;display:flex;align-items:flex-start;gap:8px;}',
    '.mib-check{color:#22C55E;flex-shrink:0;margin-top:1px;}',
    '.mib-footer{background:#fff;border-top:1px solid #F3F4F6;padding:8px;text-align:center;}',
    '.mib-footer span{font-size:10px;color:#D1D5DB;}',
    '@media(max-width:380px){#mib-widget-panel{width:calc(100vw - 24px);right:12px;}#mib-widget-btn{right:12px;bottom:12px;}#mib-widget-panel{bottom:80px;}}',
  ].join('');
  document.head.appendChild(style);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function timeLabel() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatPhone(raw) {
    var digits = raw.replace(/\\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return digits.slice(0, 3) + '-' + digits.slice(3);
    return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
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

  // SVG icons (inline, no external deps)
  var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_SPIN = '<svg viewBox="0 0 24 24" style="animation:mib-spin 0.8s linear infinite"><style>@keyframes mib-spin{to{transform:rotate(360deg)}}</style><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>';

  // ── State ────────────────────────────────────────────────────────────────────
  var state = {
    open: false,
    submitted: false,
    loading: false,
    error: null,
    name: '',
    phone: '',
    consent: false,
    sentTime: timeLabel(),
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  var panel, btn, pulseRing;

  // ── Build DOM ────────────────────────────────────────────────────────────────
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'mib-widget-panel';
    panel.style.display = 'none';
    panel.innerHTML = [
      '<div class="mib-header">',
        '<div class="mib-avatar">M<span class="mib-online-dot"></span></div>',
        '<div class="mib-header-text">',
          '<p class="mib-header-title">Maids in Black</p>',
          '<p class="mib-header-sub">We will text you immediately!</p>',
        '</div>',
        '<button class="mib-close-btn" id="mib-close-btn" aria-label="Close">',
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        '</button>',
      '</div>',
      '<div class="mib-body" id="mib-body"></div>',
      '<div class="mib-footer"><span>Powered by Maids in Black LeadFlow</span></div>',
    ].join('');
    document.body.appendChild(panel);

    document.getElementById('mib-close-btn').addEventListener('click', function () {
      setOpen(false);
    });
  }

  function renderBody() {
    var body = document.getElementById('mib-body');
    if (!body) return;

    if (state.submitted) {
      var firstName = (state.name.trim().split(' ')[0]) || 'there';
      body.innerHTML = [
        '<div>',
          '<div class="mib-success-bubble">',
            '<span class="mib-check">' + ICON_CHECK + '</span>',
            '<span>Thank you, <strong>' + escHtml(firstName) + '</strong>! \uD83C\uDF89 Check your phone \u2014 we just texted you. We will be in touch shortly!</span>',
          '</div>',
          '<div class="mib-time">' + timeLabel() + '</div>',
        '</div>',
        '<p style="font-size:12px;color:#9CA3AF;text-align:center;">Did not get a text? Make sure your number is correct or call us directly.</p>',
      ].join('');
      return;
    }

    body.innerHTML = [
      '<div>',
        '<div class="mib-bubble">\uD83D\uDC4B Hi! Drop your name and number below and we will text you right away with availability and pricing.</div>',
        '<div class="mib-time">' + state.sentTime + '</div>',
      '</div>',
      '<div class="mib-resp-badge">\u23F1 Average response time: <span class="fast">&lt;1 min</span></div>',
      '<form class="mib-form" id="mib-form">',
        '<input class="mib-input" id="mib-name" type="text" placeholder="Your name" required value="' + escHtml(state.name) + '" autocomplete="given-name"/>',
        '<input class="mib-input" id="mib-phone" type="tel" placeholder="Phone number" required value="' + escHtml(state.phone) + '" autocomplete="tel"/>',
        '<label class="mib-consent">',
          '<input type="checkbox" id="mib-consent"' + (state.consent ? ' checked' : '') + '/>',
          '<span class="mib-consent-text">I consent to receive SMS messages from Maids in Black at the number provided about cleaning services, estimates, scheduling, and follow-ups. Message frequency varies. Std message &amp; data rates may apply. Reply STOP to opt out.</span>',
        '</label>',
        state.error ? '<p class="mib-error">' + escHtml(state.error) + '</p>' : '',
        '<button type="submit" class="mib-submit-btn" id="mib-submit"' + (state.loading ? ' disabled' : '') + '>',
          state.loading ? ICON_SPIN + ' Sending\u2026' : 'Text Me Now \u2192',
        '</button>',
      '</form>',
    ].join('');

    // Wire up live input events
    document.getElementById('mib-name').addEventListener('input', function (e) {
      state.name = e.target.value;
    });
    document.getElementById('mib-phone').addEventListener('input', function (e) {
      var formatted = formatPhone(e.target.value);
      state.phone = formatted;
      e.target.value = formatted;
    });
    document.getElementById('mib-consent').addEventListener('change', function (e) {
      state.consent = e.target.checked;
    });
    document.getElementById('mib-form').addEventListener('submit', handleSubmit);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();
    state.error = null;

    if (!state.consent) {
      state.error = 'Please check the consent box to continue.';
      renderBody();
      return;
    }

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

    // tRPC batch call — same endpoint the React app uses
    var url = API_BASE + '/api/trpc/quotes.submitWidgetLead?batch=1';
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ '0': { json: payload } }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // tRPC batch response is an array; check for error in first item
        var item = Array.isArray(data) ? data[0] : data;
        if (item && item.error) {
          throw new Error(item.error.message || 'Something went wrong.');
        }
        state.loading = false;
        state.submitted = true;
        renderBody();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || 'Something went wrong. Please try again.';
        renderBody();
      });
  }

  // ── Toggle open/close ────────────────────────────────────────────────────────
  function setOpen(val) {
    state.open = val;
    if (panel) panel.style.display = val ? 'flex' : 'none';
    if (btn) btn.innerHTML = val
      ? ICON_X + (val ? '' : '<span id="mib-pulse" class="mib-pulse-ring"></span>')
      : ICON_CHAT + '<span id="mib-pulse" class="mib-pulse-ring" style="position:absolute;inset:0;border-radius:50%;background:' + CORAL + ';animation:mib-ping 1.5s cubic-bezier(0,0,0.2,1) infinite;opacity:0.35;"></span>';
    if (val) renderBody();
  }

  // ── Build floating button ────────────────────────────────────────────────────
  function buildButton() {
    btn = document.createElement('button');
    btn.id = 'mib-widget-btn';
    btn.setAttribute('aria-label', 'Chat with Maids in Black');
    btn.innerHTML = ICON_CHAT + '<span style="position:absolute;inset:0;border-radius:50%;background:' + CORAL + ';animation:mib-ping 1.5s cubic-bezier(0,0,0.2,1) infinite;opacity:0.35;"></span>';
    btn.addEventListener('click', function () {
      setOpen(!state.open);
      sessionStorage.setItem('mib_widget_opened', '1');
    });
    document.body.appendChild(btn);
  }

  // ── Auto-open after 10 seconds ───────────────────────────────────────────────
  function scheduleAutoOpen() {
    if (sessionStorage.getItem('mib_widget_opened')) return;
    setTimeout(function () {
      if (!state.open) {
        setOpen(true);
        sessionStorage.setItem('mib_widget_opened', '1');
      }
    }, 10000);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    buildButton();
    buildPanel();
    scheduleAutoOpen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}
