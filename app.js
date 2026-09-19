/* Epure — relevé de compteurs
   PWA hors-ligne, sans serveur. Toutes les données vivent dans IndexedDB
   sur ce téléphone : voir la sauvegarde dans Réglages. */

const DB_NAME = 'epure-compteurs';
const DB_VERSION = 1;

/* Les 4 compteurs Ingelec DDS1531 de la résidence, pré-enregistrés à partir
   des photos du 19/09/2026. `qr` est le contenu du QR de la vignette ANM —
   opaque mais unique et stable jusqu'à la prochaine vérification annuelle,
   après quoi il se réassocie depuis Réglages. */
const SEED_CHAMBRES = [
  { nom: 'Chambre 1', qr: '57Yt4SzYCP4+TZ8qT11M3fjoSMnGPHb8iBxdRZ1gyyTj++ATuoIwOz8/PvYWM+5o', vignette: '00275832', serie: '258575', indexInitial: 363.2 },
  { nom: 'Chambre 2', qr: '57Yt4SzYCP4+TZ8qT11M3W+b+1NV+gtbiQ1fYTHIFmHsalur/t4BiyGod9RuZ+LT', vignette: '00386773', serie: '257372', indexInitial: 241.3 },
  { nom: 'Chambre 3', qr: '57Yt4SzYCP4+TZ8qT11M3SfN5+mPfbR2GTCAhjBu00/KUmOk1JRjYcXy2RqP0UqJ', vignette: '00275807', serie: '282133', indexInitial: 538.7 },
  { nom: 'Chambre 4', qr: '57Yt4SzYCP4+TZ8qT11M3Zh9I/CYzAyT92H9tPiiKpC1YRsbwtNTNA4xia0NkD93', vignette: '00273854', serie: '258816', indexInitial: 517.3 },
];

const DEFAULTS = {
  entete: 'Epure',
  sousTitre: '',
  devise: 'FCFA',
  prixKwhDefaut: 0,
  seuilKwhJour: 30,
  dernierBackup: null,
};

/* ============================ IndexedDB ============================ */

let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      const ch = d.createObjectStore('chambres', { keyPath: 'id', autoIncrement: true });
      ch.createIndex('qr', 'qr', { unique: false });
      const sj = d.createObjectStore('sejours', { keyPath: 'id', autoIncrement: true });
      sj.createIndex('chambreId', 'chambreId');
      sj.createIndex('statut', 'statut');
      d.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('reglages', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);

const getAll = (name) => wrap(store(name).getAll());
const get = (name, id) => wrap(store(name).get(id));
const put = (name, val) => wrap(store(name, 'readwrite').put(val));

function viderTout() {
  return new Promise((resolve, reject) => {
    const names = ['chambres', 'sejours', 'photos', 'reglages'];
    const t = db.transaction(names, 'readwrite');
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    names.forEach((n) => t.objectStore(n).clear());
  });
}

/* ============================ Réglages ============================ */

let reglages = { ...DEFAULTS };

async function loadReglages() {
  const rows = await getAll('reglages');
  reglages = { ...DEFAULTS };
  for (const r of rows) reglages[r.k] = r.v;
}

async function setReglage(k, v) {
  reglages[k] = v;
  await put('reglages', { k, v });
}

/* ============================ Helpers ============================ */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const money = (n) => `${nf.format(Math.round(n))} ${reglages.devise}`;
const kwh = (n) => `${nf1.format(n)} kWh`;

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const nuits = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* Redimensionne et compresse une photo : ~1280px, JPEG 0.72.
   Une photo brute d'iPhone pèse 3 Mo ; on la ramène sous 250 Ko, sinon
   quelques mois de relevés saturent le stockage du navigateur. */
function compressImage(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b ? resolve(b) : reject(new Error('compression échouée')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
    img.src = url;
  });
}

async function savePhoto(blob) {
  const id = await put('photos', { blob, at: new Date().toISOString() });
  return id;
}

const photoUrls = new Map();
async function photoUrl(id) {
  if (!id) return null;
  if (photoUrls.has(id)) return photoUrls.get(id);
  const row = await get('photos', id);
  if (!row) return null;
  const url = URL.createObjectURL(row.blob);
  photoUrls.set(id, url);
  return url;
}

/* ============================ Métier ============================ */

/* Dernier index connu d'une chambre : l'index de sortie du dernier séjour
   clôturé, l'index d'entrée du séjour en cours, sinon l'index initial. */
function dernierIndex(chambre, sejours) {
  const s = sejours
    .filter((x) => x.chambreId === chambre.id)
    .sort((a, b) => a.id - b.id);
  const last = s[s.length - 1];
  if (!last) return chambre.indexInitial;
  if (last.statut === 'en_cours') return last.indexEntree;
  return last.indexSortie;
}

const sejourEnCours = (chambreId, sejours) =>
  sejours.find((s) => s.chambreId === chambreId && s.statut === 'en_cours') || null;

