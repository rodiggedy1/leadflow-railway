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
    '#mib-widget-btn{position:fixed!important;bottom:20px!important;right:20px!important;z-index:2147483646!important;width:56px!important;height:56px!important;border-radius:50%!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,'+CORAL+' 0%,'+CORAL_DARK+' 100%)!important;box-shadow:0 4px 20px rgba(232,115,90,0.5)!important;display:flex!important;align-items:center!important;justify-content:center!important;transition:transform 0.2s!important;padding:0!important;margin:0!important;outline:none!important;line-height:1!important;overflow:visible!important;}',
    '#mib-widget-btn:hover{transform:scale(1.1)!important;}',
    '#mib-widget-btn:active{transform:scale(0.95)!important;}',
    '#mib-widget-btn svg{width:24px!important;height:24px!important;fill:none!important;stroke:#fff!important;stroke-width:2!important;stroke-linecap:round!important;stroke-linejoin:round!important;display:block!important;}',
    '#mib-widget-pulse{position:absolute!important;inset:0!important;border-radius:50%!important;background:'+CORAL+'!important;animation:mib-ping 1.5s cubic-bezier(0,0,0.2,1) infinite!important;opacity:0.35!important;}',
    '@keyframes mib-ping{75%,100%{transform:scale(2);opacity:0;}}',
    '#mib-widget-panel{position:fixed!important;bottom:88px!important;right:20px!important;z-index:2147483645!important;width:340px!important;max-height:calc(100vh - 110px)!important;border-radius:16px!important;overflow:hidden!important;box-shadow:0 8px 40px rgba(0,0,0,0.18)!important;display:flex!important;flex-direction:column!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important;}',
    '#mib-widget-panel *{box-sizing:border-box!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important;}',
    '.mib-header{background:linear-gradient(135deg,'+CORAL+' 0%,'+CORAL_DARK+' 100%)!important;padding:12px 16px!important;display:flex!important;align-items:center!important;gap:12px!important;}',
    '.mib-avatar{width:40px!important;height:40px!important;border-radius:50%!important;background:rgba(255,255,255,0.25)!important;display:flex!important;align-items:center!important;justify-content:center!important;color:#fff!important;font-weight:700!important;font-size:18px!important;flex-shrink:0!important;position:relative!important;}',
    '.mib-online-dot{position:absolute!important;bottom:0!important;right:0!important;width:12px!important;height:12px!important;border-radius:50%!important;background:#22C55E!important;border:2px solid #fff!important;}',
    '.mib-header-text{flex:1!important;min-width:0!important;}',
    '.mib-header-title{color:#fff!important;font-weight:600!important;font-size:14px!important;line-height:1.2!important;margin:0!important;}',
    '.mib-header-sub{color:rgba(255,255,255,0.8)!important;font-size:12px!important;margin:0!important;}',
    '.mib-close-btn{background:none!important;border:none!important;cursor:pointer!important;color:rgba(255,255,255,0.8)!important;padding:4px!important;border-radius:50%!important;display:flex!important;align-items:center!important;justify-content:center!important;transition:background 0.15s!important;}',
    '.mib-close-btn:hover{background:rgba(255,255,255,0.15)!important;color:#fff!important;}',
    '.mib-close-btn svg{width:18px!important;height:18px!important;stroke:currentColor!important;fill:none!important;display:block!important;}',
    '.mib-body{background:#fff!important;flex:1!important;overflow-y:auto!important;padding:16px!important;display:flex!important;flex-direction:column!important;gap:16px!important;}',
    '.mib-bubble{background:#F3F4F6!important;border-radius:16px!important;border-top-left-radius:4px!important;padding:12px 16px!important;font-size:13px!important;color:#1F2937!important;max-width:90%!important;line-height:1.5!important;}',
    '.mib-time{font-size:11px!important;color:#9CA3AF!important;padding-left:4px!important;margin-top:2px!important;}',
    '.mib-resp-badge{display:flex!important;align-items:center!important;gap:6px!important;font-size:12px!important;color:#6B7280!important;justify-content:flex-end!important;}',
    '.mib-resp-badge span.fast{color:#16A34A!important;font-weight:600!important;}',
    '.mib-form{display:flex!important;flex-direction:column!important;gap:12px!important;}',
    '.mib-input{width:100%!important;border:1.5px solid #E5E7EB!important;border-radius:12px!important;padding:11px 14px!important;font-size:13px!important;outline:none!important;transition:border-color 0.15s,box-shadow 0.15s!important;color:#111827!important;background:#fff!important;}',
    '.mib-input::placeholder{color:#9CA3AF!important;}',
    '.mib-input:focus{border-color:'+CORAL+'!important;box-shadow:0 0 0 3px rgba(232,115,90,0.15)!important;}',
    '.mib-consent{display:flex!important;align-items:flex-start!important;gap:8px!important;cursor:pointer!important;}',
    '.mib-consent input[type=checkbox]{margin-top:2px!important;flex-shrink:0!important;accent-color:'+CORAL+'!important;}',
    '.mib-consent-text{font-size:11px!important;color:#6B7280!important;line-height:1.5!important;}',
    '.mib-submit-btn{width:100%!important;padding:12px!important;border-radius:12px!important;border:none!important;color:#fff!important;font-weight:600!important;font-size:14px!important;cursor:pointer!important;background:linear-gradient(135deg,'+CORAL+' 0%,'+CORAL_DARK+' 100%)!important;transition:opacity 0.15s!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;}',
    '.mib-submit-btn:disabled{opacity:0.5!important;cursor:not-allowed!important;}',
    '.mib-error{font-size:12px!important;color:#EF4444!important;text-align:center!important;}',
    '.mib-success-bubble{background:#F3F4F6!important;border-radius:16px!important;border-top-left-radius:4px!important;padding:12px 16px!important;font-size:13px!important;color:#1F2937!important;line-height:1.5!important;display:flex!important;align-items:flex-start!important;gap:8px!important;}',
    '.mib-check{color:#22C55E!important;flex-shrink:0!important;margin-top:1px!important;}',
    '.mib-footer{background:#fff!important;border-top:1px solid #F3F4F6!important;padding:8px!important;text-align:center!important;}',
    '.mib-footer span{font-size:10px!important;color:#D1D5DB!important;}',
    '@media(max-width:380px){#mib-widget-panel{width:calc(100vw - 24px)!important;right:12px!important;}#mib-widget-btn{right:12px!important;bottom:12px!important;}#mib-widget-panel{bottom:80px!important;}}',
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
