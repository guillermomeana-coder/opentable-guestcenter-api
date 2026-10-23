/**
 * Kitchen OT Bot v2 — Telegram + Claude NLP + OpenTable GuestCenter
 *
 * Features:
 * - Lenguaje natural en español
 * - Confirmacion antes de crear/cancelar/modificar
 * - Rectificacion si entendio mal
 * - Filtro inteligente con contexto
 * - Creacion de referidores nuevos
 * - Deposito siempre waived
 * - Notificaciones diarias 4pm + 12am BCS
 * - 24/7 activo
 */

require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHAT_ID = '7081116534';
const RID = 1264498;
const MOD_BY = '698796db4c736d653554fa2b';
const SESSION_DIR = path.join(__dirname, '.ot-browser-data');
const OT_TZ = -7;

let page, referrersCache = null;

// --- Conversation state (confirmations) ---
const pendingAction = {}; // chatId -> { type, data, summary }

// --- Telegram ---
const TG_BASE = () => `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function tgSend(chatId, text) {
  // Telegram markdown can fail on special chars, fallback to plain
  try {
    const r = await fetch(`${TG_BASE()}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const d = await r.json();
    if (!d.ok) console.error('[TG SEND ERR]', d.description);
  } catch(e) { console.error('[TG]', e.message); }
}

// --- Browser ---
async function initBrowser() {
  if (fs.existsSync(path.join(SESSION_DIR, 'lockfile'))) {
    try { fs.unlinkSync(path.join(SESSION_DIR, 'lockfile')); } catch {}
  }

  console.log('[OT] Abriendo browser...');
  const ctx = await firefox.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`https://guestcenter.opentable.com/restaurant/${RID}/home`);

  try {
    await page.waitForSelector('text=Kitchen', { timeout: 10000 });
    console.log('[OT] Sesion activa!');
  } catch {
    console.log('[OT] Logueate en GuestCenter en la ventana del browser...');
    // Notificar por Telegram que necesita login
    await tgSend(CHAT_ID, '⚠️ Sesion OT expirada. Logueate en la ventana del browser que se abrio en tu PC.');
    await page.waitForSelector('text=Kitchen', { timeout: 600000 });
    console.log('[OT] Login OK!');
    await tgSend(CHAT_ID, '✅ Login detectado. Bot activo.');
  }
}

