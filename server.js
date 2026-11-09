require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");
<<<<<<< HEAD
const session = require("express-session");
const rateLimit = require("express-rate-limit");
=======
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false } : false
});

app.use(cors());
<<<<<<< HEAD
app.use(express.json({ limit: "100kb" }));

if (!process.env.HELPDESK_USER || !process.env.HELPDESK_PASSWORD || !process.env.SESSION_SECRET) {
  console.error("Configure HELPDESK_USER, HELPDESK_PASSWORD e SESSION_SECRET no arquivo .env antes de iniciar.");
  process.exit(1);
}
if (String(process.env.SESSION_SECRET).length < 32) {
  console.error("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
  process.exit(1);
}

app.use(session({
  name: "helpdesk.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: "Muitas solicitações. Aguarde alguns minutos e tente novamente." }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Aguarde 15 minutos e tente novamente." }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  return res.status(401).json({ error: "Autenticação necessária." });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function requireAdmin(req, res, next) {
  if (req.session?.authenticated === true && req.session.role === "admin") return next();
  return res.status(403).json({ error: "Apenas o administrador pode gerenciar usuários." });
}

app.post("/api/login", loginLimiter, async (req, res, next) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const configuredUser = String(process.env.HELPDESK_USER);
  const configuredPassword = String(process.env.HELPDESK_PASSWORD);
  let role = null;
  let valid = false;

  const safeEqual = (a, b) => {
    const aa = crypto.createHash("sha256").update(a).digest();
    const bb = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(aa, bb) && a.length === b.length;
  };
  if (safeEqual(username, configuredUser) && safeEqual(password, configuredPassword)) {
    valid = true;
    role = "admin";
  } else {
    try {
      const result = await pool.query(
        "SELECT username, password_salt, password_hash FROM helpdesk_users WHERE username = $1",
        [username]
      );
      if (result.rows[0]) {
        valid = verifyPassword(password, result.rows[0].password_salt, result.rows[0].password_hash);
        if (valid) role = "user";
      }
    } catch (err) { return next(err); }
  }
  if (!valid) return res.status(401).json({ error: "Usuário ou senha incorretos." });

  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.authenticated = true;
    req.session.username = username;
    req.session.role = role;
    req.session.save(err2 => {
      if (err2) return next(err2);
      res.json({ ok: true, username, role });
    });
  });
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Informe um e-mail válido para recuperação de senha." });
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    return res.status(400).json({ error: "O usuário deve ter 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado." });
  }
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: "A senha deve ter entre 10 e 128 caracteres." });
  }
  if (username.toLowerCase() === String(process.env.HELPDESK_USER).toLowerCase()) {
    return res.status(409).json({ error: "Esse usuário é reservado para o administrador." });
  }
  const { salt, hash } = hashPassword(password);
  try {
    await pool.query(
      "INSERT INTO helpdesk_users (username, email, password_salt, password_hash) VALUES ($1, $2, $3, $4)",
      [username, email, salt, hash]
    );
    res.status(201).json({ ok: true, username });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Esse nome de usuário ou e-mail já está cadastrado." });
    console.error("Erro ao cadastrar usuário:", err.message);
    res.status(500).json({ error: "Não foi possível cadastrar o usuário." });
  }
});

app.patch("/api/admin/users/:username/email", requireAuth, requireAdmin, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return res.status(400).json({ error: "Informe um e-mail válido." });
  try {
    const result = await pool.query("UPDATE helpdesk_users SET email = $1 WHERE username = $2 RETURNING username", [email, req.params.username]);
    if (!result.rowCount) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Esse e-mail já está associado a outro usuário." });
    console.error("Erro ao atualizar e-mail:", err.message); res.status(500).json({ error: "Não foi possível atualizar o e-mail." });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT username, email, created_at FROM helpdesk_users ORDER BY username");
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar usuários:", err.message);
    res.status(500).json({ error: "Não foi possível listar os usuários." });
  }
});

