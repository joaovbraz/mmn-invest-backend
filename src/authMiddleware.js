// src/authMiddleware.js
import jwt from 'jsonwebtoken';

/**
 * Extrai o token do header Authorization (Bearer),
 * ou dos cookies (token/jwt/access_token), com ou sem cookie-parser.
 */
function extractToken(req) {
  // 1) Authorization: Bearer <token>
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.split(' ')[1];
  }

  // 2) Cookie via cookie-parser (se estiver instalado/usado)
  const cookieViaParser =
    req.cookies?.token || req.cookies?.jwt || req.cookies?.access_token;
  if (cookieViaParser) return cookieViaParser;

  // 3) Header "cookie" bruto (sem cookie-parser)
  const raw = req.headers?.cookie;
  if (!raw) return null;

  // Ex.: "token=abc; jwt=def; access_token=ghi"
  const map = {};
  for (const pair of raw.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (!k) continue;
    map[k] = decodeURIComponent(v.join('=') || '');
  }
  return map.token || map.jwt || map.access_token || null;
}

/**
 * Middleware de proteção: exige token válido.
 * Popular req.userId, req.userEmail, req.userRole para as rotas seguintes.
 */
export function protect(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res
        .status(401)
        .json({ ok: false, error: 'Não foi possível autenticar. Faça login novamente.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Popular dados mais comuns do payload (ajuste conforme seu JWT)
    req.userId =
      decoded.id || decoded.userId || decoded.sub || decoded.uid || decoded.user_id;
    req.userEmail = decoded.email || decoded.user || decoded.username || null;
    req.userRole =
      decoded.role || decoded.perfil || decoded.claims?.role || decoded.level || null;

    return next();
  } catch {
    return res
      .status(401)
      .json({ ok: false, error: 'Não foi possível autenticar. Faça login novamente.' });
  }
}

/**
 * Middleware para rotas administrativas.
 * Faz checagem simples do campo de role do token.
 * Se você armazena a role no banco, ajuste aqui para buscar no Prisma.
 */
export function admin(req, res, next) {
  const role = (req.userRole || '').toString().toLowerCase();
  if (role === 'admin' || role === 'administrator' || role === 'superadmin') {
    return next();
  }
  return res.status(403).json({ ok: false, error: 'Acesso negado.' });
}
