// Interfaz de configuración de las alertas de noticias (EFINFO).
// Lee y guarda directo en Supabase con la sesión del administrador (las tablas tienen RLS);
// lo que necesita secretos o Metabase pasa por la función alertas-admin.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $app = document.getElementById("app");

// ---------------------------------------------------------------- utilidades
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fecha = (iso) => iso ? new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" }) : "";
function aviso(texto, error = false) {
  const a = document.getElementById("aviso");
  a.textContent = texto; a.className = "aviso visible" + (error ? " error" : "");
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.className = "aviso"), error ? 6000 : 3000);
}
async function api(accion, datos = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/alertas-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ accion, ...datos }),
  });
  const j = await r.json().catch(() => ({ error: `Error ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
  return j;
}
function falla(e) { console.error(e); aviso(e.message ?? String(e), true); }
const consulta = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };

const ESTADOS = ["Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas"];
const GRUPOS_TIPO = { PRENSA: "Prensa", REVISTA: "Revistas", RADIO: "Radio", TV: "Televisión", INTERNET: "Internet", OTROS: "Redes sociales y otros" };
const MODOS = {
  primera: ["Solo la primera nota", "Llega la primera nota de cada noticia; las réplicas no se mandan."],
  primera_y_actualizaciones: ["Primera nota + actualizaciones", "Además de la primera, se manda una nota posterior si trae información nueva."],
  todas: ["Todas las notas", "Se manda cada nota que cumpla los criterios, aunque sea la misma noticia."],
};
const DECISIONES = {
  alerta: ["Alerta enviada", "ok"], actualizacion: ["Actualización", "ok"], enviada_todas: ["Enviada", "ok"], confirmacion_marca: ["Confirmación", "ok"],
  mismo_evento: ["Réplica (no se mandó)", ""], fuera_alcance: ["Fuera de alcance", ""], fuera_estados: ["Fuera de los estados", ""],
  otra_marca: ["Otra marca", ""], sin_marca: ["Sin marca", ""], limite_actualizaciones: ["Límite de actualizaciones", "ambar"],
  descarte_marca: ["Descartada por fotos", "ambar"], error: ["Error", "no"],
};

// Catálogo de tipos de medio (se carga una vez)
let tiposCache = null;
async function tiposMedio() {
  if (!tiposCache) tiposCache = (await api("catalogo", { tipo: "tipos" })).filas.filter((t) => String(t.Activo) === "1");
  return tiposCache;
}

// ---------------------------------------------------------------- sesión y navegación
let usuario = null;
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  usuario = session?.user ?? null;
  sb.auth.onAuthStateChange((_e, s) => { const antes = usuario?.id; usuario = s?.user ?? null; if (antes !== usuario?.id) rutear(); });
  window.addEventListener("hashchange", rutear);
  rutear();
}

let salirConCambios = null; // función que pregunta si hay cambios sin guardar
function marco(actual, contenido) {
  const nav = [["alertas", "Alertas"], ["clientes", "Clientes"], ["bitacora", "Bitácora"], ["admins", "Administradores"], ["ajustes", "Ajustes"]];
  $app.innerHTML = `
    <header class="barra">
      <span class="marca">Alertas EFINFO</span>
      <nav>${nav.map(([h, t]) => `<a href="#${h}" class="${actual === h ? "actual" : ""}">${t}</a>`).join("")}</nav>
      <div class="usuario"><span>${esc(usuario.email)}</span><button id="salir">Salir</button></div>
    </header>
    <main id="contenido">${contenido}</main>`;
  document.getElementById("salir").onclick = async () => { await sb.auth.signOut(); };
  return document.getElementById("contenido");
}

async function rutear() {
  if (!usuario) return pantallaLogin();
  const h = (location.hash || "#alertas").slice(1);
  try {
    if (h === "alertas") return await pantallaAlertas();
    if (h.startsWith("alerta-")) return await pantallaEditor(h.slice(7));
    if (h === "clientes") return await pantallaClientes();
    if (h === "bitacora" || h.startsWith("bitacora-")) return await pantallaBitacora(h.slice(9) || null);
    if (h === "admins") return await pantallaAdmins();
    if (h === "ajustes") return await pantallaAjustes();
    location.hash = "#alertas";
  } catch (e) {
    if (/permission|policy|no es administradora/i.test(e.message)) {
      marco("", `<div class="tarjeta"><h2>Sin acceso</h2><p>Tu cuenta (${esc(usuario.email)}) no está registrada como administradora de alertas. Pide a un administrador que te agregue.</p></div>`);
    } else falla(e);
  }
}

function pantallaLogin() {
  $app.innerHTML = `
    <div class="login"><div class="tarjeta">
      <h1>Alertas EFINFO</h1>
      <form id="f" class="fila" style="flex-direction:column;align-items:stretch;gap:14px">
        <label class="campo">Correo<input type="email" id="email" autocomplete="username" required></label>
        <label class="campo">Contraseña<input type="password" id="pass" autocomplete="current-password" required></label>
        <button class="btn primario" type="submit">Entrar</button>
        <p class="ayuda" id="msg"></p>
      </form>
    </div></div>`;
  document.getElementById("f").onsubmit = async (ev) => {
    ev.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) document.getElementById("msg").textContent = "No se pudo entrar: revisa el correo y la contraseña.";
  };
}

// ---------------------------------------------------------------- Alertas (lista)
async function pantallaAlertas() {
  const perfiles = await consulta(sb.from("alert_profiles").select("id, nombre, activo, marca, modo_envio, secciones, palabras, tipos_medio, estados, cliente:alert_clients(nombre), destinos:alert_destinations(id, canal, activo)").order("id"));
  const c = marco("alertas", `
    <div class="fila entre"><div><h1>Alertas</h1><p class="sub">Cada alerta define qué notas se revisan, qué decide la IA y a dónde se manda.</p></div>
    <button class="btn primario" id="nueva">+ Nueva alerta</button></div>
    <div class="tarjeta">${perfiles.length ? `<table>
      <thead><tr><th>Alerta</th><th>Cliente</th><th>Fuentes</th><th>Envío</th><th>Destinos</th><th>Estado</th></tr></thead>
      <tbody>${perfiles.map((p) => `<tr class="clic" data-id="${p.id}">
        <td><b>${esc(p.nombre)}</b><br><small class="ayuda">${(p.estados ?? []).length ? `${p.estados.length} estados` : "Nacional"} · ${p.tipos_medio.length} tipos de medio</small></td>
        <td>${esc(p.cliente?.nombre)}</td>
        <td>${p.secciones.length ? `${p.secciones.length} secciones` : ""}${p.secciones.length && p.palabras.length ? " + " : ""}${p.palabras.length ? `${p.palabras.length} palabras` : ""}</td>
        <td>${esc(MODOS[p.modo_envio]?.[0] ?? p.modo_envio)}</td>
        <td>${p.destinos.filter((d) => d.activo).length}</td>
        <td><span class="etiqueta ${p.activo ? "ok" : "no"}">${p.activo ? "Activa" : "Apagada"}</span></td></tr>`).join("")}</tbody></table>` : `<p class="vacio">Todavía no hay alertas.</p>`}</div>`);
  c.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = `#alerta-${tr.dataset.id}`)));
  c.querySelector("#nueva").onclick = () => (location.hash = "#alerta-nueva");
}

// ---------------------------------------------------------------- Editor de alerta
const PERFIL_NUEVO = {
  nombre: "", marca: "", activo: false, secciones: [], palabras: [], tipos_medio: [1029, 1030], medios: [], estados: [],
  categorias: [], criterios_info_nueva: ["cifras nuevas", "decisión de una autoridad", "postura de la empresa", "nuevos actores"],
  contexto_ia: "", pistas_imagen: "", modo_envio: "primera", ventana_horas: 72, max_actualizaciones: 3, actualizaciones_en_hilo: true,
  notas_sin_marca: "posible", revisar_imagenes: false, filtrar_marca: true, metabase_card_id: null, formato: {},
};

async function pantallaEditor(idTxt) {
  const nueva = idTxt === "nueva";
  const clientes = await consulta(sb.from("alert_clients").select("id, nombre").order("nombre"));
  let p = nueva ? structuredClone(PERFIL_NUEVO) : await consulta(sb.from("alert_profiles").select("*").eq("id", Number(idTxt)).single());
  if (nueva && clientes[0]) p.client_id = clientes[0].id;
  p.palabras ??= []; p.medios ??= []; p.formato ??= {}; p.estados ??= []; p.categorias ??= []; p.criterios_info_nueva ??= [];
  const original = JSON.stringify(p);
  let pestana = "general";
  const c = marco("alertas", "");

  const sucio = () => JSON.stringify(p) !== original;
  function dibujar() {
    c.innerHTML = `
      <div class="fila entre"><div><a href="#alertas">← Alertas</a><h1>${nueva ? "Nueva alerta" : esc(p.nombre)}</h1></div>
        ${nueva ? "" : `<a class="btn" href="#bitacora-${p.id}">Ver bitácora</a>`}</div>
      <div class="pestanas">${[["general", "General"], ["fuentes", "Fuentes"], ["cobertura", "Cobertura"], ["ia", "IA y criterios"], ["envio", "Envío"], ["formato", "Formato"], ["destinos", "Destinos"], ["prueba", "Prueba"]]
        .map(([k, t]) => `<button data-p="${k}" class="${pestana === k ? "actual" : ""}">${t}</button>`).join("")}</div>
      <div id="panel"></div>
      <div class="barra-guardar"><span class="sucio" id="sucio"></span>
        ${nueva ? "" : `<button class="btn peligro" id="borrar">Eliminar</button>`}
        <button class="btn primario" id="guardar">Guardar</button></div>`;
    c.querySelectorAll(".pestanas button").forEach((b) => (b.onclick = () => { pestana = b.dataset.p; dibujar(); }));
    c.querySelector("#guardar").onclick = guardar;
    if (!nueva) c.querySelector("#borrar").onclick = borrar;
    const panel = c.querySelector("#panel");
    ({ general, fuentes, cobertura, ia, envio, formato, destinos, prueba })[pestana](panel);
    marcarSucio();
  }
  function marcarSucio() { const s = c.querySelector("#sucio"); if (s) s.textContent = sucio() ? "Hay cambios sin guardar" : ""; }
  const enlazar = (el, campo, conv = (v) => v) => { el.oninput = el.onchange = () => { p[campo] = conv(el.type === "checkbox" ? el.checked : el.value); marcarSucio(); }; };

  // --- General
  function general(panel) {
    panel.innerHTML = `<div class="tarjeta grid2">
      <label class="campo">Nombre de la alerta<input type="text" id="nombre" value="${esc(p.nombre)}"><span class="ayuda">Así aparece en esta lista y en la bitácora.</span></label>
      <label class="campo">Cliente<select id="cliente">${clientes.map((k) => `<option value="${k.id}" ${k.id === p.client_id ? "selected" : ""}>${esc(k.nombre)}</option>`).join("")}</select><span class="ayuda">El cliente define el bot de Telegram que manda las alertas.</span></label>
      <label class="campo">Marca o tema<input type="text" id="marca" value="${esc(p.marca)}"><span class="ayuda">La IA usa este nombre para decidir si la nota trata del cliente.</span></label>
      <div><label class="interruptor"><input type="checkbox" id="activo" ${p.activo ? "checked" : ""}> Alerta activa</label>
        <p class="ayuda">Apagada no revisa notas ni manda nada. Conviene encenderla cuando ya tenga destinos.</p></div>
    </div>`;
    enlazar(panel.querySelector("#nombre"), "nombre"); enlazar(panel.querySelector("#marca"), "marca");
    enlazar(panel.querySelector("#cliente"), "client_id", Number); enlazar(panel.querySelector("#activo"), "activo");
  }

  // --- Fuentes
  async function fuentes(panel) {
    panel.innerHTML = `
      <div class="tarjeta"><h2>Secciones de DBNotas</h2><p class="ayuda">Notas que el sistema de EFINFO ya marca en estas secciones.</p>
        <div class="chips" id="chSec"></div>
        <input type="text" id="bSec" placeholder="Buscar sección por nombre o número…"><div class="resultados" id="rSec" hidden></div></div>
      <div class="tarjeta"><h2>Búsqueda por texto</h2><p class="ayuda">Palabras o frases que se buscan en el titular y el texto de la nota (no distingue mayúsculas ni acentos; también encuentra palabras que las contienen: «refresquer» encuentra «refresquera»). Máximo 30.</p>
        <div class="chips" id="chPal"></div>
        <div class="fila"><input type="text" id="nPal" placeholder="Escribe una palabra y presiona Enter" style="flex:1"><button class="btn" id="aPal">Agregar</button></div>
        ${p.metabase_card_id ? `<p class="ayuda">Esta alerta todavía usa la pregunta propia ${p.metabase_card_id} de Metabase. En cuanto agregues palabras se usarán las palabras.</p>` : ""}</div>
      <div class="tarjeta"><div class="fila entre"><h2>Tipos de medio</h2><div class="fila"><button class="btn chico" id="tTodos">Todos menos redes</button><button class="btn chico" id="tPortales">Solo portales</button><button class="btn chico" id="tNinguno">Ninguno</button></div></div>
        <div id="tipos" class="vacio">Cargando tipos de medio…</div></div>
      <div class="tarjeta"><h2>Medios específicos <span class="ayuda">(opcional)</span></h2><p class="ayuda">Si eliges medios, solo se revisan notas de esos medios. Vacío = todos los medios de los tipos marcados.</p>
        <div class="chips" id="chMed"></div>
        <input type="text" id="bMed" placeholder="Buscar medio…"><div class="resultados" id="rMed" hidden></div></div>`;

    // Secciones
    const nombresSec = new Map();
    const pintarSec = () => {
      panel.querySelector("#chSec").innerHTML = p.secciones.map((id) => `<span class="chip">${id}${nombresSec.get(id) ? " · " + esc(nombresSec.get(id)) : ""}<button data-id="${id}" aria-label="Quitar">×</button></span>`).join("") || `<span class="ayuda">Sin secciones</span>`;
      panel.querySelectorAll("#chSec button").forEach((b) => (b.onclick = () => { p.secciones = p.secciones.filter((x) => x !== Number(b.dataset.id)); pintarSec(); marcarSucio(); }));
    };
    if (p.secciones.length) api("catalogo", { tipo: "secciones", ids: p.secciones.join(",") }).then((r) => { r.filas.forEach((f) => nombresSec.set(Number(f.ID), f.Nombre)); pintarSec(); }).catch(() => {});
    pintarSec();
    buscador(panel.querySelector("#bSec"), panel.querySelector("#rSec"), (q) => api("catalogo", { tipo: "secciones", buscar: q }).then((r) => r.filas),
      (f) => `${f.ID} · ${esc(f.Nombre)}${String(f.Activo) === "1" ? "" : " <small>(inactiva)</small>"}`,
      (f) => { if (!p.secciones.includes(Number(f.ID))) { p.secciones.push(Number(f.ID)); nombresSec.set(Number(f.ID), f.Nombre); pintarSec(); marcarSucio(); } });

    // Palabras
    const pintarPal = () => {
      panel.querySelector("#chPal").innerHTML = p.palabras.map((w, i) => `<span class="chip">${esc(w)}<button data-i="${i}" aria-label="Quitar">×</button></span>`).join("") || `<span class="ayuda">Sin palabras</span>`;
      panel.querySelectorAll("#chPal button").forEach((b) => (b.onclick = () => { p.palabras.splice(Number(b.dataset.i), 1); pintarPal(); marcarSucio(); }));
    };
    const agregarPal = () => {
      const inp = panel.querySelector("#nPal");
      inp.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((w) => { if (!p.palabras.includes(w) && p.palabras.length < 30) p.palabras.push(w); });
      if (p.palabras.length >= 30) aviso("Llegaste al máximo de 30 palabras.");
      inp.value = ""; pintarPal(); marcarSucio();
    };
    panel.querySelector("#aPal").onclick = agregarPal;
    panel.querySelector("#nPal").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); agregarPal(); } };
    pintarPal();

    // Tipos de medio
    const tipos = await tiposMedio().catch((e) => { falla(e); return []; });
    const pintarTipos = () => {
      const porGrupo = {};
      tipos.forEach((t) => (porGrupo[t.Categoria] ??= []).push(t));
      panel.querySelector("#tipos").className = "";
      panel.querySelector("#tipos").innerHTML = Object.entries(GRUPOS_TIPO).filter(([g]) => porGrupo[g]).map(([g, nombre]) => `
        <div class="grupo-tipos"><h3>${nombre} <button class="btn chico" data-g="${g}">marcar / quitar</button></h3>
        <div class="casillas">${porGrupo[g].map((t) => `<label><input type="checkbox" value="${t.ID}" ${p.tipos_medio.includes(Number(t.ID)) ? "checked" : ""}> ${esc(t.Tipo)} <small class="ayuda">${t.ID}</small></label>`).join("")}</div></div>`).join("");
      panel.querySelectorAll("#tipos input").forEach((i) => (i.onchange = () => {
        const id = Number(i.value); p.tipos_medio = i.checked ? [...new Set([...p.tipos_medio, id])] : p.tipos_medio.filter((x) => x !== id); marcarSucio();
      }));
      panel.querySelectorAll("#tipos button[data-g]").forEach((b) => (b.onclick = () => {
        const ids = tipos.filter((t) => t.Categoria === b.dataset.g).map((t) => Number(t.ID));
        const todos = ids.every((id) => p.tipos_medio.includes(id));
        p.tipos_medio = todos ? p.tipos_medio.filter((x) => !ids.includes(x)) : [...new Set([...p.tipos_medio, ...ids])];
        pintarTipos(); marcarSucio();
      }));
    };
    const esPrueba = (t) => /prueba|examen|ingenier|internacional|crawl|automátic/i.test(t.Tipo);
    panel.querySelector("#tTodos").onclick = () => { p.tipos_medio = tipos.filter((t) => t.Categoria !== "OTROS" && !esPrueba(t)).map((t) => Number(t.ID)); pintarTipos(); marcarSucio(); };
    panel.querySelector("#tPortales").onclick = () => { p.tipos_medio = [1029, 1030]; pintarTipos(); marcarSucio(); };
    panel.querySelector("#tNinguno").onclick = () => { p.tipos_medio = []; pintarTipos(); marcarSucio(); };
    pintarTipos();

    // Medios
    const nombresMed = new Map();
    const pintarMed = () => {
      panel.querySelector("#chMed").innerHTML = p.medios.map((id) => `<span class="chip">${esc(nombresMed.get(id) ?? id)}<button data-id="${id}" aria-label="Quitar">×</button></span>`).join("") || `<span class="ayuda">Todos los medios de los tipos marcados</span>`;
      panel.querySelectorAll("#chMed button").forEach((b) => (b.onclick = () => { p.medios = p.medios.filter((x) => x !== Number(b.dataset.id)); pintarMed(); marcarSucio(); }));
    };
    if (p.medios.length) api("catalogo", { tipo: "medios", ids: p.medios.join(",") }).then((r) => { r.filas.forEach((f) => nombresMed.set(Number(f.ID), f.Nombre)); pintarMed(); }).catch(() => {});
    pintarMed();
    buscador(panel.querySelector("#bMed"), panel.querySelector("#rMed"), (q) => api("catalogo", { tipo: "medios", buscar: q, tipos: p.tipos_medio.join(",") }).then((r) => r.filas),
      (f) => `${esc(f.Nombre)} <small>${esc(f.Tipo)}${f.Estado ? " · " + esc(f.Estado) : ""}</small>`,
      (f) => { if (!p.medios.includes(Number(f.ID))) { p.medios.push(Number(f.ID)); nombresMed.set(Number(f.ID), f.Nombre); pintarMed(); marcarSucio(); } });
  }

  // --- Cobertura
  let nacionalUI = null;
  function cobertura(panel) {
    if (nacionalUI === null) nacionalUI = !p.estados.length;
    panel.innerHTML = `<div class="tarjeta">
      <h2>Estados</h2><p class="ayuda">La IA identifica en qué estado pasó la noticia. Si eliges estados, solo se mandan noticias de esos estados.</p>
      <label class="interruptor" style="margin:10px 0"><input type="checkbox" id="nac" ${nacionalUI ? "checked" : ""}> Nacional (todo el país)</label>
      <div ${nacionalUI ? "hidden" : ""}>
        <div class="fila" style="margin-bottom:8px"><button class="btn chico" id="todos">Marcar todos</button><button class="btn chico" id="ninguno">Quitar todos</button></div>
        <div class="casillas" id="est">${ESTADOS.map((e) => `<label><input type="checkbox" value="${esc(e)}" ${p.estados.includes(e) ? "checked" : ""}> ${esc(e)}</label>`).join("")}</div>
      </div></div>`;
    const leer = () => { p.estados = [...panel.querySelectorAll("#est input:checked")].map((i) => i.value); marcarSucio(); };
    panel.querySelectorAll("#est input").forEach((i) => (i.onchange = leer));
    panel.querySelector("#nac").onchange = (e) => { nacionalUI = e.target.checked; if (nacionalUI) p.estados = []; marcarSucio(); cobertura(panel); };
    panel.querySelector("#todos").onclick = () => { panel.querySelectorAll("#est input").forEach((i) => (i.checked = true)); leer(); };
    panel.querySelector("#ninguno").onclick = () => { panel.querySelectorAll("#est input").forEach((i) => (i.checked = false)); leer(); };
  }

  // --- IA y criterios
  function ia(panel) {
    panel.innerHTML = `
      <div class="tarjeta"><h2>¿De quién son las notas que se alertan?</h2><div class="opciones">
        <label><input type="radio" name="fm" value="1" ${p.filtrar_marca !== false ? "checked" : ""}><span><b>Solo hechos del cliente</b><small>Se descartan notas de otras marcas (p. ej. un camión de la competencia).</small></span></label>
        <label><input type="radio" name="fm" value="0" ${p.filtrar_marca === false ? "checked" : ""}><span><b>Toda la industria</b><small>Entran también la competencia y los temas del sector.</small></span></label></div>
        <div class="grid2" style="margin-top:8px">
          <label class="campo">Si la nota no dice la marca<select id="sinMarca"><option value="posible" ${p.notas_sin_marca === "posible" ? "selected" : ""}>Mandar como «posible alerta»</option><option value="descartar" ${p.notas_sin_marca === "descartar" ? "selected" : ""}>Descartarla</option></select></label>
          <div><label class="interruptor"><input type="checkbox" id="img" ${p.revisar_imagenes ? "checked" : ""}> Revisar las fotos de la nota</label><p class="ayuda">Si el texto no dice la marca, la IA mira las fotos (por ejemplo, el logo del camión).</p></div>
        </div></div>
      <div class="tarjeta"><h2>Temas (categorías)</h2><p class="ayuda">La IA clasifica cada nota en uno de estos temas; si no encaja en ninguno, se descarta.</p>
        <div class="chips" id="chCat"></div><div class="fila"><input type="text" id="nCat" placeholder="Nuevo tema y Enter" style="flex:1"><button class="btn" id="aCat">Agregar</button></div></div>
      <div class="tarjeta"><h2>¿Qué cuenta como información nueva?</h2><p class="ayuda">Para mandar una actualización de una noticia ya avisada.</p>
        <div class="chips" id="chCri"></div><div class="fila"><input type="text" id="nCri" placeholder="Nuevo criterio y Enter" style="flex:1"><button class="btn" id="aCri">Agregar</button></div></div>
      <div class="tarjeta grid2">
        <label class="campo">Instrucciones para la IA<textarea id="ctx">${esc(p.contexto_ia)}</textarea><span class="ayuda">Qué sí y qué no se alerta, en lenguaje normal.</span></label>
        <label class="campo">Pistas para revisar fotos<textarea id="pistas">${esc(p.pistas_imagen)}</textarea><span class="ayuda">Colores, logos o rótulos que identifican al cliente.</span></label></div>`;
    panel.querySelectorAll("input[name=fm]").forEach((r) => (r.onchange = () => { p.filtrar_marca = r.value === "1"; marcarSucio(); }));
    enlazar(panel.querySelector("#sinMarca"), "notas_sin_marca"); enlazar(panel.querySelector("#img"), "revisar_imagenes");
    enlazar(panel.querySelector("#ctx"), "contexto_ia"); enlazar(panel.querySelector("#pistas"), "pistas_imagen");
    listaChips(panel, "chCat", "nCat", "aCat", p.categorias);
    listaChips(panel, "chCri", "nCri", "aCri", p.criterios_info_nueva);
  }
  function listaChips(panel, idChips, idInput, idBtn, arr) {
    const pintar = () => {
      panel.querySelector("#" + idChips).innerHTML = arr.map((w, i) => `<span class="chip">${esc(w)}<button data-i="${i}" aria-label="Quitar">×</button></span>`).join("") || `<span class="ayuda">Vacío</span>`;
      panel.querySelectorAll(`#${idChips} button`).forEach((b) => (b.onclick = () => { arr.splice(Number(b.dataset.i), 1); pintar(); marcarSucio(); }));
    };
    const agregar = () => { const inp = panel.querySelector("#" + idInput); inp.value.split(",").map((s) => s.trim()).filter(Boolean).forEach((w) => { if (!arr.includes(w)) arr.push(w); }); inp.value = ""; pintar(); marcarSucio(); };
    panel.querySelector("#" + idBtn).onclick = agregar;
    panel.querySelector("#" + idInput).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } };
    pintar();
  }

  // --- Envío
  function envio(panel) {
    panel.innerHTML = `<div class="tarjeta"><h2>¿Qué notas se mandan?</h2><div class="opciones">
      ${Object.entries(MODOS).map(([k, [t, d]]) => `<label><input type="radio" name="modo" value="${k}" ${p.modo_envio === k ? "checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`).join("")}</div></div>
      <div class="tarjeta grid3">
        <label class="campo">Ventana para agrupar (horas)<input type="number" id="ventana" min="1" max="720" value="${p.ventana_horas}"><span class="ayuda">Notas dentro de este tiempo se comparan con las noticias ya avisadas.</span></label>
        <label class="campo">Máximo de actualizaciones<input type="number" id="maxAct" min="0" max="20" value="${p.max_actualizaciones ?? ""}"><span class="ayuda">Por noticia. Vacío = sin límite.</span></label>
        <div><label class="interruptor"><input type="checkbox" id="hilo" ${p.actualizaciones_en_hilo ? "checked" : ""}> Actualizaciones como respuesta</label><p class="ayuda">En Telegram, la actualización responde al mensaje original.</p></div></div>`;
    panel.querySelectorAll("input[name=modo]").forEach((r) => (r.onchange = () => { p.modo_envio = r.value; marcarSucio(); }));
    enlazar(panel.querySelector("#ventana"), "ventana_horas", Number);
    enlazar(panel.querySelector("#maxAct"), "max_actualizaciones", (v) => (v === "" ? null : Number(v)));
    enlazar(panel.querySelector("#hilo"), "actualizaciones_en_hilo");
  }

  // --- Formato
  function formato(panel) {
    const f = p.formato;
    const casillas = [["mostrar_categoria", "Tema (categoría)", true], ["mostrar_lugar", "Lugar", true], ["mostrar_fecha", "Fecha y hora", true], ["mostrar_titulo_nota", "Titular de la nota", false], ["mostrar_resumen", "Resumen de la IA", true], ["mostrar_medio", "Medio", true], ["mostrar_liga", "Liga a la nota o testigo", true]];
    panel.innerHTML = `<div class="grid2">
      <div class="tarjeta"><h2>Contenido del mensaje</h2>
        <label class="campo">Nombre en el encabezado<input type="text" id="etq" value="${esc(f.etiqueta ?? "")}" placeholder="${esc(p.marca)}"><span class="ayuda">Aparece como «🚨 ALERTA NOMBRE». Vacío = la marca.</span></label>
        <div class="casillas" style="margin:14px 0">${casillas.map(([k, t, def]) => `<label><input type="checkbox" data-k="${k}" ${(f[k] ?? def) ? "checked" : ""}> ${t}</label>`).join("")}</div>
        <label class="campo">Texto al final de cada alerta<input type="text" id="pie" value="${esc(f.pie ?? "")}" placeholder="Opcional, p. ej. «Monitoreo EFINFO»"></label></div>
      <div class="tarjeta"><h2>Vista previa</h2><div class="telegram"><div class="burbuja" id="prev">…</div></div>
        <p class="ayuda">Con una nota de ejemplo. Las notas de radio, TV y prensa llevan la liga al testigo.</p></div></div>`;
    const prev = async () => {
      try {
        const r = await api("vista_previa", { perfil: p });
        panel.querySelector("#prev").innerHTML = esc(r.html).replace(/&lt;(\/?)(b|i)&gt;/g, "<$1$2>");
      } catch (e) { panel.querySelector("#prev").textContent = "No se pudo generar la vista previa: " + e.message; }
    };
    panel.querySelector("#etq").oninput = (e) => { f.etiqueta = e.target.value; marcarSucio(); clearTimeout(prev.t); prev.t = setTimeout(prev, 400); };
    panel.querySelector("#pie").oninput = (e) => { f.pie = e.target.value; marcarSucio(); clearTimeout(prev.t); prev.t = setTimeout(prev, 400); };
    panel.querySelectorAll("input[data-k]").forEach((i) => (i.onchange = () => { f[i.dataset.k] = i.checked; marcarSucio(); prev(); }));
    prev();
  }

  // --- Destinos
  async function destinos(panel) {
    if (nueva) { panel.innerHTML = `<div class="tarjeta"><p>Guarda la alerta primero para agregar destinos.</p></div>`; return; }
    const lista = await consulta(sb.from("alert_destinations").select("*").eq("profile_id", p.id).order("id"));
    panel.innerHTML = `<div class="tarjeta"><h2>Destinos</h2>
      ${lista.length ? `<table><thead><tr><th>Nombre</th><th>Canal</th><th>A dónde</th><th>Estado</th><th></th></tr></thead><tbody>
      ${lista.map((d) => `<tr><td>${esc(d.nombre)}</td><td>${d.canal === "telegram" ? "Telegram" : "Correo"}</td>
        <td class="mono">${esc(d.canal === "telegram" ? d.telegram_chat_id : (d.emails ?? []).join(", "))}</td>
        <td><label class="interruptor"><input type="checkbox" data-act="${d.id}" ${d.activo !== false ? "checked" : ""}> ${d.activo !== false ? "Activo" : "Apagado"}</label></td>
        <td class="fila"><button class="btn chico" data-probar="${d.id}">Mandar prueba</button><button class="btn chico peligro" data-quitar="${d.id}">Quitar</button></td></tr>`).join("")}</tbody></table>` : `<p class="vacio">Sin destinos: la alerta no manda nada.</p>`}</div>
      <div class="tarjeta"><h2>Agregar destino</h2>
        <div class="grid3"><label class="campo">Nombre<input type="text" id="dNom" placeholder="Grupo de Telegram de…"></label>
          <label class="campo">Canal<select id="dCanal"><option value="telegram">Telegram</option><option value="email">Correo</option></select></label>
          <label class="campo" id="dDestLbl">ID del grupo de Telegram<input type="text" id="dDest" placeholder="-100…"></label></div>
        <div class="fila" style="margin-top:12px"><button class="btn" id="detectar">Detectar grupos del bot</button><button class="btn primario" id="agregar">Agregar destino</button></div>
        <div id="grupos"></div>
        <p class="ayuda">Para Telegram: agrega el bot del cliente al grupo y escribe en el grupo un mensaje que lo mencione (por ejemplo «@bot hola»); después presiona «Detectar grupos». Para correo, separa las direcciones con comas.</p></div>`;
    const canal = panel.querySelector("#dCanal");
    canal.onchange = () => { panel.querySelector("#dDestLbl").firstChild.textContent = canal.value === "telegram" ? "ID del grupo de Telegram" : "Correos"; panel.querySelector("#detectar").hidden = canal.value !== "telegram"; };
    panel.querySelector("#detectar").onclick = async () => {
      try {
        const r = await api("detectar_grupos", { client_id: p.client_id });
        panel.querySelector("#grupos").innerHTML = r.grupos.length ? `<div class="resultados">${r.grupos.map((g) => `<div data-id="${esc(g.id)}" data-t="${esc(g.titulo)}">${esc(g.titulo)} <small>${esc(g.id)}</small></div>`).join("")}</div>`
          : `<p class="ayuda">El bot no ha visto mensajes en ningún grupo. Menciónalo en el grupo y vuelve a intentar.</p>`;
        panel.querySelectorAll("#grupos [data-id]").forEach((x) => (x.onclick = () => { panel.querySelector("#dDest").value = x.dataset.id; if (!panel.querySelector("#dNom").value) panel.querySelector("#dNom").value = x.dataset.t; }));
      } catch (e) { falla(e); }
    };
    panel.querySelector("#agregar").onclick = async () => {
      const nombre = panel.querySelector("#dNom").value.trim(), dest = panel.querySelector("#dDest").value.trim();
      if (!dest) return aviso("Falta el destino.", true);
      const fila = { profile_id: p.id, nombre: nombre || dest, canal: canal.value, activo: true };
      if (canal.value === "telegram") fila.telegram_chat_id = dest; else fila.emails = dest.split(/[,;\s]+/).filter(Boolean);
      try { await consulta(sb.from("alert_destinations").insert(fila)); aviso("Destino agregado."); destinos(panel); } catch (e) { falla(e); }
    };
    panel.querySelectorAll("[data-act]").forEach((i) => (i.onchange = async () => { try { await consulta(sb.from("alert_destinations").update({ activo: i.checked }).eq("id", i.dataset.act)); destinos(panel); } catch (e) { falla(e); } }));
    panel.querySelectorAll("[data-probar]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api("probar_destino", { destination_id: Number(b.dataset.probar) }); aviso("Mensaje de prueba enviado."); } catch (e) { falla(e); } b.disabled = false; }));
    panel.querySelectorAll("[data-quitar]").forEach((b) => (b.onclick = async () => { if (!confirm("¿Quitar este destino?")) return; try { await consulta(sb.from("alert_destinations").delete().eq("id", b.dataset.quitar)); destinos(panel); } catch (e) { falla(e); } }));
  }

  // --- Prueba en seco
  function prueba(panel) {
    panel.innerHTML = `<div class="tarjeta"><h2>Prueba en seco</h2>
      <p class="ayuda">Revisa notas recientes con la configuración <b>guardada</b> y muestra qué decidiría, sin mandar nada ni mover el avance de la alerta. Tarda hasta dos minutos.</p>
      <div class="fila"><label class="campo" style="width:200px">Notas a revisar<input type="number" id="n" value="10" min="1" max="25"></label>
      <label class="campo" style="width:240px">Desde la nota (ID)<input type="number" id="desde" placeholder="Vacío = donde va la alerta"></label>
      <button class="btn primario" id="correr" style="align-self:flex-end" ${nueva ? "disabled" : ""}>Probar</button></div>
      <div id="res" style="margin-top:14px"></div></div>
      <div class="tarjeta"><h2>Avance de la alerta</h2><p class="ayuda">La alerta va en la nota <b class="mono">${esc(p.ultimo_id ?? 0)}</b>. Si la apagaste un tiempo, puedes saltar a las notas de ahora para que no mande lo atrasado.</p>
      <button class="btn" id="ahora" ${nueva ? "disabled" : ""}>Empezar desde las notas de ahora</button></div>`;
    panel.querySelector("#correr").onclick = async () => {
      const res = panel.querySelector("#res"); res.innerHTML = `<p class="vacio">Probando…</p>`;
      try {
        const desde = panel.querySelector("#desde").value;
        const r = await api("prueba_seco", { perfil: p.nombre, max_notas: Number(panel.querySelector("#n").value), desde_id: desde ? Number(desde) : undefined });
        const s = r.perfiles?.[0];
        if (!s) { res.innerHTML = `<p>La alerta debe estar activa y guardada para probarla.</p>`; return; }
        res.innerHTML = `<p>Leídas: <b>${s.leidas}</b> · revisadas: <b>${s.procesadas}</b> · se mandarían: <b>${s.enviadas}</b>${s.error ? ` · <span class="etiqueta no">${esc(s.error)}</span>` : ""}</p>
          <table><tbody>${(s.decisiones ?? []).map((d) => { const [id, dec] = d.split(": "); const [t, cls] = DECISIONES[dec] ?? [dec, ""]; return `<tr><td class="mono">${esc(id)}</td><td><span class="etiqueta ${cls}">${esc(t)}</span></td></tr>`; }).join("")}</tbody></table>`;
      } catch (e) { res.innerHTML = ""; falla(e); }
    };
    panel.querySelector("#ahora").onclick = async () => {
      try { const r = await api("ultima_nota"); await consulta(sb.from("alert_profiles").update({ ultimo_id: r.ultimo_id }).eq("id", p.id)); p.ultimo_id = r.ultimo_id; aviso("Listo: la alerta empieza desde las notas de ahora."); prueba(panel); } catch (e) { falla(e); }
    };
  }

  async function guardar() {
    if (!p.nombre.trim()) return aviso("Ponle nombre a la alerta.", true);
    if (!p.secciones.length && !p.palabras.length && !p.metabase_card_id) return aviso("Agrega al menos una sección o palabras de búsqueda.", true);
    if (!p.tipos_medio.length) return aviso("Marca al menos un tipo de medio.", true);
    const fila = { ...p }; delete fila.id; delete fila.creado; fila.actualizado = new Date().toISOString();
    if (p.palabras.length) fila.metabase_card_id = null; // las palabras reemplazan a la pregunta propia
    try {
      if (nueva) {
        fila.ultimo_id = (await api("ultima_nota")).ultimo_id;
        const r = await consulta(sb.from("alert_profiles").insert(fila).select("id").single());
        aviso("Alerta creada. Agrega sus destinos y enciéndela."); location.hash = `#alerta-${r.id}`;
      } else {
        delete fila.ultimo_id; // el avance lo mueve el servicio
        await consulta(sb.from("alert_profiles").update(fila).eq("id", p.id));
        aviso("Cambios guardados."); pantallaEditor(String(p.id));
      }
    } catch (e) { falla(e.message.includes("duplicate") ? new Error("Ya existe una alerta con ese nombre.") : e); }
  }
  async function borrar() {
    if (!confirm(`¿Eliminar la alerta «${p.nombre}»? Se borran sus destinos. Si solo quieres pausarla, apágala.`)) return;
    try { await consulta(sb.from("alert_destinations").delete().eq("profile_id", p.id)); await consulta(sb.from("alert_profiles").delete().eq("id", p.id)); aviso("Alerta eliminada."); location.hash = "#alertas"; }
    catch (e) { falla(new Error("No se pudo eliminar (tiene historial). Mejor apágala. " + e.message)); }
  }
  dibujar();
}