app.post("/api/password/forgot", recoveryLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Informe um e-mail válido." });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.APP_BASE_URL)
    return res.status(503).json({ error: "O serviço de recuperação ainda não está configurado. Procure o administrador." });
  try {
    const { rows } = await pool.query("SELECT username FROM helpdesk_users WHERE LOWER(email) = $1 LIMIT 1", [email]);
    if (rows[0]) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await pool.query("UPDATE helpdesk_users SET reset_token_hash = $1, reset_expires_at = NOW() + INTERVAL '30 minutes' WHERE username = $2", [tokenHash, rows[0].username]);
      const base = process.env.APP_BASE_URL.replace(/\/$/, "");
      const resetUrl = `${base}/?reset=${token}`;
      const mail = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], subject: "Redefinição de senha - Help Desk", html: `<p>Olá, ${rows[0].username}.</p><p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${resetUrl}">Criar nova senha</a></p><p>O link expira em 30 minutos e só pode ser usado uma vez. Se você não solicitou, ignore esta mensagem.</p>` })
      });
      if (!mail.ok) {
        await pool.query("UPDATE helpdesk_users SET reset_token_hash = NULL, reset_expires_at = NULL WHERE username = $1 AND reset_token_hash = $2", [rows[0].username, tokenHash]);
        console.error("Falha no envio de recuperação:", await mail.text());
        return res.status(502).json({ error: "Não foi possível enviar o e-mail agora. Tente novamente mais tarde." });
      }
    }
    res.json({ ok: true, message: "Se o e-mail estiver associado a uma conta, você receberá as instruções de recuperação." });
  } catch (err) { console.error("Erro na recuperação:", err.message); res.status(500).json({ error: "Não foi possível processar a solicitação." }); }
});

app.post("/api/password/reset", recoveryLimiter, async (req, res) => {
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "A nova senha deve ter entre 10 e 128 caracteres." });
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: "Link inválido ou expirado. Solicite uma nova recuperação." });
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const { salt, hash } = hashPassword(password);
    const updated = await pool.query("UPDATE helpdesk_users SET password_salt = $1, password_hash = $2, reset_token_hash = NULL, reset_expires_at = NULL WHERE reset_token_hash = $3 AND reset_expires_at > NOW() RETURNING username", [salt, hash, tokenHash]);
    if (!updated.rowCount) return res.status(400).json({ error: "Link inválido ou expirado. Solicite uma nova recuperação." });
    res.json({ ok: true, message: "Senha redefinida com sucesso. Você já pode entrar." });
  } catch (err) { console.error("Erro ao redefinir senha:", err.message); res.status(500).json({ error: "Não foi possível redefinir a senha." }); }
});

app.get("/api/session", (req, res) => {
  if (req.session?.authenticated === true) {
    return res.json({ authenticated: true, username: req.session.username, role: req.session.role });
  }
  res.status(401).json({ authenticated: false });
});

app.post("/api/logout", requireAuth, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("helpdesk.sid", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production"
    });
    res.json({ ok: true });
  });
});
=======
app.use(express.json());
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
app.use(express.static(path.join(__dirname, "public")));

const id = () => "HD-" + crypto.randomBytes(3).toString("hex").toUpperCase();

