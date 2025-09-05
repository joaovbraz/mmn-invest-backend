// Arquivo: src/authMiddleware.js (atualizado)
// - Robusto contra header ausente/malformado
// - Retorna 401 em vez de 500 quando o token faltar/for inválido
// - Busca o usuário no Prisma e injeta em req.user (sem a senha)

import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extrai "Bearer <token>" de maneira segura (case-insensitive)
function extractBearerToken(req) {
  const raw =
    (req.headers.authorization ?? req.headers.Authorization ?? '').toString().trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1] : null;
}

const protect = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Não autenticado: token ausente.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_err) {
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    if (!decoded?.userId) {
      return res.status(401).json({ error: 'Token inválido.' });
    }

    // Busque apenas campos seguros (evita ter que fazer delete da senha)
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        // Adicione outros campos que você precise em req.user:
        // rank: true, referralCode: true, phone: true, etc.
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    req.user = user;
    return next();
  } catch (err) {
    // Loga falhas inesperadas do middleware (para não ficar “silencioso”)
    console.error('[protect] Erro inesperado:', err);
    return res.status(500).json({ error: 'Falha de autenticação.' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    return next();
  }
  return res.status(403).json({ error: 'Acesso negado. Rota de administrador.' });
};

export { protect, admin };
