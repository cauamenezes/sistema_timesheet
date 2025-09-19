const express = require("express");
const pool = require("../config/db");
const mailer = require("../config/mailer");
const authRequired = require("../middleware/auth");
const { formatTimesheetEmail } = require("../utils/emailTemplates");

const router = express.Router();

// =============== HORAS TRABALHADAS ===============
// Criar lançamento
router.post("/criarLancamento", authRequired, async (req, res) => {
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
router.get("/listarLancamentos", authRequired, async (req, res) => {
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
router.post("/submit", authRequired, async (req, res) => {
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

module.exports = router;