async function init() {
  await pool.query(`
<<<<<<< HEAD
    CREATE TABLE IF NOT EXISTS helpdesk_users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(40) NOT NULL UNIQUE,
      password_salt VARCHAR(32) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE helpdesk_users ADD COLUMN IF NOT EXISTS email VARCHAR(254)");
  await pool.query("ALTER TABLE helpdesk_users ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(64)");
  await pool.query("ALTER TABLE helpdesk_users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_users_email_unique ON helpdesk_users (LOWER(email)) WHERE email IS NOT NULL");
  await pool.query(`
=======
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
    CREATE TABLE IF NOT EXISTS tickets (
      id VARCHAR(20) PRIMARY KEY,
      requester VARCHAR(120) NOT NULL,
      department VARCHAR(120),
      category VARCHAR(80) NOT NULL,
      subject VARCHAR(200) NOT NULL,
      description TEXT NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'Média',
      status VARCHAR(30) NOT NULL DEFAULT 'Aberto',
      assigned_to VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
<<<<<<< HEAD

  // Migração aditiva: não remove nem recria os chamados já existentes.
  await pool.query(`
    ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS sla_first_response_target INTEGER,
      ADD COLUMN IF NOT EXISTS sla_resolution_target INTEGER
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sla_policies (
      priority VARCHAR(20) PRIMARY KEY,
      first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes > 0),
      resolution_minutes INTEGER NOT NULL CHECK (resolution_minutes > 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sla_holidays (
      holiday_date DATE PRIMARY KEY,
      description VARCHAR(160) NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_sla_pauses (
      id BIGSERIAL PRIMARY KEY,
      ticket_id VARCHAR(20) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      pause_type VARCHAR(20) NOT NULL CHECK (pause_type IN ('requester','resolved')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ticket_sla_pauses_ticket
    ON ticket_sla_pauses(ticket_id, started_at)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_sla_history (
      id BIGSERIAL PRIMARY KEY,
      ticket_id VARCHAR(20) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      event_type VARCHAR(40) NOT NULL,
      description VARCHAR(240),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const policy of DEFAULT_SLA_POLICIES) {
    await pool.query(`
      INSERT INTO sla_policies(priority, first_response_minutes, resolution_minutes)
      VALUES($1,$2,$3) ON CONFLICT(priority) DO NOTHING
    `, [policy.priority, policy.first_response_minutes, policy.resolution_minutes]);
  }
  // Define os prazos dos chamados antigos sem alterar os dados funcionais existentes.
  await pool.query(`
    UPDATE tickets t SET
      sla_first_response_target = COALESCE(t.sla_first_response_target, p.first_response_minutes),
      sla_resolution_target = COALESCE(t.sla_resolution_target, p.resolution_minutes)
    FROM sla_policies p
    WHERE t.priority = p.priority
      AND (t.sla_first_response_target IS NULL OR t.sla_resolution_target IS NULL)
  `);
  // Backfill conservador para chamados anteriores à implantação do SLA.
  await pool.query(`
    UPDATE tickets SET first_response_at = updated_at
    WHERE first_response_at IS NULL
      AND (status = 'Em atendimento' OR status IN ('Resolvido','Fechado','Concluído','Concluido'))
  `);
  await pool.query(`
    UPDATE tickets SET resolved_at = updated_at
    WHERE resolved_at IS NULL
      AND status IN ('Resolvido','Fechado','Concluído','Concluido')
  `);
  await pool.query(`
    INSERT INTO ticket_sla_pauses(ticket_id,pause_type,started_at)
    SELECT t.id,'requester',t.updated_at
    FROM tickets t
    WHERE t.status = 'Aguardando solicitante'
      AND NOT EXISTS (
        SELECT 1 FROM ticket_sla_pauses p
        WHERE p.ticket_id=t.id AND p.pause_type='requester' AND p.ended_at IS NULL
      )
  `);
  await pool.query(`
    INSERT INTO ticket_sla_pauses(ticket_id,pause_type,started_at)
    SELECT t.id,'resolved',COALESCE(t.resolved_at,t.updated_at)
    FROM tickets t
    WHERE t.status IN ('Resolvido','Fechado','Concluído','Concluido')
      AND NOT EXISTS (
        SELECT 1 FROM ticket_sla_pauses p
        WHERE p.ticket_id=t.id AND p.pause_type='resolved' AND p.ended_at IS NULL
      )
  `);
=======
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
}

const priorityOrder = { "Crítica": 0, "Alta": 1, "Média": 2, "Baixa": 3 };

<<<<<<< HEAD
const SLA_TIME_ZONE = "America/Sao_Paulo";
const BUSINESS_OPEN_MINUTE = 9 * 60;
const BUSINESS_CLOSE_MINUTE = 18 * 60;
const DEFAULT_SLA_POLICIES = [
  { priority: "Crítica", first_response_minutes: 15, resolution_minutes: 240 },
  { priority: "Alta", first_response_minutes: 30, resolution_minutes: 480 },
  { priority: "Média", first_response_minutes: 120, resolution_minutes: 1440 },
  { priority: "Baixa", first_response_minutes: 240, resolution_minutes: 2880 }
];
const terminalStatuses = new Set(["Resolvido", "Fechado", "Concluído", "Concluido"]);
const waitingRequesterStatus = "Aguardando solicitante";

const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SLA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
});
const localPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SLA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function localParts(date) {
  const parts = Object.fromEntries(localPartsFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

// Converte um horário civil de São Paulo para UTC sem depender do fuso do servidor.
function saoPauloLocalToUtc(year, month, day, hour, minute) {
  const targetWall = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = targetWall;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(candidate));
    const representedWall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    candidate += targetWall - representedWall;
  }
  return candidate;
}

function addCalendarDays(y, m, d, amount) {
  const date = new Date(Date.UTC(y, m - 1, d + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function businessMinutesBetween(startValue, endValue, holidays = new Set()) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const first = localParts(new Date(start));
  const last = localParts(new Date(end));
  let day = { year: first.year, month: first.month, day: first.day };
  let totalMs = 0;
  let guard = 0;
  while (guard++ < 4000) {
    const dateKey = `${day.year}-${String(day.month).padStart(2,"0")}-${String(day.day).padStart(2,"0")}`;
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(dateKey)) {
      const open = saoPauloLocalToUtc(day.year, day.month, day.day, 9, 0);
      const close = saoPauloLocalToUtc(day.year, day.month, day.day, 18, 0);
      const overlapStart = Math.max(start, open);
      const overlapEnd = Math.min(end, close);
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
    }
    if (day.year === last.year && day.month === last.month && day.day === last.day) break;
    day = addCalendarDays(day.year, day.month, day.day, 1);
  }
  return Math.floor(totalMs / 60000);
}

function subtractPausedBusinessMinutes(start, end, pauses, holidays, pauseTypes = null) {
  let paused = 0;
  for (const pause of pauses) {
    if (pauseTypes && !pauseTypes.has(pause.pause_type)) continue;
    const pauseStart = Math.max(new Date(start).getTime(), new Date(pause.started_at).getTime());
    const pauseEnd = Math.min(new Date(end).getTime(), pause.ended_at ? new Date(pause.ended_at).getTime() : new Date(end).getTime());
    if (pauseEnd > pauseStart) paused += businessMinutesBetween(pauseStart, pauseEnd, holidays);
  }
  return Math.max(0, businessMinutesBetween(start, end, holidays) - paused);
}

function formatSlaMinutes(minutes) {
  const value = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}min`;
}

function makeSlaData(ticket, pauses, holidays, now = new Date()) {
  const responseTarget = Number(ticket.sla_first_response_target || 120);
  const resolutionTarget = Number(ticket.sla_resolution_target || 1440);
  const responseEnd = ticket.first_response_at || now;
  const resolutionEnd = ticket.resolved_at || now;
  const responseElapsed = subtractPausedBusinessMinutes(ticket.created_at, responseEnd, pauses, holidays, new Set(["requester"]));
  const resolutionElapsed = subtractPausedBusinessMinutes(ticket.created_at, resolutionEnd, pauses, holidays);
  const responseRemaining = Math.max(0, responseTarget - responseElapsed);
  const resolutionRemaining = Math.max(0, resolutionTarget - resolutionElapsed);
  const responseBreached = responseElapsed > responseTarget;
  const resolutionBreached = resolutionElapsed > resolutionTarget;
  const isResolved = Boolean(ticket.resolved_at);
  const isPaused = pauses.some(p => !p.ended_at && p.pause_type === "requester");
  return {
    firstResponseTargetMinutes: responseTarget,
    resolutionTargetMinutes: resolutionTarget,
    firstResponseElapsedMinutes: responseElapsed,
    resolutionElapsedMinutes: resolutionElapsed,
    firstResponseRemainingMinutes: responseRemaining,
    resolutionRemainingMinutes: resolutionRemaining,
    firstResponseRemaining: formatSlaMinutes(responseRemaining),
    resolutionRemaining: formatSlaMinutes(resolutionRemaining),
    firstResponseBreached: responseBreached,
    resolutionBreached,
    firstResponseMet: Boolean(ticket.first_response_at) && !responseBreached,
    resolutionMet: isResolved && !resolutionBreached,
    paused: isPaused,
    resolved: isResolved,
    statusLabel: isPaused ? "Pausado — aguardando solicitante" :
      (isResolved ? (responseBreached || resolutionBreached ? "Resolvido com SLA violado" : "Resolvido no prazo") :
      (responseBreached || resolutionBreached ? "SLA vencido" : "Dentro do prazo"))
  };
}

function enrich(t, sla = null) {
=======
function enrich(t) {
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
  const waitMinutes = Math.max(0, Math.ceil((Date.now() - new Date(t.created_at).getTime()) / 60000));
  return {
    id:t.id, requester:t.requester, department:t.department, category:t.category,
    subject:t.subject, description:t.description, priority:t.priority, status:t.status,
<<<<<<< HEAD
    assignedTo:t.assigned_to, createdAt:t.created_at, updatedAt:t.updated_at, waitMinutes,
    firstResponseAt:t.first_response_at, resolvedAt:t.resolved_at, sla
  };
}

async function loadSlaContext(ticketIds = []) {
  const [holidayResult, pauseResult] = await Promise.all([
    pool.query("SELECT holiday_date::text AS holiday_date FROM sla_holidays"),
    ticketIds.length
      ? pool.query("SELECT ticket_id, pause_type, started_at, ended_at FROM ticket_sla_pauses WHERE ticket_id = ANY($1::varchar[]) ORDER BY started_at", [ticketIds])
      : Promise.resolve({ rows: [] })
  ]);
  const holidays = new Set(holidayResult.rows.map(r => r.holiday_date));
  const pausesByTicket = new Map();
  for (const pause of pauseResult.rows) {
    if (!pausesByTicket.has(pause.ticket_id)) pausesByTicket.set(pause.ticket_id, []);
    pausesByTicket.get(pause.ticket_id).push(pause);
  }
  return { holidays, pausesByTicket };
}

async function enrichTicketsWithSla(rows) {
  if (!rows.length) return [];
  const { holidays, pausesByTicket } = await loadSlaContext(rows.map(t => t.id));
  return rows.map(t => enrich(t, makeSlaData(t, pausesByTicket.get(t.id) || [], holidays)));
}

=======
    assignedTo:t.assigned_to, createdAt:t.created_at, updatedAt:t.updated_at, waitMinutes
  };
}

>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
app.get("/api/health", async (_, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ online:true, database:"PostgreSQL conectado", time:new Date().toISOString() });
  } catch (e) { res.status(503).json({ online:false, error:"Banco indisponível" }); }
});

