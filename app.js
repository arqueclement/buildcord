const SESSION_KEY = "buildcord:admin-session:v2";
const MEMBER_KEYS = "buildcord:member-tickets:v2";
const MEMBER_EMAIL_KEY = "buildcord:member-email:v1";
const MEMBER_SESSION_KEY = "buildcord:member-session:v1";
const API_URL = "/api/tickets";
const REFRESH_INTERVAL_MS = 30000;
const savedMemberEmail = localStorage.getItem(MEMBER_EMAIL_KEY) || "";

localStorage.removeItem(MEMBER_SESSION_KEY);
localStorage.removeItem(MEMBER_KEYS);

const state = {
  tickets: [],
  selectedId: null,
  isAdmin: Boolean(sessionStorage.getItem(SESSION_KEY)),
  adminToken: sessionStorage.getItem(SESSION_KEY) || "",
  memberEmail: savedMemberEmail,
  memberSession: "",
  memberAccess: [],
  isLoading: false,
  hasLoaded: false,
  error: "",
};

const nodes = {
  orderForm: document.querySelector("#orderForm"),
  orderHeader: document.querySelector("#orderHeader"),
  memberName: document.querySelector("#memberName"),
  memberEmail: document.querySelector("#memberEmail"),
  serviceType: document.querySelector("#serviceType"),
  orderDetails: document.querySelector("#orderDetails"),
  memberLoginForm: document.querySelector("#memberLoginForm"),
  restoreEmail: document.querySelector("#restoreEmail"),
  restoreCode: document.querySelector("#restoreCode"),
  togglePasswordButton: document.querySelector("#togglePasswordButton"),
  memberLoginError: document.querySelector("#memberLoginError"),
  loginForm: document.querySelector("#loginForm"),
  adminId: document.querySelector("#adminId"),
  adminPassword: document.querySelector("#adminPassword"),
  loginError: document.querySelector("#loginError"),
  logoutButton: document.querySelector("#logoutButton"),
  sessionBadge: document.querySelector("#sessionBadge"),
  ticketList: document.querySelector("#ticketList"),
  ticketMeta: document.querySelector("#ticketMeta"),
  ticketTitle: document.querySelector("#ticketTitle"),
  closeTicketButton: document.querySelector("#closeTicketButton"),
  messages: document.querySelector("#messages"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector(".send-action"),
  clearClosedButton: document.querySelector("#clearClosedButton"),
};

function loadMemberAccess() {
  try {
    const saved = JSON.parse(localStorage.getItem(MEMBER_KEYS) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveMemberAccess() {
  localStorage.setItem(MEMBER_KEYS, JSON.stringify(state.memberAccess));
}

function rememberTicketAccess(ticketId, token) {
  state.memberAccess = state.memberAccess.filter((item) => item.id !== ticketId);
  state.memberAccess.push({ id: ticketId, token });
  saveMemberAccess();
}

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      adminToken: state.adminToken,
      memberEmail: state.memberEmail,
      memberSession: state.memberSession,
      memberAccess: state.memberAccess,
      ...payload,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Le serveur de tickets n'est pas deploye sur Cloudflare.");
    }
    throw new Error(data.error || "Impossible de contacter le serveur de tickets. Verifie les Functions dans Cloudflare.");
  }
  return data;
}

async function refreshTickets(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    state.isLoading = true;
    render();
  }

  try {
    const data = await api("list");
    state.error = "";
    state.tickets = data.tickets || [];
    if (!state.tickets.some((ticket) => ticket.id === state.selectedId)) {
      state.selectedId = state.tickets[0]?.id || null;
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.hasLoaded = true;
    state.isLoading = false;
    render();
  }
}

async function createTicket({ member, email, service, details }) {
  if (!state.memberSession) {
    throw new Error("Connecte-toi avec ton identifiant avant d'ouvrir un ticket.");
  }

  state.memberEmail = normalizeIdentifier(email);
  localStorage.setItem(MEMBER_EMAIL_KEY, state.memberEmail);

  const data = await api("create", { member, email: state.memberEmail, service, details });
  rememberTicketAccess(data.ticket.id, data.memberToken);
  state.selectedId = data.ticket.id;
  await refreshTickets();
}

async function login(event) {
  event.preventDefault();
  nodes.loginError.textContent = "";

  try {
    const data = await api("login", {
      adminId: nodes.adminId.value.trim(),
      adminPassword: nodes.adminPassword.value,
    });

    state.isAdmin = true;
    state.adminToken = data.adminToken;
    sessionStorage.setItem(SESSION_KEY, data.adminToken);
    nodes.loginForm.reset();
    window.location.href = "admin.html";
  } catch (error) {
    nodes.loginError.textContent = error.message;
  }
}

function logout() {
  state.isAdmin = false;
  state.adminToken = "";
  state.memberEmail = "";
  state.memberSession = "";
  state.memberAccess = [];
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(MEMBER_EMAIL_KEY);
  localStorage.removeItem(MEMBER_SESSION_KEY);
  localStorage.removeItem(MEMBER_KEYS);
  refreshTickets();
}

function getSelectedTicket() {
  return state.tickets.find((ticket) => ticket.id === state.selectedId) || null;
}

function getMemberToken(ticketId) {
  return state.memberAccess.find((item) => item.id === ticketId)?.token || "";
}

async function sendMessage(event) {
  event.preventDefault();
  const ticket = getSelectedTicket();
  const text = nodes.messageInput.value.trim();

  if (!ticket || !text || ticket.status === "closed") return;

  nodes.messageInput.value = "";
  await api("sendMessage", {
    ticketId: ticket.id,
    memberToken: getMemberToken(ticket.id),
    text,
  });
  await refreshTickets();
}

async function closeTicket() {
  const ticket = getSelectedTicket();
  if (!ticket || !state.isAdmin) return;

  await api("closeTicket", { ticketId: ticket.id });
  await refreshTickets();
}

async function clearClosedTickets() {
  await api("clearClosed");
  await refreshTickets();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ticketName(ticket) {
  return `ticket-${ticket.number}`;
}

function renderTicketList() {
  if (!state.memberSession) {
    nodes.ticketList.innerHTML = `<div class="empty-state">Connecte-toi avec ton identifiant pour voir tes tickets.</div>`;
    return;
  }

  if (state.isLoading && !state.hasLoaded) {
    nodes.ticketList.innerHTML = `<div class="empty-state">Chargement des tickets...</div>`;
    return;
  }

  if (state.error) {
    nodes.ticketList.innerHTML = `<div class="empty-state">${escapeHtml(state.error)}</div>`;
    return;
  }

  if (state.tickets.length === 0) {
    nodes.ticketList.innerHTML = `<div class="empty-state">Aucun ticket visible pour ce compte.</div>`;
    return;
  }

  nodes.ticketList.innerHTML = state.tickets
    .map((ticket) => {
      const isActive = ticket.id === state.selectedId;
      const statusText = ticket.status === "open" ? "ouvert" : "ferme";
      return `
        <button class="ticket-button ${isActive ? "active" : ""} ${ticket.status === "closed" ? "closed" : ""}" type="button" data-ticket-id="${ticket.id}">
          <span class="ticket-row">
            <strong># ${ticketName(ticket)}</strong>
            <em class="status-pill ${ticket.status === "closed" ? "closed" : ""}">${statusText}</em>
          </span>
          <span>${escapeHtml(ticket.member)} - ${escapeHtml(ticket.service)}</span>
        </button>
      `;
    })
    .join("");
}

function renderChat() {
  if (!state.memberSession) {
    nodes.ticketMeta.textContent = "Connexion requise";
    nodes.ticketTitle.textContent = "# espace-membre";
    nodes.messageInput.disabled = true;
    nodes.sendButton.disabled = true;
    nodes.closeTicketButton.classList.add("hidden");
    nodes.messages.innerHTML = `<div class="empty-state">Connecte-toi avec ton identifiant et ton mot de passe pour ouvrir ou suivre une commande.</div>`;
    return;
  }

  const ticket = getSelectedTicket();
  const canWrite = Boolean(ticket && ticket.status === "open");

  nodes.messageInput.disabled = !canWrite;
  nodes.sendButton.disabled = !canWrite;
  nodes.closeTicketButton.classList.toggle("hidden", !state.isAdmin || !ticket || ticket.status === "closed");

  if (!ticket) {
    nodes.ticketMeta.textContent = "Aucun ticket selectionne";
    nodes.ticketTitle.textContent = "# ouvrir-un-ticket";
    nodes.messages.innerHTML = `<div class="empty-state">Ouvre une commande pour creer un vrai salon de ticket.</div>`;
    return;
  }

  nodes.ticketMeta.textContent = `${ticket.member} - ${ticket.service} - ${formatDate(ticket.createdAt)}`;
  nodes.ticketTitle.textContent = `# ${ticketName(ticket)}`;
  nodes.messages.innerHTML = ticket.messages
    .map((message) => {
      const initials = message.author.slice(0, 2).toUpperCase();
      return `
        <section class="message">
          <div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="message-body">
            <div class="message-meta">
              <strong>${escapeHtml(message.author)}</strong>
              <span>${message.role === "admin" ? "Staff" : message.role === "system" ? "Systeme" : "Membre"}</span>
              <span>${formatDate(message.createdAt)}</span>
            </div>
            <div class="message-text">${escapeHtml(message.text)}</div>
          </div>
        </section>
      `;
    })
    .join("");

  nodes.messages.scrollTop = nodes.messages.scrollHeight;
}

function renderSession() {
  nodes.sessionBadge.textContent = state.isAdmin ? "Mode admin" : state.memberEmail ? state.memberEmail : "Mode membre";
  nodes.logoutButton.classList.toggle("hidden", !state.isAdmin && !state.memberSession);
  nodes.clearClosedButton.classList.toggle("hidden", !state.isAdmin || !state.tickets.some((ticket) => ticket.status === "closed"));
  const isMemberLoggedIn = Boolean(state.memberSession);
  document.body.classList.toggle("login-required", !isMemberLoggedIn);
  nodes.orderHeader.classList.toggle("hidden", !isMemberLoggedIn);
  nodes.orderForm.classList.toggle("hidden", !isMemberLoggedIn);
  nodes.memberLoginForm.classList.toggle("hidden", isMemberLoggedIn);
  nodes.memberEmail.value = state.memberEmail;
  nodes.memberEmail.readOnly = true;
  if (!nodes.restoreEmail.value) {
    nodes.restoreEmail.value = state.memberEmail;
  }
}

function render() {
  renderSession();
  renderTicketList();
  renderChat();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

nodes.orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await createTicket({
      member: nodes.memberName.value.trim(),
      email: nodes.memberEmail.value.trim(),
      service: nodes.serviceType.value,
      details: nodes.orderDetails.value.trim(),
    });
    nodes.orderForm.reset();
  } catch (error) {
    alert(error.message);
  }
});

