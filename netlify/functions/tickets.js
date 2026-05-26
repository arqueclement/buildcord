import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const TICKETS_KEY = "tickets";
const MEMBER_CODES_KEY = "member-codes";
const MEMBER_ACCOUNTS_KEY = "member-accounts";
const ADMIN_ID_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const ADMIN_PASSWORD_HASH = "ecd71870d1963316a97e3ac3408c9835ad8cf0f3c1bc703527c30265534f75ae";
const TOKEN_SECRET = process.env.BUILDCORD_TOKEN_SECRET || ADMIN_PASSWORD_HASH;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "BuildCord <onboarding@resend.dev>";

export default async (request) => {
  if (request.method !== "POST") {
    return json(405, { error: "Methode non autorisee." });
  }

  try {
    const body = await request.json();
    const action = body.action;

    if (action === "login") return login(body);
    if (action === "memberLogin") return memberLogin(body);
    if (action === "requestMemberCode") return requestMemberCode(body);
    if (action === "verifyMemberCode") return verifyMemberCode(body);
    if (action === "list") return listTickets(body);
    if (action === "create") return createTicket(body);
    if (action === "sendMessage") return sendMessage(body);
    if (action === "closeTicket") return closeTicket(body);
    if (action === "clearClosed") return clearClosed(body);

    return json(400, { error: "Action inconnue." });
  } catch (error) {
    return json(500, { error: "Erreur serveur: " + error.message });
  }
};

async function login(body) {
  const idHash = sha256(String(body.adminId || "").trim());
  const passwordHash = sha256(String(body.adminPassword || ""));

  if (!safeEqual(idHash, ADMIN_ID_HASH) || !safeEqual(passwordHash, ADMIN_PASSWORD_HASH)) {
    return json(401, { error: "Identifiants incorrects." });
  }

  return json(200, { adminToken: signToken({ role: "admin", exp: Date.now() + 12 * 60 * 60 * 1000 }) });
}

async function memberLogin(body) {
  const email = normalizeIdentifier(body.identifier || body.memberIdentifier || body.email || body.memberEmail);
  const code = cleanText(body.code, 64);
  if (!email || !code) return json(400, { error: "Identifiant et mot de passe obligatoires." });
  if (code.length < 6) return json(400, { error: "Le mot de passe doit faire au moins 6 caracteres." });

  const accounts = await readMemberAccounts();
  const codeHash = hashMemberCode(email, code);

  if (!accounts[email]) {
    accounts[email] = {
      codeHash,
      createdAt: new Date().toISOString(),
    };
    await writeMemberAccounts(accounts);
  } else if (!safeEqual(accounts[email].codeHash, codeHash)) {
    return json(401, { error: "Identifiant ou mot de passe incorrect." });
  }

  return json(200, {
    memberEmail: email,
    memberSession: signToken({ role: "member", email, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }),
  });
}

async function requestMemberCode(body) {
  const email = normalizeEmail(body.email || body.memberEmail);
  if (!email) return json(400, { error: "Email obligatoire." });

  const code = String(crypto.randomInt(100000, 1000000));
  const codes = await readMemberCodes();
  codes[email] = {
    codeHash: sha256(code),
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
  };
  await writeMemberCodes(codes);
  await sendLoginEmail(email, code);

  return json(200, { ok: true });
}

async function verifyMemberCode(body) {
  const email = normalizeEmail(body.email || body.memberEmail);
  const code = cleanText(body.code, 6);
  if (!email || !code) return json(400, { error: "Email et code obligatoires." });

  const codes = await readMemberCodes();
  const saved = codes[email];
  if (!saved || Number(saved.expiresAt) < Date.now()) {
    delete codes[email];
    await writeMemberCodes(codes);
    return json(401, { error: "Code expire. Demande un nouveau code." });
  }

  saved.attempts = Number(saved.attempts || 0) + 1;
  if (saved.attempts > 5) {
    delete codes[email];
    await writeMemberCodes(codes);
    return json(401, { error: "Trop d'essais. Demande un nouveau code." });
  }

  if (!safeEqual(saved.codeHash, sha256(code))) {
    codes[email] = saved;
    await writeMemberCodes(codes);
    return json(401, { error: "Code incorrect." });
  }

  delete codes[email];
  await writeMemberCodes(codes);

  return json(200, {
    memberEmail: email,
    memberSession: signToken({ role: "member", email, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }),
  });
}