<<<<<<< HEAD
// Todas as rotas de dados abaixo exigem uma sessão autenticada.
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/login" || req.path === "/session" || req.path === "/logout") return next();
  return requireAuth(req, res, next);
});

=======
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
app.get("/api/cep/:cep", async (req,res) => {
  const cep = String(req.params.cep).replace(/\D/g,"");
  if (cep.length !== 8) return res.status(400).json({error:"CEP inválido"});
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await r.json();
    if (data.erro) return res.status(404).json({error:"CEP não encontrado"});
    res.json(data);
  } catch { res.status(502).json({error:"Falha ao consultar ViaCEP"}); }
});

app.get("/api/tickets", async (_,res) => {
  try {
    const {rows} = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
<<<<<<< HEAD
    const tickets = await enrichTicketsWithSla(rows);
=======
    const tickets = rows.map(enrich);
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
    const queue = tickets.filter(t=>["Aberto","Em espera"].includes(t.status))
      .sort((a,b)=>(priorityOrder[a.priority]-priorityOrder[b.priority]) ||
                    (new Date(a.createdAt)-new Date(b.createdAt)));
    res.json({tickets,queue});
<<<<<<< HEAD
  } catch(e) { console.error("Erro ao carregar chamados:", e.message); res.status(500).json({error:"Erro ao carregar chamados"}); }
});