const conso = (s) => Math.round(((s.indexSortie ?? 0) - s.indexEntree) * 10) / 10;
const montant = (s) => conso(s) * (s.prixKwh || 0);

/* ============================ Router ============================ */

const routes = {};
let current = { name: 'recap', params: {} };
const history_ = [];

function go(name, params = {}, { push = true } = {}) {
  if (push && current.name !== name) history_.push(current);
  current = { name, params };
  render();
}

function back() {
  const prev = history_.pop();
  current = prev || { name: 'recap', params: {} };
  render();
}

async function render() {
  const app = $('#app');
  const route = routes[current.name];
  app.innerHTML = '<div class="empty">…</div>';
  $('#btn-back').hidden = history_.length === 0;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.go === current.name));
  const node = await route(current.params);
  app.innerHTML = '';
  app.append(node);
  window.scrollTo(0, 0);
}

/* ============================ Écran : Récap ============================ */

routes.recap = async () => {
  $('#title').textContent = reglages.entete || 'Epure';
  const [chambres, sejours] = await Promise.all([getAll('chambres'), getAll('sejours')]);
  const frag = el('<div class="stack"></div>');

  const actifs = chambres.filter((c) => c.actif !== false).sort((a, b) => a.id - b.id);
  if (!actifs.length) {
    frag.append(el('<div class="empty">Aucune chambre. Ajoute-les dans les réglages.</div>'));
    return frag;
  }

  for (const c of actifs) {
    const s = sejourEnCours(c.id, sejours);
    const idx = dernierIndex(c, sejours);
    let body;
    if (s) {
      const n = nuits(s.dateEntree, today());
      body = `
        <div class="room-meta">${esc(s.occupant)} · depuis le ${fmtDate(s.dateEntree)} · ${n} nuit${n > 1 ? 's' : ''}</div>
        <div class="room-stats">
          <div><div class="stat-label">Index entrée</div><div class="stat-value">${nf1.format(s.indexEntree)} <small style="font-size:13px;font-weight:400;color:var(--muted)">kWh</small></div></div>
        </div>`;
    } else {
      body = `
        <div class="room-meta">Vignette ANM ${esc(c.vignette || '—')}</div>
        <div class="room-stats">
          <div><div class="stat-label">Dernier index</div><div class="stat-value">${nf1.format(idx)} <small style="font-size:13px;font-weight:400;color:var(--muted)">kWh</small></div></div>
        </div>`;
    }
    const card = el(`
      <button class="card" data-chambre="${c.id}">
        <div class="room-head">
          <span class="room-name">${esc(c.nom)}</span>
          <span class="pill ${s ? 'occupee' : 'libre'}">${s ? 'Occupée' : 'Libre'}</span>
        </div>
        ${body}
      </button>`);
    card.onclick = () => go('chambre', { id: c.id });
    frag.append(card);
  }

  const enCours = sejours.filter((s) => s.statut === 'en_cours').length;
  frag.append(el(`<div class="hint" style="text-align:center;margin-top:18px">
    ${enCours} chambre${enCours > 1 ? 's' : ''} occupée${enCours > 1 ? 's' : ''} sur ${actifs.length}
  </div>`));
  return frag;
};

/* ============================ Écran : Chambre ============================ */

routes.chambre = async ({ id }) => {
  const [chambre, sejours] = await Promise.all([get('chambres', id), getAll('sejours')]);
  $('#title').textContent = chambre.nom;
  const s = sejourEnCours(id, sejours);
  const idx = dernierIndex(chambre, sejours);
  const frag = el('<div class="stack"></div>');

  if (s) {
    const n = nuits(s.dateEntree, today());
    frag.append(el(`
      <div class="card">
        <div class="room-head">
          <span class="room-name">${esc(s.occupant)}</span>
          <span class="pill occupee">Occupée</span>
        </div>
        <div class="lines" style="margin-top:12px">
          <div><span class="k">Entrée</span><span class="v">${fmtDate(s.dateEntree)}</span></div>
          <div><span class="k">Nuits</span><span class="v">${n}</span></div>
          <div><span class="k">Index d'entrée</span><span class="v">${kwh(s.indexEntree)}</span></div>
          ${s.tel ? `<div><span class="k">Téléphone</span><span class="v">${esc(s.tel)}</span></div>` : ''}
        </div>
      </div>`));
    const b = el('<button class="btn">Enregistrer le départ</button>');
    b.onclick = () => go('depart', { sejourId: s.id });
    frag.append(b);
  } else {
    frag.append(el(`
      <div class="card">
        <div class="room-head"><span class="room-name">Chambre libre</span><span class="pill libre">Libre</span></div>
        <div class="lines" style="margin-top:12px">
          <div><span class="k">Dernier index relevé</span><span class="v">${kwh(idx)}</span></div>
          <div><span class="k">Vignette ANM</span><span class="v">${esc(chambre.vignette || '—')}</span></div>
          <div><span class="k">N° de série</span><span class="v">${esc(chambre.serie || '—')}</span></div>
        </div>
      </div>`));
    const b = el('<button class="btn">Enregistrer une arrivée</button>');
    b.onclick = () => go('arrivee', { chambreId: id });
    frag.append(b);
  }

  const passes = sejours.filter((x) => x.chambreId === id && x.statut !== 'en_cours').sort((a, b) => b.id - a.id);
  if (passes.length) {
    frag.append(el('<h2>Séjours précédents</h2>'));
    for (const p of passes.slice(0, 6)) frag.append(archiveCard(p, chambre));
  }
  return frag;
};