// --- OT API via browser ---
async function ot(endpoint, options = {}) {
  return page.evaluate(async ({ endpoint, options }) => {
    const r = await fetch(`/gateway/proxies/${endpoint}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const t = await r.text();
    try { return { s: r.status, d: JSON.parse(t) }; }
    catch { return { s: r.status, d: t }; }
  }, { endpoint, options });
}

async function searchGuest(q) {
  const r = await ot(`gcFohWeb/api/${RID}/v4/guests/search?query=${encodeURIComponent(q)}`);
  return r.s === 200 ? r.d.results || [] : [];
}

async function getReferrers() {
  if (referrersCache) return referrersCache;
  const r = await ot(`referralManagement/user/v1/restaurants/${RID}/referrers`);
  if (r.s === 200) { referrersCache = r.d; return r.d; }
  return [];
}

async function searchReferrer(q) {
  const refs = await getReferrers();
  const lq = q.toLowerCase();
  return refs.filter(r => `${r.FirstName} ${r.LastName} ${r.CompanyName}`.toLowerCase().includes(lq)).slice(0, 5);
}

async function createRes({ guestId, date, time, pax }) {
  const rid = await page.evaluate(() => crypto.randomUUID());
  return ot(`foh-web/gcFohWeb/api/${RID}/v2/reservations?disableVault=true`, {
    method: 'POST',
    body: {
      RID, State: 'NotConfirmed', Origin: 'PHONE', ReservationId: rid,
      PartySize: pax, Scheduled: toUTC(date, time), ScheduledLocal: `${date}T${time}:00`,
      $restaurantDay: date, GuestId: guestId, DiningAreaId: 0, ExperienceId: 0,
      DiningArea: { Selection: 'any', Id: 0 }, SlotLockId: null, SMSOptIn: false,
      EmailConfirmationOptOut: false, OverbookingReason: 'None',
      CancellationPolicyId: '64b846257896686eaddea365:v12',
      CancellationPolicyWaivedReason: 'InHouse',
      DepositDetails: { TotalPrice: 60000, Currency: 'MXN', CurrencyDenominator: 100, Status: 'Waived' },
      BookingContext: { NoTablesAvailable: false, NoPrivateDiningAvailable: false, OnlyNonreservableTablesAvailable: false, EachAvailableTableViolatesATurnControl: false, PartySizeViolatesExperienceConstraints: false, NoTablesAvailableForExperience: false, TimeViolatesExperienceConstraints: false, AllowedBookingChannelViolations: [], AllowAccessRuleViolation: false },
      CommandParameters: { ModifiedBy: MOD_BY, ClientInfo: { Client: 'Web App', ClientVersion: 'gc-microapp-front-of-house-Base-10144' } },
      Tags: [], $allTags: []
    }
  });
}

async function updateRes(id, u) {
  return ot(`foh-web/gcFohWeb/api/${RID}/v2/reservations/${id}`, {
    method: 'PUT', body: { reservation: { ...u, ReservationId: id } }
  });
}

async function getRes(date) {
  const r = await ot(`gcFohWeb/api/${RID}/bulk-sync?entities=Reservations,CoverBlocks,TableBlocks`, {
    method: 'POST',
    body: {
      Reservations: { restaurantDay: date, sinceSequenceId: 0, useNewReservationSyncApi: true },
      CoverBlocks: { restaurantDay: date, sinceSequenceId: 0, count: 1000 },
      TableBlocks: { startDate: `${date}T05:00:00`, endDate: `${date}T04:59:00`, sinceSequenceId: 0, includeDeleted: true, count: 500 }
    }
  });
  return r.s === 200 ? (r.d.Reservations?.Results || []).filter(x => x.State !== 'Cancelled') : [];
}

async function guestProfile(gid) {
  const r = await ot(`crm/guestProfile/api/v1/modular-guest-profile/restaurants/${RID}/guests/${gid}?modules=contactV2,guest,insights,intelligence,notes,rewards,tags`);
  return r.s === 200 ? r.d : null;
}

async function checkAvailability(date, pax) {
  const r = await ot(`fohAggregator/v4/${RID}/detailedAvailability`, {
    method: 'POST', body: { date, partySize: pax, accessRuleIds: [], bookingChannel: 'InHouse' }
  });
  return r.s === 200 ? r.d : null;
}

async function getStaff() {
  const r = await ot(`gcFohWeb/api/${RID}/restaurantParticipants`);
  return r.s === 200 ? r.d : [];
}

async function getReviews(limit = 5) {
  const r = await ot(`hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/${RID}/reviews/details`, {
    method: 'POST', body: { pageNumber: 0, limit, sortBy: 'newest' }
  });
  return r.s === 200 ? r.d : null;
}

async function getReviewsSummary() {
  const r = await ot(`hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/${RID}/reviews/summary`, {
    method: 'POST', body: {}
  });
  return r.s === 200 ? r.d : null;
}

async function getConversations() {
  const r = await ot(`gc-inbox/gcDmService/v2/restaurants/${RID}/conversation?limit=25&offset=0&processingStatus=New%2CInProgress&showAllSourceTypes=true`);
  return r.s === 200 ? r.d : null;
}

async function getResRange(startDate, endDate) {
  // Get reservations across multiple days
  const all = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().substring(0, 10);
    const dayRes = await getRes(dateStr);
    all.push(...dayRes.map(r => ({ ...r, _date: dateStr })));
  }
  return all;
}

// --- Claude NLP ---
async function nlp(msg, context = null) {
  const today = todayStr();
  const dow = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][new Date().getDay()];

  let contextMsg = '';
  if (context) {
    contextMsg = `\nContexto previo: el usuario esta respondiendo a una confirmacion. Accion pendiente: ${context.type}. Datos: ${JSON.stringify(context.data)}. El usuario puede decir "si"/"dale"/"confirma" para ejecutar, "no"/"cancela" para abortar, o corregir algo.`;
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 600,
      system: `Eres el bot de reservas de Kitchen San Jose del Cabo. Todo en español.
Hoy=${dow} ${today}. Horario 17:00-21:30 c/15min. MST UTC-7.
${contextMsg}

Responde SOLO JSON puro (sin markdown, sin backticks):
{"action":"create|cancel|modify|search|list|confirm|reject|correct|availability|reviews|assign_concierge|week|messages|profile","guestName":null,"partySize":null,"date":"YYYY-MM-DD"|null,"endDate":null,"time":"HH:MM"|null,"concierge":null,"notes":null,"reservationId":null,"missing":[],"clarification":null,"corrections":null}

Reglas:
- viernes=proximo viernes desde hoy. manana=dia siguiente. "el 4 de noviembre"="2026-11-04"
- "6 y media"="18:30". "8pm"="20:00". "8 y cuarto"="20:15". "7 de la noche"="19:00"
- "2 personas"/"2 pax"/"para 2" = partySize 2
- Si NO dice pax para create: missing=["pax"], clarification="¿Para cuantas personas?"
- Si dice hotel o nombre de persona como referido/concierge → concierge
- "cancela"/"borra" → cancel. "mueve"/"cambia hora" → modify
- "reservas de hoy"/"como esta hoy"/"que hay" → list. "busca"/"quien es" → search
- "si"/"dale"/"va"/"confirma"/"ok"/"sale" → confirm
- "no"/"mejor no"/"cancela eso"/"olvidalo" → reject
- Si corrige algo ("no, son 4 personas" / "a las 9 mejor"): action=correct, corrections={"partySize":4} o {"time":"21:00"}
- "disponibilidad"/"hay lugar"/"espacios" → availability (necesita date + pax)
- "reviews"/"reseñas"/"calificaciones"/"como nos va" → reviews
- "asigna concierge"/"pon referido"/"agrega concierge" a reserva existente → assign_concierge (necesita guestName + concierge)
- "semana"/"esta semana"/"proximos dias" → week (lista reservas de 7 dias)
- "mensajes"/"inbox"/"conversaciones" → messages
- "perfil de X"/"historial de X"/"datos de X" → profile
- SIEMPRE intenta parsear. Solo clarification si falta algo critico.`,
      messages: [{ role: 'user', content: msg }]
    })
  });
  const d = await r.json();
  const raw = d.content?.[0]?.text || '{}';
  const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(clean); }
  catch { console.error('[NLP RAW]', raw); return { action: 'info', clarification: 'No entendi. Ej: "reserva Juan 4 pax viernes 8pm"' }; }
}

// --- Handlers ---
async function handle(chatId, text) {
  if (!text || text === '/start') {
    return '🟢 Bot Kitchen OT v3\n\nEscribime lo que sea:\n\n📋 Reservas:\n• "reserva Juan 4 pax viernes 8pm"\n• "reservas de hoy" / "semana"\n• "cancela la de Katy"\n• "mueve a Juan a las 9pm"\n\n🔍 Info:\n• "busca Maria" / "perfil de Juan"\n• "hay lugar viernes 8pm para 6?"\n• "asigna concierge Palmilla a Katy"\n\n📊 Dashboard:\n• "reviews" / "mensajes"';
  }

  // Check if there's a pending confirmation
  const pending = pendingAction[chatId];
  if (pending) {
    const p = await nlp(text, pending);
    console.log('[NLP confirm]', JSON.stringify(p));

    if (p.action === 'confirm') {
      delete pendingAction[chatId];
      return await executePending(pending);
    }
    if (p.action === 'reject') {
      delete pendingAction[chatId];
      return '❌ Cancelado.';
    }
    if (p.action === 'correct' && p.corrections) {
      // Apply corrections
      Object.assign(pending.data, p.corrections);
      const summary = buildSummary(pending);
      pendingAction[chatId] = { ...pending, summary };
      return `📝 Corregido:\n\n${summary}\n\n¿Confirmo? (si/no)`;
    }
    // If it's a completely new action, drop pending and process as new
    if (['create','cancel','modify','list','search'].includes(p.action)) {
      delete pendingAction[chatId];
      return await processAction(chatId, p);
    }
    return '❓ ¿Confirmo la accion? Responde "si", "no", o corregime algo.';
  }

  // New message — parse and process
  const p = await nlp(text);
  console.log('[NLP]', JSON.stringify(p));
  if (p.clarification && p.missing?.length) return `❓ ${p.clarification}`;
  return await processAction(chatId, p);
}

async function processAction(chatId, p) {
  switch (p.action) {
    case 'create': return await hCreate(chatId, p);
    case 'cancel': return await hCancel(chatId, p);
    case 'modify': return await hModify(chatId, p);
    case 'list': return await hList(p);
    case 'search': return await hSearch(p);
    case 'availability': return await hAvailability(p);
    case 'reviews': return await hReviews(p);
    case 'assign_concierge': return await hAssignConcierge(chatId, p);
    case 'week': return await hWeek(p);
    case 'messages': return await hMessages(p);
    case 'profile': return await hProfile(p);
    default: return p.clarification || '❓ Ej: "reserva Juan 4 pax viernes 8pm"';
  }
}

// --- Create with confirmation ---
async function hCreate(chatId, p) {
  const m = [];
  if (!p.guestName) m.push('nombre');
  if (!p.partySize) m.push('cuantas personas');
  if (!p.date) m.push('fecha');
  if (!p.time) m.push('hora');
  if (m.length) return `❓ Falta: ${m.join(', ')}`;

  // Search guest
  const gs = await searchGuest(p.guestName);
  if (!gs.length) return `❌ No encontre "${p.guestName}" en OT. Tiene que existir como cliente en GuestCenter.`;

  let g = gs[0];
  if (gs.length > 1) {
    // Check if date context helps filter
    const dateRes = await getRes(p.date);
    const existing = gs.filter(guest =>
      dateRes.some(r => r.GuestDescription?.toLowerCase().includes(guest.first_name.toLowerCase()))
    );
    // Still ambiguous? Ask
    if (gs.length > 1 && !existing.length) {
      const list = gs.slice(0, 5).map((x, i) =>
        `${i+1}. ${x.first_name} ${x.last_name} - ${x.email || x.phone_numbers?.[0]?.number || 'sin datos'}`
      ).join('\n');
      return `🔍 Hay ${gs.length} "${p.guestName}":\n${list}\n\n¿Cual? Dame nombre completo o numero.`;
    }
  }

  // Check availability (informational — we can always overbook for internal)
  const avail = await checkAvailability(p.date, p.partySize);
  let availInfo = '';
  if (avail) {
    const slots = avail.timeSlots || avail.slots || [];
    const requestedSlot = slots.find(s => (s.time || s.timeIso?.substring(11, 16)) === p.time);
    if (requestedSlot && requestedSlot.isAvailable === false) {
      availInfo = `⚠️ Horario ${p.time} sin disponibilidad standard — se creara como sobrerreserva\n`;
    }
  }

  // Check duplicates
  const dayRes = await getRes(p.date);
  const dupes = dayRes.filter(r =>
    r.GuestDescription?.toLowerCase().includes(g.first_name.toLowerCase()) &&
    r.GuestDescription?.toLowerCase().includes(g.last_name.toLowerCase())
  );
  if (dupes.length) {
    const existing = dupes.map(d =>
      `  • #${d.ConfirmationNumber} ${d.ScheduledLocal?.substring(11,16)} ${d.PartySize}pax`
    ).join('\n');
    // Still allow but warn
    p._dupeWarning = `⚠️ ${g.first_name} ya tiene reserva ese dia:\n${existing}\n`;
  }

  // Check concierge
  let conciergeInfo = '';
  let conciergeData = null;
  if (p.concierge) {
    const refs = await searchReferrer(p.concierge);
    if (refs.length) {
      conciergeData = refs[0];
      conciergeInfo = `🏨 Concierge: ${conciergeData.FirstName} ${conciergeData.LastName} (${conciergeData.CompanyName})`;
      if (refs.length > 1) {
        conciergeInfo += `\n   Tambien: ${refs.slice(1,3).map(r=>`${r.FirstName} ${r.LastName} (${r.CompanyName})`).join(', ')}`;
      }
    } else {
      conciergeInfo = `⚠️ No encontre concierge "${p.concierge}". Se crea sin referido.`;
    }
  }

  // Guest profile
  const pr = await guestProfile(g.guest_id);
  let profileInfo = '';
  if (pr?.insights) {
    profileInfo = `📊 ${pr.insights.visits||0} visitas, ${pr.insights.cancellations||0} cancel, ${pr.insights.noShows||0} no-show`;
  }

  // Build confirmation
  const data = {
    guestId: g.guest_id, guestName: `${g.first_name} ${g.last_name}`,
    date: p.date, time: p.time, partySize: p.partySize,
    conciergeData, notes: p.notes
  };

  const summary = [
    availInfo,
    p._dupeWarning || '',
    `👤 ${g.first_name} ${g.last_name}`,
    `📅 ${p.date} a las ${p.time}`,
    `👥 ${p.partySize} personas`,
    conciergeInfo,
    p.notes ? `📝 ${p.notes}` : '',
    profileInfo
  ].filter(Boolean).join('\n');

  pendingAction[chatId] = { type: 'create', data, summary };
  return `📋 Crear reserva:\n\n${summary}\n\n¿Confirmo? (si/no/corregir)`;
}

// --- Cancel with confirmation ---
async function hCancel(chatId, p) {
  if (!p.reservationId && !p.guestName) return '❓ ¿Cual cancelo? Dame # o nombre.';
  const date = p.date || todayStr();
  const res = await getRes(date);

  let r;
  if (p.reservationId) {
    r = res.find(x => x.ConfirmationNumber?.toString() === p.reservationId?.toString());
  } else {
    const m = res.filter(x => x.GuestDescription?.toLowerCase().includes(p.guestName.toLowerCase()));
    if (!m.length) return `❌ No encontre "${p.guestName}" para ${date}`;
    if (m.length > 1) return `🔍 ${m.length} reservas:\n${m.map(x=>`• #${x.ConfirmationNumber} ${x.ScheduledLocal?.substring(11,16)} ${x.PartySize}pax`).join('\n')}\n\n¿Cual cancelo?`;
    r = m[0];
  }
  if (!r) return `❌ No encontre reserva`;

  const summary = `👤 ${r.GuestDescription}\n📅 ${r.ScheduledLocal?.substring(0,16)}\n👥 ${r.PartySize} pax\n📋 #${r.ConfirmationNumber}`;
  pendingAction[chatId] = { type: 'cancel', data: { reservationId: r.ReservationId, confirmNum: r.ConfirmationNumber, guest: r.GuestDescription }, summary };
  return `🗑️ Cancelar reserva:\n\n${summary}\n\n¿Confirmo? (si/no)`;
}

// --- Modify with confirmation ---
async function hModify(chatId, p) {
  if (!p.reservationId && !p.guestName) return '❓ ¿Cual modifico? Dame # o nombre.';
  const date = p.date || todayStr();
  const res = await getRes(date);

  let r;
  if (p.reservationId) {
    r = res.find(x => x.ConfirmationNumber?.toString() === p.reservationId?.toString());
  } else {
    const m = res.filter(x => x.GuestDescription?.toLowerCase().includes(p.guestName.toLowerCase()));
    if (!m.length) return `❌ No encontre "${p.guestName}" para ${date}`;
    if (m.length > 1) return `🔍 ${m.length} reservas:\n${m.map(x=>`• #${x.ConfirmationNumber} ${x.ScheduledLocal?.substring(11,16)}`).join('\n')}\n\n¿Cual?`;
    r = m[0];
  }
  if (!r) return '❌ No encontre reserva';

  const changes = [];
  const data = { reservationId: r.ReservationId, confirmNum: r.ConfirmationNumber, guest: r.GuestDescription, updates: {} };

  if (p.time) {
    const d = p.date || r.ScheduledLocal?.substring(0,10);
    data.updates.Scheduled = toUTC(d, p.time);
    data.updates.ScheduledLocal = `${d}T${p.time}:00`;
    changes.push(`Hora: ${r.ScheduledLocal?.substring(11,16)} → ${p.time}`);
  }
  if (p.partySize) {
    data.updates.PartySize = p.partySize;
    changes.push(`Pax: ${r.PartySize} → ${p.partySize}`);
  }
  if (p.notes) {
    data.updates.VenueNotes = p.notes;
    changes.push(`Nota: ${p.notes}`);
  }
  if (!changes.length) return '❓ ¿Que cambio? Puedo mover hora, cambiar pax, o agregar nota.';

  data.updates.CommandParameters = { ModifiedBy: MOD_BY };
  const summary = `👤 ${r.GuestDescription} (#${r.ConfirmationNumber})\n${changes.map(c=>`  → ${c}`).join('\n')}`;
  pendingAction[chatId] = { type: 'modify', data, summary };
  return `✏️ Modificar reserva:\n\n${summary}\n\n¿Confirmo? (si/no/corregir)`;
}

// --- Execute confirmed action ---
async function executePending(pending) {
  switch (pending.type) {
    case 'create': {
      const d = pending.data;
      const r = await createRes({ guestId: d.guestId, date: d.date, time: d.time, pax: d.partySize });
      if (r.s !== 200) return `❌ Error creando reserva: ${r.s}`;

      let extra = '';
      // Assign concierge
      if (d.conciergeData) {
        const ref = d.conciergeData;
        await updateRes(r.d.ReservationId, {
          Referrer: { Id: ref.GlobalPersonId, FirstName: ref.FirstName, LastName: ref.LastName, CompanyName: ref.CompanyName, PhoneNumber: ref.PhoneNumbers?.[0], Email: ref.Email }
        });
        extra += `\n🏨 ${ref.FirstName} ${ref.LastName} (${ref.CompanyName})`;
      }
      // Add notes
      if (d.notes) {
        await updateRes(r.d.ReservationId, { VenueNotes: d.notes });
        extra += `\n📝 ${d.notes}`;
      }

      return `✅ Reserva creada!\n\n📋 #${r.d.ConfirmationNumber}\n👤 ${d.guestName}\n📅 ${d.date} ${d.time}\n👥 ${d.partySize} pax\n🪑 ${r.d.Tables?.map(t=>t.TableId).join(',')||'por asignar'}${extra}`;
    }
    case 'cancel': {
      const d = pending.data;
      const r = await updateRes(d.reservationId, { State:'Cancelled', Departed:null, CommandParameters:{ModifiedBy:MOD_BY}, CustomState:{CustomStateId:null} });
      return r.s === 200
        ? `✅ Cancelada #${d.confirmNum}\n👤 ${d.guest}`
        : `❌ Error: ${r.s}`;
    }
    case 'modify': {
      const d = pending.data;
      const r = await updateRes(d.reservationId, d.updates);
      if (r.s === 200) {
        return `✅ Modificada #${d.confirmNum}\n👤 ${r.d.GuestDescription}\n📅 ${r.d.ScheduledLocal?.substring(0,16)}\n👥 ${r.d.PartySize} pax`;
      }
      return `❌ Error: ${r.s}`;
    }
    case 'assign_concierge': {
      const d = pending.data;
      const ref = d.referrer;
      const r = await updateRes(d.reservationId, {
        Referrer: { Id: ref.GlobalPersonId, FirstName: ref.FirstName, LastName: ref.LastName, CompanyName: ref.CompanyName, PhoneNumber: ref.PhoneNumbers?.[0], Email: ref.Email }
      });
      return r.s === 200
        ? `✅ Concierge asignado #${d.confirmNum}\n👤 ${d.guest}\n🏨 ${ref.FirstName} ${ref.LastName} (${ref.CompanyName})`
        : `❌ Error: ${r.s}`;
    }
  }
}

function buildSummary(pending) {
  const d = pending.data;
  if (pending.type === 'create') {
    return [
      `👤 ${d.guestName}`,
      `📅 ${d.date} a las ${d.time}`,
      `👥 ${d.partySize} personas`,
      d.conciergeData ? `🏨 ${d.conciergeData.FirstName} ${d.conciergeData.LastName} (${d.conciergeData.CompanyName})` : '',
      d.notes ? `📝 ${d.notes}` : ''
    ].filter(Boolean).join('\n');
  }
  return pending.summary;
}

// --- List & Search (no confirmation needed) ---
async function hList(p) {
  const date = p.date || todayStr();
  const res = await getRes(date);
  if (!res.length) return `📋 Sin reservas para ${date}`;
  const lines = res.sort((a,b)=>(a.ScheduledLocal||'').localeCompare(b.ScheduledLocal||'')).map(r => {
    const st = r.State==='Confirmed'?'✅':r.State==='NotConfirmed'?'🔵':'⚪';
    const ref = r.Referrer?` 🏨${r.Referrer.CompanyName}`:'';
    return `${st} ${r.ScheduledLocal?.substring(11,16)} | ${r.GuestDescription} | ${r.PartySize}pax | ${r.Tables?.map(t=>t.TableId).join(',')||'-'}${ref}`;
  });
  return `📋 Reservas ${date} (${res.length}):\n\n${lines.join('\n')}`;
}

async function hSearch(p) {
  if (!p.guestName) return '❓ ¿A quien busco?';
  const gs = await searchGuest(p.guestName);
  if (!gs.length) return `❌ No encontre "${p.guestName}"`;
  const lines = [];
  for (const g of gs.slice(0,5)) {
    const pr = await guestProfile(g.guest_id);
    lines.push(`👤 ${g.first_name} ${g.last_name}\n   📞 ${g.phone_numbers?.[0]?.number||'-'} | ✉️ ${g.email||'-'}\n   📊 ${pr?.insights?.visits||0} visitas, ${pr?.insights?.cancellations||0} cancel`);
  }
  return `🔍 "${p.guestName}":\n\n${lines.join('\n\n')}`;
}

// --- Availability ---
async function hAvailability(p) {
  const date = p.date || todayStr();
  const pax = p.partySize || 2;
  const avail = await checkAvailability(date, pax);
  if (!avail) return '❌ Error obteniendo disponibilidad';

  const slots = avail.timeSlots || avail.slots || [];
  if (!slots.length) return `📋 Sin disponibilidad para ${date} (${pax} pax).\nPero podemos sobrerreservar si querés.`;

  const times = slots.filter(s => s.isAvailable !== false).map(s => s.time || s.timeIso?.substring(11, 16)).filter(Boolean);
  return `📋 Disponibilidad ${date} (${pax} pax):\n\n${times.length ? times.join(', ') : 'Sin horarios libres'}\n\nTotal slots: ${slots.length}`;
}

// --- Reviews ---
async function hReviews(p) {
  const summary = await getReviewsSummary();
  if (!summary) return '❌ Error obteniendo reviews';

  const details = await getReviews(5);
  const recent = (details?.data || []).slice(0, 5);

  let msg = `⭐ Reviews Kitchen\n\n` +
    `📊 ${summary.totalCount || 0} reviews | ${(summary.averageOverallRating || 0).toFixed(1)} overall\n` +
    `🍽️ Food: ${(summary.otFoodRatingAvg || 0).toFixed(1)} | 🙋 Service: ${(summary.otServiceRatingAvg || 0).toFixed(1)}\n` +
    `✨ Ambiance: ${(summary.otAmbianceRatingAvg || 0).toFixed(1)} | 💰 Value: ${(summary.otValueRatingAvg || 0).toFixed(1)}\n` +
    `⭐⭐⭐⭐⭐ ${summary.fiveStarCount || 0} | ⭐⭐⭐⭐ ${summary.fourStarCount || 0} | ⭐⭐⭐ ${summary.threeStarCount || 0} | ⭐⭐ ${summary.twoStarCount || 0} | ⭐ ${summary.oneStarCount || 0}`;

  if (recent.length) {
    msg += '\n\nUltimas:';
    for (const r of recent) {
      const stars = '⭐'.repeat(Math.round(r.overallRating || 0));
      const source = r.source === 'Google' ? '🔍' : r.source === 'TripAdvisor' ? '🦉' : '🍽️';
      msg += `\n${source} ${stars} ${r.guestName || 'Anonimo'} (${r.reviewDate?.substring(0, 10)})`;
      if (r.comment) msg += `\n   "${r.comment.substring(0, 80)}${r.comment.length > 80 ? '...' : ''}"`;
    }
  }

  return msg;
}

// --- Assign Concierge to existing reservation ---
async function hAssignConcierge(chatId, p) {
  if (!p.guestName) return '❓ ¿A que reserva le asigno el concierge? Dame nombre.';
  if (!p.concierge) return '❓ ¿Que concierge/hotel? Dame nombre.';

  const date = p.date || todayStr();
  const res = await getRes(date);
  const m = res.filter(x => x.GuestDescription?.toLowerCase().includes(p.guestName.toLowerCase()));
  if (!m.length) return `❌ No encontre "${p.guestName}" para ${date}`;
  if (m.length > 1) return `🔍 ${m.length} reservas:\n${m.map(x => `• #${x.ConfirmationNumber} ${x.ScheduledLocal?.substring(11, 16)}`).join('\n')}\n\n¿Cual?`;

  const r = m[0];
  const refs = await searchReferrer(p.concierge);
  if (!refs.length) return `❌ No encontre concierge "${p.concierge}"`;

  const ref = refs[0];
  const summary = `👤 ${r.GuestDescription} (#${r.ConfirmationNumber})\n🏨 → ${ref.FirstName} ${ref.LastName} (${ref.CompanyName})`;
  pendingAction[chatId] = {
    type: 'assign_concierge',
    data: { reservationId: r.ReservationId, confirmNum: r.ConfirmationNumber, guest: r.GuestDescription, referrer: ref },
    summary
  };
  return `🏨 Asignar concierge:\n\n${summary}\n\n¿Confirmo? (si/no)`;
}

// --- Week view ---
async function hWeek(p) {
  const start = p.date || todayStr();
  const startD = new Date(start);
  const endD = new Date(startD);
  endD.setDate(endD.getDate() + 6);
  const end = endD.toISOString().substring(0, 10);

  let totalRes = 0, totalPax = 0;
  let lines = [];

  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().substring(0, 10);
    const dayName = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'][d.getDay()];
    const res = await getRes(dateStr);
    const pax = res.reduce((s, r) => s + (r.PartySize || 0), 0);
    totalRes += res.length;
    totalPax += pax;
    const bar = '█'.repeat(Math.min(res.length, 20));
    lines.push(`${dayName} ${dateStr.substring(5)}: ${res.length} res (${pax} pax) ${bar}`);
  }

  return `📅 Semana ${start} → ${end}\n\n${lines.join('\n')}\n\n📊 Total: ${totalRes} reservas, ${totalPax} pax`;
}

