#!/usr/bin/env node
/**
 * prepare_data.js
 * Builds the small, chart-ready files in data/ from the raw public datasets.
 * Sources, licences, column definitions and caveats: data/README.md.
 *
 * Usage:  node scripts/prepare_data.js [--raw data/raw] [--out data]
 * Needs:  npm install   (xlsx and mapshaper)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RAW = path.resolve(option('raw', 'data/raw'));
const OUT = path.resolve(option('out', 'data'));
const MAPSHAPER = require.resolve('mapshaper/bin/mapshaper');

const SRC = {
  acara: path.join(RAW, 'acara', 'Student_attendance_dataset.xlsx'),
  abs42b: path.join(RAW, 'abs_schools', 't42b.xlsx'),
  abs46a: path.join(RAW, 'abs_schools', 't46a.xlsx'),
  nswAttendance: path.join(RAW, 'nsw', 'attendance_2011_2024.csv'),
  nswMaster: path.join(RAW, 'nsw', 'master_dataset.csv'),
  remoteness: path.join(RAW, 'asgs', 'RA_2021_AUST_GDA2020.shp'),
};

// ---------------------------------------------------------------------------
// Lookup tables: the same category is spelled differently in each source
// ---------------------------------------------------------------------------
const STATES = [
  { code: 1, name: 'New South Wales', abbr: 'NSW', abs: 'a NSW' },
  { code: 2, name: 'Victoria', abbr: 'Vic', abs: 'b Vic.' },
  { code: 3, name: 'Queensland', abbr: 'Qld', abs: 'c Qld' },
  { code: 4, name: 'South Australia', abbr: 'SA', abs: 'd SA' },
  { code: 5, name: 'Western Australia', abbr: 'WA', abs: 'e WA' },
  { code: 6, name: 'Tasmania', abbr: 'Tas', abs: 'f Tas.' },
  { code: 7, name: 'Northern Territory', abbr: 'NT', abs: 'g NT' },
  { code: 8, name: 'Australian Capital Territory', abbr: 'ACT', abs: 'h ACT' },
];
const AUSTRALIA = { name: 'Australia', abbr: 'Aust' };

const REMOTENESS = [
  { order: 1, label: 'Major Cities', acara: 'Major cities', abs: 'a Major City', asgs: 'Major Cities of Australia' },
  { order: 2, label: 'Inner Regional', acara: 'Inner regional', abs: 'b Inner Regional', asgs: 'Inner Regional Australia' },
  { order: 3, label: 'Outer Regional', acara: 'Outer regional', abs: 'c Outer Regional', asgs: 'Outer Regional Australia' },
  { order: 4, label: 'Remote', acara: 'Remote', abs: 'd Remote', asgs: 'Remote Australia' },
  { order: 5, label: 'Very Remote', acara: 'Very remote', abs: 'e Very Remote', asgs: 'Very Remote Australia' },
];

const SECTORS = [
  { label: 'Government', abs: 'a Government' },
  { label: 'Catholic', abs: 'b Catholic' },
  { label: 'Independent', abs: 'c Independent' },
];

// ABS grades counted in ACARA's "Years 1-10" (ACARA includes ungraded students in that total).
const ABS_GRADES_Y1_10 = new Set([
  'b Year 1', 'c Year 2', 'd Year 3', 'e Year 4', 'f Year 5', 'g Year 6', 'h Year 7 primary',
  'i Ungraded primary', 'j Year 7 secondary', 'k Year 8', 'l Year 9', 'm Year 10', 'p Ungraded secondary',
]);

const ICSEA_QUARTERS = [
  { order: 1, label: 'Lowest quarter', acara: '1st Quarter' },
  { order: 2, label: 'Second quarter', acara: '2nd Quarter' },
  { order: 3, label: 'Third quarter', acara: '3rd Quarter' },
  { order: 4, label: 'Highest quarter', acara: '4th Quarter' },
];

const ICSEA_BANDS = [
  { order: 1, label: 'Under 900', min: -Infinity, max: 900 },
  { order: 2, label: '900–949', min: 900, max: 950 },
  { order: 3, label: '950–999', min: 950, max: 1000 },
  { order: 4, label: '1000–1049', min: 1000, max: 1050 },
  { order: 5, label: '1050–1099', min: 1050, max: 1100 },
  { order: 6, label: '1100 and over', min: 1100, max: Infinity },
];

// Map extents: drops Lord Howe Island and the external territories.
const BBOX_AUSTRALIA = '112,-44.5,154.5,-9';
const BBOX_NSW = '140.9,-37.6,154,-28.1';
const NSW_MAX_LON = 154;

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const NOT_PUBLISHED = 2020; // ACARA did not publish 2020 attendance (COVID-19)

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const round = (x, dp = 1) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp);

/** Parses a published value; ACARA marks suppressed cells with "-". */
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "Missing out" (100 - attendance level) and "days missed" (100 - attendance rate). */
const complement = v => (v === null ? null : round(100 - v, 1));

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(f => f !== ''));
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] === undefined ? '' : r[i]])));
}

