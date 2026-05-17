// popup.js — LeadFlow × Thumbtack Extension

const DEFAULT_LEADFLOW_URL = "https://quote.maidinblack.com";

// ── State ─────────────────────────────────────────────────────────────────────
let currentLead = null;
let currentSessionId = null; // LeadFlow session ID if lead was found in DB

// ── DOM refs ──────────────────────────────────────────────────────────────────
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const settingUrl = document.getElementById("setting-url");
const settingsSaveBtn = document.getElementById("settings-save-btn");

const idleState = document.getElementById("idle-state");
const manualPanel = document.getElementById("manual-panel");
const manualToggleBtn = document.getElementById("manual-toggle-btn");
const generateManualBtn = document.getElementById("generate-manual-btn");

const leadCard = document.getElementById("lead-card");
const leadNameDisplay = document.getElementById("lead-name-display");
const leadMetaDisplay = document.getElementById("lead-meta-display");
const loadingState = document.getElementById("loading-state");
const messageArea = document.getElementById("message-area");
const messageBox = document.getElementById("message-box");
const regenerateBtn = document.getElementById("regenerate-btn");
const sendBtn = document.getElementById("send-btn");
const dismissBtn = document.getElementById("dismiss-btn");
const toast = document.getElementById("toast");

// ── Settings ──────────────────────────────────────────────────────────────────
async function getLeadFlowUrl() {
  const { leadflowUrl } = await chrome.storage.sync.get("leadflowUrl");
  return leadflowUrl || DEFAULT_LEADFLOW_URL;
}

settingsToggle.addEventListener("click", async () => {
  const visible = settingsPanel.classList.toggle("visible");
  if (visible) {
    settingUrl.value = await getLeadFlowUrl();
  }
});

settingsSaveBtn.addEventListener("click", async () => {
  const url = settingUrl.value.trim().replace(/\/$/, "");
  await chrome.storage.sync.set({ leadflowUrl: url });
  settingsPanel.classList.remove("visible");
  showToast("Settings saved", "success");
});

// ── Logs panel ───────────────────────────────────────────────────────────────
const logsToggle = document.getElementById("logs-toggle");
const logsPanel = document.getElementById("logs-panel");
const logsContent = document.getElementById("logs-content");
const logsClearBtn = document.getElementById("logs-clear-btn");

async function refreshLogs() {
  const { bgLogs = [] } = await chrome.storage.local.get("bgLogs");
  logsContent.textContent = bgLogs.length ? bgLogs.join("\n") : "(no logs yet)";
  logsPanel.scrollTop = logsPanel.scrollHeight;
}

logsToggle.addEventListener("click", async () => {
  const visible = logsPanel.style.display === "block";
  logsPanel.style.display = visible ? "none" : "block";
  if (!visible) await refreshLogs();
});

logsClearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("bgLogs");
  logsContent.textContent = "(cleared)";
});

// ── tRPC helpers ──────────────────────────────────────────────────────────────
async function trpcMutation(procedure, input) {
  const base = await getLeadFlowUrl();
  const url = `${base}/api/trpc/${procedure}`;
  const resp = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "tRPC error");
  return data.result?.data?.json ?? data.result?.data;
}

async function trpcQuery(procedure, input) {
  const base = await getLeadFlowUrl();
  const params = new URLSearchParams({ input: JSON.stringify({ json: input }) });
  const url = `${base}/api/trpc/${procedure}?${params}`;
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "tRPC error");
  return data.result?.data?.json ?? data.result?.data;
}

