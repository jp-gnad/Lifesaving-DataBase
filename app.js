/* global initSqlJs */
"use strict";

const DATABASE_URL = "data/Lifesaving_Results.sqlite3";
const DATABASE_ID = "1WWuvjmEO_6pIMKmgUFadZEqfVROXXSfz";
const app = document.querySelector("#app-view");
const main = document.querySelector("#inhalt");
const loading = document.querySelector("#loading-view");
const number = new Intl.NumberFormat("de-DE");
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });
const scopes = [
  ["all", "Alles"],
  ["competition", "Wettkampf"],
  ["discipline", "Disziplin"],
  ["person", "Person"],
  ["club", "Club"],
];
const competitionCategories = ["Ocean", "Beach", "Pool", "SERC", "IRB", "SpeedLifesaving"];
const overviewFilters = { q: "", scope: "all", year: "", country: "", category: "", sort: "" };

let db;
let stats;
let competitions;
let competitionsById;
let eventsByCompetition;
let memberNames;
let participantIndex;

window.addEventListener("hashchange", () => {
  if (competitions && location.hash !== "#inhalt") route();
});
start();

async function start() {
  try {
    const response = await fetch(DATABASE_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Datenbank: HTTP ${response.status}`);
    const [SQL, bytes] = await Promise.all([
      initSqlJs({ locateFile: () => "vendor/sql.js/sql-wasm.wasm" }),
      readDatabase(response),
    ]);
    db = new SQL.Database(bytes);
    const identity = query("SELECT canonical_drive_file_id FROM database_identity WHERE singleton_id = 1")[0];
    if (identity?.canonical_drive_file_id !== DATABASE_ID) throw new Error("Unerwartete Datenbankdatei.");
    loadArchive();
    loading.hidden = true;
    app.hidden = false;
    route();
  } catch (error) {
    console.error(error);
    loading.hidden = true;
    app.hidden = false;
    const panel = element("section", "error-card");
    const retry = element("button", "button", "Neu laden");
    retry.addEventListener("click", () => location.reload());
    panel.append(element("h1", "", "Datenbank konnte nicht geladen werden"), retry);
    app.replaceChildren(panel);
  }
}

async function readDatabase(response) {
  const size = Number(response.headers.get("content-length"));
  if (!response.body || !size || response.headers.get("content-encoding")) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const progress = document.querySelector("#loading-progress");
  progress.max = size;
  progress.value = 0;
  const reader = response.body.getReader();
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes.set(value, offset);
    offset += value.length;
    progress.value = offset;
  }
  return bytes;
}

function loadArchive() {
  stats = query(`
    SELECT (SELECT COUNT(*) FROM competitions) AS competitions,
           (SELECT COUNT(*) FROM disciplines) AS disciplines,
           (SELECT COUNT(*) FROM athletes) AS people,
           (SELECT COUNT(*) FROM clubs) AS clubs,
           (SELECT COUNT(*) FROM competition_events) AS events,
           (SELECT COUNT(*) FROM results) AS results
  `)[0];
  competitions = query(`
    SELECT c.id, c.parent_competition_id, c.name, c.edition_label, c.start_date, c.end_date, c.environment,
           v.name AS venue, v.city, co.name AS country, cs.name AS series
    FROM competitions c
    LEFT JOIN venues v ON v.id = c.venue_id
    LEFT JOIN countries co ON co.id = v.country_id
    LEFT JOIN competition_series cs ON cs.id = c.series_id
  `);
  const disciplines = groupBy(query("SELECT discipline_id, alias FROM discipline_aliases"), "discipline_id");
  eventsByCompetition = groupBy(query(`
    WITH result_counts AS (
      SELECT ro.event_id, COUNT(*) AS result_count
      FROM rounds ro JOIN results r ON r.round_id = ro.id
      GROUP BY ro.event_id
    )
    SELECT ce.id, ce.competition_id, ce.external_event_code, ce.event_name, ce.source_title_raw,
           ce.gender, ce.discipline_id, d.canonical_name AS discipline,
           d.environment AS discipline_environment, d.discipline_kind, ce.event_kind,
           cat.label AS category, COALESCE(rc.result_count, 0) AS result_count
    FROM competition_events ce
    JOIN disciplines d ON d.id = ce.discipline_id
    LEFT JOIN categories cat ON cat.id = ce.category_id
    LEFT JOIN result_counts rc ON rc.event_id = ce.id
    ORDER BY CAST(ce.external_event_code AS INTEGER), ce.id
  `).map((event) => ({
    ...event,
    gender: ({ Female: "Frauen", Male: "Männer", Mixed: "Mixed" })[event.gender] || event.gender,
    terms: normalize([event.event_name, event.source_title_raw, event.discipline, event.category,
      event.gender, ({ Female: "Frauen", Male: "Männer" })[event.gender],
      ...(disciplines.get(event.discipline_id) || []).map(({ alias }) => alias)].join(" ")),
  })), "competition_id");

  for (const competition of competitions) {
    const events = eventsByCompetition.get(competition.id) || [];
    competition.year = [competition.start_date, competition.edition_label, competition.name]
      .join(" ").match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
    competition.categories = new Set(events.flatMap(eventCategories));
    const formats = namedFormats([competition.name, competition.series].join(" "));
    formats.forEach((format) => competition.categories.add(format));
    if (!competition.categories.size) {
      environmentCategories(competition.environment).forEach((category) => competition.categories.add(category));
    }
    competition.resultCount = events.reduce((total, event) => total + event.result_count, 0);
    competition.eventCount = events.length;
  }
  competitionsById = new Map(competitions.map((competition) => [competition.id, competition]));
  for (const competition of competitions) {
    const visited = new Set([competition.id]);
    let parent = competitionsById.get(competition.parent_competition_id);
    while (parent && !visited.has(parent.id)) {
      competition.categories.forEach((category) => parent.categories.add(category));
      visited.add(parent.id);
      parent = competitionsById.get(parent.parent_competition_id);
    }
  }
  for (const competition of competitions) {
    competition.categoryLabel = competitionCategories.filter((category) => competition.categories.has(category)).join(" · ");
    competition.terms = normalize([competition.name, competition.edition_label, competition.year,
      competition.city, competition.country, competition.venue, competition.series, competition.categoryLabel].join(" "));
  }
}

function namedFormats(text) {
  return [
    ["SERC", /\b(?:serc|simulated emergency response)\b/i],
    ["IRB", /\b(?:irb|inflatable rescue boats?)\b/i],
    ["SpeedLifesaving", /\bspeed[\s-]*life[\s-]*saving\b/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
}

function eventCategories(event) {
  const formats = namedFormats([
    event.discipline_kind, event.event_kind, event.discipline, event.event_name, event.source_title_raw,
  ].join(" "));
  if (formats.length) return formats;

  // Some imports use a shared beach/open-water environment for both types of races.
  if (/\bbeach\b|\bmarch past\b/i.test(event.discipline)) return ["Beach"];
  if (/\bboard (?:race|relay|rescue)\b|\brescue tube rescue\b/i.test(event.discipline)) return ["Ocean"];
  return environmentCategories(event.discipline_environment);
}

function environmentCategories(environment) {
  const label = normalize(environment).replaceAll("_", " ");
  return [
    ["Ocean", /\b(?:ocean|open water)\b/],
    ["Beach", /\bbeach\b/],
    ["Pool", /\bpool\b/],
  ].filter(([, pattern]) => pattern.test(label)).map(([category]) => category);
}

function route() {
  const [path, params] = location.hash.split("?");
  const id = path.match(/^#\/wettkampf\/(\d+)\/?$/)?.[1];
  app.replaceChildren(id ? renderCompetition(competitionsById.get(Number(id)), new URLSearchParams(params)) : renderOverview());
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function renderOverview() {
  document.title = "Lifesaving Ergebnisarchiv";
  const page = element("div");
  const dashboard = element("section", "dashboard");
  const metrics = element("dl", "metrics");
  for (const [label, value] of [
    ["Wettkämpfe", stats.competitions], ["Disziplinen", stats.disciplines],
    ["Personen", stats.people], ["Clubs", stats.clubs],
    ["Austragungen", stats.events], ["Ergebnisse", stats.results],
  ]) {
    const metric = element("div", "metric");
    metric.append(element("dt", "", label), element("dd", "", number.format(value)));
    metrics.append(metric);
  }
  dashboard.append(element("h1", "", "Ergebnisarchiv"), metrics);
  const section = element("section");
  const { heading, count } = sectionHeading("Wettkämpfe");
  const list = element("div", "competition-list");
  const empty = element("p", "empty-state", "Keine Wettkämpfe gefunden.");
  const filters = createFilters("overview", overviewFilters, scopes, [
    ["year", "Jahr", options(competitions, "year").reverse()],
    ["country", "Land", options(competitions, "country")],
    ["category", "Kategorie", competitionCategories.map((category) => [category, category]), "Alles"],
    ["sort", "Sortierung", [["oldest", "Älteste zuerst"], ["name", "Name A–Z"]], "Neueste zuerst"],
  ], update);
  section.append(heading, filters, list, empty);
  page.append(dashboard, section);
  update();
  return page;

  function update() {
    const { q, scope, year, country, category, sort } = overviewFilters;
    const tokens = searchTokens(q);
    const rows = [];
    for (const competition of competitions) {
      if (year && year !== competition.year) continue;
      if (country && country !== (competition.country || "(unknown)")) continue;
      if (category && !competition.categories.has(category)) continue;
      let context = null;
      if (tokens.length) {
        const events = eventsByCompetition.get(competition.id) || [];
        if (scope === "competition" || scope === "all") {
          if (matches(competition.terms, tokens)) {
            rows.push({ competition, context });
            continue;
          }
          if (scope === "competition") continue;
        }
        if (scope === "discipline" || scope === "all") {
          if (events.some((event) => matches(event.terms, tokens))) context = scope;
        }
        if (!context && scope !== "discipline") {
          const people = searchParticipants(competition.id, scope, tokens);
          if (people.size) context = scope;
        }
        if (!context) continue;
      }
      rows.push({ competition, context });
    }
    rows.sort(({ competition: a }, { competition: b }) => {
      const nameOrder = collator.compare(a.name, b.name);
      if (sort === "name") return nameOrder;
      const dateOrder = (a.start_date || a.year).localeCompare(b.start_date || b.year);
      return (sort === "oldest" ? dateOrder : -dateOrder) || nameOrder;
    });
    list.replaceChildren(...rows.map(({ competition, context }) => competitionLink(competition, context, q)));
    count.textContent = `${number.format(rows.length)} / ${number.format(competitions.length)}`;
    empty.hidden = rows.length > 0;
  }
}

function competitionLink(competition, scope, q) {
  const link = element("a", "competition-row");
  const params = scope ? "?" + new URLSearchParams({ q, scope }).toString() : "";
  link.href = `#/wettkampf/${competition.id}${params}`;
  const name = element("span");
  name.append(element("strong", "", competition.name));
  const place = [dateLabel(competition), ...new Set([competition.city, competition.country].filter(Boolean)), competition.categoryLabel].filter(Boolean).join(" · ");
  if (place) name.append(element("small", "", place));
  link.append(name, element("span", "row-meta",
    `${number.format(competition.eventCount)} Austragungen · ${number.format(competition.resultCount)} Ergebnisse`),
  decorative("span", "chevron", "›"));
  return link;
}

function renderCompetition(competition, params) {
  const page = element("div");
  const back = element("a", "back-link", "← Wettkämpfe");
  back.href = "#/";
  page.append(back);
  if (!competition) {
    document.title = "Wettkampf nicht gefunden";
    page.append(element("h1", "", document.title));
    return page;
  }

  document.title = `${competition.name} · Lifesaving`;
  const header = element("header", "detail-header");
  const meta = [dateLabel(competition), ...new Set([competition.venue, competition.city, competition.country].filter(Boolean)), competition.categoryLabel].filter(Boolean);
  header.append(element("h1", "", competition.name));
  if (meta.length) header.append(element("p", "muted", meta.join(" · ")));
  const results = createEventsPanel(competition.id, params);
  const panels = [["Ergebnisse", results]];
  const standings = query(`
    SELECT standing_group, entity_name, rank_numeric, rank_text, points, events_count
    FROM overall_standings WHERE competition_id = ?
    ORDER BY standing_group COLLATE NOCASE, rank_numeric IS NULL, rank_numeric, entity_name
  `, [competition.id]);
  if (standings.length) {
    const panel = element("section");
    panel.append(element("h2", "sr-only", "Gesamtwertungen"));
    for (const [label, rows] of groupBy(standings, "standing_group")) {
      const group = element("div", "standing-group");
      if (label) group.append(element("h3", "", label));
      group.append(simpleTable(["Rang", "Name / Team", "Wertungen", "Punkte"], rows.map((row) => [
        rankLabel(row), row.entity_name, row.events_count, row.points == null ? null : decimal.format(row.points),
      ])));
      panel.append(group);
    }
    panels.push(["Gesamtwertungen", panel]);
  }
  const medals = query(`
    SELECT club_name, rank_numeric, rank_text, gold, silver, bronze FROM medal_table
    WHERE competition_id = ? ORDER BY rank_numeric IS NULL, rank_numeric, club_name
  `, [competition.id]);
  if (medals.length) {
    const panel = element("section");
    panel.append(element("h2", "sr-only", "Medaillenspiegel"), simpleTable(
      ["Rang", "Club", "Gold", "Silber", "Bronze"],
      medals.map((row) => [rankLabel(row), row.club_name, row.gold, row.silver, row.bronze]),
    ));
    panels.push(["Medaillen", panel]);
  }

  page.append(header);
  if (panels.length > 1) {
    const nav = element("nav", "detail-nav");
    nav.setAttribute("aria-label", "Wettkampfbereiche");
    const buttons = panels.map(([label, panel], index) => {
      panel.id = `wettkampf-bereich-${index}`;
      const button = element("button", "", label);
      button.setAttribute("aria-controls", panel.id);
      button.addEventListener("click", () => activate(index));
      nav.append(button);
      return button;
    });
    function activate(index) {
      panels.forEach(([, panel], i) => {
        panel.hidden = i !== index;
        buttons[i].setAttribute("aria-pressed", String(i === index));
      });
    }
    activate(0);
    page.append(nav);
  }
  page.append(...panels.map(([, panel]) => panel));
  return page;
}

function createEventsPanel(competitionId, params) {
  const events = eventsByCompetition.get(competitionId) || [];
  const eventScopes = scopes.filter(([value]) => value !== "competition");
  const requestedScope = params.get("scope");
  const filters = {
    q: params.get("q") || "",
    scope: eventScopes.some(([value]) => value === requestedScope) ? requestedScope : "all",
    category: "",
    gender: "",
  };
  const panel = element("section");
  const { heading, count } = sectionHeading("Disziplinen");
  const list = element("div", "event-list");
  const empty = element("p", "empty-state", "Keine Disziplinen gefunden.");
  const cards = new Map();
  panel.append(heading, createFilters("event", filters, eventScopes, [
    ["category", "Wertungsklasse", options(events, "category")],
    ["gender", "Geschlecht", options(events, "gender")],
  ], update), list, empty);
  update();
  return panel;

  function update() {
    const tokens = searchTokens(filters.q);
    const participants = tokens.length && filters.scope !== "discipline"
      ? searchParticipants(competitionId, filters.scope, tokens) : new Map();
    const visible = [];
    for (const event of events) {
      if (filters.category && filters.category !== (event.category || "(unknown)")) continue;
      if (filters.gender && filters.gender !== (event.gender || "(unknown)")) continue;
      const disciplineMatch = tokens.length && ["all", "discipline"].includes(filters.scope) &&
        matches(event.terms, tokens);
      const entries = participants.get(event.id);
      if (tokens.length && !disciplineMatch && !entries) continue;
      if (!cards.has(event.id)) cards.set(event.id, createEventCard(event));
      const card = cards.get(event.id);
      card.setMatches(disciplineMatch ? null : entries);
      visible.push(card.node);
    }
    list.replaceChildren(...visible);
    count.textContent = `${number.format(visible.length)} / ${number.format(events.length)}`;
    empty.hidden = visible.length > 0;
    list.classList.toggle("is-empty", !visible.length);
  }
}

function createEventCard(event) {
  const node = element("details", "event-card");
  const summary = element("summary");
  const title = element("span", "event-name");
  title.append(element("strong", "", event.source_title_raw || event.event_name));
  const meta = [event.category, event.gender].filter(Boolean).join(" · ");
  if (meta) title.append(element("small", "", meta));
  const count = element("span", "count");
  summary.append(title, count);
  const body = element("div", "event-body");
  node.append(summary, body);
  let results;
  let entryIds = null;
  let renderedIds;
  node.addEventListener("toggle", render);
  return {
    node,
    setMatches(ids) {
      entryIds = ids || null;
      count.textContent = entryIds ? `${number.format(entryIds.size)} Treffer` : `${number.format(event.result_count)} Erg.`;
      render();
    },
  };

  function render() {
    if (!node.open || renderedIds === entryIds) return;
    results ??= loadResults(event.id);
    const visible = entryIds ? results.filter((row) => entryIds.has(row.entry_id)) : results;
    body.replaceChildren(visible.length ? resultTable(visible) : element("p", "empty-state", "Keine Ergebnisse."));
    renderedIds = entryIds;
  }
}

function loadResults(eventId) {
  return query(`
    SELECT r.entry_id, r.rank_numeric, r.rank_text, r.lane, r.time_text, r.raw_value_text,
           r.points, r.status_code, r.disqualification_code, r.qualification_code, r.record_marker,
           r.remarks, e.display_name, COALESCE(ec.name, tc.name) AS club_name,
           ro.source_label AS round_label, ro.heat_no, e.team_id
    FROM rounds ro
    JOIN results r ON r.round_id = ro.id
    JOIN entries e ON e.id = r.entry_id AND e.event_id = ro.event_id
    LEFT JOIN clubs ec ON ec.id = e.club_id
    LEFT JOIN teams t ON t.id = e.team_id
    LEFT JOIN clubs tc ON tc.id = t.club_id
    WHERE ro.event_id = ?
    ORDER BY COALESCE(ro.sequence_no, 9999), COALESCE(ro.heat_no, 9999),
             r.rank_numeric IS NULL, r.rank_numeric, e.display_name COLLATE NOCASE
  `, [eventId]);
}

function resultTable(rows) {
  const { wrap, body } = createTable([
    ["Rang", "rank"], ["Name / Team", ""], ["Runde", "desktop-round"], ["Leistung", "performance"],
  ]);
  const members = getMemberNames();
  for (const result of rows) {
    const row = element("tr");
    const person = element("td");
    person.append(element("strong", "", result.display_name));
    if (result.club_name && result.club_name !== result.display_name) person.append(element("small", "", result.club_name));
    const names = getMemberLabels(members, result.entry_id, result.team_id);
    if (names.length) person.append(element("small", "", names.join(", ")));
    const roundText = [result.round_label, result.heat_no == null ? "" : `Lauf ${result.heat_no}`,
      result.lane == null ? "" : `Bahn ${result.lane}`].filter(Boolean).join(" · ");
    if (roundText) person.append(element("small", "mobile-round", roundText));
    const performance = result.time_text || (result.raw_value_text !== String(result.points ?? "") ? result.raw_value_text : "");
    const points = result.points == null ? "" : `${decimal.format(result.points)} Pkt.`;
    const score = element("td", "performance");
    score.append(element("strong", "", performance || points || "–"));
    if (performance && points) score.append(element("small", "", points));
    const status = [result.status_code === "FINISHED" ? "" : result.status_code,
      result.disqualification_code ? `DSQ ${result.disqualification_code}` : "",
      result.qualification_code, result.record_marker, result.remarks].filter(Boolean).join(" · ");
    if (status) score.append(element("small", "", status));
    row.append(element("td", "rank", rankLabel(result)), person,
      element("td", "desktop-round muted", roundText || "–"), score);
    body.append(row);
  }
  return wrap;
}

function getMemberNames() {
  if (memberNames) return memberNames;
  const tables = new Set(query("SELECT name FROM sqlite_master WHERE type = 'table'").map(({ name }) => name));
  const members = (table, key) => tables.has(table) ? groupBy(query(`
    SELECT m.${key} AS owner, a.display_name FROM ${table} m
    JOIN athletes a ON a.id = m.athlete_id
    ORDER BY m.member_order, m.id
  `), "owner") : new Map();
  memberNames = { entries: members("entry_members", "entry_id"), teams: members("team_members", "team_id") };
  return memberNames;
}

function getMemberLabels(members, entryId, teamId) {
  const rows = members.entries.get(entryId) || members.teams.get(teamId) || [];
  return [...new Set(rows.map(({ display_name }) => display_name))];
}

function searchParticipants(competitionId, scope, tokens) {
  if (!participantIndex) {
    const members = getMemberNames();
    const rows = query(`
      SELECT ce.competition_id, e.id, e.event_id, e.display_name, e.participant_type, e.team_id,
             a.display_name AS athlete, ec.name AS club, tc.name AS team_club
      FROM competition_events ce
      JOIN entries e ON e.event_id = ce.id
      LEFT JOIN athletes a ON a.id = e.athlete_id
      LEFT JOIN clubs ec ON ec.id = e.club_id
      LEFT JOIN teams t ON t.id = e.team_id
      LEFT JOIN clubs tc ON tc.id = t.club_id
      WHERE EXISTS (
        SELECT 1 FROM results r JOIN rounds ro ON ro.id = r.round_id
        WHERE r.entry_id = e.id AND ro.event_id = ce.id
      )
    `).map((entry) => ({
      competition: entry.competition_id,
      id: entry.id,
      event: entry.event_id,
      people: [entry.athlete, ...getMemberLabels(members, entry.id, entry.team_id),
        entry.participant_type !== "team" ? entry.display_name : ""].filter(Boolean).map(normalize),
      clubs: [entry.club, entry.team_club,
        entry.participant_type === "team" ? entry.display_name : ""].filter(Boolean).map(normalize),
    }));
    participantIndex = groupBy(rows, "competition");
  }
  const events = new Map();
  for (const entry of participantIndex.get(competitionId) || []) {
    const hasMatch = (name) => matches(name, tokens);
    const found = (scope !== "club" && entry.people.some(hasMatch)) ||
      (scope !== "person" && entry.clubs.some(hasMatch));
    if (!found) continue;
    if (!events.has(entry.event)) events.set(entry.event, new Set());
    events.get(entry.event).add(entry.id);
  }
  return events;
}

function createFilters(id, values, searchScopes, fields, update) {
  const form = element("form", id === "event" ? "filters detail-filters" : "filters");
  form.setAttribute("role", "search");
  form.setAttribute("aria-label", id === "event" ? "Wettkampf durchsuchen" : "Archiv durchsuchen");
  form.addEventListener("submit", (event) => event.preventDefault());
  const search = element("div", "search-controls");
  const input = element("input");
  input.type = "search";
  input.value = values.q;
  input.autocomplete = "off";
  input.placeholder = "Suchbegriff eingeben";
  search.append(field(`${id}-q`, "Suche", input));
  const controls = element("div", "filter-options");
  const selects = new Map();
  for (const [key, label, choices, first] of [["scope", "Suchfeld", searchScopes], ...fields]) {
    const select = element("select");
    for (const [value, name] of key === "scope" ? choices : [["", first || "Alle"], ...choices]) {
      const option = element("option", "", name);
      option.value = value;
      select.append(option);
    }
    select.value = values[key];
    selects.set(key, select);
    (key === "scope" ? search : controls).append(field(`${id}-${key}`, label, select));
    select.addEventListener("change", () => {
      values[key] = select.value;
      apply();
    });
  }
  const reset = element("button", "button", "Zurücksetzen");
  reset.type = "button";
  controls.append(reset);
  form.append(search, controls);
  let timer;
  function syncReset() {
    const active = values.q || values.scope !== "all" || fields.some(([key]) => values[key]);
    reset.setAttribute("aria-disabled", String(!active));
  }
  function apply() {
    clearTimeout(timer);
    if (!form.isConnected) return;
    values.q = input.value.trim();
    syncReset();
    update();
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 120);
  });
  reset.addEventListener("click", () => {
    if (reset.getAttribute("aria-disabled") === "true") return;
    input.value = "";
    for (const [key, select] of selects) {
      select.value = key === "scope" ? "all" : "";
      values[key] = select.value;
    }
    apply();
    input.focus();
  });
  syncReset();
  return form;
}

