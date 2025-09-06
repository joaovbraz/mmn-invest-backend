// src/authMiddleware.js (SEM MUDANÇAS FUNCIONAIS)
import jwt from 'jsonwebtoken';

/** Extrai o token de vários lugares: Authorization, query, cookies e header alternativo */
function extractToken(req) {
  const auth = req.headers?.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  if (req.query && typeof req.query.token === 'string' && req.query.token) {
    return req.query.token;
  }
  const cookieHeader = req.headers?.cookie || '';
  if (cookieHeader) {
    const map = Object.fromEntries(
      cookieHeader
        .split(';')
        .map(s => s.trim())
        .filter(Boolean)
        .map(pair => {
          const i = pair.indexOf('=');
          const k = pair.slice(0, i);
          const v = decodeURIComponent(pair.slice(i + 1));
          return [k, v];
        })
    );
    const cookieToken = map.authToken || map.token || map.jwt || map.access_token;
    if (cookieToken) return cookieToken;
  }
  const alt = req.headers['x-access-token'];
  if (typeof alt === 'string' && alt) return alt;
  return null;
}

function setUserOnReq(req, payload) {
  const id = payload.userId ?? payload.id ?? payload.sub ?? null;
  req.userId = id || null;
  req.user = {
    id,
    email: payload.email ?? null,
    role: payload.role ?? 'user',
    raw: payload,
  };
}

export function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[AUTH] JWT_SECRET ausente no ambiente.');
      return res.status(500).json({ ok: false, error: 'server_misconfigured' });
    }
    const payload = jwt.verify(token, secret);
    setUserOnReq(req, payload);
    if (!req.userId) {
      return res.status(401).json({ ok: false, error: 'invalid_token_payload' });
    }
    return next();
  } catch (err) {
    console.warn('[AUTH] Token inválido:', err?.message);
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
}

export function authenticateOptional(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const secret = process.env.JWT_SECRET;
    if (!secret) return next();
    const payload = jwt.verify(token, secret);
    setUserOnReq(req, payload);
    return next();
  } catch {
    return next();
  }
}

export function admin(req, res, next) {
  const proceed = () => {
    if (!req.user || (req.user.role ?? 'user') !== 'admin') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    return next();
  };
  if (!req.user) {
    return authenticate(req, res, (err) => {
      if (err) return next(err);
      return proceed();
    });
  }
  return proceed();
}
export const protect = authenticate;
export default authenticate;
