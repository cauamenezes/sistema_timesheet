const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    ciphers: "SSLv3",
    rejectUnauthorized: false,
  },
});

transporter.verify((err, success) => {
  if (err) console.error("Erro SMTP:", err);
  else console.log("📧 Servidor SMTP pronto:", success);
});

module.exports = transporter;