// ── Build bookingDetails string ───────────────────────────────────────────────
function buildBookingDetails(lead) {
  const parts = [];
  if (lead.name) parts.push(`Name: ${lead.name}`);
  if (lead.phone) parts.push(`Phone: ${lead.phone}`);
  if (lead.service) parts.push(`Service: ${lead.service}`);
  // jobDetails is nested when scraped from Thumbtack; fall back to top-level for manual mode
  const beds = lead.jobDetails?.beds || lead.beds;
  const baths = lead.jobDetails?.baths || lead.baths;
  const notes = lead.customerMessage || lead.notes;
  if (beds) parts.push(`Bedrooms: ${beds.replace(" Bedroom", "").replace(" Bedrooms", "")}`);
  if (baths) parts.push(`Bathrooms: ${baths.replace(" Bathroom", "").replace(" Bathrooms", "")}`);
  if (lead.location) parts.push(`Location: ${lead.location}`);
  if (notes) parts.push(`Notes: ${notes}`);
  if (lead.description) parts.push(`Details: ${lead.description}`);
  return parts.join("\n");
}

// ── Generate message ──────────────────────────────────────────────────────────
async function generateMessage(lead) {
  showLoading(true);
  messageArea.style.display = "none";
  toast.className = "toast";

  try {
    const bookingDetails = buildBookingDetails(lead);
    const result = await trpcMutation("tools.generateFirstMessage", { bookingDetails });
    messageBox.value = result.message || result;
    showLoading(false);
    messageArea.style.display = "block";
  } catch (err) {
    showLoading(false);
    showToast(`Failed to generate: ${err.message}`, "error");
  }
}

// ── Send ──────────────────────────────────────────────────────────────────────
sendBtn.addEventListener("click", async () => {
  const message = messageBox.value.trim();
  if (!message) return;

  sendBtn.disabled = true;
  sendBtn.textContent = "Sending…";
  toast.className = "toast";

  try {
    const errors = [];

    // 1. Inject into Thumbtack reply box (with auto-send)
    try {
      const injectResult = await chrome.runtime.sendMessage({ type: "INJECT_MESSAGE", message, autoSend: true, leadName: currentLead?.name || null, leadId: currentLead?.leadId || null });
      if (!injectResult?.success) {
        errors.push(`Thumbtack inject: ${injectResult?.error || "failed"}`);
      }
    } catch (e) {
      errors.push(`Thumbtack inject: ${e.message}`);
    }

    // 2. Store the message so it can be sent as SMS when the phone is revealed later.
    //    Thumbtack never shows the real phone until after the first reply is sent,
    //    so SMS always fires in the phone-reveal step, not here.
    try {
      await chrome.storage.local.set({
        pendingMessage: message,
        pendingLeadName: currentLead?.name || "",
        pendingServiceType: currentLead?.service || "",
      });
      console.log("[LeadFlow] Message stored for SMS-on-reveal");
    } catch (e) {
      errors.push(`Message store: ${e.message}`);
    }

    // 3. Update lead name/phone in LeadFlow if we have a session
    if (currentSessionId && currentLead) {
      try {
        if (currentLead.name) {
          await trpcMutation("leads.updateLeadName", {
            sessionId: currentSessionId,
            leadName: currentLead.name,
          });
        }
        if (currentLead.phone) {
          await trpcMutation("leads.updateLeadPhone", {
            sessionId: currentSessionId,
            leadPhone: currentLead.phone,
          });
        }
      } catch (e) {
        errors.push(`Lead update: ${e.message}`);
      }
    }

    if (errors.length === 0) {
      showToast("✓ Sent on Thumbtack — SMS will fire when phone is revealed", "success");
      sendBtn.textContent = "Sent ✓";
      // Clear the badge
      chrome.runtime.sendMessage({ type: "LEAD_CLEARED" });
    } else {
      showToast(`Partial: ${errors.join("; ")}`, "error");
      sendBtn.disabled = false;
      sendBtn.textContent = "Send via SMS + Thumbtack";
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
    sendBtn.disabled = false;
    sendBtn.textContent = "Send via SMS + Thumbtack";
  }
});

// ── Dismiss ───────────────────────────────────────────────────────────────────
dismissBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "LEAD_CLEARED" });
  resetToIdle();
});