async function listTickets(body) {
  const tickets = await readTickets();
  const isAdmin = isAdminToken(body.adminToken);

  if (isAdmin) {
    return json(200, { tickets: tickets.map(publicTicket) });
  }

  if (body.adminToken) {
    return json(403, { error: "Session admin expiree. Reconnectez-vous." });
  }

  const memberAccess = Array.isArray(body.memberAccess) ? body.memberAccess : [];
  const memberSession = readMemberSession(body.memberSession);
  const memberEmail = memberSession?.email || "";
  const visible = tickets.filter((ticket) =>
    memberAccess.some((item) => item.id === ticket.id && item.token === ticket.memberToken) ||
    (memberEmail && normalizeEmail(ticket.memberEmail) === memberEmail)
  );

  return json(200, { tickets: visible.map(publicTicket) });
}

async function createTicket(body) {
  const memberSession = readMemberSession(body.memberSession);
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

  const tickets = await readTickets();
  const nextNumber = tickets.reduce((max, ticket) => Math.max(max, Number(ticket.number) || 0), 0) + 1;
  const now = new Date().toISOString();
  const ticket = {
    id: crypto.randomUUID(),
    number: String(nextNumber).padStart(4, "0"),
    member,
    memberEmail,
    service,
    status: "open",
    memberToken: crypto.randomBytes(32).toString("hex"),
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
  await writeTickets(tickets);

  return json(200, { ticket: publicTicket(ticket), memberToken: ticket.memberToken });
}

async function sendMessage(body) {
  const tickets = await readTickets();
  const ticket = tickets.find((item) => item.id === body.ticketId);
  if (!ticket) return json(404, { error: "Ticket introuvable." });
  if (ticket.status === "closed") return json(400, { error: "Ce ticket est ferme." });

  const isAdmin = isAdminToken(body.adminToken);
  const memberSession = readMemberSession(body.memberSession);
  const memberEmail = memberSession?.email || "";
  const isMember =
    (body.memberToken && body.memberToken === ticket.memberToken) ||
    (memberEmail && normalizeEmail(ticket.memberEmail) === memberEmail);
  if (!isAdmin && !isMember) return json(403, { error: "Acces refuse." });

  const text = cleanText(body.text, 1200);
  if (!text) return json(400, { error: "Message vide." });

  ticket.messages.push({
    author: isAdmin ? "Admin" : ticket.member,
    role: isAdmin ? "admin" : "member",
    text,
    createdAt: new Date().toISOString(),
  });
  await writeTickets(tickets);

  return json(200, { ticket: publicTicket(ticket) });
}

async function closeTicket(body) {
  if (!isAdminToken(body.adminToken)) return json(403, { error: "Acces admin requis." });

  const tickets = await readTickets();
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
  await writeTickets(tickets);

  return json(200, { ticket: publicTicket(ticket) });
}

async function clearClosed(body) {
  if (!isAdminToken(body.adminToken)) return json(403, { error: "Acces admin requis." });

  const tickets = await readTickets();
  await writeTickets(tickets.filter((ticket) => ticket.status !== "closed"));
  return json(200, { ok: true });
}

async function readTickets() {
  const store = getStore("buildcord");
  const tickets = await store.get(TICKETS_KEY, { type: "json" });
  return Array.isArray(tickets) ? tickets : [];
}

async function writeTickets(tickets) {
  const store = getStore("buildcord");
  await store.setJSON(TICKETS_KEY, tickets);
}

async function readMemberCodes() {
  const store = getStore("buildcord");
  const codes = await store.get(MEMBER_CODES_KEY, { type: "json" });
  return codes && typeof codes === "object" && !Array.isArray(codes) ? codes : {};
}

async function writeMemberCodes(codes) {
  const store = getStore("buildcord");
  await store.setJSON(MEMBER_CODES_KEY, codes);
}

async function readMemberAccounts() {
  const store = getStore("buildcord");
  const accounts = await store.get(MEMBER_ACCOUNTS_KEY, { type: "json" });
  return accounts && typeof accounts === "object" && !Array.isArray(accounts) ? accounts : {};
}

async function writeMemberAccounts(accounts) {
  const store = getStore("buildcord");
  await store.setJSON(MEMBER_ACCOUNTS_KEY, accounts);
}

async function sendLoginEmail(email, code) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY n'est pas configure dans Netlify.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: email,
      subject: "Ton code BuildCord",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h1>Code de connexion BuildCord</h1>
          <p>Voici ton code pour retrouver tes tickets:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
          <p>Ce code expire dans 10 minutes.</p>
        </div>
      `,
      text: `Ton code BuildCord est ${code}. Il expire dans 10 minutes.`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error("Impossible d'envoyer l'email: " + error);
  }
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

function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function isAdminToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [encoded, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.role === "admin" && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function readMemberSession(token) {
  const payload = readSignedToken(token);
  if (!payload || payload.role !== "member" || !payload.email) return null;
  return payload;
}

function readSignedToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashMemberCode(email, code) {
  return sha256(`${normalizeIdentifier(email)}:${code}:${TOKEN_SECRET}`);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 80);
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
