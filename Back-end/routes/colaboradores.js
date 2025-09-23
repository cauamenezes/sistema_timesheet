const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const authRequired = require("../middleware/auth");

const router = express.Router();

// =============== AUTH ===============
// router.post("/cadastro", authRequired, async (req, res) => {
//   try {
//     const { nome_completo, email, senha, tipo_perfil } = req.body;
//     if (!nome_completo || !email || !senha)
//       return res
//         .status(400)
//         .json({ error: "nome_completo, email e senha são obrigatórios" });

//     const [dup] = await pool.query(
//       "SELECT id FROM colaboradores WHERE email=?",
//       [email]
//     );
//     if (dup.length)
//       return res.status(409).json({ error: "Email já cadastrado" });

//     const senha_hash = await bcrypt.hash(senha, 10);
//     const [result] = await pool.query(
//       "INSERT INTO colaboradores (nome_completo, email, senha_hash, tipo_perfil) VALUES (?,?,?,?)",
//       [nome_completo, email, senha_hash, tipo_perfil || "consultor"]
//     );

//     const token = jwt.sign(
//       { id: result.insertId, email, tipo_perfil: tipo_perfil || "consultor" },
//       process.env.JWT_SECRET,
//       { expiresIn: "8h" }
//     );
//     res.json({
//       id: result.insertId,
//       nome_completo,
//       email,
//       tipo_perfil: tipo_perfil || "consultor",
//       token,
//     });
//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: "Erro ao registrar" });
//   }
// });

//Cadastro de colaboradores
router.post("/cadastro", authRequired, async (req, res) => {
  try {
    // Mostra o body recebido pra debug
    console.log("BODY RECEBIDO:", req.body);

    const {
      tipo_perfil,
      nome_completo,
      cpf,
      rg,
      data_nascimento,
      sexo,
      email,
      celular,
      cep,
      rua,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      senha,

      // Empresa
      nome_fantasia,
      cnpj,
      inscricao_estadual,
      inscricao_municipal,
      regime_tributario,
      cep_empresa,
      logradouro_empresa,
      numero_empresa,
      complemento_empresa,
      bairro_empresa,
      cidade_empresa,
      estado_empresa,
      pais_empresa,
      telefone_fixo_empresa,
      telefone_celular_empresa,
      email_corporativo_empresa,

      // Dados bancários
      agencia,
      conta,
      chave_pix,
    } = req.body;

    // 1. Valida token
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token não informado" });

    let userData;
    try {
      userData = require("jsonwebtoken").verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido" });
    }

    if (userData.tipo_perfil !== "adm") {
      return res.status(403).json({
        error: "Apenas administradores podem cadastrar colaboradores",
      });
    }

    // 2. Valida campos obrigatórios
    if (!nome_completo || !cpf || !senha || !nome_fantasia || !cnpj) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    // 3. Criptografa a senha
    const senha_hash = await bcrypt.hash(senha, 10);

    // Verifica se a empresa já existe
    const [empresaExiste] = await pool.query(
      "SELECT id FROM empresas WHERE cnpj = ?",
      [cnpj]
    );

    let empresa_id; // declara antes

    if (empresaExiste.length > 0) {
      empresa_id = empresaExiste[0].id; // Reaproveita
    } else {
      // Cria nova empresa
      const sqlEmpresa = `
    INSERT INTO empresas 
    (nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, regime_tributario,
     cep, logradouro, numero, complemento, bairro, cidade, estado, pais,
     telefone_fixo, telefone_celular, email_corporativo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `;
      const [empresaResult] = await pool.query(sqlEmpresa, [
        nome_fantasia,
        cnpj,
        inscricao_estadual,
        inscricao_municipal,
        regime_tributario,
        cep_empresa,
        logradouro_empresa,
        numero_empresa,
        complemento_empresa,
        bairro_empresa,
        cidade_empresa,
        estado_empresa,
        pais_empresa,
        telefone_fixo_empresa,
        telefone_celular_empresa,
        email_corporativo_empresa,
      ]);
      empresa_id = empresaResult.insertId;
    }

    // Agora que empresa_id já existe, pode logar
    console.log("empresa_id usado para o colaborador:", empresa_id);

    // Verifica se o CPF já foi cadastrado
    const [cpfExiste] = await pool.query(
      "SELECT id FROM colaboradores WHERE cpf = ?",
      [cpf]
    );

    if (cpfExiste.length > 0) {
      return res.status(400).json({ error: "CPF já cadastrado" });
    }

    // Verifica se o e-mail já foi cadastrado
    const [emailExiste] = await pool.query(
      "SELECT id FROM colaboradores WHERE email = ?",
      [email]
    );

    if (emailExiste.length > 0) {
      return res.status(400).json({ error: "E-mail já cadastrado" });
    }

    // 5. Insere o colaborador
    const sqlColab = `
      INSERT INTO colaboradores
      (nome_completo, cpf, rg, data_nascimento, sexo, email, celular, cep, rua, numero, complemento, bairro, cidade, estado,
       tipo_perfil, ativo, data_criacao, status, senha_hash, empresa_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;
    const [colabResult] = await pool.query(sqlColab, [
      nome_completo,
      cpf,
      rg || null,
      data_nascimento || null,
      sexo || null,
      email,
      celular || null,
      cep || null,
      rua || null,
      numero || null,
      complemento || null,
      bairro || null,
      cidade || null,
      estado || null,
      tipo_perfil,
      1,
      new Date(),
      "ativo",
      senha_hash,
      empresa_id,
    ]);
    const colaborador_id = colabResult.insertId;

    // 6. Insere dados bancários
    if (agencia && conta && chave_pix) {
      const sqlBanco = `
        INSERT INTO dados_bancarios
        (colaborador_id, agencia, conta, chave_pix, status)
        VALUES (?,?,?,?,?)
      `;
      await pool.query(sqlBanco, [
        colaborador_id,
        agencia,
        conta,
        chave_pix,
        "ativo",
      ]);
    }

    res.status(201).json({ message: "Colaborador cadastrado com sucesso" });
  } catch (e) {
    console.error("Erro cadastro colaborador:", e);
    res.status(500).json({ error: "Erro ao cadastrar colaborador" });
  }
});

module.exports = router;

// listagem de colaboradores
router.get("/listagem", authRequired, async (req, res) => {
  if (req.user.tipo_perfil !== "adm")
    return res.status(403).json({ error: "Sem permissão" });

  const [rows] = await pool.query(
    "SELECT id, nome_completo, email, tipo_perfil, data_criacao FROM colaboradores ORDER BY id DESC"
  );
  res.json(rows);
});

module.exports = router;