app.post("/api/tickets", async (req,res) => {
  const { requester, department, category, subject, description, priority } = req.body || {};
  const clean = value => typeof value === "string" ? value.trim() : "";
  const normalizedRequester = clean(requester);
  const normalizedSubject = clean(subject);
  const normalizedDescription = clean(description);

  if (!normalizedRequester || !normalizedSubject || !normalizedDescription) {
    return res.status(400).json({ error: "Solicitante, assunto e descrição são obrigatórios." });
  }
  if (normalizedRequester.length > 120 || normalizedSubject.length > 200 || normalizedDescription.length > 10000) {
    return res.status(400).json({ error: "Confira os limites dos campos: solicitante (120), assunto (200) e descrição (10.000 caracteres)." });
  }

  const normalizedPriority = DEFAULT_SLA_POLICIES.some(p => p.priority === priority) ? priority : "Média";
  const ticket = {
    id: id(),
    requester: normalizedRequester,
    department: clean(department).slice(0, 120) || "Não informado",
    category: clean(category).slice(0, 80) || "Outros",
    subject: normalizedSubject,
    description: normalizedDescription,
    priority: normalizedPriority
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Garante uma política para a prioridade selecionada sem sobrescrever prazos personalizados.
    const defaultPolicy = DEFAULT_SLA_POLICIES.find(p => p.priority === normalizedPriority);
    await client.query(`
      INSERT INTO sla_policies(priority, first_response_minutes, resolution_minutes)
      VALUES($1, $2, $3)
      ON CONFLICT(priority) DO NOTHING
    `, [defaultPolicy.priority, defaultPolicy.first_response_minutes, defaultPolicy.resolution_minutes]);

    const policyResult = await client.query(
      "SELECT first_response_minutes, resolution_minutes FROM sla_policies WHERE priority = $1",
      [normalizedPriority]
    );
    if (!policyResult.rows[0]) {
      throw new Error("Política de SLA não encontrada para a prioridade " + normalizedPriority + ".");
    }

    const { first_response_minutes, resolution_minutes } = policyResult.rows[0];
    const insertResult = await client.query(`
      INSERT INTO tickets(
        id, requester, department, category, subject, description, priority,
        sla_first_response_target, sla_resolution_target
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      ticket.id, ticket.requester, ticket.department, ticket.category,
      ticket.subject, ticket.description, ticket.priority,
      first_response_minutes, resolution_minutes
    ]);

    await client.query(
      "INSERT INTO ticket_sla_history(ticket_id,event_type,description) VALUES($1,'created','Contagem de SLA iniciada')",
      [ticket.id]
    );

    await client.query("COMMIT");
    const [enriched] = await enrichTicketsWithSla(insertResult.rows);
    return res.status(201).json(enriched);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro ao criar chamado:", e.stack || e.message || e);
    return res.status(500).json({
      error: "Não foi possível registrar o chamado no banco de dados.",
      details: process.env.NODE_ENV === "development" ? e.message : undefined
    });
  } finally {
    client.release();
  }
=======
  } catch(e) { res.status(500).json({error:"Erro ao carregar chamados"}); }
});

app.post("/api/tickets", async (req,res) => {
  const {requester,department,category,subject,description,priority} = req.body;
  if (!requester || !subject || !description) return res.status(400).json({error:"Solicitante, assunto e descrição são obrigatórios."});
  const ticket = {id:id(), requester, department:department||"Não informado", category:category||"Outros",
    subject,description,priority:priority||"Média"};
  try {
    const {rows} = await pool.query(`
      INSERT INTO tickets(id,requester,department,category,subject,description,priority)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [ticket.id,ticket.requester,ticket.department,ticket.category,ticket.subject,ticket.description,ticket.priority]);
    res.status(201).json(enrich(rows[0]));
  } catch(e) { res.status(500).json({error:"Erro ao criar chamado"}); }
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
});

