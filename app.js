/* global initSqlJs */

"use strict";

const DATABASE_ID = "1WWuvjmEO_6pIMKmgUFadZEqfVROXXSfz";
const DATABASE_URL = `https://drive.usercontent.google.com/download?id=${DATABASE_ID}&export=download&confirm=t`;
const DATABASE_VIEW_URL = `https://drive.google.com/file/d/${DATABASE_ID}/view?usp=sharing`;

const state = {
  db: null,
  competitions: [],
  databaseModified: null,
};

const ui = {
  app: document.querySelector("#app-view"),
  loading: document.querySelector("#loading-view"),
  loadingMessage: document.querySelector("#loading-message"),
  loadingMeta: document.querySelector("#loading-meta"),
  progress: document.querySelector("#progress-bar"),
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
};

document.addEventListener("DOMContentLoaded", start);
window.addEventListener("hashchange", route);

async function start() {
  try {
    setLoading("Datenbank wird direkt von Google Drive geladen.", "Download startet …", 4);
    const bytes = await downloadDatabase();
    setLoading("Datenbank wird im Browser geöffnet.", formatBytes(bytes.byteLength), 94);

    const SQL = await initSqlJs({
      locateFile: () => "vendor/sql.js/sql-wasm.wasm",
    });

    state.db = new SQL.Database(bytes);
    verifyDatabase();
    state.competitions = loadCompetitions();

    setLoading("Ansicht wird aufgebaut.", `${state.competitions.length} Wettkämpfe gefunden`, 100);
    ui.statusDot.classList.remove("is-loading");
    ui.statusText.textContent = `${state.competitions.length} Wettkämpfe · live aus Drive`;

    window.setTimeout(() => {
      ui.loading.hidden = true;
      ui.app.hidden = false;
      route();
    }, 220);
  } catch (error) {
    console.error(error);
    showFatalError(error);
  }
}

