require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false } : false
});

app.use(cors());
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
      "INSERT INTO helpdesk_users (username, password_salt, password_hash) VALUES ($1, $2, $3)",
      [username, salt, hash]
    );
    res.status(201).json({ ok: true, username });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Esse nome de usuário já existe." });
    console.error("Erro ao cadastrar usuário:", err.message);
    res.status(500).json({ error: "Não foi possível cadastrar o usuário." });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT username, created_at FROM helpdesk_users ORDER BY username");
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar usuários:", err.message);
    res.status(500).json({ error: "Não foi possível listar os usuários." });
  }
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
app.use(express.static(path.join(__dirname, "public")));

const id = () => "HD-" + crypto.randomBytes(3).toString("hex").toUpperCase();

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS helpdesk_users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(40) NOT NULL UNIQUE,
      password_salt VARCHAR(32) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
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
}

const priorityOrder = { "Crítica": 0, "Alta": 1, "Média": 2, "Baixa": 3 };

function enrich(t) {
  const waitMinutes = Math.max(0, Math.ceil((Date.now() - new Date(t.created_at).getTime()) / 60000));
  return {
    id:t.id, requester:t.requester, department:t.department, category:t.category,
    subject:t.subject, description:t.description, priority:t.priority, status:t.status,
    assignedTo:t.assigned_to, createdAt:t.created_at, updatedAt:t.updated_at, waitMinutes
  };
}

app.get("/api/health", async (_, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ online:true, database:"PostgreSQL conectado", time:new Date().toISOString() });
  } catch (e) { res.status(503).json({ online:false, error:"Banco indisponível" }); }
});

// Todas as rotas de dados abaixo exigem uma sessão autenticada.
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/login" || req.path === "/session" || req.path === "/logout") return next();
  return requireAuth(req, res, next);
});

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
    const tickets = rows.map(enrich);
    const queue = tickets.filter(t=>["Aberto","Em espera"].includes(t.status))
      .sort((a,b)=>(priorityOrder[a.priority]-priorityOrder[b.priority]) ||
                    (new Date(a.createdAt)-new Date(b.createdAt)));
    res.json({tickets,queue});
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
});

app.patch("/api/tickets/:id", async (req,res) => {
  const allowed = ["status","assigned_to","priority"];
  const changes = [];
  const values = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { values.push(req.body[key]); changes.push(`${key}=$${values.length}`); }
  }
  if (!changes.length) return res.status(400).json({error:"Nenhuma alteração enviada"});
  values.push(new Date(), req.params.id);
  try {
    const {rows} = await pool.query(`UPDATE tickets SET ${changes.join(", ")}, updated_at=$${values.length-1} WHERE id=$${values.length} RETURNING *`, values);
    if (!rows[0]) return res.status(404).json({error:"Chamado não encontrado"});
    res.json(enrich(rows[0]));
  } catch(e) { res.status(500).json({error:"Erro ao atualizar chamado"}); }
});

app.delete("/api/tickets/:id", async (req,res) => {
  try {
    const r = await pool.query("DELETE FROM tickets WHERE id=$1",[req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:"Chamado não encontrado"});
    res.status(204).end();
  } catch(e) { res.status(500).json({error:"Erro ao excluir chamado"}); }
});

app.get("*", (_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

init().then(()=>app.listen(PORT,()=>console.log(`Help Desk online na porta ${PORT}`)))
.catch(e=>{console.error(e);process.exit(1)});
