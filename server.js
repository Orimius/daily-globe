const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const session = require('express-session');
const multer = require('multer');
const sharp = require('sharp');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 3000;

const CONTACT_URL = 'https://discord.com/users/245644669801725962';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const VIEW_COOKIE_NAME = 'dg_views';
const VIEW_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

require('dotenv').config()

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || 'unknown';
}
function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}
function makeViewSignature(req, itemId) {
  return `${itemId}__${normalizeIp(getClientIp(req))}`;
}
function parseViewCookie(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-3000) : [];
  } catch {
    return [];
  }
}


const CATEGORIES = {
  actualites: { key: 'actualites', label: 'Actualité', listLabel: 'Actualités', type: 'image', metaRoleLabel: 'Rédaction par', field: 'redacteur', autoDate: true },
  evenements: { key: 'evenements', label: 'Événement', listLabel: 'Événements', type: 'image', metaRoleLabel: 'Organisateur(trice)', field: 'organisateur', autoDate: false },
  magazines: { key: 'magazines', label: 'Magazine', listLabel: 'Magazines', type: 'image', autoDate: true },
  emissions: { key: 'emissions', label: 'Émission', listLabel: 'Émissions', type: 'youtube', metaRoleLabel: 'Présentateur(trice)', field: 'organisateur', autoDate: true },
  interviews: { key: 'interviews', label: 'Interview', listLabel: 'Interviews', type: 'youtube', metaRoleLabel: 'Présentateur(trice)', field: 'organisateur', autoDate: true }
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const defaultDb = () => ({
  site: { title: 'Daily Globe', introTagline: "L'information au bout des doigts" },
  content: { actualites: [], evenements: [], magazines: [], emissions: [], interviews: [] }
});

async function initDb() {
  try { await fsp.access(DB_PATH); }
  catch { await fsp.writeFile(DB_PATH, JSON.stringify(defaultDb(), null, 2)); }
}

function slugify(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'contenu';
}
function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
function formatDateTimeDisplay(iso) {
  const d = new Date(iso); const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toInputDateTimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso); const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function extractYoutubeId(input='') {
  const patterns = [/(?:youtube\.com\/watch\?v=)([^&]+)/,/(?:youtu\.be\/)([^?&]+)/,/(?:youtube\.com\/embed\/)([^?&]+)/,/^([a-zA-Z0-9_-]{11})$/];
  for (const p of patterns) { const m = input.trim().match(p); if (m) return m[1]; }
  return '';
}
function youtubeEmbedUrl(input='') { const id = extractYoutubeId(input); return id ? `https://www.youtube.com/embed/${id}` : ''; }
async function readDb() { return JSON.parse(await fsp.readFile(DB_PATH, 'utf-8')); }
async function writeDb(db) { await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2)); }
function findItem(db, key, id) { return (db.content[key] || []).find(x => x.id === id); }
async function processImage(buffer, name, width = 1350, height = 1688) {
  const fileName = `${name}.jpg`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  await sharp(buffer)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 90 })
    .toFile(filePath);
  return `/uploads/${fileName}`;
}

const storage = multer.memoryStorage();
const upload = multer({ storage });
const contentUpload = upload.fields([{ name: 'coverImage', maxCount: 1 }, { name: 'contentImage', maxCount: 1 }]);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());
app.use(methodOverride('_method'));
app.use(session({ secret: 'daily-globe-refonte-secret', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.categories = CATEGORIES;
  res.locals.currentPath = req.path;
  res.locals.isAdmin = !!req.session.isAdmin;
  res.locals.flash = req.session.flash || null;
  res.locals.contactUrl = CONTACT_URL;
  res.locals.confirm = req.session.confirm || null;
  res.locals.showIntro = !req.session.introSeen;
  if (!req.session.introSeen) req.session.introSeen = true;
  delete req.session.flash; delete req.session.confirm;
  next();
});

function requireAdmin(req, res, next) { if (!req.session.isAdmin) return res.redirect('/administration'); next(); }

app.get('/', async (req, res) => {
  const db = await readDb();
  res.render('pages/home', { site: db.site });
});

app.get('/contact', (req, res) => res.redirect(CONTACT_URL));

app.get('/administration', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/administration/dashboard');
  res.render('pages/admin-login');
});
app.post('/administration/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true; req.session.flash = { type: 'success', message: '✅ Vous êtes désormais connecté.' };
    return res.redirect('/administration/dashboard');
  }
  req.session.flash = { type: 'error', message: '🚫 Le mot de passe saisi est invalide.' };
  res.redirect('/administration');
});
app.post('/administration/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/administration/dashboard', requireAdmin, async (req, res) => {
  const db = await readDb();
  const groups = {};
  for (const [key, meta] of Object.entries(CATEGORIES)) groups[key] = { meta, items: [...db.content[key]].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)) };
  res.render('pages/admin-dashboard', { groups });
});

app.get('/administration/:category/new', requireAdmin, (req, res) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return res.status(404).render('pages/not-found');
  res.render('pages/admin-form', { meta, item: null, values: {}, inputDateTime: '', youtubePreview: '' });
});