/* ============================ Champ photo + index ============================ */

/* Un bloc réutilisable : la photo du compteur au-dessus, le champ index
   juste en dessous. Les deux se lisent d'un seul coup d'œil — c'est ce qui
   permet de vérifier le chiffre saisi sans quitter l'écran. */
function blocReleve({ label, hint }) {
  const node = el(`
    <div>
      <div class="field">
        <label>${esc(label)}</label>
        <div class="photo-slot">
          <span class="ph-placeholder">📷 Photographier le compteur</span>
          <img hidden alt="">
          <input type="file" accept="image/*" capture="environment">
        </div>
        <div class="hint">La photo est la pièce justificative du relevé. Obligatoire.</div>
      </div>
      <div class="field">
        <label>Index affiché (kWh)</label>
        <input class="index-input" type="text" inputmode="decimal" placeholder="000000.0">
        <div class="hint index-hint">${esc(hint || 'Recopie le nombre affiché, virgule comprise.')}</div>
      </div>
    </div>`);

  const slot = $('.photo-slot', node);
  const img = $('img', slot);
  const ph = $('.ph-placeholder', slot);
  const file = $('input[type=file]', slot);
  const input = $('.index-input', node);
  const state = { blob: null, photoId: null };

  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const blob = await compressImage(f);
      state.blob = blob;
      img.src = URL.createObjectURL(blob);
      img.hidden = false;
      ph.hidden = true;
    } catch (e) {
      toast('Photo illisible, recommence.');
    }
  };

  return { node, input, state, commit: async () => state.blob ? (state.photoId = await savePhoto(state.blob)) : null };
}

const parseIndex = (raw) => {
  const v = String(raw).trim().replace(',', '.').replace(/\s/g, '');
  if (!/^\d{1,7}(\.\d)?$/.test(v)) return NaN;
  return parseFloat(v);
};

/* ============================ Écran : Arrivée ============================ */

routes.arrivee = async ({ chambreId }) => {
  const [chambre, sejours] = await Promise.all([get('chambres', chambreId), getAll('sejours')]);
  $('#title').textContent = `${chambre.nom} — arrivée`;
  const precedent = dernierIndex(chambre, sejours);

  const frag = el('<div class="stack"></div>');
  frag.append(el(`<div class="card"><div class="lines">
    <div><span class="k">Dernier index relevé</span><span class="v">${kwh(precedent)}</span></div>
  </div></div>`));

  const releve = blocReleve({
    label: 'Compteur à l\'arrivée',
    hint: `Doit être au moins égal à ${nf1.format(precedent)} — un compteur ne recule pas.`,
  });
  const form = el(`
    <div class="card">
      <div class="field"><label>Occupant</label><input id="a-nom" type="text" autocomplete="name" placeholder="Nom de l'occupant"></div>
      <div class="field"><label>Téléphone (optionnel)</label><input id="a-tel" type="tel" inputmode="tel" placeholder="+229…"></div>
      <div class="field"><label>Date d'entrée</label><input id="a-date" type="date" value="${today()}"></div>
    </div>`);
  const boucle = el(`<label style="display:flex;gap:10px;align-items:center;font-size:13px;color:var(--muted);margin-top:4px">
    <input type="checkbox" id="a-boucle" style="width:auto"> Le compteur est repassé à zéro
  </label>`);

  const bloc = el('<div class="card"></div>');
  bloc.append(releve.node);
  frag.append(bloc, boucle, form);

  const btn = el('<button class="btn">Valider l\'arrivée</button>');
  btn.onclick = async () => {
    const idx = parseIndex(releve.input.value);
    const nom = $('#a-nom', form).value.trim();
    const date = $('#a-date', form).value;
    const aBoucle = $('#a-boucle', boucle).checked;

    if (!releve.state.blob) return toast('Photo du compteur obligatoire.');
    if (Number.isNaN(idx)) return toast('Index invalide — 6 chiffres et une décimale.');
    if (!aBoucle && idx < precedent) return toast(`Index inférieur au dernier relevé (${nf1.format(precedent)}). Coche « repassé à zéro » si c’est le cas.`);
    if (!nom) return toast('Nom de l’occupant obligatoire.');
    if (!date) return toast('Date d’entrée obligatoire.');
    if (sejourEnCours(chambreId, await getAll('sejours'))) return toast('Cette chambre est déjà occupée.');

    btn.disabled = true;
    const photoId = await releve.commit();
    await put('sejours', {
      chambreId, occupant: nom,
      tel: $('#a-tel', form).value.trim(),
      dateEntree: date, indexEntree: idx, photoEntree: photoId,
      indexSortie: null, photoSortie: null, dateSortie: null,
      prixKwh: null, statut: 'en_cours',
      compteurBoucleEntree: aBoucle,
      creeA: new Date().toISOString(),
    });
    toast('Arrivée enregistrée.');
    history_.length = 0;
    go('recap');
  };
  frag.append(btn);
  return frag;
};