// --- Messages/Inbox ---
async function hMessages(p) {
  const convos = await getConversations();
  if (!convos?.conversations?.length) return '📬 Sin mensajes pendientes';

  const lines = convos.conversations.slice(0, 10).map(c => {
    const t = c.messageThread;
    const msg = t.newestMessage?.body || '';
    return `📨 #${t.confirmationNumber} — ${msg.substring(0, 60)}${msg.length > 60 ? '...' : ''}`;
  });

  return `📬 Mensajes (${convos.conversations.length} total):\n\n${lines.join('\n')}`;
}

// --- Guest Profile ---
async function hProfile(p) {
  if (!p.guestName) return '❓ ¿De quien queres el perfil?';
  const gs = await searchGuest(p.guestName);
  if (!gs.length) return `❌ No encontre "${p.guestName}"`;

  const g = gs[0];
  const pr = await guestProfile(g.guest_id);
  if (!pr) return `👤 ${g.first_name} ${g.last_name}\n📞 ${g.phone_numbers?.[0]?.number || '-'}\n✉️ ${g.email || '-'}`;

  const notes = (pr.notes || []).map(n => `  ${n.categories?.join(',')}: ${n.value}`).join('\n') || 'Sin notas';
  const tags = (pr.tags || []).map(t => t.name || t).join(', ') || 'Sin tags';

  return `👤 ${g.first_name} ${g.last_name}\n` +
    `📞 ${g.phone_numbers?.[0]?.number || '-'} | ✉️ ${g.email || '-'}\n` +
    `📊 ${pr.insights?.visits || 0} visitas | ${pr.insights?.cancellations || 0} cancel | ${pr.insights?.noShows || 0} no-show\n` +
    `🏷️ ${tags}\n` +
    `📝 Notas:\n${notes}`;
}