app.patch("/api/tickets/:id", async (req,res) => {
  const allowed = ["status","assigned_to","priority"];
  const changes = [];
  const values = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { values.push(req.body[key]); changes.push(`${key}=$${values.length}`); }
  }
  if (!changes.length) return res.status(400).json({error:"Nenhuma alteração enviada"});
<<<<<<< HEAD
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query("SELECT * FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({error:"Chamado não encontrado"});
    }
    const nextStatus = req.body.status !== undefined ? String(req.body.status) : current.status;
    const now = new Date();
    const wasWaiting = current.status === waitingRequesterStatus;
    const isWaiting = nextStatus === waitingRequesterStatus;
    const wasResolved = terminalStatuses.has(current.status);
    const isResolved = terminalStatuses.has(nextStatus);

    values.push(now, req.params.id);
    let extra = "";
    if (!current.first_response_at &&
        (nextStatus === "Em atendimento" || isResolved || (req.body.assigned_to && String(req.body.assigned_to).trim()))) {
      extra += `, first_response_at = COALESCE(first_response_at, $${values.length-1})`;
      await client.query("INSERT INTO ticket_sla_history(ticket_id,event_type,description) VALUES($2,'first_response','Primeiro atendimento registrado')", [req.params.id, now]);
    }
    if (!wasWaiting && isWaiting) {
      await client.query("INSERT INTO ticket_sla_pauses(ticket_id,pause_type,started_at) VALUES($1,'requester',$2)", [req.params.id, now]);
      await client.query("INSERT INTO ticket_sla_history(ticket_id,event_type,description) VALUES($1,'paused','SLA pausado: aguardando solicitante')", [req.params.id]);
    } else if (wasWaiting && !isWaiting) {
      await client.query("UPDATE ticket_sla_pauses SET ended_at=$2 WHERE ticket_id=$1 AND pause_type='requester' AND ended_at IS NULL", [req.params.id, now]);
      await client.query("INSERT INTO ticket_sla_history(ticket_id,event_type,description) VALUES($1,'resumed','SLA retomado após resposta do solicitante')", [req.params.id]);
    }
    if (!wasResolved && isResolved) {
      await client.query("UPDATE tickets SET resolved_at=$2 WHERE id=$1", [req.params.id, now]);
      await client.query("INSERT INTO ticket_sla_pauses(ticket_id,pause_type,started_at) VALUES($1,'resolved',$2)", [req.params.id, now]);
      await client.query("INSERT INTO ticket_sla_history(ticket_id,event_type,description) VALUES($1,'resolved','Chamado resolvido; relógio de SLA encerrado')", [req.params.id]);
    } else if (wasResolved && !isResolved) {
      await client.query("UPDATE tickets SET resolved_at=NULL WHERE id=$1", [req.params.id]);
      await client.query("UPDATE ticket_sla_pauses SET ended_at=$2 WHERE ticket_id=$1 AND pause_type='resolved' AND ended_at IS NULL", [req.params.id, now]);
      await client.query("INSERT INTO ticket_sla_history(ticket_id,event_type,description) VALUES($1,'reopened','Chamado reaberto; SLA retomado')", [req.params.id]);
    }
    const updateSql = `UPDATE tickets SET ${changes.join(", ")}, updated_at=$${values.length-1}${extra} WHERE id=$${values.length} RETURNING *`;
    const result = await client.query(updateSql, values);
    await client.query("COMMIT");
    const [enriched] = await enrichTicketsWithSla(result.rows);
    res.json(enriched);
  } catch(e) {
    await client.query("ROLLBACK");
    console.error("Erro ao atualizar chamado:", e.message);
    res.status(500).json({error:"Erro ao atualizar chamado"});
  } finally { client.release(); }
