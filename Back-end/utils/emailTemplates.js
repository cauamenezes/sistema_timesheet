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

module.exports = { formatTimesheetEmail };