function field(id, text, input) {
  const wrap = element("div", "field");
  const label = element("label", "field-label", text);
  label.htmlFor = id;
  input.id = id;
  wrap.append(label, input);
  return wrap;
}

function options(rows, key) {
  const values = [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort(collator.compare);
  const choices = values.map((value) => [value, value]);
  if (key !== "year" && rows.some((row) => !row[key])) choices.push(["(unknown)", "Ohne Angabe"]);
  return choices;
}

function sectionHeading(title) {
  const heading = element("div", "section-heading");
  const count = element("span", "count");
  count.setAttribute("role", "status");
  heading.append(element("h2", "", title), count);
  return { heading, count };
}

function createTable(headers) {
  const wrap = element("div", "table-wrap");
  const table = element("table");
  const head = table.createTHead().insertRow();
  for (const [title, className] of headers) {
    const cell = element("th", className, title);
    cell.scope = "col";
    head.append(cell);
  }
  const body = table.createTBody();
  wrap.append(table);
  return { wrap, body };
}

function simpleTable(headers, rows) {
  const { wrap, body } = createTable(headers.map((title, index) => [title, index ? "" : "rank"]));
  for (const values of rows) {
    const row = body.insertRow();
    values.forEach((value, index) => row.append(element("td", index ? "" : "rank", value ?? "–")));
  }
  return wrap;
}

function rankLabel(row) {
  return row.rank_text || row.rank_numeric || "–";
}

function dateLabel(competition) {
  const format = (value) => value?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1");
  const start = format(competition.start_date);
  const end = format(competition.end_date);
  if (start && end && start !== end) return `${start}–${end}`;
  return start || end || competition.year;
}

function normalize(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase().replaceAll("ß", "ss");
}

function searchTokens(text) {
  return normalize(text).trim().split(/\s+/).filter(Boolean);
}

function matches(text, tokens) {
  return tokens.every((token) => text.includes(token));
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

function query(sql, params = []) {
  const statement = db.prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function decorative(tag, className, text) {
  const node = element(tag, className, text);
  node.setAttribute("aria-hidden", "true");
  return node;
}
