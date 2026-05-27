const TICKETS_KEY = "tickets";
const MEMBER_ACCOUNTS_KEY = "member-accounts";
const ADMIN_ID_HASH = "c0b77f7eee72dfd46520f934db2f0badf2a7915a80d9c7a049b3ccbfd9513c39";
const ADMIN_PASSWORD_HASH = "13472559ec86e965f6d85c6cbfd035d02127e383bb960c08628555419e215cb9";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return json(405, { error: "Methode non autorisee." });
  }

  if (!env.BUILDCORD_KV) {
    return json(500, { error: "Stockage Cloudflare KV manquant. Ajoute un KV binding nomme BUILDCORD_KV." });
  }

  try {
    const body = await request.json();
    const action = body.action;

    if (action === "login") return login(body, env);
    if (action === "memberLogin") return memberLogin(body, env);
    if (action === "list") return listTickets(body, env);
    if (action === "create") return createTicket(body, env);
    if (action === "sendMessage") return sendMessage(body, env);
    if (action === "closeTicket") return closeTicket(body, env);
    if (action === "clearClosed") return clearClosed(body, env);

    return json(400, { error: "Action inconnue." });
  } catch (error) {
    return json(500, { error: "Erreur serveur: " + error.message });
  }
}

async function login(body, env) {
  const idHash = await sha256(String(body.adminId || "").trim());
  const passwordHash = await sha256(String(body.adminPassword || ""));

  if (!safeEqual(idHash, ADMIN_ID_HASH) || !safeEqual(passwordHash, ADMIN_PASSWORD_HASH)) {
    return json(401, { error: "Identifiants incorrects." });
  }

  return json(200, { adminToken: await signToken({ role: "admin", exp: Date.now() + 12 * 60 * 60 * 1000 }, env) });
}

async function memberLogin(body, env) {
  const identifier = normalizeIdentifier(body.identifier || body.memberIdentifier || body.email || body.memberEmail);
  const code = cleanText(body.code, 64);
  if (!identifier || !code) return json(400, { error: "Identifiant et mot de passe obligatoires." });
  if (code.length < 6) return json(400, { error: "Le mot de passe doit faire au moins 6 caracteres." });

  const accounts = await readMemberAccounts(env);
  const codeHash = await hashMemberCode(identifier, code, env);

  if (!accounts[identifier]) {
    accounts[identifier] = {
      codeHash,
      createdAt: new Date().toISOString(),
    };
    await writeMemberAccounts(accounts, env);
  } else if (!safeEqual(accounts[identifier].codeHash, codeHash)) {
    return json(401, { error: "Identifiant ou mot de passe incorrect." });
  }

  return json(200, {
    memberEmail: identifier,
    memberSession: await signToken({ role: "member", email: identifier, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }, env),
  });
}

async function listTickets(body, env) {
  const tickets = await readTickets(env);
  const isAdmin = await isAdminToken(body.adminToken, env);

  if (isAdmin) {
    return json(200, { tickets: tickets.map(publicTicket) });
  }

  if (body.adminToken) {
    return json(403, { error: "Session admin expiree. Reconnectez-vous." });
  }

  const memberAccess = Array.isArray(body.memberAccess) ? body.memberAccess : [];
  const memberSession = await readMemberSession(body.memberSession, env);
  const memberEmail = memberSession?.email || "";
  const visible = tickets.filter((ticket) =>
    memberAccess.some((item) => item.id === ticket.id && item.token === ticket.memberToken) ||
    (memberEmail && normalizeIdentifier(ticket.memberEmail) === memberEmail)
  );

  return json(200, { tickets: visible.map(publicTicket) });
}

async function createTicket(body, env) {
  const memberSession = await readMemberSession(body.memberSession, env);
  if (!memberSession) {
    return json(403, { error: "Connexion membre requise." });
  }

  const member = cleanText(body.member, 32);
  const memberEmail = memberSession.email;
  const service = cleanText(body.service, 80);
  const details = cleanText(body.details, 1200);

  if (!member || !memberEmail || !service || !details) {
    return json(400, { error: "Merci de remplir toute la demande." });
  }

  const tickets = await readTickets(env);
  const nextNumber = tickets.reduce((max, ticket) => Math.max(max, Number(ticket.number) || 0), 0) + 1;
  const now = new Date().toISOString();
  const ticket = {
    id: crypto.randomUUID(),
    number: String(nextNumber).padStart(4, "0"),
    member,
    memberEmail,
    service,
    status: "open",
    memberToken: randomHex(32),
    createdAt: now,
    messages: [
      {
        author: "BuildCord",
        role: "system",
        text: `Ticket ouvert pour ${service}. Un admin pourra repondre ici.`,
        createdAt: now,
      },
      {
        author: member,
        role: "member",
        text: details,
        createdAt: now,
      },
    ],
  };

  tickets.unshift(ticket);
  await writeTickets(tickets, env);

  return json(200, { ticket: publicTicket(ticket), memberToken: ticket.memberToken });
}

