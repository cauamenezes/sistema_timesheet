const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const colabRoutes = require("./routes/colaboradores");
const timesheetRoutes = require("./routes/timesheets");

const app = express();
app.use(cors());
app.use(express.json());

// health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// rotas
app.use("/auth", authRoutes);
app.use("/colaboradores", colabRoutes);
app.use("/timesheets", timesheetRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
);