async function downloadDatabase() {
  const response = await fetch(DATABASE_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Google Drive antwortet mit HTTP ${response.status}.`);
  }

  state.databaseModified = response.headers.get("last-modified");
  const total = Number(response.headers.get("content-length")) || 0;

  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = total ? Math.min(90, 7 + (received / total) * 83) : 45;
    setLoading(
      "Datenbank wird direkt von Google Drive geladen.",
      total ? `${formatBytes(received)} von ${formatBytes(total)}` : formatBytes(received),
      percent,
    );
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function setLoading(message, meta, percent) {
  ui.loadingMessage.textContent = message;
  ui.loadingMeta.textContent = meta;
  ui.progress.style.width = `${percent}%`;
}

function verifyDatabase() {
  const identity = queryOne(
    "SELECT canonical_drive_file_id, canonical_filename FROM database_identity WHERE singleton_id = 1",
  );
  if (!identity || identity.canonical_drive_file_id !== DATABASE_ID) {
    throw new Error("Die geladene Datei ist nicht die erwartete Lifesaving-Datenbank.");
  }
}

function loadCompetitions() {
  return query(`
    SELECT
      c.id,
      c.name,
      c.edition_label,
      c.start_date,
      c.end_date,
      c.environment,
      v.name AS venue_name,
      v.city,
      co.name AS country_name,
      cs.name AS series_name,
      COUNT(DISTINCT ce.id) AS event_count,
      COUNT(DISTINCT r.id) AS result_count
    FROM competitions c
    LEFT JOIN venues v ON v.id = c.venue_id
    LEFT JOIN countries co ON co.id = v.country_id
    LEFT JOIN competition_series cs ON cs.id = c.series_id
    LEFT JOIN competition_events ce ON ce.competition_id = c.id
    LEFT JOIN rounds ro ON ro.event_id = ce.id
    LEFT JOIN results r ON r.round_id = ro.id
    GROUP BY c.id
    ORDER BY COALESCE(c.start_date, c.edition_label, '') DESC, c.name COLLATE NOCASE
  `);
}

function route() {
  if (!state.db) return;
  const match = window.location.hash.match(/^#\/wettkampf\/(\d+)/);
  if (match) {
    renderCompetition(Number(match[1]));
  } else {
    renderOverview();
  }
  document.querySelector("#inhalt")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderOverview() {
  document.title = "Lifesaving Ergebnisarchiv";
  clear(ui.app);

  const shell = element("div", "app-shell");
  const hero = element("section", "hero");
  const copy = element("div", "hero-copy");
  copy.append(
    element("p", "eyebrow", "Wettkampfdatenbank"),
    element("h1", "", "Ergebnisse, die nicht untergehen."),
    element("p", "", "Durchsuche alle erfassten Lifesaving-Wettkämpfe und öffne Disziplinen, Platzierungen, Zeiten und Punkte direkt aus der aktuellen Datenbank."),
  );
  const totalResults = state.competitions.reduce((sum, item) => sum + Number(item.result_count || 0), 0);
  const stat = element("div", "hero-stat");
  stat.append(element("strong", "", formatNumber(totalResults)), element("span", "", "strukturierte Resultate"));
  hero.append(copy, stat);

  const toolbar = element("div", "toolbar");
  const searchField = element("div", "field");
  const searchLabel = element("label", "", "Wettkämpfe durchsuchen");
  searchLabel.htmlFor = "competition-search";
  const search = element("input");
  search.id = "competition-search";
  search.type = "search";
  search.placeholder = "Name, Jahr, Ort oder Land …";
  search.autocomplete = "off";
  searchField.append(searchLabel, search, element("span", "search-icon"));

  const filterField = element("div", "field");
  const filterLabel = element("label", "", "Umgebung filtern");
  filterLabel.htmlFor = "environment-filter";
  const filter = element("select");
  filter.id = "environment-filter";
  addOption(filter, "", "Alle Umgebungen");
  const environments = [...new Set(state.competitions.map((item) => item.environment).filter(Boolean))].sort(localeSort);
  for (const value of environments) addOption(filter, value, translateEnvironment(value));
  filterField.append(filterLabel, filter);
  toolbar.append(searchField, filterField);

  const heading = element("div", "results-heading");
  heading.append(element("h2", "", "Alle Wettkämpfe"), element("span", "results-count"));
  const list = element("div", "competition-list");
  const empty = element("div", "empty-state", "Keine Wettkämpfe passen zu dieser Suche.");
  empty.hidden = true;

  const renderCards = () => {
    const term = normalize(search.value);
    const environment = filter.value;
    const visible = state.competitions.filter((competition) => {
      const haystack = normalize([
        competition.name,
        competition.edition_label,
        competition.start_date,
        competition.venue_name,
        competition.city,
        competition.country_name,
        competition.series_name,
      ].join(" "));
      return (!term || haystack.includes(term)) && (!environment || competition.environment === environment);
    });

    clear(list);
    for (const competition of visible) list.append(createCompetitionCard(competition));
    heading.querySelector(".results-count").textContent = `${visible.length} von ${state.competitions.length}`;
    empty.hidden = visible.length !== 0;
  };

  search.addEventListener("input", renderCards);
  filter.addEventListener("change", renderCards);
  renderCards();

  shell.append(hero, toolbar, heading, list, empty);
  ui.app.append(shell);
}

function createCompetitionCard(competition) {
  const card = element("article", "competition-card");
  const kicker = element("div", "card-kicker");
  kicker.append(element("span", "", competition.edition_label || yearFromDate(competition.start_date) || "Wettkampf"));

  const title = element("h3");
  const link = element("a", "", competition.name);
  link.href = `#/wettkampf/${competition.id}`;
  title.append(link);

  const meta = element("div", "card-meta");
  meta.append(
    element("span", "", formatDateRange(competition.start_date, competition.end_date)),
    element("span", "", formatLocation(competition)),
  );

  const stats = element("div", "card-stats");
  stats.append(
    element("span", "chip is-ocean", `${formatNumber(competition.event_count)} Disziplinen`),
    element("span", "chip is-accent", `${formatNumber(competition.result_count)} Resultate`),
  );
  card.append(kicker, title, meta, stats);
  return card;
}

function renderCompetition(id) {
  const competition = queryOne(`
    SELECT
      c.*,
      v.name AS venue_name,
      v.city,
      co.name AS country_name,
      cs.name AS series_name,
      src.source_file_id,
      src.original_filename,
      src.current_filename,
      src.last_processed_at,
      COUNT(DISTINCT ce.id) AS event_count,
      COUNT(DISTINCT r.id) AS result_count
    FROM competitions c
    LEFT JOIN venues v ON v.id = c.venue_id
    LEFT JOIN countries co ON co.id = v.country_id
    LEFT JOIN competition_series cs ON cs.id = c.series_id
    LEFT JOIN import_sources src ON src.id = c.source_id
    LEFT JOIN competition_events ce ON ce.competition_id = c.id
    LEFT JOIN rounds ro ON ro.event_id = ce.id
    LEFT JOIN results r ON r.round_id = ro.id
    WHERE c.id = ?
    GROUP BY c.id
  `, [id]);

  if (!competition) {
    renderNotFound();
    return;
  }

  document.title = `${competition.name} · Lifesaving Ergebnisarchiv`;
  clear(ui.app);
  const shell = element("div", "app-shell");
  const back = element("a", "back-link", "Alle Wettkämpfe");
  back.href = "#/";

  const hero = element("section", "detail-hero");
  hero.append(element("p", "eyebrow", competition.series_name || "Lifesaving-Wettkampf"), element("h1", "", competition.name));
  const subline = element("div", "detail-subline");
  subline.append(
    element("span", "", formatDateRange(competition.start_date, competition.end_date)),
    element("span", "", formatLocation(competition)),
    element("span", "", translateEnvironment(competition.environment)),
  );
  const stats = element("div", "detail-stats");
  stats.append(
    element("span", "chip", `${formatNumber(competition.event_count)} Disziplinen`),
    element("span", "chip", `${formatNumber(competition.result_count)} Resultate`),
  );
  hero.append(subline, stats);

  const grid = element("div", "detail-grid");
  const content = element("div", "content-stack");
  content.append(createEventsPanel(competition.id));

  const standings = loadStandings(competition.id);
  if (standings.length) content.append(createStandingsPanel(standings));
  const medals = loadMedals(competition.id);
  if (medals.length) content.append(createMedalPanel(medals));

  const sidebar = createFactsPanel(competition);
  grid.append(content, sidebar);
  shell.append(back, hero, grid);
  ui.app.append(shell);
}

function createEventsPanel(competitionId) {
  const events = query(`
    SELECT
      ce.id,
      ce.external_event_code,
      ce.event_name,
      ce.source_title_raw,
      ce.gender,
      ce.event_kind,
      d.canonical_name AS discipline_name,
      cat.label AS category_label,
      COUNT(DISTINCT r.id) AS result_count
    FROM competition_events ce
    LEFT JOIN disciplines d ON d.id = ce.discipline_id
    LEFT JOIN categories cat ON cat.id = ce.category_id
    LEFT JOIN rounds ro ON ro.event_id = ce.id
    LEFT JOIN results r ON r.round_id = ro.id
    WHERE ce.competition_id = ?
    GROUP BY ce.id
    ORDER BY CAST(ce.external_event_code AS INTEGER), ce.id
  `, [competitionId]);

  const panel = element("section", "panel");
  panel.append(
    element("h2", "", "Disziplinen & Ergebnisse"),
    element("p", "panel-intro", "Eine Disziplin öffnen, um alle erfassten Platzierungen, Zeiten und Punkte zu sehen."),
  );

  const tools = element("div", "event-tools field");
  const label = element("label", "", "Disziplinen durchsuchen");
  label.htmlFor = "event-search";
  const input = element("input");
  input.id = "event-search";
  input.type = "search";
  input.placeholder = "Disziplin, Kategorie oder Geschlecht …";
  input.autocomplete = "off";
  tools.append(label, input, element("span", "search-icon"));

  const list = element("div", "event-list");
  const empty = element("div", "empty-state", "Keine passende Disziplin gefunden.");
  empty.hidden = true;

  const cards = events.map((event) => ({ event, card: createEventCard(event) }));
  for (const item of cards) list.append(item.card);

  input.addEventListener("input", () => {
    const term = normalize(input.value);
    let visible = 0;
    for (const { event, card } of cards) {
      const matches = !term || normalize([event.event_name, event.source_title_raw, event.discipline_name, event.category_label, event.gender].join(" ")).includes(term);
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    empty.hidden = visible !== 0;
  });

  panel.append(tools, list, empty);
  return panel;
}

function createEventCard(event) {
  const details = element("details", "event-card");
  const summary = element("summary");
  const name = element("span", "event-name");
  name.append(
    element("strong", "", event.source_title_raw || event.event_name),
    element("small", "", [event.discipline_name, translateGender(event.gender), event.category_label].filter(Boolean).join(" · ")),
  );
  summary.append(name, element("span", "chip is-ocean", `${formatNumber(event.result_count)} Resultate`));
  const body = element("div", "event-body");
  body.append(element("div", "event-loading", "Ergebnisse werden beim Öffnen geladen."));
  details.append(summary, body);

  details.addEventListener("toggle", () => {
    if (details.open && !details.dataset.loaded) {
      details.dataset.loaded = "true";
      renderEventResults(event.id, body);
    }
  });
  return details;
}

function renderEventResults(eventId, container) {
  const results = query(`
    SELECT
      r.rank_numeric,
      r.rank_text,
      r.is_tied,
      r.lane,
      r.time_text,
      r.raw_value_text,
      r.points,
      r.status_code,
      r.qualification_code,
      r.record_marker,
      r.disqualification_code,
      r.remarks,
      e.display_name,
      e.participant_type,
      cl.name AS club_name,
      ro.source_label AS round_label,
      ro.sequence_no,
      ro.heat_no
    FROM entries e
    JOIN rounds ro ON ro.event_id = e.event_id
    JOIN results r ON r.entry_id = e.id AND r.round_id = ro.id
    LEFT JOIN clubs cl ON cl.id = e.club_id
    WHERE e.event_id = ?
    ORDER BY COALESCE(ro.sequence_no, 9999), COALESCE(ro.heat_no, 9999),
             CASE WHEN r.rank_numeric IS NULL THEN 1 ELSE 0 END, r.rank_numeric, e.display_name COLLATE NOCASE
  `, [eventId]);

  clear(container);
  if (!results.length) {
    container.append(element("div", "empty-state", "Für diese Disziplin sind noch keine Einzelresultate gespeichert."));
    return;
  }

  const wrap = element("div", "table-wrap");
  const table = element("table");
  const head = element("thead");
  const headerRow = element("tr");
  for (const title of ["Rang", "Teilnehmer / Team", "Runde", "Bahn", "Leistung", "Punkte", "Status"]) {
    headerRow.append(element("th", "", title));
  }
  head.append(headerRow);
  const body = element("tbody");

  for (const result of results) {
    const row = element("tr");
    row.append(element("td", "rank", result.rank_text || result.rank_numeric || "–"));
    const participant = element("td", "participant");
    participant.append(element("strong", "", result.display_name || "–"));
    if (result.club_name) participant.append(element("small", "", result.club_name));
    row.append(participant);
    row.append(
      element("td", "", formatRound(result)),
      element("td", "nowrap", result.lane ?? "–"),
      element("td", "nowrap", formatPerformance(result)),
      element("td", "nowrap", result.points == null ? "–" : formatDecimal(result.points)),
    );
    const status = element("td", "status-code", formatStatus(result));
    if (result.remarks) status.title = result.remarks;
    row.append(status);
    body.append(row);
  }

  table.append(head, body);
  wrap.append(table);
  container.append(wrap);
}

function createFactsPanel(competition) {
  const panel = element("aside", "panel side-panel");
  panel.append(element("h2", "", "Wettkampfinfo"));
  const facts = element("dl", "facts");
  const entries = [
    ["Zeitraum", formatDateRange(competition.start_date, competition.end_date)],
    ["Austragungsort", formatLocation(competition)],
    ["Umgebung", translateEnvironment(competition.environment)],
    ["Serie", competition.series_name],
    ["Quelldatei", competition.original_filename || competition.current_filename],
    ["Importiert", formatDateTime(competition.last_processed_at)],
  ];
  for (const [label, value] of entries) {
    if (!value || value === "Nicht angegeben") continue;
    const item = element("div");
    item.append(element("dt", "", label), element("dd", "", value));
    facts.append(item);
  }
  panel.append(facts);

  if (competition.source_file_id) {
    const source = element("a", "source-link", "Originalquelle öffnen ↗");
    source.href = `https://drive.google.com/file/d/${encodeURIComponent(competition.source_file_id)}/view`;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    panel.append(source);
  }
  return panel;
}

function loadStandings(competitionId) {
  return query(`
    SELECT standing_group, entity_name, rank_numeric, rank_text, points, events_count
    FROM overall_standings
    WHERE competition_id = ?
    ORDER BY standing_group COLLATE NOCASE, CASE WHEN rank_numeric IS NULL THEN 1 ELSE 0 END, rank_numeric, entity_name COLLATE NOCASE
  `, [competitionId]);
}

function createStandingsPanel(standings) {
  const panel = element("section", "panel");
  panel.append(element("h2", "", "Gesamtwertungen"));
  const groups = groupBy(standings, (item) => item.standing_group || "Gesamtwertung");
  for (const [name, rows] of groups) {
    const group = element("div", "standing-group");
    group.append(element("h3", "", name), createSimpleTable(
      ["Rang", "Name / Team", "Wertungen", "Punkte"],
      rows.map((row) => [row.rank_text || row.rank_numeric || "–", row.entity_name, row.events_count ?? "–", row.points == null ? "–" : formatDecimal(row.points)]),
    ));
    panel.append(group);
  }
  return panel;
}

function loadMedals(competitionId) {
  return query(`
    SELECT club_name, rank_numeric, rank_text, gold, silver, bronze
    FROM medal_table
    WHERE competition_id = ?
    ORDER BY CASE WHEN rank_numeric IS NULL THEN 1 ELSE 0 END, rank_numeric, club_name COLLATE NOCASE
  `, [competitionId]);
}

function createMedalPanel(medals) {
  const panel = element("section", "panel");
  panel.append(
    element("h2", "", "Medaillenspiegel"),
    createSimpleTable(
      ["Rang", "Verein", "Gold", "Silber", "Bronze"],
      medals.map((row) => [row.rank_text || row.rank_numeric || "–", row.club_name, row.gold ?? "–", row.silver ?? "–", row.bronze ?? "–"]),
    ),
  );
  return panel;
}

function createSimpleTable(headers, rows) {
  const wrap = element("div", "table-wrap");
  const table = element("table");
  const thead = element("thead");
  const headRow = element("tr");
  headers.forEach((header) => headRow.append(element("th", "", header)));
  thead.append(headRow);
  const tbody = element("tbody");
  for (const values of rows) {
    const row = element("tr");
    values.forEach((value, index) => row.append(element("td", index === 0 ? "rank" : "", value)));
    tbody.append(row);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function renderNotFound() {
  clear(ui.app);
  const shell = element("div", "app-shell");
  const empty = element("div", "empty-state");
  empty.append(element("h1", "", "Wettkampf nicht gefunden"), element("p", "", "Der angeforderte Datensatz existiert nicht."));
  const back = element("a", "back-link", "Zur Übersicht");
  back.href = "#/";
  empty.append(back);
  shell.append(empty);
  ui.app.append(shell);
}

function showFatalError(error) {
  ui.loading.hidden = true;
  ui.app.hidden = false;
  ui.statusDot.classList.remove("is-loading");
  ui.statusDot.classList.add("is-error");
  ui.statusText.textContent = "Datenbank nicht erreichbar";
  clear(ui.app);

  const card = element("section", "error-card");
  card.append(
    element("p", "eyebrow", "Verbindungsfehler"),
    element("h1", "", "Die Ergebnisdaten konnten nicht geladen werden."),
    element("p", "", "Bitte prüfe die Internetverbindung und ob die Google-Drive-Datei weiterhin öffentlich als Betrachter freigegeben ist."),
    element("code", "", error?.message || String(error)),
  );
  const retry = element("button", "retry-button", "Erneut versuchen");
  retry.type = "button";
  retry.addEventListener("click", () => window.location.reload());
  const source = element("a", "source-link", "Datenquelle in Google Drive öffnen ↗");
  source.href = DATABASE_VIEW_URL;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  card.append(retry, source);
  ui.app.append(card);
}

function query(sql, params = []) {
  const statement = state.db.prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function queryOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function addOption(select, value, label) {
  const option = element("option", "", label);
  option.value = value;
  select.append(option);
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de").trim();
}

function localeSort(a, b) {
  return String(a).localeCompare(String(b), "de", { sensitivity: "base" });
}

function formatNumber(value) {
  return new Intl.NumberFormat("de-DE").format(Number(value || 0));
}

function formatDecimal(value) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(Number(value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: index ? 1 : 0 }).format(bytes / (1024 ** index))} ${units[index]}`;
}

function parseIsoDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDate(value) {
  const date = parseIsoDate(value);
  return date ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(date) : value || "Datum offen";
}

function formatDateRange(start, end) {
  if (!start && !end) return "Datum nicht angegeben";
  if (!end || start === end) return formatDate(start || end);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function yearFromDate(value) {
  return value ? String(value).slice(0, 4) : "";
}

function formatLocation(item) {
  const parts = [item.venue_name, item.city, item.country_name].filter(Boolean);
  return [...new Set(parts)].join(", ") || "Ort nicht angegeben";
}

function translateEnvironment(value) {
  const translations = {
    pool: "Pool",
    ocean: "Ocean / Surf",
    beach: "Beach",
    open_water: "Open Water",
    mixed: "Gemischt",
  };
  return translations[value] || value || "Nicht angegeben";
}

function translateGender(value) {
  const translations = { Female: "Frauen", Male: "Männer", Mixed: "Mixed" };
  return translations[value] || value || "";
}

function formatRound(result) {
  const bits = [result.round_label];
  if (result.heat_no != null) bits.push(`Lauf ${result.heat_no}`);
  return bits.filter(Boolean).join(" · ") || "–";
}

function formatPerformance(result) {
  if (result.time_text) return result.time_text;
  if (result.raw_value_text && result.raw_value_text !== String(result.points ?? "")) return result.raw_value_text;
  return "–";
}

function formatStatus(result) {
  const bits = [];
  if (result.status_code && result.status_code !== "FINISHED") bits.push(result.status_code);
  if (result.disqualification_code) bits.push(`DSQ ${result.disqualification_code}`);
  if (result.qualification_code) bits.push(result.qualification_code);
  if (result.record_marker) bits.push(result.record_marker);
  return bits.join(" · ") || "OK";
}
