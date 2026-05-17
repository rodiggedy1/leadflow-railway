// LeadFlow — Thumbtack content script
// Runs on thumbtack.com/pro-leads/* AND thumbtack.com/messages/*
//
// Two-step flow:
//   Step 1 (/pro-leads/{id}): Extract lead info → popup generates message → inject into reply box → auto-send → dismiss modal → navigate to /messages/{id}
//   Step 2 (/messages/{id}): Auto-click "Click to show phone number" → read revealed number → fire bridge call

(function () {
  "use strict";

  let lastDetectedLeadId = null;
  let phoneWatchInterval = null;
  let phoneAlreadyReported = false;
  let revealAlreadyClicked = false;
  let modalWatchInterval = null;
  let currentLeadId = null; // track the lead ID so we can navigate directly to /messages/{id}

  // ── Helpers ────────────────────────────────────────────────────────────────

  function isLeadListPage() {
    return window.location.pathname === "/pro-leads" || window.location.pathname === "/pro-leads/";
  }
  function isLeadDetailPage() {
    return /\/pro-leads\/\d+/.test(window.location.pathname);
  }

  function isMessagesPage() {
    return window.location.pathname.startsWith("/messages") ||
           window.location.pathname.startsWith("/pro-inbox/messages");
  }

  // ── Step 1: Extract lead info from /pro-leads/{id} ─────────────────────────
  async function extractLeadData() {
    try {
      if (!isLeadDetailPage()) return null;

      const urlMatch = window.location.pathname.match(/\/pro-leads\/(\d+)/);
      const leadId = urlMatch ? urlMatch[1] : null;
      if (!leadId) return null;

      currentLeadId = leadId; // store for direct navigation later

      // ── Name — read from storage (captured when user clicked from lead list page) ──
      let name = null;
      const storedNameData = await chrome.storage.local.get(`leadName_${leadId}`);
      const storedName = storedNameData[`leadName_${leadId}`];
      if (storedName) {
        name = storedName;
        console.log("[LeadFlow] Using stored name from lead list:", name);
      }
      // Fallback 2: try DOM (may be "Pros contacted" but better than nothing)
      const nameEl = document.querySelector("h1");
      if (!name) {
        const raw = nameEl?.textContent?.trim() || null;
        if (raw && raw !== "Pros contacted" && raw !== "Messages" && raw.length < 60) {
          name = raw;
        }
      }

      // ── Service ───────────────────────────────────────────────────────────
      let service = null;
      if (nameEl) {
        let el = nameEl.nextElementSibling;
        while (el) {
          const text = el.textContent?.trim();
          if (text && text.length > 2 && text.length < 80 && !text.includes(":")) {
            service = text;
            break;
          }
          el = el.nextElementSibling;
        }
      }
      if (!service) {
        const allEls = document.querySelectorAll("p, h2, h3, span");
        const serviceKeywords = ["House Cleaning", "Home Cleaning", "Deep Cleaning", "Move-out", "Office Cleaning", "Carpet Cleaning", "Window Cleaning", "Lawn", "Painting"];
        for (const el of allEls) {
          const text = el.textContent?.trim();
          if (text && serviceKeywords.some(k => text.includes(k))) {
            service = text;
            break;
          }
        }
      }

      // ── Location ──────────────────────────────────────────────────────────
      let location = null;
      const allEls = document.querySelectorAll("p, span, div, li");
      for (const el of allEls) {
        if (el.children.length > 2) continue;
        const text = el.textContent?.trim();
        if (text && /^[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}/.test(text)) {
          location = text.split("\n")[0].trim();
          break;
        }
      }

      // ── Dates ─────────────────────────────────────────────────────────────
      let dates = null;
      for (const el of allEls) {
        const text = el.textContent?.trim();
        if (text?.startsWith("Dates:")) {
          dates = text.replace("Dates:", "").trim();
          break;
        }
      }

      // ── Job Details ───────────────────────────────────────────────────────
      const jobDetails = {};
      const labelMap = {
        "Number of bedrooms": "beds",
        "Number of bathrooms": "baths",
        "Frequency": "frequency",
        "Pets": "pets",
        "Extra services": "extras",
        "Cleaning type": "cleaningType",
        "Travel preferences": "travel",
      };
      for (const el of allEls) {
        if (el.children.length > 4) continue;
        const text = el.textContent?.trim();
        if (!text || !text.includes(":")) continue;
        for (const [label, key] of Object.entries(labelMap)) {
          if (text.startsWith(label + ":")) {
            jobDetails[key] = text.replace(label + ":", "").trim();
            break;
          }
        }
      }

      // ── Customer Message ──────────────────────────────────────────────────
      let customerMessage = null;
      const headings = document.querySelectorAll("h2, h3, p, span, div");
      for (const el of headings) {
        if (el.textContent?.trim() === "Message") {
          let sib = el.nextElementSibling;
          while (sib) {
            const t = sib.textContent?.trim();
            if (t && t.length > 5 && !t.startsWith("Why")) {
              customerMessage = t;
              break;
            }
            sib = sib.nextElementSibling;
          }
          if (!customerMessage) {
            const parent = el.parentElement?.nextElementSibling;
            if (parent) customerMessage = parent.textContent?.trim();
          }
          break;
        }
      }

      // ── Build description ─────────────────────────────────────────────────
      const descParts = [];
      if (customerMessage) descParts.push(`Customer message: "${customerMessage}"`);
      if (location) descParts.push(`Location: ${location}`);
      if (dates) descParts.push(`Dates: ${dates}`);
      if (jobDetails.beds) descParts.push(`Bedrooms: ${jobDetails.beds}`);
      if (jobDetails.baths) descParts.push(`Bathrooms: ${jobDetails.baths}`);
      if (jobDetails.frequency) descParts.push(`Frequency: ${jobDetails.frequency}`);
      if (jobDetails.cleaningType) descParts.push(`Cleaning type: ${jobDetails.cleaningType}`);
      if (jobDetails.extras) descParts.push(`Extra services: ${jobDetails.extras}`);
      if (jobDetails.pets) descParts.push(`Pets: ${jobDetails.pets}`);

      return {
        leadId,
        name,
        phone: null,
        phoneMasked: true,
        service,
        location,
        dates,
        jobDetails,
        customerMessage,
        description: descParts.join(" | "),
        url: window.location.href,
        detectedAt: Date.now(),
      };
    } catch (e) {
      console.warn("[LeadFlow] Lead extraction error:", e);
      return null;
    }
  }

  async function detectAndReport() {
    const lead = await extractLeadData();
    if (!lead) return;

    const fingerprint = `${lead.leadId}:${lead.name}`;
    if (fingerprint === lastDetectedLeadId) return;
    lastDetectedLeadId = fingerprint;

    console.log("[LeadFlow] Lead detected:", lead);
    chrome.runtime.sendMessage({ type: "LEAD_DETECTED", lead });
  }

  // ── Auto-dismiss Thumbtack post-send modal then navigate to conversation ───
  // After sending, Thumbtack shows an upsell modal ("Want more leads").
  // We click the X to close it (NEVER "Update preferences"), then navigate
  // directly to /messages/{leadId} which we already know.
  function tryDismissModal() {
    // Priority 1: close X buttons
    const closeXSelectors = [
      'button[aria-label="Close"]',
      'button[aria-label="close"]',
      'button[aria-label="Dismiss"]',
      'button[title="Close"]',
      'button[title="close"]',
    ];
    for (const sel of closeXSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        console.log("[LeadFlow] Clicking close X:", sel);
        btn.click();
        return true;
      }
    }
    // Priority 2: buttons whose only content is × ✕ ✖
    const allBtns = Array.from(document.querySelectorAll("button"));
    for (const btn of allBtns) {
      const text = btn.textContent?.trim();
      if (text === "×" || text === "✕" || text === "✖" || text === "\u2715") {
        console.log("[LeadFlow] Clicking × button");
        btn.click();
        return true;
      }
    }
    // Priority 3: safe dismiss labels inside a modal — but NEVER "Update preferences"
    const SAFE = ["dismiss", "got it", "skip", "no thanks", "maybe later", "not now"];
    const UNSAFE = ["update", "upgrade", "buy", "purchase", "subscribe", "pay", "add payment"];
    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const dialog of dialogs) {
      for (const btn of dialog.querySelectorAll("button")) {
        const label = btn.textContent?.trim().toLowerCase();
        if (!label) continue;
        if (UNSAFE.some(u => label.includes(u))) continue;
        if (SAFE.some(s => label.includes(s))) {
          console.log("[LeadFlow] Dismissing modal via safe button:", btn.textContent?.trim());
          btn.click();
          return true;
        }
      }
    }
    return false;
  }

  function startModalWatch(leadId) {
    if (modalWatchInterval) return;
    let attempts = 0;
    modalWatchInterval = setInterval(() => {
      attempts++;
      if (attempts > 20) { // 10 seconds max
        clearInterval(modalWatchInterval);
        modalWatchInterval = null;
        console.warn("[LeadFlow] Modal watch timed out — navigating to messages anyway");
        if (leadId) navigateDirectlyToConversation(leadId);
        return;
      }
      if (tryDismissModal()) {
        clearInterval(modalWatchInterval);
        modalWatchInterval = null;
        // Navigate directly to the conversation using the known leadId
        setTimeout(() => {
          if (leadId) navigateDirectlyToConversation(leadId);
        }, 500);
      }
    }, 500);
  }

  function navigateDirectlyToConversation(leadId) {
    const targetUrl = `https://www.thumbtack.com/pro-inbox/messages/${leadId}`;
    console.log("[LeadFlow] Navigating directly to conversation:", targetUrl);
    window.location.href = targetUrl;
  }

  // ── On-page toast banner ────────────────────────────────────────────────────
  let toastEl = null;
  function showToast(msg, color) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText = [
        "position:fixed","bottom:20px","right:20px","z-index:2147483647",
        "padding:10px 16px","border-radius:8px","font-size:13px","font-weight:600",
        "font-family:sans-serif","color:#fff","box-shadow:0 2px 12px rgba(0,0,0,0.3)",
        "max-width:320px","line-height:1.4","pointer-events:none","transition:background 0.3s"
      ].join(";");
      document.body.appendChild(toastEl);
    }
    toastEl.style.background = color || "#333";
    toastEl.textContent = msg;
    toastEl.style.display = "block";
  }
  function hideToast(delay) {
    setTimeout(() => { if (toastEl) toastEl.style.display = "none"; }, delay || 4000);
  }

  // ── Step 2: Messages page — auto-click reveal + watch for phone ────────────
  function scanForVisiblePhone() {
    // Check if phone is already visible anywhere on the page (e.g. sidebar)
    const allEls = document.querySelectorAll("a[href^='tel:'], p, span, div, strong, li, a");
    for (const el of allEls) {
      let phone = null;
      if (el.tagName === "A" && el.href?.startsWith("tel:")) {
        phone = el.href.replace("tel:", "").trim();
      } else {
        const text = el.textContent?.trim();
        if (
          text &&
          /^\+?1?[\s.-]?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}$/.test(text) &&
          !text.toLowerCase().includes("x")
        ) {
          phone = text;
        }
      }
      if (phone) return phone;
    }
    return null;
  }

  function tryRevealPhone() {
    if (phoneAlreadyReported) return;

    showToast("🔍 LeadFlow: scanning for phone...", "#555");

    // First check if phone is already visible (e.g. in sidebar)
    const existingPhone = scanForVisiblePhone();
    if (existingPhone) {
      phoneAlreadyReported = true;
      showToast("📞 Phone found — firing bridge...", "#1a7f4b");
      console.log("[LeadFlow] Phone already visible on page:", existingPhone);
      const nameEl =
        document.querySelector("h1") ||
        document.querySelector("h2");
      const rawName = nameEl?.textContent?.trim() || null;
      const leadName = (rawName && rawName !== "Messages" && rawName.length < 60) ? rawName : null;
      chrome.runtime.sendMessage({
        type: "PHONE_REVEALED",
        phone: existingPhone,
        leadName,
        url: window.location.href,
      });
      return;
    }

    if (revealAlreadyClicked) return;

    const revealLinks = Array.from(document.querySelectorAll("a, button, span"))
      .filter(el => el.textContent?.trim() === "Click to show phone number");

    if (revealLinks.length === 0) {
      // Not found yet — start watching
      showToast("⏳ LeadFlow: waiting for phone reveal...", "#555");
      startPhoneWatch();
      return;
    }

    revealAlreadyClicked = true;
    showToast("👆 LeadFlow: clicking phone reveal...", "#555");
    console.log("[LeadFlow] Clicking 'Click to show phone number'");
    revealLinks[0].click();

    startPhoneWatch();
  }

  function startPhoneWatch() {
    if (phoneWatchInterval) return;
    phoneAlreadyReported = false;
    console.log("[LeadFlow] Watching for revealed phone number...");

    phoneWatchInterval = setInterval(() => {
      if (phoneAlreadyReported) {
        clearInterval(phoneWatchInterval);
        phoneWatchInterval = null;
        return;
      }

      const allEls = document.querySelectorAll("a[href^='tel:'], p, span, div, strong, li");
      for (const el of allEls) {
        let phone = null;

        if (el.tagName === "A" && el.href?.startsWith("tel:")) {
          phone = el.href.replace("tel:", "").trim();
        } else {
          const text = el.textContent?.trim();
          if (
            text &&
            /^\+?1?\s*\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}$/.test(text) &&
            !text.toLowerCase().includes("x")
          ) {
            phone = text;
          }
        }

        if (phone) {
          phoneAlreadyReported = true;
          clearInterval(phoneWatchInterval);
          phoneWatchInterval = null;
          showToast("📞 Phone found — firing bridge...", "#1a7f4b");
          console.log("[LeadFlow] Phone revealed:", phone);

          const nameEl =
            document.querySelector("[class*='conversationHeader'] h1") ||
            document.querySelector("[class*='conversationHeader'] h2") ||
            document.querySelector("[class*='thread'] h1") ||
            document.querySelector("[class*='thread'] h2") ||
            document.querySelector("header h1") ||
            document.querySelector("header h2") ||
            document.querySelector("h1");
          const rawName = nameEl?.textContent?.trim() || null;
          const leadName = (rawName && rawName !== "Messages" && rawName.length < 60) ? rawName : null;

          chrome.runtime.sendMessage({
            type: "PHONE_REVEALED",
            phone,
            leadName,
            url: window.location.href,
          });
          return;
        }
      }
    }, 1000);

    setTimeout(() => {
      if (phoneWatchInterval) {
        clearInterval(phoneWatchInterval);
        phoneWatchInterval = null;
        console.log("[LeadFlow] Phone watch timed out");
      }
    }, 3 * 60 * 1000);
  }

  // ── Message Injection (Step 1 — reply box on /pro-leads/{id}) ─────────────
  function injectMessage(message, autoSend, leadId) {
    const replyBox =
      document.querySelector('textarea[placeholder*="Answer any questions"]') ||
      document.querySelector('textarea[placeholder*="answer any questions"]') ||
      document.querySelector('textarea[placeholder*="next steps"]') ||
      document.querySelector('textarea[placeholder*="Type message"]') ||
      document.querySelector('textarea[placeholder*="type message"]') ||
      document.querySelector('textarea[placeholder*="message"]') ||
      document.querySelector('textarea[placeholder*="Message"]') ||
      document.querySelector('textarea[placeholder*="reply"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector("textarea");

    if (!replyBox) {
      return {
        success: false,
        error: "Could not find Thumbtack reply box. Please paste the message manually.",
      };
    }

    // Inject using React's native setter so React state updates properly
    if (replyBox.tagName === "TEXTAREA") {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      nativeSetter.call(replyBox, message);
      replyBox.dispatchEvent(new Event("input", { bubbles: true }));
      replyBox.dispatchEvent(new Event("change", { bubbles: true }));
      replyBox.focus();
    } else {
      replyBox.focus();
      replyBox.textContent = message;
      replyBox.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (autoSend) {
      setTimeout(() => {
        const sendBtn =
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[aria-label*="Send"]') ||
          document.querySelector('button[aria-label*="send"]') ||
          Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent?.trim() === "Send" && !b.disabled
          ) ||
          document.querySelector('button[type="submit"]');

        if (sendBtn && !sendBtn.disabled) {
          // Tell background to navigate the tab — background survives page unloads
          const effectiveLeadId = leadId || currentLeadId;
          if (effectiveLeadId) {
            chrome.runtime.sendMessage({ type: "NAVIGATE_TO_MESSAGES", leadId: effectiveLeadId, delayMs: 1500 });
          }
          sendBtn.click();
          console.log("[LeadFlow] Auto-clicked Send button");
        } else {
          console.warn("[LeadFlow] Send button not found — message injected, waiting for manual send");
        }
      }, 400);
    }

    return { success: true };
  }

  // ── Listen for messages from background/popup ─────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "DO_INJECT") {
      const result = injectMessage(msg.message, msg.autoSend || false, msg.leadId || currentLeadId);
      sendResponse(result);
    }
    if (msg.type === "REVEAL_PHONE") {
      revealAlreadyClicked = false;
      tryRevealPhone();
      sendResponse({ ok: true });
    }
  });

  // ── Page-specific init ─────────────────────────────────────────────────────
  let leadListListenerAttached = false;
  function initLeadList() {
    // Guard: only attach once — MutationObserver calls this repeatedly
    if (leadListListenerAttached) return;
    leadListListenerAttached = true;
    document.addEventListener("click", (e) => {
      const card = e.target.closest("a[href*='/pro-leads/']");
      if (!card) return;
      // Extract lead ID from the href
      const hrefMatch = card.getAttribute("href")?.match(/\/pro-leads\/(\d+)/);
      if (!hrefMatch) return;
      const leadId = hrefMatch[1];
      const href = card.getAttribute("href");
      // Thumbtack always shows customer name as "First L." (first name + last initial + period)
      const allEls = card.querySelectorAll("div, span, p, h2, h3");
      let name = null;
      for (const el of allEls) {
        if (el.children.length > 0) continue; // leaf nodes only
        const text = el.textContent?.trim();
        if (!text) continue;
        // Match exactly "Chris B." format — first name + space + single capital + period
        if (/^[A-Z][a-z]+ [A-Z]\.$/.test(text)) {
          name = text;
          break;
        }
      }
      // Fallback: if strict format didn't match, take first short leaf text that isn't a known non-name
      if (!name) {
        const NON_NAME = /^(\d|\$|accept|view|reply|message|why|for you|opportunities|house|home|deep|move|lawn|carpet|window|office|painting|repair|plumbing|electric|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
        for (const el of allEls) {
          if (el.children.length > 0) continue;
          const text = el.textContent?.trim();
          if (!text || text.length < 2 || text.length > 35) continue;
          if (/,\s*[A-Z]{2}/.test(text)) continue; // city, state
          if (NON_NAME.test(text)) continue;
          name = text;
          break;
        }
      }
      if (!name) return; // truly no name found — let click proceed normally
      // Prevent default navigation, save name first, then navigate
      e.preventDefault();
      e.stopPropagation();
      console.log("[LeadFlow] Captured name from lead list:", name, "for lead", leadId);
      chrome.storage.local.set({ [`leadName_${leadId}`]: name }, () => {
        // Navigate after storage write completes
        window.location.href = href;
      });
    }, true); // capture phase
  }

  function init() {
    if (isLeadListPage()) {
      initLeadList();
    } else if (isLeadDetailPage()) {
      detectAndReport();
    } else if (isMessagesPage()) {
      // On /messages/{id} — try to reveal the phone number
      showToast("⚡ LeadFlow active on this page", "#333");
      setTimeout(() => {
        tryRevealPhone();
      }, 1500);
    }
  }

  // ── SPA navigation watcher ─────────────────────────────────────────────────
  let mutationDebounceTimer = null;
  const observer = new MutationObserver(() => {
    if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => {
      mutationDebounceTimer = null;
      if (isLeadListPage()) initLeadList();
      if (isLeadDetailPage()) detectAndReport();
      if (isMessagesPage()) tryRevealPhone();
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastDetectedLeadId = null;
      phoneAlreadyReported = false;
      revealAlreadyClicked = false;
      leadListListenerAttached = false; // allow re-attaching on return to list page
      if (phoneWatchInterval) {
        clearInterval(phoneWatchInterval);
        phoneWatchInterval = null;
      }
      if (modalWatchInterval) {
        clearInterval(modalWatchInterval);
        modalWatchInterval = null;
      }
      setTimeout(init, 800);
    }
  }, 500);

  // Run on initial page load
  init();
})();
