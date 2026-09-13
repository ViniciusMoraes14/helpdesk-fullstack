require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const id = () => "HD-" + crypto.randomBytes(3).toString("hex").toUpperCase();

async function init() {
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