// ── Regenerate ────────────────────────────────────────────────────────────────
regenerateBtn.addEventListener("click", () => {
  if (currentLead) generateMessage(currentLead);
});

// ── Manual input ──────────────────────────────────────────────────────────────
manualToggleBtn.addEventListener("click", () => {
  manualPanel.classList.toggle("visible");
  idleState.style.display = manualPanel.classList.contains("visible") ? "none" : "block";
});

generateManualBtn.addEventListener("click", () => {
  const firstName = document.getElementById("m-first").value.trim();
  const lastName = document.getElementById("m-last").value.trim();
  const phone = document.getElementById("m-phone").value.trim();
  const service = document.getElementById("m-service").value;
  const beds = document.getElementById("m-beds").value;
  const baths = document.getElementById("m-baths").value;
  const notes = document.getElementById("m-notes").value.trim();

  if (!firstName) {
    showToast("First name is required", "error");
    return;
  }

  currentLead = {
    name: [firstName, lastName].filter(Boolean).join(" "),
    phone: phone || null,
    service,
    beds,
    baths,
    notes,
    location: null,
    description: null,
  };

  showLeadCard(currentLead);
  generateMessage(currentLead);
});

// ── UI helpers ────────────────────────────────────────────────────────────────
function showLoading(on) {
  loadingState.style.display = on ? "block" : "none";
}

function showToast(msg, type) {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
}

function showLeadCard(lead) {
  idleState.style.display = "none";
  manualPanel.classList.remove("visible");
  leadCard.classList.add("visible");

  leadNameDisplay.textContent = lead.name || "Unknown Lead";

  const meta = [];
  if (lead.phone) meta.push(`📞 ${lead.phone}`);
  if (lead.service) meta.push(`🧹 ${lead.service}`);
  if (lead.beds) meta.push(lead.beds);
  if (lead.baths) meta.push(lead.baths);
  if (lead.location) meta.push(`📍 ${lead.location}`);
  leadMetaDisplay.innerHTML = meta.map(m => `<span>${m}</span>`).join("");

  sendBtn.disabled = false;
  sendBtn.textContent = "Send via SMS + Thumbtack";
  toast.className = "toast";
}

function resetToIdle() {
  leadCard.classList.remove("visible");
  messageArea.style.display = "none";
  loadingState.style.display = "none";
  idleState.style.display = "block";
  currentLead = null;
  currentSessionId = null;
}

// ── On popup open: check for pending lead ────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(["pendingLead", "bridgeComplete", "bridgeLeadName"]);

  // If bridge already fired successfully, show Done state — don't restart
  if (stored.bridgeComplete) {
    idleState.style.display = "none";
    leadCard.classList.add("visible");
    leadNameDisplay.textContent = stored.bridgeLeadName || "Lead";
    leadMetaDisplay.innerHTML = "";
    messageArea.style.display = "none";
    loadingState.style.display = "none";
    sendBtn.disabled = true;
    sendBtn.textContent = "Done ✓";
    showToast(`✓ Bridge fired — SMS + office call sent`, "success");
    return;
  }

  if (stored.pendingLead) {
    currentLead = stored.pendingLead;
    showLeadCard(stored.pendingLead);
    generateMessage(stored.pendingLead);
  }
}

init();

// ── Listen for phone reveal from background ───────────────────────────────────
// When the content script auto-clicks "Click to show phone number" on the
// messages page, background.js stores the phone and fires PHONE_READY.
// If the popup is open, we fire the bridge call immediately.
// If the popup is closed, the phone is stored in session storage and the
// next time the popup opens it will check and fire.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PHONE_READY") {
    // Background already fires the bridge — popup just shows live feedback if open
    showToast("📞 Phone revealed — calling office + sending SMS…", "success");
  }
  if (msg.type === "BRIDGE_COMPLETE") {
    const smsSent = msg.sms ? " + SMS sent" : "";
    showToast(`✓ Office called${smsSent} — connecting to ${msg.leadName}`, "success");
    sendBtn.textContent = "Done ✓";
  }
});