async function sendMessage(body, env) {
  const tickets = await readTickets(env);
  const ticket = tickets.find((item) => item.id === body.ticketId);
  if (!ticket) return json(404, { error: "Ticket introuvable." });
  if (ticket.status === "closed") return json(400, { error: "Ce ticket est ferme." });

  const isAdmin = await isAdminToken(body.adminToken, env);
  const memberSession = await readMemberSession(body.memberSession, env);
  const memberEmail = memberSession?.email || "";
  const isMember =
    (body.memberToken && body.memberToken === ticket.memberToken) ||
    (memberEmail && normalizeIdentifier(ticket.memberEmail) === memberEmail);
  if (!isAdmin && !isMember) return json(403, { error: "Acces refuse." });

  const text = cleanText(body.text, 1200);
  if (!text) return json(400, { error: "Message vide." });

  ticket.messages.push({
    author: isAdmin ? "Admin" : ticket.member,
    role: isAdmin ? "admin" : "member",
    text,
    createdAt: new Date().toISOString(),
  });
  await writeTickets(tickets, env);

  return json(200, { ticket: publicTicket(ticket) });
}

async function closeTicket(body, env) {
  if (!(await isAdminToken(body.adminToken, env))) return json(403, { error: "Acces admin requis." });

  const tickets = await readTickets(env);
  const ticket = tickets.find((item) => item.id === body.ticketId);
  if (!ticket) return json(404, { error: "Ticket introuvable." });
  if (ticket.status === "closed") return json(200, { ticket: publicTicket(ticket) });

  ticket.status = "closed";
  ticket.closedAt = new Date().toISOString();
  ticket.messages.push({
    author: "Admin",
    role: "admin",
    text: "Le ticket est ferme. Merci d'avoir contacte BuildCord.",
    createdAt: ticket.closedAt,
  });
  await writeTickets(tickets, env);

  return json(200, { ticket: publicTicket(ticket) });
}

async function clearClosed(body, env) {
  if (!(await isAdminToken(body.adminToken, env))) return json(403, { error: "Acces admin requis." });

  const tickets = await readTickets(env);
  await writeTickets(tickets.filter((ticket) => ticket.status !== "closed"), env);
  return json(200, { ok: true });
}

async function readTickets(env) {
  const tickets = await env.BUILDCORD_KV.get(TICKETS_KEY, "json");
  return Array.isArray(tickets) ? tickets : [];
}

async function writeTickets(tickets, env) {
  await env.BUILDCORD_KV.put(TICKETS_KEY, JSON.stringify(tickets));
}

async function readMemberAccounts(env) {
  const accounts = await env.BUILDCORD_KV.get(MEMBER_ACCOUNTS_KEY, "json");
  return accounts && typeof accounts === "object" && !Array.isArray(accounts) ? accounts : {};
}

async function writeMemberAccounts(accounts, env) {
  await env.BUILDCORD_KV.put(MEMBER_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function publicTicket(ticket) {
  return {
    id: ticket.id,
    number: ticket.number,
    member: ticket.member,
    memberEmail: ticket.memberEmail,
    service: ticket.service,
    status: ticket.status,
    createdAt: ticket.createdAt,
    closedAt: ticket.closedAt,
    messages: ticket.messages || [],
  };
}

async function signToken(payload, env) {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(encoded, tokenSecret(env));
  return `${encoded}.${signature}`;
}

async function isAdminToken(token, env) {
  const payload = await readSignedToken(token, env);
  return Boolean(payload && payload.role === "admin");
}

async function readMemberSession(token, env) {
  const payload = await readSignedToken(token, env);
  if (!payload || payload.role !== "member" || !payload.email) return null;
  return payload;
}

async function readSignedToken(token, env) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = await hmacSha256(encoded, tokenSecret(env));
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashMemberCode(identifier, code, env) {
  return sha256(`${normalizeIdentifier(identifier)}:${code}:${tokenSecret(env)}`);
}

async function hmacSha256(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlFromBytes(new Uint8Array(signature));
}

function base64UrlEncode(value) {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomHex(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tokenSecret(env) {
  return env.BUILDCORD_TOKEN_SECRET || ADMIN_PASSWORD_HASH;
}

function safeEqual(a, b) {
  return String(a) === String(b);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase().slice(0, 80);
}

function json(status, data) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