nodes.memberLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  nodes.memberLoginError.textContent = "";
  const email = normalizeIdentifier(nodes.restoreEmail.value);
  const code = nodes.restoreCode.value.trim();

  try {
    const data = await api("memberLogin", { identifier: email, code });
    state.memberEmail = data.memberEmail;
    state.memberSession = data.memberSession;
    localStorage.setItem(MEMBER_EMAIL_KEY, state.memberEmail);
    localStorage.setItem(MEMBER_SESSION_KEY, state.memberSession);
    await refreshTickets();
    if (state.tickets.length === 0) {
      nodes.memberLoginError.textContent = "Connexion reussie. Tu peux maintenant ouvrir une commande.";
    }
  } catch (error) {
    nodes.memberLoginError.textContent = error.message;
  }
});

nodes.togglePasswordButton.addEventListener("click", () => {
  const isHidden = nodes.restoreCode.type === "password";
  nodes.restoreCode.type = isHidden ? "text" : "password";
  nodes.togglePasswordButton.textContent = isHidden ? "cacher" : "oeil";
  nodes.togglePasswordButton.setAttribute("aria-label", isHidden ? "Masquer le mot de passe" : "Voir le mot de passe");
});

nodes.loginForm?.addEventListener("submit", login);
nodes.logoutButton.addEventListener("click", logout);
nodes.messageForm.addEventListener("submit", sendMessage);
nodes.closeTicketButton.addEventListener("click", closeTicket);
nodes.clearClosedButton.addEventListener("click", clearClosedTickets);
nodes.ticketList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ticket-id]");
  if (!button) return;
  state.selectedId = button.dataset.ticketId;
  render();
});

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

refreshTickets();
setInterval(() => {
  if (!document.hidden) {
    refreshTickets({ silent: true });
  }
}, REFRESH_INTERVAL_MS);