async function fireBridgeWithRevealedPhone(phone, leadName) {
  if (!phone) return;
  try {
    const base = await getLeadFlowUrl();
    // thumbtackName = the short name stored in LeadFlow (e.g. "Mauli D.")
    // leadName = full name from Messages page header (e.g. "Mauli Dosi") — may be same or longer
    const thumbtackName = currentLead?.name || leadName || "";
    const fullName = leadName || currentLead?.name || "";
    const service = currentLead?.service || "";

    // Read the pending message that was stored when user clicked Send on the lead detail page
    const stored = await chrome.storage.local.get(["pendingMessage", "pendingLeadName", "pendingServiceType"]);
    const pendingMessage = stored.pendingMessage || "";
    // Use stored service if current lead context isn't available
    const resolvedService = service || stored.pendingServiceType || "";
    // Use stored name as fallback for thumbtackName if popup was closed and reopened
    const effectiveThumbName = thumbtackName || stored.pendingLeadName || "";

    showToast("🔍 Finding lead in LeadFlow…", "success");

    // Step 1: Find the session by name + thumbtack placeholder phone, update with real phone + full name
    let resolvedSessionId = currentSessionId;
    let resolvedName = fullName || effectiveThumbName || "New Lead";
    if (effectiveThumbName) {
      try {
        const updateResp = await fetch(`${base}/api/thumbtack/update-lead-phone`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thumbtackName: effectiveThumbName,
            fullName: fullName !== effectiveThumbName ? fullName : undefined,
            realPhone: phone,
          }),
        });
        const updateData = await updateResp.json();
        if (updateResp.ok && updateData.sessionId) {
          resolvedSessionId = updateData.sessionId;
          resolvedName = updateData.leadName || resolvedName;
          console.log("[LeadFlow] Session updated:", updateData);
        } else {
          console.warn("[LeadFlow] update-lead-phone failed:", updateData.error);
          // Non-fatal — still place the Vapi call even if session lookup fails
        }
      } catch (e) {
        console.warn("[LeadFlow] update-lead-phone error:", e.message);
        // Non-fatal
      }
    }

    // Step 2: Fire the bridge call — sends SMS with the pending message + places Vapi call to office
    showToast("📞 Sending SMS + calling office…", "success");
    const bridgeResp = await fetch(`${base}/api/thumbtack/bridge-call`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadName: resolvedName,
        leadPhone: phone,
        serviceType: resolvedService,
        message: pendingMessage,  // Send the stored message as SMS now that we have the real phone
        sessionId: resolvedSessionId || undefined,
      }),
    });
    const bridgeData = await bridgeResp.json();
    if (!bridgeResp.ok || bridgeData.error) {
      showToast(`Bridge call failed: ${bridgeData.error || "unknown error"}`, "error");
    } else {
      const smsSent = bridgeData.sms ? " + SMS sent" : "";
      showToast(`✓ Office called${smsSent} — connecting to ${resolvedName}`, "success");
      // Clear the revealed phone and pending message from storage
      chrome.storage.local.remove(["revealedPhone", "revealedLeadName", "pendingMessage", "pendingLeadName", "pendingServiceType"]);
      chrome.action.setBadgeText({ text: "" });
    }
  } catch (e) {
    showToast(`Bridge error: ${e.message}`, "error");
  }
}

// ── On popup open: also check if a phone was already revealed while popup was closed ──
async function checkRevealedPhone() {
  const { revealedPhone, revealedLeadName } = await chrome.storage.local.get([
    "revealedPhone",
    "revealedLeadName",
  ]);
  if (revealedPhone) {
    fireBridgeWithRevealedPhone(revealedPhone, revealedLeadName);
  }
}
// Run after init so currentLead is set first (800ms gives init() time to finish loading storage)
setTimeout(checkRevealedPhone, 800);
