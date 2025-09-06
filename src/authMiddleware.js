// src/authMiddleware.js
import jwt from 'jsonwebtoken';

/* --- util: extrai token de vários lugares --- */
function extractToken(req) {
  // 1) Authorization: Bearer xxx
  const auth = req.headers?.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }

  // 2) Query string (?token=)
  if (req.query && typeof req.query.token === 'string' && req.query.token) {
    return req.query.token;
  }

  // 3) Cookies
  const cookieHeader = req.headers?.cookie || '';
  if (cookieHeader) {
    const map = Object.fromEntries(
      cookieHeader
        .split(';')
        .map(s => s.trim())
        .filter(Boolean)
        .map(pair => {
          const idx = pair.indexOf('=');
          const k = pair.slice(0, idx);
          const v = decodeURIComponent(pair.slice(idx + 1));
          return [k, v];
        })
    );
    const cookieToken =
      map.authToken || map.token || map.jwt || map.access_token;
    if (cookieToken) return cookieToken;
  }

  // 4) x-access-token
  const alt = req.headers['x-access-token'];
  if (typeof alt === 'string' && alt) return alt;

  return null;
}

/* --- seta req.user e req.userId --- */
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

/* --- middleware: precisa estar autenticado --- */
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

/* --- middleware: autenticação opcional --- */
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

/* --- middleware: exige perfil admin --- */
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

/* compat com seu código antigo */
export const protect = authenticate;
export default authenticate;