// Buscador con resultados desplegables
function buscador(input, caja, buscar, pintar, elegir) {
  let t;
  input.oninput = () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) { caja.hidden = true; return; }
    t = setTimeout(async () => {
      try {
        const filas = await buscar(q);
        caja.innerHTML = filas.length ? filas.map((f, i) => `<div data-i="${i}">${pintar(f)}</div>`).join("") : `<div>Sin resultados</div>`;
        caja.hidden = false;
        caja.querySelectorAll("[data-i]").forEach((d) => (d.onclick = () => { elegir(filas[Number(d.dataset.i)]); }));
      } catch (e) { falla(e); }
    }, 350);
  };
}

// ---------------------------------------------------------------- Clientes
async function pantallaClientes() {
  const clientes = await consulta(sb.from("alert_clients").select("*, perfiles:alert_profiles(id, nombre, activo)").order("id"));
  const c = marco("clientes", `
    <div class="fila entre"><div><h1>Clientes</h1><p class="sub">Cada cliente tiene su bot de Telegram; sus alertas mandan con ese bot.</p></div></div>
    ${clientes.map((k) => `<div class="tarjeta" data-c="${k.id}">
      <div class="fila entre"><h2>${esc(k.nombre)}</h2><span class="etiqueta ${k.activo !== false ? "ok" : "no"}">${k.activo !== false ? "Activo" : "Apagado"}</span></div>
      <div class="grid3">
        <label class="campo">Nombre<input type="text" data-f="nombre" value="${esc(k.nombre)}"></label>
        <label class="campo">ID de cliente en EFINFO<input type="number" data-f="efinfo_id_cliente" value="${esc(k.efinfo_id_cliente ?? "")}"></label>
        <div><label class="interruptor"><input type="checkbox" data-f="activo" ${k.activo !== false ? "checked" : ""}> Cliente activo</label><p class="ayuda">Apagado detiene todas sus alertas.</p></div></div>
      <p style="margin:12px 0 6px"><b>Bot de Telegram:</b> <span data-bot>${k.telegram_bot_secreto ? "configurado…" : "sin bot"}</span></p>
      <div class="fila"><input type="password" data-token placeholder="Pega aquí el token que te dio @BotFather" style="flex:1" autocomplete="off"><button class="btn" data-guardar-bot>Guardar bot</button></div>
      <p class="ayuda">El token se guarda cifrado en Supabase (Vault) y no se vuelve a mostrar.</p>
      <p style="margin-top:10px"><b>Alertas:</b> ${k.perfiles.map((p) => `<a href="#alerta-${p.id}">${esc(p.nombre)}</a>`).join(" · ") || "ninguna"}</p>
      <div class="fila" style="justify-content:flex-end"><button class="btn primario" data-guardar>Guardar cliente</button></div></div>`).join("")}
    <div class="tarjeta"><h2>Nuevo cliente</h2><div class="fila"><input type="text" id="nNom" placeholder="Nombre del cliente" style="flex:1"><input type="number" id="nId" placeholder="ID en EFINFO" style="width:180px"><button class="btn primario" id="crear">Crear</button></div></div>`);
  clientes.forEach((k) => {
    const t = c.querySelector(`[data-c="${k.id}"]`);
    if (k.telegram_bot_secreto) api("info_bot", { client_id: k.id }).then((r) => (t.querySelector("[data-bot]").textContent = `@${r.bot}`)).catch((e) => (t.querySelector("[data-bot]").textContent = "no responde (" + e.message + ")"));
    t.querySelector("[data-guardar]").onclick = async () => {
      const v = (f) => t.querySelector(`[data-f="${f}"]`);
      try {
        await consulta(sb.from("alert_clients").update({ nombre: v("nombre").value.trim(), efinfo_id_cliente: v("efinfo_id_cliente").value ? Number(v("efinfo_id_cliente").value) : null, activo: v("activo").checked }).eq("id", k.id));
        aviso("Cliente guardado."); pantallaClientes();
      } catch (e) { falla(e); }
    };
    t.querySelector("[data-guardar-bot]").onclick = async () => {
      const inp = t.querySelector("[data-token]");
      try { const r = await api("guardar_bot", { client_id: k.id, token: inp.value.trim() }); inp.value = ""; aviso(`Bot @${r.bot} guardado.`); t.querySelector("[data-bot]").textContent = `@${r.bot}`; } catch (e) { falla(e); }
    };
  });
  c.querySelector("#crear").onclick = async () => {
    const nombre = c.querySelector("#nNom").value.trim(); if (!nombre) return aviso("Escribe el nombre del cliente.", true);
    try { await consulta(sb.from("alert_clients").insert({ nombre, efinfo_id_cliente: c.querySelector("#nId").value ? Number(c.querySelector("#nId").value) : null, activo: true })); aviso("Cliente creado. Ahora guarda su bot."); pantallaClientes(); } catch (e) { falla(e); }
  };
}

