// ===== server.js (adaptado para sistema_timesheet) =====
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

// Pool MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// Saúde
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/db/health", async (_req, res) => {
  try {
    const c = await pool.getConnection();
    await c.ping();
    c.release();
    res.json({ db: "ok" });
  } catch (e) {
    res.status(500).json({ db: "error", detail: e.message });
  }
});

// =============== AUTH ===============
app.post("/auth/register", async (req, res) => {
  try {
    const { nome_completo, email, senha, tipo_perfil } = req.body;
    if (!nome_completo || !email || !senha)
      return res
        .status(400)
        .json({ error: "nome_completo, email e senha são obrigatórios" });

    const [dup] = await pool.query(
      "SELECT id FROM colaboradores WHERE email=?",
      [email]
    );
    if (dup.length)
      return res.status(409).json({ error: "Email já cadastrado" });

    const senha_hash = await bcrypt.hash(senha, 10);
    const [result] = await pool.query(
      "INSERT INTO colaboradores (nome_completo, email, senha_hash, tipo_perfil) VALUES (?,?,?,?)",
      [nome_completo, email, senha_hash, tipo_perfil || "consultor"]
    );

    const token = jwt.sign(
      { id: result.insertId, email, tipo_perfil: tipo_perfil || "consultor" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({
      id: result.insertId,
      nome_completo,
      email,
      tipo_perfil: tipo_perfil || "consultor",
      token,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res.status(400).json({ error: "email e senha são obrigatórios" });

    const [rows] = await pool.query(
      "SELECT * FROM colaboradores WHERE email=?",
      [email]
    );
    if (!rows.length)
      return res.status(401).json({ error: "Credenciais inválidas" });

    const u = rows[0];
    const ok = await bcrypt.compare(senha, u.senha_hash);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas" });

    const token = jwt.sign(
      { id: u.id, email: u.email, tipo_perfil: u.tipo_perfil },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({
      id: u.id,
      nome_completo: u.nome_completo,
      email: u.email,
      tipo_perfil: u.tipo_perfil,
      token,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao fazer login" });
  }
});

// =============== EMAIL ===============
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

function formatTimesheetEmail({ colaborador, items, totalHoras, period }) {
  const lines = items
    .map(
      (i) =>
        `• ${i.data} | Projeto ${i.projeto_id} | ${i.horas}h\n   ${i.descricao}`
    )
    .join("\n");

  return {
    subject: `Timesheet - ${colaborador.nome_completo} (${period.from} a ${period.to}) - ${totalHoras}h`,
    text: `Consultor: ${colaborador.nome_completo} <${colaborador.email}>
Período: ${period.from} a ${period.to}
Total de horas: ${totalHoras}

Lançamentos:
${lines}
`,
  };
}

// =============== HORAS TRABALHADAS ===============
// Criar lançamento
app.post("/timesheets", authRequired, async (req, res) => {
  try {
    const { cliente_id, projeto_id, data, horas, descricao } = req.body;
    if (!cliente_id || !projeto_id || !data || horas == null || !descricao)
      return res
        .status(400)
        .json({
          error:
            "cliente_id, projeto_id, data, horas e descricao são obrigatórios",
        });

    const [r] = await pool.query(
      `INSERT INTO horas_trabalhadas (colaborador_id, cliente_id, projeto_id, data, horas, descricao, status)
       VALUES (?,?,?,?,?,?, 'draft')`,
      [req.user.id, cliente_id, projeto_id, data, horas, descricao]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao criar lançamento" });
  }
});

// Listar lançamentos
app.get("/timesheets", authRequired, async (req, res) => {
  try {
    const { from, to, status, colaborador_id } = req.query;
    const isAdmin = req.user.tipo_perfil === "adm";

    const params = [];
    let where = "WHERE 1=1";

    if (isAdmin && colaborador_id) {
      where += " AND h.colaborador_id = ?";
      params.push(colaborador_id);
    } else {
      where += " AND h.colaborador_id = ?";
      params.push(req.user.id);
    }

    if (from) {
      where += " AND h.data >= ?";
      params.push(from);
    }
    if (to) {
      where += " AND h.data <= ?";
      params.push(to);
    }
    if (status) {
      where += " AND h.status = ?";
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT h.id, h.colaborador_id, c.nome_completo, c.email,
              h.data, h.projeto_id, h.descricao, h.horas, h.status,
              h.timestamp
         FROM horas_trabalhadas h
         JOIN colaboradores c ON c.id = h.colaborador_id
       ${where}
       ORDER BY h.data DESC, h.id DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao listar lançamentos" });
  }
});

// Submeter lançamentos (enviar por e-mail)
app.post("/timesheets/submit", authRequired, async (req, res) => {
  try {
    const { from, to } = req.body;
    if (!from || !to)
      return res
        .status(400)
        .json({ error: "from e to são obrigatórios (YYYY-MM-DD)" });

    const [urows] = await pool.query(
      "SELECT id, nome_completo, email FROM colaboradores WHERE id=?",
      [req.user.id]
    );
    const colaborador = urows[0];

    const [items] = await pool.query(
      `SELECT id, data, projeto_id, descricao, horas
         FROM horas_trabalhadas
        WHERE colaborador_id=? AND data BETWEEN ? AND ?`,
      [req.user.id, from, to]
    );
    if (!items.length)
      return res.status(400).json({ error: "Não há lançamentos no período" });

    const totalHoras = items.reduce((acc, i) => acc + Number(i.horas), 0);

    const { subject, text } = formatTimesheetEmail({
      colaborador,
      items,
      totalHoras,
      period: { from, to },
    });

    if (process.env.SMTP_HOST && process.env.FINANCE_EMAIL) {
      await mailer.sendMail({
        from: process.env.SMTP_USER || "no-reply@cidic.com.br",
        to: process.env.FINANCE_EMAIL,
        subject,
        text,
      });
    }

    await pool.query(
      `UPDATE horas_trabalhadas SET status='submitted'
        WHERE colaborador_id=? AND data BETWEEN ? AND ?`,
      [req.user.id, from, to]
    );

    res.json({
      ok: true,
      sent_to: process.env.FINANCE_EMAIL || null,
      totalHoras,
      count: items.length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao submeter timesheet" });
  }
});

// =============== AUTH HELPER ===============
function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token ausente" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Lista de colaboradores (apenas admins)
app.get("/colaboradores", authRequired, async (req, res) => {
  if (req.user.tipo_perfil !== "adm")
    return res.status(403).json({ error: "Sem permissão" });

  const [rows] = await pool.query(
    "SELECT id, nome_completo, email, tipo_perfil, data_criacao FROM colaboradores ORDER BY id DESC"
  );
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
);