app.post('/administration/:category', requireAdmin, contentUpload, async (req, res) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return res.status(404).render('pages/not-found');
  const db = await readDb(); const id = makeId();
  const publishedAt = meta.autoDate ? new Date().toISOString() : new Date(req.body.publishedAt || Date.now()).toISOString();
  const item = { id, title: (req.body.title || '').trim(), slug: `${slugify(req.body.title)}-${id.slice(-6)}`, publishedAt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), views: 0 };
  if (meta.field) item[meta.field] = (req.body[meta.field] || '').trim();
  const coverFile = req.files?.coverImage?.[0];
  const contentFile = req.files?.contentImage?.[0];
  if (!coverFile) {
    req.session.flash = { type: 'error', message: '⚠️ Une cover est obligatoire.' };
    return res.redirect(`/administration/${meta.key}/new`);
  }
  item.coverImage = await processImage(coverFile.buffer, `${meta.key}-${id}-cover`, 402, 251);
  if (meta.type === 'image') {
    if (!contentFile) {
      req.session.flash = { type: 'error', message: '⚠️ Une image de contenu est obligatoire.' };
      return res.redirect(`/administration/${meta.key}/new`);
    }
    item.image = await processImage(contentFile.buffer, `${meta.key}-${id}-content`, 1350, 1688);
  }
  if (meta.type === 'youtube') {
    item.youtubeUrl = (req.body.youtubeUrl || '').trim();
    item.youtubeEmbed = youtubeEmbedUrl(item.youtubeUrl);
  }
  db.content[meta.key].push(item); await writeDb(db);
  req.session.flash = { type: 'success', message: `✅ ${meta.label} a été créée avec succès.` };
  res.redirect('/administration/dashboard');
});

app.get('/administration/:category/:id/edit', requireAdmin, async (req, res) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return res.status(404).render('pages/not-found');
  const db = await readDb(); const item = findItem(db, meta.key, req.params.id); if (!item) return res.status(404).render('pages/not-found');
  res.render('pages/admin-form', { meta, item, values: item, inputDateTime: toInputDateTimeLocal(item.publishedAt), youtubePreview: item.youtubeEmbed || '' });
});

app.post('/administration/:category/:id/update', requireAdmin, contentUpload, async (req, res) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return res.status(404).render('pages/not-found');
  const db = await readDb(); const item = findItem(db, meta.key, req.params.id); if (!item) return res.status(404).render('pages/not-found');
  item.title = (req.body.title || '').trim();
  item.slug = `${slugify(req.body.title)}-${item.id.slice(-6)}`;
  item.updatedAt = new Date().toISOString();
  if (!meta.autoDate) item.publishedAt = new Date(req.body.publishedAt || Date.now()).toISOString();
  if (meta.field) item[meta.field] = (req.body[meta.field] || '').trim();
  const coverFile = req.files?.coverImage?.[0];
  const contentFile = req.files?.contentImage?.[0];
  if (coverFile) {
    item.coverImage = await processImage(coverFile.buffer, `${meta.key}-${item.id}-cover`, 402, 251);
  }
  if (meta.type === 'image' && contentFile) {
    item.image = await processImage(contentFile.buffer, `${meta.key}-${item.id}-content`, 1350, 1688);
  }
  if (meta.type === 'youtube') {
    item.youtubeUrl = (req.body.youtubeUrl || '').trim();
    item.youtubeEmbed = youtubeEmbedUrl(item.youtubeUrl);
  }
  await writeDb(db);
  req.session.flash = { type: 'success', message: `✅ ${meta.label} modifiée avec succès.` };
  res.redirect('/administration/dashboard');
});

app.get('/administration/:category/:id/delete', requireAdmin, async (req, res) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return res.status(404).render('pages/not-found');
  const db = await readDb(); const item = findItem(db, meta.key, req.params.id); if (!item) return res.status(404).render('pages/not-found');
  req.session.confirm = {
    title: '⚠️ Veuillez confirmer la suppression',
    action: `/administration/${meta.key}/${item.id}/delete`,
    cancelUrl: '/administration/dashboard',
    confirmLabel: 'Supprimer',
    danger: true
  };
  res.redirect('/administration/dashboard');
});

app.post('/administration/:category/:id/delete', requireAdmin, async (req, res) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return res.status(404).render('pages/not-found');
  const db = await readDb();
  db.content[meta.key] = (db.content[meta.key] || []).filter(item => item.id !== req.params.id);
  await writeDb(db);
  req.session.flash = { type: 'success', message: `✅ ${meta.label} a été supprimée avec succès.` };
  res.redirect('/administration/dashboard');
});

app.get('/:category', async (req, res, next) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return next();
  const db = await readDb(); const items = [...db.content[meta.key]].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  res.render('pages/category-list', { meta, items, formatDateTimeDisplay });
});
app.get('/:category/:slug', async (req, res, next) => {
  const meta = CATEGORIES[req.params.category]; if (!meta) return next();
  const db = await readDb(); const item = (db.content[meta.key] || []).find(x => x.slug === req.params.slug); if (!item) return next();
  const signature = makeViewSignature(req, item.id);
  const seenViews = parseViewCookie(req.cookies?.[VIEW_COOKIE_NAME]);
  if (!seenViews.includes(signature)) {
    item.views = Number(item.views || 0) + 1;
    await writeDb(db);
    seenViews.push(signature);
    res.cookie(VIEW_COOKIE_NAME, JSON.stringify(seenViews.slice(-3000)), {
      maxAge: VIEW_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax'
    });
  }
  res.render('pages/category-detail', { meta, item, formatDateTimeDisplay });
});

app.use((req,res)=>res.status(404).render('pages/not-found'));

initDb().then(() => app.listen(PORT, () => console.log(`http://localhost:${PORT}`)));