// --- Daily Notifications ---
function scheduleDailyNotifs() {
  const check = () => {
    const now = new Date();
    // Convert to BCS time (UTC-7)
    const bcsHour = (now.getUTCHours() + OT_TZ + 24) % 24;
    const bcsMin = now.getUTCMinutes();

    // 4:00 PM BCS = 16:00
    if (bcsHour === 16 && bcsMin === 0) sendDailySummary('📋 Resumen 4pm');
    // 12:00 AM BCS = 00:00
    if (bcsHour === 0 && bcsMin === 0) sendDailySummary('🌙 Resumen cierre');
  };
  setInterval(check, 60000); // Check every minute
  console.log('[NOTIF] Programadas: 4pm + 12am BCS');
}

async function sendDailySummary(title) {
  try {
    const today = todayStr();
    const res = await getRes(today);
    const active = res.filter(r => r.State !== 'Cancelled');

    const confirmed = active.filter(r => r.State === 'Confirmed').length;
    const pending = active.filter(r => r.State === 'NotConfirmed').length;
    const total = active.length;
    const totalPax = active.reduce((s, r) => s + (r.PartySize || 0), 0);

    let lines = active.sort((a,b)=>(a.ScheduledLocal||'').localeCompare(b.ScheduledLocal||'')).map(r => {
      const st = r.State==='Confirmed'?'✅':'🔵';
      const ref = r.Referrer?` 🏨${r.Referrer.CompanyName}`:'';
      return `${st} ${r.ScheduledLocal?.substring(11,16)} | ${r.GuestDescription} | ${r.PartySize}pax${ref}`;
    });

    const msg = `${title} — ${today}\n\n` +
      `📊 ${total} reservas | ${totalPax} pax | ✅${confirmed} confirmadas | 🔵${pending} pendientes\n\n` +
      (lines.length ? lines.join('\n') : 'Sin reservas');

    await tgSend(CHAT_ID, msg);
    console.log(`[NOTIF] ${title} enviado`);
  } catch(e) {
    console.error('[NOTIF ERR]', e.message);
  }
}

