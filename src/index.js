// Arquivo: src/index.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3333;

app.get('/', (req, res) => {
  res.json({ message: 'API do TDP INVEST funcionando!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend rodando na porta ${PORT}`);
});