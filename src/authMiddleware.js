// Arquivo: src/authMiddleware.js - ATUALIZADO COM MIDDLEWARE DE ADMIN

import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Este middleware continua o mesmo: verifica se o usuário está logado
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await prisma.user.findUnique({ where: { id: decoded.userId }});
      delete req.user.password;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Token inválido, autorização negada.' });
    }
  }
  if (!token) {
    res.status(401).json({ error: 'Nenhum token, autorização negada.' });
  }
};

// --- NOSSO NOVO "SEGURANÇA VIP" ---
// Este middleware verifica se o usuário logado (pelo 'protect') tem o cargo 'ADMIN'
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    next(); // Se for admin, pode passar
  } else {
    res.status(403).json({ error: 'Acesso negado. Rota exclusiva para administradores.' });
  }
};

export { protect, admin };