const outputs = [];

function writeCsv(file, columns, rows, description) {
  const cell = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, file), text, 'utf8');
  outputs.push({ file, rows: rows.length, description });
}

function mapshaper(...args) {
  execFileSync(process.execPath, [MAPSHAPER, '-quiet', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------
function loadAcara(file) {
  const sheet = XLSX.readFile(file).Sheets['Data'];
  if (!sheet) throw new Error('ACARA workbook: sheet "Data" not found');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  const key = (...parts) => parts.map(String).join('\u0001');
  const index = new Map();
  for (const r of rows) {
    const k = key(r['Calendar year'], r['State/Territory'], r['School Sector'], r['Disaggregation'], r['School Year Level']);
    if (index.has(k)) throw new Error(`ACARA: duplicate row for ${k.replace(/\u0001/g, ' | ')}`);
    index.set(k, r);
  }
  return {
    rowCount: rows.length,
    /** Returns {rate, level} or null when the combination does not exist. */
    get(year, state, sector, disaggregation, yearLevel = 'Years 1-10') {
      const r = index.get(key(year, state, sector, disaggregation, yearLevel));
      return r ? { rate: num(r['Attendance Rate']), level: num(r['Attendance Level']) } : null;
    },
  };
}

/** Reads the "Table 2 Data table" sheet of an ABS Schools data cube into objects. */
function loadAbsTable(file) {
  const sheet = XLSX.readFile(file).Sheets['Table 2 Data table'];
  if (!sheet) throw new Error(`${path.basename(file)}: sheet "Table 2 Data table" not found`);
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const h = grid.findIndex(r => r && r[0] === 'Year');
  const header = grid[h];
  return grid.slice(h + 1)
    .filter(r => r && /^\d{4}$/.test(String(r[0]))) // drops the footnote rows
    .map(r => Object.fromEntries(header.map((name, i) => [name, r[i]])));
}

// ---------------------------------------------------------------------------
// 1. Boundaries (mapshaper)
// ---------------------------------------------------------------------------
function buildBoundaries(tmp) {
  const abbrList = JSON.stringify(['', ...STATES.map(s => s.abbr)]);
  const nameByAbbr = JSON.stringify(Object.fromEntries(STATES.map(s => [s.abbr, s.name])));
  const raFull = path.join(tmp, 'remoteness_full.json');

  mapshaper('-i', SRC.remoteness,
    '-filter', '!this.isNull && +STE_CODE21 >= 1 && +STE_CODE21 <= 8',
    '-clip', `bbox=${BBOX_AUSTRALIA}`,
    '-each', `state_abbr = ${abbrList}[+STE_CODE21], ` +
      `remoteness = RA_NAME21.replace(' of Australia', '').replace(' Australia', ''), ` +
      `ra_order = (+RA_CODE21 % 10) + 1, key = state_abbr + '|' + remoteness, area_km2 = Math.round(AREASQKM21)`,
    '-filter-fields', 'key,state_abbr,remoteness,ra_order,area_km2',
    '-o', raFull, 'format=geojson');

  // State outlines are dissolved from the remoteness regions, so both layers share the same
  // arcs: borders line up exactly and simplify identically (no separate states shapefile needed).

  // Representative points inside each polygon: symbol positions for the proportional symbol map
  // and starting positions for the Dorling cartogram.
  const points = (name, ...commands) => {
    const out = path.join(tmp, `${name}_points.json`);
    mapshaper('-i', raFull, ...commands, '-points', 'inner', '-o', out, 'format=geojson');
    return JSON.parse(fs.readFileSync(out, 'utf8')).features;
  };
  const raPoints = points('remoteness');
  const statePoints = points('states', '-dissolve', 'state_abbr');

  mapshaper('-i', raFull,
    '-rename-layers', 'remoteness',
    '-filter-fields', 'key,state_abbr,remoteness,ra_order',
    '-dissolve', 'state_abbr', '+', 'name=states',
    '-each', `state = ${nameByAbbr}[state_abbr]`, 'target=states',
    '-simplify', 'weighted', '0.5%', 'keep-shapes',
    '-o', path.join(OUT, 'australia_2021.topojson'), 'format=topojson', 'quantization=1e5', 'target=*');
  outputs.push({ file: 'australia_2021.topojson', rows: null, description: 'Boundaries: objects "states" (8) and "remoteness" (33 state x remoteness regions)' });

  // NSW close-up: more detail, NSW only.
  mapshaper('-i', raFull,
    '-filter', "state_abbr === 'NSW'",
    '-clip', `bbox=${BBOX_NSW}`,
    '-rename-layers', 'remoteness',
    '-filter-fields', 'remoteness,ra_order',
    '-dissolve', '+', 'name=outline',
    '-simplify', 'weighted', '2%', 'keep-shapes',
    '-o', path.join(OUT, 'nsw_2021.topojson'), 'format=topojson', 'quantization=1e5', 'target=*');
  outputs.push({ file: 'nsw_2021.topojson', rows: null, description: 'NSW boundaries: objects "outline" and "remoteness"' });

  const regions = JSON.parse(fs.readFileSync(raFull, 'utf8')).features.map(f => f.properties);
  const pointOf = (features, prop, value) => {
    const f = features.find(p => p.properties[prop] === value);
    return f ? { lon: round(f.geometry.coordinates[0], 4), lat: round(f.geometry.coordinates[1], 4) } : { lon: null, lat: null };
  };
  return {
    regions: regions.map(r => ({ ...r, ...pointOf(raPoints, 'key', r.key) })),
    statePoint: abbr => pointOf(statePoints, 'state_abbr', abbr),
  };
}

// ---------------------------------------------------------------------------
// 2. Tables
// ---------------------------------------------------------------------------
function main() {
  for (const [name, file] of Object.entries(SRC)) {
    if (!fs.existsSync(file)) throw new Error(`Missing raw file (${name}): ${file}\nRun: bash scripts/download_raw.sh`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-geo-'));

  const acara = loadAcara(SRC.acara);
  const national = (year, disaggregation = 'All', yearLevel = 'Years 1-10', sector = 'All') =>
    acara.get(year, AUSTRALIA.name, sector, disaggregation, yearLevel);
  const withMeasures = v => ({
    attendance_rate: v ? v.rate : null,
    attendance_level: v ? v.level : null,
    missing_out: v ? complement(v.level) : null,
    days_missed: v ? complement(v.rate) : null,
  });

  const geo = buildBoundaries(tmp);

  // --- National trend (C1 ISOTYPE, C2) ---
  writeCsv('attendance_trend.csv',
    ['year', 'published', 'attendance_rate', 'attendance_level', 'missing_out', 'days_missed'],
    range(2014, 2025).map(year => year === NOT_PUBLISHED
      ? { year, published: false }
      : { year, published: true, ...withMeasures(national(year)) }),
    'Australia, all sectors, Years 1-10, 2014-2025 (2020 not published)');

  // --- Year level x year (C3 heatmap) ---
  writeCsv('attendance_yearlevel.csv',
    ['year', 'published', 'year_level', 'attendance_rate', 'attendance_level', 'missing_out'],
    range(2015, 2025).flatMap(year => range(1, 10).map(n => {
      if (year === NOT_PUBLISHED) return { year, published: false, year_level: n };
      const v = withMeasures(national(year, 'All', `Year ${n}`));
      return { year, published: true, year_level: n, attendance_rate: v.attendance_rate, attendance_level: v.attendance_level, missing_out: v.missing_out };
    })),
    'Australia, all sectors, Years 1 to 10 separately, 2015-2025');

  // --- States x year (C6 slope chart) ---
  writeCsv('attendance_states.csv',
    ['state', 'state_abbr', 'year', 'attendance_rate', 'attendance_level', 'missing_out'],
    [...STATES, AUSTRALIA].flatMap(s => range(2015, 2025).filter(y => y !== NOT_PUBLISHED).map(year => {
      const v = withMeasures(acara.get(year, s.name, 'All', 'All'));
      return { state: s.name, state_abbr: s.abbr, year, attendance_rate: v.attendance_rate, attendance_level: v.attendance_level, missing_out: v.missing_out };
    })),
    'States, territories and Australia, all sectors, Years 1-10, 2015-2025');

  // --- ABS student counts ---
  const abs46a = loadAbsTable(SRC.abs46a).filter(r => Number(r['Year']) === 2025);
  const students46a = (stateAbs, remotenessAbs, governmentOnly) => abs46a
    .filter(r => r['State/Territory'] === stateAbs && r['ASGS Remoteness Classification'] === remotenessAbs &&
      (!governmentOnly || r['Affiliation'] === 'a Government'))
    .reduce((sum, r) => sum + (num(r['Total Student Count (FTE)']) || 0), 0);

  const abs42b = loadAbsTable(SRC.abs42b);
  const fullTimeY1to10 = {};
  for (const r of abs42b) {
    const year = Number(r['Year']);
    if ((year !== 2019 && year !== 2025) || !ABS_GRADES_Y1_10.has(r['Year (Grade)'])) continue;
    const k = `${year}|${r['State/Territory']}|${r['Affiliation (Gov/Cath/Ind)']}`;
    fullTimeY1to10[k] = (fullTimeY1to10[k] || 0) + (num(r['Full-time Student count']) || 0);
  }

  // --- State x remoteness regions (C4 choropleth, C5 proportional symbols) ---
  const stateByAbbr = Object.fromEntries(STATES.map(s => [s.abbr, s]));
  const remotenessByLabel = Object.fromEntries(REMOTENESS.map(r => [r.label, r]));
  const regionRows = geo.regions
    .map(g => {
      const s = stateByAbbr[g.state_abbr], ra = remotenessByLabel[g.remoteness];
      const v19 = acara.get(2019, s.name, 'All', ra.acara), v25 = acara.get(2025, s.name, 'All', ra.acara);
      return {
        key: g.key, state: s.name, state_abbr: s.abbr, remoteness: ra.label, ra_order: ra.order,
        attendance_rate_2019: v19 ? v19.rate : null, attendance_level_2019: v19 ? v19.level : null,
        missing_out_2019: v19 ? complement(v19.level) : null,
        attendance_rate_2025: v25 ? v25.rate : null, attendance_level_2025: v25 ? v25.level : null,
        missing_out_2025: v25 ? complement(v25.level) : null,
        // FTE keeps ABS's one decimal so regional values add up exactly to published totals.
        students_fte_2025: round(students46a(s.abs, ra.abs, false), 1),
        students_fte_gov_2025: round(students46a(s.abs, ra.abs, true), 1),
        area_km2: g.area_km2, lon: g.lon, lat: g.lat,
      };
    })
    .sort((a, b) => STATES.findIndex(s => s.abbr === a.state_abbr) - STATES.findIndex(s => s.abbr === b.state_abbr) || a.ra_order - b.ra_order);
  writeCsv('attendance_regions.csv',
    ['key', 'state', 'state_abbr', 'remoteness', 'ra_order',
      'attendance_rate_2019', 'attendance_level_2019', 'missing_out_2019',
      'attendance_rate_2025', 'attendance_level_2025', 'missing_out_2025',
      'students_fte_2025', 'students_fte_gov_2025', 'area_km2', 'lon', 'lat'],
    regionRows,
    '33 state x remoteness regions: ACARA attendance (2019, 2025), ABS FTE students (2025), area and symbol position');

  // --- Aboriginal and Torres Strait Islander students (C7, C8) ---
  const indigenousRemoteness = REMOTENESS.flatMap(ra => {
    const gap = national(2025, `Gap in ${ra.acara}`);
    return [
      ['Aboriginal and Torres Strait Islander students', `Aboriginal and Torres Strait Islanders in ${ra.acara}`],
      ['Non-Indigenous students', `Non-Indigenous people in ${ra.acara}`],
    ].map(([status, dis]) => ({
      remoteness: ra.label, ra_order: ra.order, status, ...withMeasures(national(2025, dis)),
      gap_attendance_level: gap ? gap.level : null, gap_attendance_rate: gap ? gap.rate : null,
    }));
  });
  writeCsv('attendance_indigenous_remoteness.csv',
    ['remoteness', 'ra_order', 'status', 'attendance_rate', 'attendance_level', 'missing_out', 'gap_attendance_level', 'gap_attendance_rate'],
    indigenousRemoteness.map(r => { const { days_missed, ...rest } = r; return rest; }),
    'Australia 2025, all sectors, Years 1-10, by remoteness and Indigenous status (ACARA gap values attached)');

  writeCsv('attendance_indigenous_trend.csv',
    ['year', 'status', 'attendance_rate', 'attendance_level', 'missing_out'],
    range(2014, 2025).filter(y => y !== NOT_PUBLISHED).flatMap(year => [
      ['Aboriginal and Torres Strait Islander students', 'Aboriginal and Torres Strait Islander'],
      ['Non-Indigenous students', 'Non-Indigenous'],
      ['Gap (points)', 'Gap'],
    ].map(([status, dis]) => {
      const v = national(year, dis);
      return { year, status, attendance_rate: v ? v.rate : null, attendance_level: v ? v.level : null,
        missing_out: v && dis !== 'Gap' ? complement(v.level) : null };
    })),
    'Australia, all sectors, Years 1-10, by Indigenous status, 2014-2025 (level from 2015; gap rows are ACARA gap values)');

  // --- Socio-educational advantage x sector (C9) ---
  const sectorsAll = [...SECTORS.map(s => s.label), 'All'];
  writeCsv('attendance_icsea_sector.csv',
    ['group', 'group_order', 'sector', 'attendance_rate', 'attendance_level', 'missing_out'],
    [{ order: 0, label: 'All schools', acara: 'All' }, ...ICSEA_QUARTERS].flatMap(q => sectorsAll.map(sector => {
      const v = withMeasures(national(2025, q.acara, 'Years 1-10', sector));
      return { group: q.label, group_order: q.order, sector: sector === 'All' ? 'All sectors' : sector,
        attendance_rate: v.attendance_rate, attendance_level: v.attendance_level, missing_out: v.missing_out };
    })),
    'Australia 2025, Years 1-10: all schools and ICSEA quarters, by sector');

  // --- Factor ladder (C14): all values computed from ACARA, nothing typed in ---
  const pair = (factor, a, va, b, vb, note = '') => ({
    factor,
    higher_group: a, higher_missing_out: complement(va.level), higher_attendance_rate: va.rate,
    lower_group: b, lower_missing_out: complement(vb.level), lower_attendance_rate: vb.rate,
    difference: round(complement(va.level) - complement(vb.level), 1), note,
  });
  const factors = [
    pair('Where you live', 'Very remote', national(2025, 'Very remote'), 'Major cities', national(2025, 'Major cities')),
    pair("School community's advantage", 'Lowest ICSEA quarter', national(2025, '1st Quarter'), 'Highest ICSEA quarter', national(2025, '4th Quarter')),
    pair('Aboriginal and Torres Strait Islander status', 'Aboriginal and Torres Strait Islander students', national(2025, 'Aboriginal and Torres Strait Islander'), 'Non-Indigenous students', national(2025, 'Non-Indigenous')),
    pair('School sector', 'Government', national(2025, 'All', 'Years 1-10', 'Government'), 'Independent', national(2025, 'All', 'Years 1-10', 'Independent'), 'Mostly reflects advantage (compare within ICSEA quarters)'),
    pair('Stage of school', 'Years 7-10', national(2025, 'All', 'Years 7-10'), 'Years 1-6', national(2025, 'All', 'Years 1-6')),
    pair('Since COVID-19', '2025', national(2025), '2019', national(2019)),
    pair('Sex', 'Boys', national(2025, 'Male'), 'Girls', national(2025, 'Female')),
  ].sort((a, b) => b.difference - a.difference);
  writeCsv('factors_2025.csv',
    ['factor', 'higher_group', 'higher_missing_out', 'higher_attendance_rate', 'lower_group', 'lower_missing_out', 'lower_attendance_rate', 'difference', 'note'],
    factors, 'Differences in the share of students missing out, 2025 (2019 for the time comparison)');

  // --- Estimated students missing out (C13 treemap, C16 Dorling cartogram) ---
  const estimateRows = [2019, 2025].flatMap(year => STATES.flatMap(s => SECTORS.map(sec => {
    const students = fullTimeY1to10[`${year}|${s.abs}|${sec.abs}`] || 0;
    const v = acara.get(year, s.name, sec.label, 'All');
    return { year, state: s.name, state_abbr: s.abbr, sector: sec.label,
      ft_students_y1_10: students, attendance_level: v ? v.level : null,
      est_missing_out: v && v.level !== null ? Math.round(students * (100 - v.level) / 100) : null };
  })));
  writeCsv('missing_out_state_sector.csv',
    ['year', 'state', 'state_abbr', 'sector', 'ft_students_y1_10', 'attendance_level', 'est_missing_out'],
    estimateRows, 'Estimate = ABS full-time Years 1-10 students x (100 - ACARA attendance level) / 100, by state and sector');

  writeCsv('states_summary.csv',
    ['state', 'state_abbr', 'lon', 'lat', 'ft_students_y1_10_2019', 'est_missing_out_2019', 'missing_out_2019',
      'ft_students_y1_10_2025', 'est_missing_out_2025', 'missing_out_2025'],
    STATES.map(s => {
      const sum = (year, field) => estimateRows.filter(r => r.year === year && r.state_abbr === s.abbr).reduce((t, r) => t + (r[field] || 0), 0);
      const v19 = acara.get(2019, s.name, 'All', 'All'), v25 = acara.get(2025, s.name, 'All', 'All');
      return { state: s.name, state_abbr: s.abbr, ...geo.statePoint(s.abbr),
        ft_students_y1_10_2019: sum(2019, 'ft_students_y1_10'), est_missing_out_2019: sum(2019, 'est_missing_out'), missing_out_2019: complement(v19.level),
        ft_students_y1_10_2025: sum(2025, 'ft_students_y1_10'), est_missing_out_2025: sum(2025, 'est_missing_out'), missing_out_2025: complement(v25.level) };
    }),
    'One row per state: symbol position, estimated students missing out (sum of sector estimates), ACARA share');

  // --- NSW public schools (C10 dot map, C11 histogram, C12 box plot, C15 bin map) ---
  const nswMaster = new Map(parseCsv(fs.readFileSync(SRC.nswMaster, 'utf8')).map(r => [String(r['School_code']).trim(), r]));
  const nswRemoteness = Object.fromEntries(REMOTENESS.map(r => [r.asgs, r]));
  const excluded = { notInMaster: 0, noCoordinates: 0, noAttendance: 0 };
  const schools = [];
  for (const a of parseCsv(fs.readFileSync(SRC.nswAttendance, 'utf8'))) {
    const code = String(a['school_code']).trim();
    const m = nswMaster.get(code);
    if (!m) { excluded.notInMaster++; continue; }
    const lat = num(m['Latitude']), lon = num(m['Longitude']);
    if (lat === null || lon === null) { excluded.noCoordinates++; continue; }
    const att2022 = num(a['2022']), att2024 = num(a['2024']);
    if (att2022 === null && att2024 === null) { excluded.noAttendance++; continue; }
    const icsea = num(m['ICSEA_value']);
    const band = icsea === null ? null : ICSEA_BANDS.find(b => icsea >= b.min && icsea < b.max);
    const ra = nswRemoteness[String(m['ASGS_remoteness']).trim()];
    schools.push({
      school_code: code, lat: round(lat, 4), lon: round(lon, 4), in_map_extent: lon <= NSW_MAX_LON,
      level_of_schooling: String(m['Level_of_schooling']).trim().replace(/ Schools?$/, '').replace('Schools for Specific Purposes', 'Specific purposes'),
      remoteness: ra ? ra.label : null, ra_order: ra ? ra.order : null,
      icsea, icsea_band: band ? band.label : null, icsea_band_order: band ? band.order : null,
      fte: round(num(m['latest_year_enrolment_FTE']), 0),
      attendance_2022: att2022, attendance_2024: att2024, days_missed_2024: complement(att2024),
    });
  }
  writeCsv('nsw_schools.csv',
    ['school_code', 'lat', 'lon', 'in_map_extent', 'level_of_schooling', 'remoteness', 'ra_order',
      'icsea', 'icsea_band', 'icsea_band_order', 'fte', 'attendance_2022', 'attendance_2024', 'days_missed_2024'],
    schools, 'NSW public schools with 2022 and/or 2024 attendance, joined to location and ICSEA (no school names)');

  // --- Manifest: sizes, row counts and raw-file checksums ---
  for (const o of outputs) o.bytes = fs.statSync(path.join(OUT, o.file)).size;
  const manifest = {
    generated: new Date().toISOString(),
    script: 'scripts/prepare_data.js',
    acara_rows_read: acara.rowCount,
    nsw_schools_excluded: excluded,
    total_bytes: outputs.reduce((t, o) => t + o.bytes, 0),
    outputs,
    raw_sources: Object.entries(SRC).map(([id, file]) => ({ id, file: path.relative(RAW, file).replace(/\\/g, '/'), bytes: fs.statSync(file).size, sha256: sha256(file) })),
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`Wrote ${outputs.length} files to ${OUT} (${(manifest.total_bytes / 1024).toFixed(0)} KB total)`);
  for (const o of outputs) console.log(`  ${o.file.padEnd(38)} ${String(o.rows ?? '-').padStart(5)} rows  ${(o.bytes / 1024).toFixed(1).padStart(6)} KB`);
  console.log('NSW schools excluded:', JSON.stringify(excluded));
}

main();
