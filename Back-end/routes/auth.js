const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db");
const mailer = require("../config/mailer");

const router = express.Router();

// Login
router.post("/login", async (req, res) => {
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

// =============== RECUPERAR SENHA ===============
// Requisitar recuperação
// ===== RECUPERAR SENHA =====
router.post("/recover", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "E-mail é obrigatório" });

    // 1️⃣ Busca usuário
    const [rows] = await pool.query(
      "SELECT id, nome_completo FROM colaboradores WHERE email=?",
      [email]
    );
    if (!rows.length) return res.status(404).json({ error: "E-mail não encontrado" });

    const user = rows[0];

    // 2️⃣ Gera token e expiração (formato MySQL compatível)
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 15) // +15 min
      .toISOString().slice(0, 19).replace("T", " ");

    console.log("Token:", token, "Expires:", expires, "UserID:", user.id);

    // 3️⃣ Atualiza banco
    const [updateResult] = await pool.query(
      "UPDATE colaboradores SET reset_token=?, reset_expires=? WHERE id=?",
      [token, expires, user.id]
    );
    console.log("Resultado do UPDATE:", updateResult);

    // 4️⃣ Envia e-mail usando transporter definido no início do server
    const resetLink = `${process.env.FRONTEND_URL}/Front-end/reset.html?token=${token}`;

    await mailer.sendMail({
      from: process.env.SMTP_USER || "no-reply@cidic.com.br",
      to: email,
      subject: "Recuperação de senha - Sistema Timesheet",
      text: `Olá ${user.nome_completo},\n\nClique no link abaixo para redefinir sua senha (válido por 15 minutos):\n${resetLink}`,
    });

    // 5️⃣ Resposta
    res.json({ ok: true, msg: "E-mail de recuperação enviado" });

  } catch (e) {
    console.error("ERRO INTERNO RECOVER:", e);
    res.status(500).json({ error: "Erro ao enviar recuperação", detail: e.message });
  }
});

// Resetar senha
router.post("/reset", async (req, res) => {
  try {
    const { token, novaSenha } = req.body;
    if (!token || !novaSenha)
      return res.status(400).json({ error: "Token e novaSenha são obrigatórios" });

    const [rows] = await pool.query(
      "SELECT id, reset_expires FROM colaboradores WHERE reset_token=?",
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: "Token inválido" });

    const user = rows[0];
    if (new Date(user.reset_expires) < new Date())
      return res.status(400).json({ error: "Token expirado" });

    const senha_hash = await bcrypt.hash(novaSenha, 10);
    await pool.query(
      "UPDATE colaboradores SET senha_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?",
      [senha_hash, user.id]
    );

    res.json({ ok: true, msg: "Senha redefinida com sucesso" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao redefinir senha" });
  }
});

module.exports = router;