// ---------------------------------------------------------------- Bitácora
async function pantallaBitacora(idPerfil) {
  const perfiles = await consulta(sb.from("alert_profiles").select("id, nombre").order("id"));
  const actual = Number(idPerfil) || perfiles[0]?.id;
  const c = marco("bitacora", `<div class="fila entre"><div><h1>Bitácora</h1><p class="sub">Qué notas revisó la alerta y qué decidió con cada una.</p></div>
    <div class="fila"><select id="perfil">${perfiles.map((p) => `<option value="${p.id}" ${p.id === actual ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select>
    <select id="filtro"><option value="">Todas las decisiones</option><option value="enviadas">Solo enviadas</option>${Object.entries(DECISIONES).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("")}</select></div></div>
    <div class="tarjeta" id="resumen"></div><div class="tarjeta" id="tabla"><p class="vacio">Cargando…</p></div>`);
  const cargar = async () => {
    const id = Number(c.querySelector("#perfil").value), filtro = c.querySelector("#filtro").value;
    let q = sb.from("alert_notes").select("nota_id, decision, razon, medio, url, titulo, fecha_nota, procesada, fuentes, envios").eq("profile_id", id).order("procesada", { ascending: false }).limit(200);
    if (filtro === "enviadas") q = q.in("decision", ["alerta", "actualizacion", "enviada_todas", "confirmacion_marca"]);
    else if (filtro) q = q.eq("decision", filtro);
    const filas = await consulta(q);
    const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
    const dia = await consulta(sb.from("alert_notes").select("decision").eq("profile_id", id).gte("procesada", desde));
    const cuenta = {}; dia.forEach((d) => (cuenta[d.decision] = (cuenta[d.decision] ?? 0) + 1));
    c.querySelector("#resumen").innerHTML = `<h3>Últimas 24 horas</h3><div class="chips">${Object.entries(cuenta).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="etiqueta ${DECISIONES[k]?.[1] ?? ""}">${esc(DECISIONES[k]?.[0] ?? k)}: ${n}</span>`).join("") || `<span class="ayuda">Sin notas revisadas</span>`}</div>`;
    c.querySelector("#tabla").innerHTML = filas.length ? `<table><thead><tr><th>Revisada</th><th>Nota</th><th>Decisión</th><th>Motivo</th></tr></thead><tbody>
      ${filas.map((f) => { const [t, cls] = DECISIONES[f.decision] ?? [f.decision, ""]; const fallos = (f.envios ?? []).filter((e) => !e.ok);
        return `<tr><td>${fecha(f.procesada)}</td>
        <td>${f.titulo ? `<b>${esc(f.titulo)}</b><br>` : ""}<small class="ayuda">${esc(f.medio)} · ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">abrir</a> · ` : ""}<span class="mono">${f.nota_id}</span>${(f.fuentes ?? []).length ? " · " + esc(f.fuentes.join(", ")) : ""}</small></td>
        <td><span class="etiqueta ${cls}">${esc(t)}</span>${fallos.length ? `<br><span class="etiqueta no">Falló el envío</span>` : ""}</td>
        <td><small>${esc(f.razon ?? "")}${fallos.length ? "<br>" + esc(fallos.map((e) => e.error).join("; ")) : ""}</small></td></tr>`; }).join("")}</tbody></table>` : `<p class="vacio">Sin notas con este filtro.</p>`;
  };
  c.querySelector("#perfil").onchange = () => { history.replaceState(null, "", `#bitacora-${c.querySelector("#perfil").value}`); cargar().catch(falla); };
  c.querySelector("#filtro").onchange = () => cargar().catch(falla);
  await cargar();
}

// ---------------------------------------------------------------- Administradores
async function pantallaAdmins() {
  const admins = await consulta(sb.from("alert_admins").select("*").order("creado"));
  const c = marco("admins", `<h1>Administradores</h1><p class="sub">Personas que pueden entrar a esta página y cambiar las alertas.</p>
    <div class="tarjeta"><table><thead><tr><th>Correo</th><th>Nombre</th><th>Desde</th><th></th></tr></thead><tbody>
    ${admins.map((a) => `<tr><td>${esc(a.email)}</td><td>${esc(a.nombre ?? "")}</td><td>${fecha(a.creado)}</td><td>${a.email.toLowerCase() === usuario.email.toLowerCase() ? `<span class="ayuda">(tú)</span>` : `<button class="btn chico peligro" data-q="${esc(a.email)}">Quitar</button>`}</td></tr>`).join("")}</tbody></table></div>
    <div class="tarjeta"><h2>Agregar administrador</h2><div class="grid3">
      <label class="campo">Correo<input type="email" id="aEmail"></label><label class="campo">Nombre<input type="text" id="aNom"></label>
      <label class="campo">Contraseña inicial<input type="password" id="aPass" autocomplete="new-password"><span class="ayuda">Mínimo 8 caracteres. Si la persona ya tiene cuenta en Supabase, se usa su contraseña actual.</span></label></div>
      <div class="fila" style="justify-content:flex-end;margin-top:10px"><button class="btn primario" id="agregar">Agregar</button></div></div>
    <div class="tarjeta"><h2>Cambiar mi contraseña</h2><div class="fila"><input type="password" id="miPass" placeholder="Nueva contraseña" autocomplete="new-password" style="max-width:320px"><button class="btn" id="cambiar">Cambiar</button></div></div>`);
  c.querySelectorAll("[data-q]").forEach((b) => (b.onclick = async () => { if (!confirm(`¿Quitar a ${b.dataset.q}?`)) return; try { await consulta(sb.from("alert_admins").delete().eq("email", b.dataset.q)); pantallaAdmins(); } catch (e) { falla(e); } }));
  c.querySelector("#agregar").onclick = async () => {
    try { const r = await api("crear_admin", { email: c.querySelector("#aEmail").value, nombre: c.querySelector("#aNom").value, password: c.querySelector("#aPass").value || undefined });
      aviso(r.cuenta === "nueva" ? "Administrador agregado con su contraseña inicial." : "Administrador agregado; entra con su cuenta existente."); pantallaAdmins(); } catch (e) { falla(e); }
  };
  c.querySelector("#cambiar").onclick = async () => {
    const v = c.querySelector("#miPass").value; if (v.length < 8) return aviso("Mínimo 8 caracteres.", true);
    const { error } = await sb.auth.updateUser({ password: v }); if (error) falla(error); else { aviso("Contraseña cambiada."); c.querySelector("#miPass").value = ""; }
  };
}

// ---------------------------------------------------------------- Ajustes
async function pantallaAjustes() {
  const { metabase_cards: m } = await api("ajustes");
  const etiquetas = { seccion: "Notas por sección (genérica)", palabras: "Notas por palabras (genérica)", tipos: "Catálogo de tipos de medio", medios: "Catálogo de medios", secciones: "Catálogo de secciones", ultima: "Última nota" };
  const c = marco("ajustes", `<h1>Ajustes</h1><p class="sub">Preguntas de Metabase que usa el servicio (colección «21 - Alertas Telegram»). Solo cámbialas si alguien las reemplaza en Metabase.</p>
    <div class="tarjeta"><div class="grid3">${Object.entries(etiquetas).map(([k, t]) => `<label class="campo">${t}<input type="number" data-k="${k}" value="${esc(m[k])}"></label>`).join("")}</div>
    <div class="fila" style="justify-content:flex-end;margin-top:12px"><button class="btn primario" id="g">Guardar</button></div></div>`);
  c.querySelector("#g").onclick = async () => {
    const guardar = Object.fromEntries([...c.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, Number(i.value)]));
    try { await api("ajustes", { guardar }); aviso("Ajustes guardados."); } catch (e) { falla(e); }
  };
}

iniciar();