// --- Helpers ---
function todayStr() {
  // Get current date in BCS timezone (America/Mazatlan, UTC-7)
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mazatlan' });
}

function toUTC(date, time) {
  const l = new Date(`${date}T${time}:00`);
  l.setHours(l.getHours() - OT_TZ);
  return l.toISOString().replace('.000Z', 'Z');
}

// --- Main ---
(async () => {
  if (!TELEGRAM_BOT_TOKEN || !ANTHROPIC_API_KEY) { console.error('Set TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY in .env'); process.exit(1); }

  await initBrowser();
  const refs = await getReferrers();
  console.log(`[OT] ${refs.length} concierges`);

  // Schedule daily notifications
  scheduleDailyNotifs();

  // Telegram polling
  let offset = 0;
  const poll = async () => {
    try {
      const r = await fetch(`${TG_BASE()}/getUpdates?offset=${offset}&timeout=30`);
      const data = await r.json();
      if (data.ok && data.result.length) {
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          const msg = upd.message;
          if (!msg?.text || msg.chat.id.toString() !== CHAT_ID) continue;
          console.log(`[MSG] ${msg.text}`);
          try {
            const reply = await handle(msg.chat.id.toString(), msg.text.trim());
            await tgSend(msg.chat.id, reply);
          } catch(e) {
            console.error('[ERR]', e.message);
            await tgSend(msg.chat.id, `❌ Error: ${e.message}`);
          }
        }
      }
    } catch(e) { console.error('[POLL]', e.message); }
    setTimeout(poll, 1000);
  };

  console.log('[TG] Bot listo!');
  await tgSend(CHAT_ID, `🟢 Bot Kitchen OT v3\n🏨 ${refs.length} concierges\n⏰ Notificaciones: 4pm + 12am BCS\n\nEscribime lo que sea:\n• "reserva Juan 4 pax viernes 8pm"\n• "reservas de hoy" / "semana"\n• "cancela la de Katy" / "mueve a las 9"\n• "reviews" / "mensajes" / "busca Maria"\n• "hay lugar sabado 8pm para 6?"`);
  poll();
})();
