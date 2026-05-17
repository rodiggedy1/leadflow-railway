// background.js — LeadFlow × Thumbtack Extension
// Handles communication between content script and popup

const THUMBTACK_PATTERN = "https://www.thumbtack.com/*";
const DEFAULT_LEADFLOW_URL = "https://quote.maidinblack.com";

// ── Persistent log (survives SW restarts) ─────────────────────────────────────
async function bgLog(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  console.log("[LeadFlow BG]", msg);
  const { bgLogs = [] } = await chrome.storage.local.get("bgLogs");
  bgLogs.push(line);
  if (bgLogs.length > 100) bgLogs.splice(0, bgLogs.length - 100);
  await chrome.storage.local.set({ bgLogs });
}

async function getLeadFlowUrl() {
  const { leadflowUrl } = await chrome.storage.sync.get("leadflowUrl");
  return leadflowUrl || DEFAULT_LEADFLOW_URL;
}

// ── Fire the full bridge flow from background (popup-independent) ─────────────
// This runs whenever a phone is revealed, whether the popup is open or not.
async function fireBridgeFromBackground(phone, leadName) {
  if (!phone) return;

  try {
    const base = await getLeadFlowUrl();

    // Read stored pending data from chrome.storage.local (survives service worker restarts)
    const stored = await chrome.storage.local.get([
      "pendingMessage",
      "pendingLeadName",
      "pendingServiceType",
    ]);
    const pendingMessage = stored.pendingMessage || "";
    const effectiveThumbName = stored.pendingLeadName || leadName || "";
    const resolvedService = stored.pendingServiceType || "";

    await bgLog(`Firing bridge for phone: ${phone}, name: ${effectiveThumbName}, msg len: ${pendingMessage.length}`);

    // Step 1: Find + update the LeadFlow session with the real phone
    let resolvedSessionId = null;
    let resolvedName = leadName || effectiveThumbName || "New Lead";

    if (effectiveThumbName) {
      try {
        const updateResp = await fetch(`${base}/api/thumbtack/update-lead-phone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thumbtackName: effectiveThumbName,
            fullName: leadName && leadName !== effectiveThumbName ? leadName : undefined,
            realPhone: phone,
          }),
        });
        const updateData = await updateResp.json();
        if (updateResp.ok && updateData.sessionId) {
          resolvedSessionId = updateData.sessionId;
          resolvedName = updateData.leadName || resolvedName;
          await bgLog(`Session updated: ${JSON.stringify(updateData)}`);
        } else {
          await bgLog(`update-lead-phone failed: ${updateData.error}`);
        }
      } catch (e) {
        await bgLog(`update-lead-phone error: ${e.message}`);
      }
    }

    // Step 2: Fire bridge call (SMS + Vapi office call)
    const bridgeResp = await fetch(`${base}/api/thumbtack/bridge-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadName: resolvedName,
        leadPhone: phone,
        serviceType: resolvedService,
        message: pendingMessage,
        sessionId: resolvedSessionId || undefined,
      }),
    });
    const bridgeData = await bridgeResp.json();

    if (!bridgeResp.ok || bridgeData.error) {
      await bgLog(`Bridge call FAILED: ${bridgeData.error}`);
      chrome.action.setBadgeText({ text: "ERR" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    } else {
      await bgLog(`Bridge call success: sms=${bridgeData.sms} call=${bridgeData.call}`);
      chrome.action.setBadgeText({ text: "\u2713" });
      chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
      // Store bridge completion so popup shows Done state on reopen
      chrome.storage.local.set({ bridgeComplete: true, bridgeLeadName: resolvedName });
      // Clear pending data (but keep bridgeComplete + bridgeLeadName)
      chrome.storage.local.remove([
        "pendingMessage",
        "pendingLeadName",
        "pendingServiceType",
        "pendingLead",
      ]);
      // Notify popup if it's open so it can show success toast
      chrome.runtime.sendMessage({
        type: "BRIDGE_COMPLETE",
        sms: bridgeData.sms,
        call: bridgeData.call,
        leadName: resolvedName,
      }).catch(() => {}); // popup may be closed — that's fine
    }
  } catch (e) {
    await bgLog(`Bridge error: ${e.message}`);
    chrome.action.setBadgeText({ text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── Lead detected on /pro-leads/{id} ──────────────────────────────────────
  if (msg.type === "LEAD_DETECTED") {
    // Compare incoming leadId to the stored pendingLead to decide what to wipe.
    // Same lead (e.g. navigating /pro-leads → /messages for the same lead):
    //   → keep pendingMessage/pendingLeadName/pendingServiceType intact so the
    //     bridge-call SMS still has the message that was generated in the popup.
    // Different lead (a brand-new Thumbtack lead):
    //   → wipe everything so nothing from the prior lead survives.
    chrome.storage.local.get("pendingLead", (stored) => {
      const isSameLead = stored.pendingLead?.leadId &&
                         stored.pendingLead.leadId === msg.lead.leadId;

      if (isSameLead) {
        // Same lead re-detected (URL navigation) — only reset bridge/phone state,
        // NOT the pending message that the popup already wrote.
        bgLog(`LEAD_DETECTED same lead ${msg.lead.leadId} — keeping pendingMessage`);
        chrome.storage.local.remove(["bridgeComplete", "bridgeLeadName", "revealedPhone", "revealedLeadName"]);
      } else {
        // New lead — wipe all previous-lead state so nothing contaminates this one.
        bgLog(`LEAD_DETECTED new lead ${msg.lead.leadId} (was ${stored.pendingLead?.leadId ?? "none"}) — wiping all state`);
        chrome.storage.local.remove([
          "bridgeComplete", "bridgeLeadName",
          "revealedPhone", "revealedLeadName",
          "pendingMessage", "pendingLeadName", "pendingServiceType",
        ]);
        // Wipe any previously revealed real phones from the server DB so stale
        // phone numbers from a prior lead can never contaminate this new lead.
        getLeadFlowUrl().then(base => {
          fetch(`${base}/api/thumbtack/clear-previous-phone`, { method: "POST" })
            .then(() => bgLog("clear-previous-phone: server DB wiped for new lead"))
            .catch(e => bgLog(`clear-previous-phone error: ${e.message}`));
        });
      }

      // Always update pendingLead with the freshest lead data and set badge.
      chrome.storage.local.set({ pendingLead: msg.lead });
      chrome.action.setBadgeText({ text: "1", tabId: sender.tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: "#e07b54" });
    });
  }

  // ── Lead cleared (dismissed or sent) ──────────────────────────────────────
  if (msg.type === "LEAD_CLEARED") {
    chrome.storage.local.remove("pendingLead");
    chrome.action.setBadgeText({ text: "" });
  }

  // ── Phone revealed on /messages page ──────────────────────────────────────
  // Fire the bridge immediately from background — no popup required.
  if (msg.type === "PHONE_REVEALED") {
    const { phone, leadName } = msg;

    // Store for popup to read if it opens later
    chrome.storage.local.set({
      revealedPhone: phone,
      revealedLeadName: leadName || null,
    });

    // Yellow "working" badge while bridge fires
    chrome.action.setBadgeText({ text: "…" });
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });

    // Fire bridge immediately — popup-independent
    fireBridgeFromBackground(phone, leadName);

    // Also notify popup if it's open (for live toast feedback)
    chrome.runtime.sendMessage({
      type: "PHONE_READY",
      phone,
      leadName,
    }).catch(() => {});
  }

  // ── Navigate Thumbtack tab to messages page (survives content script death) ──
  if (msg.type === "NAVIGATE_TO_MESSAGES") {
    const { leadId, delayMs } = msg;
    const targetUrl = `https://www.thumbtack.com/pro-inbox/messages/${leadId}`;
    setTimeout(() => {
      chrome.tabs.query({ url: "https://www.thumbtack.com/*" }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { url: targetUrl });
          bgLog(`Navigating tab to: ${targetUrl}`);
        }
      });
    }, delayMs || 1500);
  }

  // ── Forward inject request to Thumbtack tab ────────────────────────────────────
  if (msg.type === "INJECT_MESSAGE") {
    const injectPayload = {
      type: "DO_INJECT",
      message: msg.message,
      autoSend: msg.autoSend ?? true,
      leadName: msg.leadName || null,
      leadId: msg.leadId || null, // used for direct navigation to /messages/{leadId}
    };
    chrome.tabs.query({ url: THUMBTACK_PATTERN, active: true }, (tabs) => {
      const tab = tabs[0];
      if (tab) {
        chrome.tabs.sendMessage(tab.id, injectPayload, sendResponse);
      } else {
        chrome.tabs.query({ url: THUMBTACK_PATTERN }, (allTabs) => {
          if (allTabs.length > 0) {
            chrome.tabs.sendMessage(allTabs[0].id, injectPayload, sendResponse);
          } else {
            sendResponse({ success: false, error: "No Thumbtack tab found" });
          }
        });
      }
    });
    return true; // async response
  }

  return false;
});
