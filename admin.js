const SESSION_KEY = "buildcord:admin-session:v2";
const API_URL = "/api/tickets";
const REFRESH_INTERVAL_MS = 30000;

const state = {
  tickets: [],
  selectedId: null,
  adminToken: sessionStorage.getItem(SESSION_KEY) || "",
  isLoading: false,
  hasLoaded: false,
  error: "",
};

const nodes = {
  logoutButton: document.querySelector("#logoutButton"),
  adminLoginScreen: document.querySelector("#adminLoginScreen"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminId: document.querySelector("#adminId"),
  adminPassword: document.querySelector("#adminPassword"),
  loginError: document.querySelector("#loginError"),
  adminStats: document.querySelector("#adminStats"),
  adminConsole: document.querySelector("#adminConsole"),
  clearClosedButton: document.querySelector("#clearClosedButton"),
  ticketList: document.querySelector("#ticketList"),
  ticketMeta: document.querySelector("#ticketMeta"),
  ticketTitle: document.querySelector("#ticketTitle"),
  closeTicketButton: document.querySelector("#closeTicketButton"),
  messages: document.querySelector("#messages"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector(".send-action"),
  totalTickets: document.querySelector("#totalTickets"),
  openTickets: document.querySelector("#openTickets"),
  closedTickets: document.querySelector("#closedTickets"),
};

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      adminToken: state.adminToken,
      ...payload,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Le serveur de tickets n'est pas deploye sur Cloudflare.");
    }
    throw new Error(data.error || "Impossible de charger les tickets. Verifie les Functions dans Cloudflare.");
  }
  return data;
}

async function loginAdmin(event) {
  event.preventDefault();
  nodes.loginError.textContent = "";

  try {
    const data = await api("login", {
      adminId: nodes.adminId.value.trim(),
      adminPassword: nodes.adminPassword.value,
    });

    state.adminToken = data.adminToken;
    sessionStorage.setItem(SESSION_KEY, data.adminToken);
    nodes.adminLoginForm.reset();
    await refreshTickets();
  } catch (error) {
    nodes.loginError.textContent = error.message;
  }
}

async function refreshTickets(options = {}) {
  if (!state.adminToken) {
    render();
    return;
  }

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
    if (error.message.includes("admin") || error.message.includes("Acces")) {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } finally {
    state.hasLoaded = true;
    state.isLoading = false;
    render();
  }
}

function getSelectedTicket() {
  return state.tickets.find((ticket) => ticket.id === state.selectedId) || null;
}

async function sendMessage(event) {
  event.preventDefault();
  const ticket = getSelectedTicket();
  const text = nodes.messageInput.value.trim();

  if (!ticket || !text || ticket.status === "closed") return;

  nodes.messageInput.value = "";
  await api("sendMessage", { ticketId: ticket.id, text });
  await refreshTickets();
}

async function closeTicket() {
  const ticket = getSelectedTicket();
  if (!ticket) return;

  await api("closeTicket", { ticketId: ticket.id });
  await refreshTickets();
}

async function clearClosedTickets() {
  await api("clearClosed");
  await refreshTickets();
}

function logout() {
  state.adminToken = "";
  state.tickets = [];
  state.selectedId = null;
  sessionStorage.removeItem(SESSION_KEY);
  render();
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

function renderStats() {
  const openCount = state.tickets.filter((ticket) => ticket.status === "open").length;
  const closedCount = state.tickets.filter((ticket) => ticket.status === "closed").length;

  nodes.totalTickets.textContent = state.tickets.length;
  nodes.openTickets.textContent = openCount;
  nodes.closedTickets.textContent = closedCount;
}

function renderTicketList() {
  if (state.isLoading && !state.hasLoaded) {
    nodes.ticketList.innerHTML = `<div class="empty-state">Chargement des commandes...</div>`;
    return;
  }

  if (state.error) {
    nodes.ticketList.innerHTML = `<div class="empty-state">${escapeHtml(state.error)}</div>`;
    return;
  }

  if (state.tickets.length === 0) {
    nodes.ticketList.innerHTML = `<div class="empty-state">Aucune commande de ticket pour le moment.</div>`;
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
          <span>${escapeHtml(ticket.member)}</span>
          <span>${escapeHtml(ticket.memberEmail || "Identifiant non renseigne")}</span>
          <span>${escapeHtml(ticket.service)}</span>
          <span>${formatDate(ticket.createdAt)}</span>
        </button>
      `;
    })
    .join("");
}

function renderChat() {
  const ticket = getSelectedTicket();
  const canWrite = Boolean(ticket && ticket.status === "open");

  nodes.messageInput.disabled = !canWrite;
  nodes.sendButton.disabled = !canWrite;
  nodes.closeTicketButton.classList.toggle("hidden", !ticket || ticket.status === "closed");
  nodes.clearClosedButton.classList.toggle("hidden", !state.tickets.some((ticketItem) => ticketItem.status === "closed"));

  if (!ticket) {
    nodes.ticketMeta.textContent = "Aucun ticket selectionne";
    nodes.ticketTitle.textContent = "# ticket";
    nodes.messages.innerHTML = `<div class="empty-state">Selectionne une commande pour voir la discussion.</div>`;
    return;
  }

  nodes.ticketMeta.textContent = `${ticket.member} - ${ticket.memberEmail || "Identifiant non renseigne"} - ${ticket.service} - ${formatDate(ticket.createdAt)}`;
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

function render() {
  const isLoggedIn = Boolean(state.adminToken);
  nodes.adminLoginScreen.classList.toggle("hidden", isLoggedIn);
  nodes.adminStats.classList.toggle("hidden", !isLoggedIn);
  nodes.adminConsole.classList.toggle("hidden", !isLoggedIn);
  nodes.logoutButton.classList.toggle("hidden", !isLoggedIn);

  if (!isLoggedIn) return;

  renderStats();
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

nodes.logoutButton.addEventListener("click", logout);
nodes.adminLoginForm.addEventListener("submit", loginAdmin);
nodes.messageForm.addEventListener("submit", sendMessage);
nodes.closeTicketButton.addEventListener("click", closeTicket);
nodes.clearClosedButton.addEventListener("click", clearClosedTickets);
nodes.ticketList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ticket-id]");
  if (!button) return;
  state.selectedId = button.dataset.ticketId;
  render();
});

refreshTickets();
setInterval(() => {
  if (!document.hidden) {
    refreshTickets({ silent: true });
  }
}, REFRESH_INTERVAL_MS);