/* ============================ Écran : Départ ============================ */

routes.depart = async ({ sejourId }) => {
  const sejour = await get('sejours', sejourId);
  const chambre = await get('chambres', sejour.chambreId);
  $('#title').textContent = `${chambre.nom} — départ`;

  const frag = el('<div class="stack"></div>');
  frag.append(el(`<div class="card"><div class="lines">
    <div><span class="k">Occupant</span><span class="v">${esc(sejour.occupant)}</span></div>
    <div><span class="k">Entré le</span><span class="v">${fmtDate(sejour.dateEntree)}</span></div>
    <div><span class="k">Index d'entrée</span><span class="v">${kwh(sejour.indexEntree)}</span></div>
  </div></div>`));

  const releve = blocReleve({
    label: 'Compteur au départ',
    hint: `Doit être au moins égal à ${nf1.format(sejour.indexEntree)}.`,
  });
  const form = el(`
    <div class="card">
      <div class="field"><label>Date de sortie</label><input id="d-date" type="date" value="${today()}"></div>
      <div class="field"><label>Prix du kWh (${esc(reglages.devise)})</label>
        <input id="d-prix" type="text" inputmode="decimal" placeholder="ex. 120" value="${reglages.prixKwhDefaut || ''}"></div>
      <div class="field"><label>Note (optionnel)</label><input id="d-note" type="text" placeholder="État des lieux, remarque…"></div>
    </div>`);
  const apercu = el(`<div class="card"><div class="lines" id="d-apercu">
    <div><span class="k">Consommation</span><span class="v">—</span></div>
    <div class="total"><span class="k">Total</span><span class="v">—</span></div>
  </div><div class="hint" id="d-alerte" hidden></div></div>`);

  const bloc = el('<div class="card"></div>');
  bloc.append(releve.node);
  frag.append(bloc, form, apercu);

  const recalc = () => {
    const idx = parseIndex(releve.input.value);
    const prix = parseFloat(String($('#d-prix', form).value).replace(',', '.'));
    const lines = $('#d-apercu', apercu);
    const alerte = $('#d-alerte', apercu);
    if (Number.isNaN(idx) || idx < sejour.indexEntree) {
      lines.innerHTML = '<div><span class="k">Consommation</span><span class="v">—</span></div><div class="total"><span class="k">Total</span><span class="v">—</span></div>';
      alerte.hidden = true;
      return;
    }
    const c = Math.round((idx - sejour.indexEntree) * 10) / 10;
    const n = Math.max(1, nuits(sejour.dateEntree, $('#d-date', form).value || today()));
    const total = Number.isNaN(prix) ? null : c * prix;
    lines.innerHTML = `
      <div><span class="k">Index entrée</span><span class="v">${nf1.format(sejour.indexEntree)}</span></div>
      <div><span class="k">Index sortie</span><span class="v">${nf1.format(idx)}</span></div>
      <div><span class="k">Consommation</span><span class="v">${kwh(c)}</span></div>
      <div><span class="k">Moyenne / nuit</span><span class="v">${kwh(Math.round((c / n) * 10) / 10)}</span></div>
      <div class="total"><span class="k">Total</span><span class="v">${total === null ? '—' : money(total)}</span></div>`;
    const parJour = c / n;
    if (c === 0) {
      alerte.textContent = '⚠ Consommation nulle — index identique à l’entrée. À vérifier.';
      alerte.className = 'hint warn'; alerte.hidden = false;
    } else if (parJour > reglages.seuilKwhJour) {
      alerte.textContent = `⚠ ${nf1.format(parJour)} kWh/nuit, au-dessus du seuil de ${reglages.seuilKwhJour}. Vérifie l’index avant de valider.`;
      alerte.className = 'hint warn'; alerte.hidden = false;
    } else {
      alerte.hidden = true;
    }
  };
  releve.input.oninput = recalc;
  form.oninput = recalc;

  const btn = el('<button class="btn">Clôturer et éditer la facture</button>');
  btn.onclick = async () => {
    const idx = parseIndex(releve.input.value);
    const prix = parseFloat(String($('#d-prix', form).value).replace(',', '.'));
    const date = $('#d-date', form).value;
    if (!releve.state.blob) return toast('Photo du compteur obligatoire.');
    if (Number.isNaN(idx)) return toast('Index invalide.');
    if (idx < sejour.indexEntree) return toast(`Index inférieur à celui d’entrée (${nf1.format(sejour.indexEntree)}).`);
    if (Number.isNaN(prix) || prix <= 0) return toast('Prix du kWh obligatoire.');
    if (!date) return toast('Date de sortie obligatoire.');
    if (new Date(date) < new Date(sejour.dateEntree)) return toast('La sortie est antérieure à l’entrée.');

    btn.disabled = true;
    const photoId = await releve.commit();
    Object.assign(sejour, {
      indexSortie: idx, photoSortie: photoId, dateSortie: date,
      prixKwh: prix, note: $('#d-note', form).value.trim(),
      statut: 'cloture', clotureA: new Date().toISOString(),
    });
    await put('sejours', sejour);
    if (!reglages.prixKwhDefaut) await setReglage('prixKwhDefaut', prix);
    refreshBackupWarning();
    history_.length = 0;
    go('facture', { sejourId: sejour.id });
  };
  frag.append(btn);
  recalc();
  return frag;
};