=======
  values.push(new Date(), req.params.id);
  try {
    const {rows} = await pool.query(`UPDATE tickets SET ${changes.join(", ")}, updated_at=$${values.length-1} WHERE id=$${values.length} RETURNING *`, values);
    if (!rows[0]) return res.status(404).json({error:"Chamado não encontrado"});
    res.json(enrich(rows[0]));
  } catch(e) { res.status(500).json({error:"Erro ao atualizar chamado"}); }
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
});

app.delete("/api/tickets/:id", async (req,res) => {
  try {
    const r = await pool.query("DELETE FROM tickets WHERE id=$1",[req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:"Chamado não encontrado"});
    res.status(204).end();
  } catch(e) { res.status(500).json({error:"Erro ao excluir chamado"}); }
});

<<<<<<< HEAD

// Painel e configuração do SLA. Todas as rotas exigem sessão; edição é exclusiva do admin.
app.get("/api/sla/dashboard", async (_req,res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
    const tickets = await enrichTicketsWithSla(rows);
    const active = tickets.filter(t => !t.sla.resolved);
    const breached = tickets.filter(t => t.sla.firstResponseBreached || t.sla.resolutionBreached);
    const paused = tickets.filter(t => t.sla.paused);
    const compliant = tickets.length ? Math.round((tickets.length - breached.length) / tickets.length * 100) : 100;
    res.json({
      summary: { total:tickets.length, active:active.length, paused:paused.length, breached:breached.length, compliance:compliant },
      tickets
    });
  } catch (e) { console.error("Erro no painel SLA:", e.message); res.status(500).json({error:"Não foi possível carregar o painel de SLA."}); }
});