/* ============================ Facture (canvas) ============================ */

async function dessinerFacture(sejour, chambre) {
  const W = 1000, H = 1414;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const ink = '#12181f', grey = '#6b7886', line = '#d7dee5';

  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const M = 80;
  let y = 110;

  g.fillStyle = ink;
  g.font = '600 46px -apple-system, "Segoe UI", Roboto, sans-serif';
  g.fillText(reglages.entete || 'Epure', M, y);
  if (reglages.sousTitre) {
    y += 34;
    g.fillStyle = grey; g.font = '26px -apple-system, sans-serif';
    g.fillText(reglages.sousTitre, M, y);
  }

  y += 30;
  g.strokeStyle = line; g.lineWidth = 2;
  g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();

  y += 56;
  g.fillStyle = ink; g.font = '600 32px -apple-system, sans-serif';
  g.fillText('Facture d’électricité', M, y);
  y += 38;
  g.fillStyle = grey; g.font = '24px -apple-system, sans-serif';
  g.fillText(`Éditée le ${new Date().toLocaleDateString('fr-FR')}`, M, y);

  const ligne = (k, v, opts = {}) => {
    y += opts.gap ?? 52;
    g.fillStyle = opts.bold ? ink : grey;
    g.font = `${opts.bold ? '600 ' : ''}${opts.size || 26}px -apple-system, sans-serif`;
    g.fillText(k, M, y);
    g.fillStyle = ink;
    g.font = `600 ${opts.size || 26}px -apple-system, sans-serif`;
    g.textAlign = 'right';
    g.fillText(v, W - M, y);
    g.textAlign = 'left';
  };

  y += 30;
  ligne('Chambre', chambre.nom);
  ligne('Occupant', sejour.occupant);
  if (sejour.tel) ligne('Téléphone', sejour.tel);
  ligne('Entrée', fmtDate(sejour.dateEntree));
  ligne('Sortie', fmtDate(sejour.dateSortie));
  ligne('Nuits', String(Math.max(1, nuits(sejour.dateEntree, sejour.dateSortie))));

  y += 34;
  g.strokeStyle = line; g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();

  ligne('Index à l’entrée', `${nf1.format(sejour.indexEntree)} kWh`);
  ligne('Index à la sortie', `${nf1.format(sejour.indexSortie)} kWh`);
  ligne('Consommation', `${nf1.format(conso(sejour))} kWh`, { bold: true });
  ligne('Prix du kWh', money(sejour.prixKwh));

  y += 34;
  g.strokeStyle = ink; g.lineWidth = 3;
  g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();
  ligne('TOTAL À PAYER', money(montant(sejour)), { bold: true, size: 40, gap: 70 });

  if (sejour.note) {
    y += 64;
    g.fillStyle = grey; g.font = '23px -apple-system, sans-serif';
    for (const part of String(sejour.note).match(/.{1,52}(\s|$)/g) || []) {
      g.fillText(part.trim(), M, y); y += 32;
    }
  }

  g.fillStyle = grey; g.font = '20px -apple-system, sans-serif';
  g.fillText(`Compteur Ingelec DDS1531 · vignette ANM ${chambre.vignette || '—'}`, M, H - 116);
  g.fillText('Relevé contradictoire effectué sur place, photos à l’appui.', M, H - 84);

  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

routes.facture = async ({ sejourId }) => {
  const sejour = await get('sejours', sejourId);
  const chambre = await get('chambres', sejour.chambreId);
  $('#title').textContent = 'Facture';

  const blob = await dessinerFacture(sejour, chambre);
  const url = URL.createObjectURL(blob);
  const nomFichier = `Facture-${(chambre.nom || 'chambre').replace(/\s+/g, '-')}-${sejour.dateSortie}.png`;

  const frag = el('<div class="stack"></div>');
  frag.append(el(`<img id="facture-img" src="${url}" alt="Facture">`));

  const partager = el('<button class="btn">Partager (WhatsApp…)</button>');
  partager.onclick = async () => {
    const file = new File([blob], nomFichier, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Facture d’électricité' }); }
      catch (e) { if (e.name !== 'AbortError') toast('Partage impossible.'); }
    } else {
      toast('Partage non supporté — utilise « Enregistrer ».');
    }
  };

  const enregistrer = el(`<a class="btn ghost" style="display:block;text-align:center;text-decoration:none" href="${url}" download="${nomFichier}">Enregistrer l’image</a>`);
  const hint = el('<div class="hint">Sur iPhone : appuie longuement sur la facture ci-dessus puis « Ajouter aux photos ».</div>');

  const imprimer = el('<button class="btn ghost">Imprimer</button>');
  imprimer.onclick = () => {
    const w = window.open('', '_blank');
    if (!w) return toast('Fenêtre d’impression bloquée.');
    w.document.write(`<img src="${url}" style="width:100%" onload="window.print()">`);
    w.document.close();
  };

  const fini = el('<button class="btn ghost">Terminé</button>');
  fini.onclick = () => { history_.length = 0; go('recap'); };

  frag.append(partager, enregistrer, hint, imprimer, fini);
  return frag;
};

/* ============================ Écran : Archives ============================ */

function archiveCard(s, chambre) {
  const card = el(`
    <button class="card">
      <div class="arch-item">
        <div>
          <div class="room-name" style="font-size:15px">${esc(s.occupant)}</div>
          <div class="arch-sub">${esc(chambre?.nom || '')} · ${fmtDate(s.dateEntree)} → ${fmtDate(s.dateSortie)} · ${nf1.format(conso(s))} kWh</div>
        </div>
        <div class="arch-amount">${money(montant(s))}</div>
      </div>
    </button>`);
  card.onclick = () => go('facture', { sejourId: s.id });
  return card;
}

routes.archives = async () => {
  $('#title').textContent = 'Archives';
  const [chambres, sejours] = await Promise.all([getAll('chambres'), getAll('sejours')]);
  const byId = Object.fromEntries(chambres.map((c) => [c.id, c]));
  const clos = sejours.filter((s) => s.statut !== 'en_cours').sort((a, b) => (b.dateSortie || '').localeCompare(a.dateSortie || ''));

  const frag = el('<div class="stack"></div>');
  if (!clos.length) {
    frag.append(el('<div class="empty">Aucun séjour clôturé pour l’instant.</div>'));
    return frag;
  }

  const mois = [...new Set(clos.map((s) => (s.dateSortie || '').slice(0, 7)))];
  const filtre = el(`<select><option value="">Tous les mois</option>${
    mois.map((m) => `<option value="${m}">${new Date(m + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</option>`).join('')
  }</select>`);
  const liste = el('<div class="stack"></div>');
  const total = el('<div class="card"><div class="lines"><div class="total"><span class="k">Total période</span><span class="v"></span></div></div></div>');

  const dessine = () => {
    const m = filtre.value;
    const rows = m ? clos.filter((s) => (s.dateSortie || '').startsWith(m)) : clos;
    liste.innerHTML = '';
    for (const s of rows) liste.append(archiveCard(s, byId[s.chambreId]));
    $('.total .v', total).textContent = `${money(rows.reduce((a, s) => a + montant(s), 0))} · ${nf1.format(rows.reduce((a, s) => a + conso(s), 0))} kWh`;
  };
  filtre.onchange = dessine;

  const csv = el('<button class="btn ghost">Exporter en CSV</button>');
  csv.onclick = () => exporterCsv(clos, byId);

  frag.append(filtre, total, liste, csv);
  dessine();
  return frag;
};

function exporterCsv(sejours, byId) {
  const head = ['Chambre', 'Occupant', 'Telephone', 'Entree', 'Sortie', 'Nuits', 'Index entree', 'Index sortie', 'Consommation kWh', 'Prix kWh', 'Montant', 'Devise', 'Note'];
  const rows = sejours.map((s) => [
    byId[s.chambreId]?.nom || '', s.occupant, s.tel || '', s.dateEntree, s.dateSortie,
    Math.max(1, nuits(s.dateEntree, s.dateSortie)),
    s.indexEntree, s.indexSortie, conso(s), s.prixKwh, Math.round(montant(s)), reglages.devise, s.note || '',
  ]);
  const csv = [head, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  telecharger(new Blob(['﻿' + csv], { type: 'text/csv' }), `epure-sejours-${today()}.csv`);
}

function telecharger(blob, nom) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ============================ Écran : Réglages ============================ */

routes.reglages = async () => {
  $('#title').textContent = 'Réglages';
  const chambres = (await getAll('chambres')).sort((a, b) => a.id - b.id);
  const frag = el('<div class="stack"></div>');

  /* --- sauvegarde, en premier parce que c'est le vrai risque --- */
  frag.append(el('<h2>Sauvegarde</h2>'));
  const dern = reglages.dernierBackup;
  frag.append(el(`<div class="card">
    <div class="hint" style="margin:0 0 12px">
      Toutes les données vivent sur ce téléphone uniquement. Sans sauvegarde,
      un téléphone perdu ou réinitialisé emporte toute la comptabilité.
      ${dern ? `Dernière sauvegarde : <b>${new Date(dern).toLocaleString('fr-FR')}</b>.` : '<b>Aucune sauvegarde effectuée.</b>'}
    </div>
  </div>`));
  const bExport = el('<button class="btn">Sauvegarder maintenant</button>');
  bExport.onclick = exporterSauvegarde;
  const bImport = el('<label class="btn ghost" style="display:block;text-align:center">Restaurer une sauvegarde<input type="file" accept="application/json" hidden></label>');
  $('input', bImport).onchange = (e) => importerSauvegarde(e.target.files[0]);
  frag.append(bExport, bImport);

  /* --- facture --- */
  frag.append(el('<h2>Facture</h2>'));
  const fact = el(`<div class="card">
    <div class="field"><label>En-tête</label><input id="r-entete" value="${esc(reglages.entete)}"></div>
    <div class="field"><label>Sous-titre (adresse, téléphone…)</label><input id="r-sous" value="${esc(reglages.sousTitre)}"></div>
    <div class="row field">
      <div><label>Devise</label><input id="r-devise" value="${esc(reglages.devise)}"></div>
      <div><label>Prix kWh par défaut</label><input id="r-prix" inputmode="decimal" value="${reglages.prixKwhDefaut || ''}"></div>
    </div>
    <div class="field"><label>Seuil d’alerte (kWh / nuit)</label><input id="r-seuil" inputmode="decimal" value="${reglages.seuilKwhJour}"></div>
  </div>`);
  const bFact = el('<button class="btn ghost">Enregistrer</button>');
  bFact.onclick = async () => {
    await setReglage('entete', $('#r-entete', fact).value.trim() || 'Epure');
    await setReglage('sousTitre', $('#r-sous', fact).value.trim());
    await setReglage('devise', $('#r-devise', fact).value.trim() || 'FCFA');
    await setReglage('prixKwhDefaut', parseFloat(String($('#r-prix', fact).value).replace(',', '.')) || 0);
    await setReglage('seuilKwhJour', parseFloat(String($('#r-seuil', fact).value).replace(',', '.')) || 30);
    toast('Réglages enregistrés.');
  };
  frag.append(fact, bFact);

  /* --- chambres --- */
  frag.append(el('<h2>Chambres et compteurs</h2>'));
  for (const c of chambres) {
    const card = el(`<div class="card">
      <div class="field"><label>Nom</label><input value="${esc(c.nom)}" data-nom="${c.id}"></div>
      <div class="lines" style="margin-top:10px">
        <div><span class="k">Vignette ANM</span><span class="v">${esc(c.vignette || '—')}</span></div>
        <div><span class="k">N° de série</span><span class="v">${esc(c.serie || '—')}</span></div>
        <div><span class="k">QR associé</span><span class="v">${c.qr ? '✓ oui' : '✗ aucun'}</span></div>
      </div>
    </div>`);
    $(`[data-nom="${c.id}"]`, card).onchange = async (e) => {
      c.nom = e.target.value.trim() || c.nom;
      await put('chambres', c);
      toast('Nom mis à jour.');
    };
    const rebind = el('<button class="btn ghost" style="margin-top:10px">Réassocier le QR (nouvelle vignette)</button>');
    rebind.onclick = () => ouvrirScanner(async (payload) => {
      c.qr = payload;
      await put('chambres', c);
      toast(`QR réassocié à ${c.nom}.`);
      render();
    });
    card.append(rebind);
    frag.append(card);
  }

  frag.append(el(`<div class="hint" style="margin-top:18px">
    Le QR est collé sur la vignette de vérification métrologique annuelle :
    il change à chaque re-vérification. Réassocie-le ici, l’historique de la
    chambre est conservé.
  </div>`));
  return frag;
};

/* ============================ Sauvegarde ============================ */

const blobToDataUrl = (blob) => new Promise((res) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.readAsDataURL(blob);
});

async function exporterSauvegarde() {
  toast('Préparation de la sauvegarde…');
  const [chambres, sejours, photos, regs] = await Promise.all([
    getAll('chambres'), getAll('sejours'), getAll('photos'), getAll('reglages'),
  ]);
  const photosOut = [];
  for (const p of photos) photosOut.push({ id: p.id, at: p.at, data: await blobToDataUrl(p.blob) });
  const dump = { format: 'epure-compteurs/1', exporteLe: new Date().toISOString(), chambres, sejours, photos: photosOut, reglages: regs };
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  const nom = `epure-sauvegarde-${today()}.json`;
  const file = new File([blob], nom, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Sauvegarde Epure' }); }
    catch (e) { if (e.name !== 'AbortError') telecharger(blob, nom); }
  } else {
    telecharger(blob, nom);
  }
  await setReglage('dernierBackup', new Date().toISOString());
  refreshBackupWarning();
  render();
}

async function importerSauvegarde(file) {
  if (!file) return;
  if (!confirm('Restaurer cette sauvegarde remplace toutes les données actuelles de ce téléphone. Continuer ?')) return;
  try {
    const dump = JSON.parse(await file.text());
    if (dump.format !== 'epure-compteurs/1') throw new Error('format inconnu');
    await viderTout();
    for (const c of dump.chambres) await put('chambres', c);
    for (const s of dump.sejours) await put('sejours', s);
    for (const p of dump.photos) {
      const blob = await (await fetch(p.data)).blob();
      await put('photos', { id: p.id, at: p.at, blob });
    }
    for (const r of dump.reglages) await put('reglages', r);
    photoUrls.clear();
    await loadReglages();
    toast('Sauvegarde restaurée.');
    history_.length = 0;
    go('recap');
  } catch (e) {
    toast('Fichier de sauvegarde illisible.');
  }
}

/* Rappelle la sauvegarde dès qu'un séjour a été clôturé après la dernière. */
async function refreshBackupWarning() {
  const sejours = await getAll('sejours');
  const clos = sejours.filter((s) => s.statut !== 'en_cours' && s.clotureA);
  const depuis = reglages.dernierBackup;
  const enRetard = clos.filter((s) => !depuis || s.clotureA > depuis).length;
  const b = $('#backup-warning');
  b.hidden = enRetard === 0;
  document.body.classList.toggle('has-banner', enRetard > 0);
  if (enRetard) {
    $('#backup-warning-text').textContent =
      `${enRetard} facture${enRetard > 1 ? 's' : ''} non sauvegardée${enRetard > 1 ? 's' : ''}.`;
  }
}

/* ============================ Scanner QR ============================ */

let scanStream = null, scanRaf = null;

function ouvrirScanner(onFound) {
  const ov = $('#scanner');
  const video = $('#scan-video');
  const canvas = $('#scan-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ov.hidden = false;

  const stop = () => {
    cancelAnimationFrame(scanRaf);
    scanStream?.getTracks().forEach((t) => t.stop());
    scanStream = null;
    ov.hidden = true;
  };
  $('#scan-close').onclick = stop;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(async (stream) => {
      scanStream = stream;
      video.srcObject = stream;
      await video.play();

      /* BarcodeDetector quand il existe (Chrome/Android), jsQR partout ailleurs
         — Safari iOS n'implémente pas l'API native. */
      const detector = 'BarcodeDetector' in window
        ? new window.BarcodeDetector({ formats: ['qr_code'] })
        : null;

      const tick = async () => {
        if (!scanStream) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          let payload = null;
          if (detector) {
            try { payload = (await detector.detect(video))[0]?.rawValue ?? null; } catch {}
          } else {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            payload = window.jsQR?.(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (payload) {
            stop();
            if (navigator.vibrate) navigator.vibrate(60);
            onFound(payload);
            return;
          }
        }
        scanRaf = requestAnimationFrame(tick);
      };
      tick();
    })
    .catch(() => {
      stop();
      toast('Caméra inaccessible. Autorise l’accès, ou choisis la chambre à la main.');
    });
}

async function scannerPuisOuvrir() {
  ouvrirScanner(async (payload) => {
    const chambres = await getAll('chambres');
    const c = chambres.find((x) => x.qr === payload);
    if (!c) {
      toast('QR inconnu. Associe-le à une chambre dans les réglages.');
      go('reglages');
      return;
    }
    go('chambre', { id: c.id });
  });
}

/* ============================ Démarrage ============================ */

async function seedSiVide() {
  const chambres = await getAll('chambres');
  if (chambres.length) return;
  for (const c of SEED_CHAMBRES) await put('chambres', { ...c, actif: true });
}

async function main() {
  db = await openDb();
  await seedSiVide();
  await loadReglages();

  $('#btn-back').onclick = back;
  $('#btn-settings').onclick = () => go('reglages');
  $('#tab-scan').onclick = scannerPuisOuvrir;
  document.querySelectorAll('[data-go]').forEach((b) => {
    b.onclick = () => { history_.length = 0; go(b.dataset.go); };
  });

  await refreshBackupWarning();
  await render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* Le stockage persistant met le navigateur en garde contre l'éviction
     automatique des données — surtout sur iOS, où une app web peu visitée
     peut se faire purger. */
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

main().catch((e) => {
  document.body.innerHTML = `<div class="empty">Erreur au démarrage : ${esc(e.message)}</div>`;
});