app.get("/api/sla/policies", async (_req,res) => {
  try {
    const { rows } = await pool.query("SELECT priority, first_response_minutes, resolution_minutes FROM sla_policies ORDER BY CASE priority WHEN 'Crítica' THEN 1 WHEN 'Alta' THEN 2 WHEN 'Média' THEN 3 ELSE 4 END");
    res.json(rows);
  } catch (e) { res.status(500).json({error:"Não foi possível carregar as políticas de SLA."}); }
});

app.put("/api/sla/policies", requireAdmin, async (req,res) => {
  const policies = req.body?.policies;
  if (!Array.isArray(policies) || policies.length !== 4) return res.status(400).json({error:"Envie as quatro políticas de prioridade."});
  const expected = new Set(DEFAULT_SLA_POLICIES.map(p => p.priority));
  if (new Set(policies.map(p => p.priority)).size !== 4 || policies.some(p => !expected.has(p.priority) ||
      !Number.isInteger(Number(p.first_response_minutes)) || Number(p.first_response_minutes) < 1 || Number(p.first_response_minutes) > 100000 ||
      !Number.isInteger(Number(p.resolution_minutes)) || Number(p.resolution_minutes) < 1 || Number(p.resolution_minutes) > 100000)) {
    return res.status(400).json({error:"Prioridade ou prazo inválido. Informe minutos inteiros maiores que zero."});
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of policies) {
      await client.query(`
        INSERT INTO sla_policies(priority,first_response_minutes,resolution_minutes,updated_at)
        VALUES($1,$2,$3,NOW())
        ON CONFLICT(priority) DO UPDATE SET
          first_response_minutes=EXCLUDED.first_response_minutes,
          resolution_minutes=EXCLUDED.resolution_minutes, updated_at=NOW()
      `, [p.priority, Number(p.first_response_minutes), Number(p.resolution_minutes)]);
    }
    await client.query("COMMIT");
    const { rows } = await pool.query("SELECT priority,first_response_minutes,resolution_minutes FROM sla_policies ORDER BY CASE priority WHEN 'Crítica' THEN 1 WHEN 'Alta' THEN 2 WHEN 'Média' THEN 3 ELSE 4 END");
    res.json(rows);
  } catch(e) { await client.query("ROLLBACK"); console.error("Erro ao salvar políticas:", e.message); res.status(500).json({error:"Não foi possível salvar as políticas."}); }
  finally { client.release(); }
});

app.get("/api/sla/holidays", async (_req,res) => {
  try {
    const { rows } = await pool.query("SELECT holiday_date::text AS date, description FROM sla_holidays ORDER BY holiday_date");
    res.json(rows);
  } catch(e) { res.status(500).json({error:"Não foi possível carregar os feriados."}); }
});

app.post("/api/sla/holidays", requireAdmin, async (req,res) => {
  const date = String(req.body?.date || "");
  const description = String(req.body?.description || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || description.length > 160) {
    return res.status(400).json({error:"Informe uma data válida e uma descrição de até 160 caracteres."});
  }
  try {
    const { rows } = await pool.query("INSERT INTO sla_holidays(holiday_date,description) VALUES($1,$2) ON CONFLICT(holiday_date) DO UPDATE SET description=EXCLUDED.description RETURNING holiday_date::text AS date,description", [date,description]);
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:"Não foi possível cadastrar o feriado."}); }
});

app.delete("/api/sla/holidays/:date", requireAdmin, async (req,res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({error:"Data inválida."});
  try {
    const result = await pool.query("DELETE FROM sla_holidays WHERE holiday_date=$1", [req.params.date]);
    if (!result.rowCount) return res.status(404).json({error:"Feriado não encontrado."});
    res.status(204).end();
  } catch(e) { res.status(500).json({error:"Não foi possível remover o feriado."}); }
});

app.get("/api/tickets/:id/sla-history", async (req,res) => {
  try {
    const { rows } = await pool.query("SELECT event_type,description,created_at FROM ticket_sla_history WHERE ticket_id=$1 ORDER BY created_at DESC", [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({error:"Não foi possível carregar o histórico de SLA."}); }
});

=======
>>>>>>> c860af904b9ab5e92a669592df2f1bc32967cb7a
app.get("*", (_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

init().then(()=>app.listen(PORT,()=>console.log(`Help Desk online na porta ${PORT}`)))
.catch(e=>{console.error(e);process.exit(1)});
