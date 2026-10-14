#!/usr/bin/env node
/**
 * check_data.js
 * Recomputes the headline numbers used in the page's annotations from the published files in
 * data/ (not from the raw sources) and compares them with the reference values quoted in the
 * text. Prints a Markdown table; exits with code 1 if anything differs.
 *
 * Usage: node scripts/check_data.js [--data data]
 * No dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const i = argv.indexOf('--data');
const DATA = path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : 'data');

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (quoted) {
      if (c === '"' && text[k + 1] === '"') { field += '"'; k++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[k + 1] === '\n') k++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(f => f !== ''));
  const typed = v => (v === '' ? null : v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v);
  return body.map(r => Object.fromEntries(header.map((h, j) => [h, typed(r[j] === undefined ? '' : r[j])])));
}
const csv = file => parseCsv(fs.readFileSync(path.join(DATA, file), 'utf8'));

const trend = csv('attendance_trend.csv');
const yearLevel = csv('attendance_yearlevel.csv');
const states = csv('attendance_states.csv');
const regions = csv('attendance_regions.csv');
const indRemote = csv('attendance_indigenous_remoteness.csv');
const indTrend = csv('attendance_indigenous_trend.csv');
const icsea = csv('attendance_icsea_sector.csv');
const factors = csv('factors_2025.csv');
const estimates = csv('missing_out_state_sector.csv');
const summary = csv('states_summary.csv');
const nsw = csv('nsw_schools.csv');
const topo = JSON.parse(fs.readFileSync(path.join(DATA, 'australia_2021.topojson'), 'utf8'));

// ---------------------------------------------------------------------------
// Statistics (same definitions the charts use: Vega's median and quantiles)
// ---------------------------------------------------------------------------
const sum = a => a.reduce((t, v) => t + v, 0);
const sorted = a => [...a].sort((x, y) => x - y);
/** Quantile with linear interpolation (R-7, as d3.quantile / Vega). */
function quantile(values, p) {
  const s = sorted(values), h = (s.length - 1) * p, lo = Math.floor(h);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (h - lo);
}
const median = a => quantile(a, 0.5);
const r1 = x => Math.round(x * 10) / 10;
const pct = (part, whole) => (100 * part) / whole;

// ---------------------------------------------------------------------------
// Checks: reference value (as quoted in the plan text) vs value recomputed from data/
// ---------------------------------------------------------------------------
const results = [];
/**
 * @param tol  allowed absolute difference (the quoted value's own rounding)
 */
function check(section, item, reference, computed, tol = 0.0001, display) {
  const ok = computed !== null && computed !== undefined && Math.abs(reference - computed) <= tol;
  results.push({ section, item, reference, computed, ok, display });
}
const fmt = v => (v === null || v === undefined || Number.isNaN(v) ? 'n/a'
  : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-AU') : String(r1(v)));

const at = (rows, where) => rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v));

// National trend
const T = y => at(trend, { year: y });
const planRate = { 2014: 92.7, 2015: 92.6, 2016: 92.5, 2017: 92.4, 2018: 91.9, 2019: 91.4, 2021: 90.9, 2022: 86.5, 2023: 88.6, 2024: 88.3, 2025: 88.8 };
const planLevel = { 2015: 77.8, 2016: 77.7, 2017: 77.1, 2018: 75.2, 2019: 73.1, 2021: 71.2, 2022: 49.9, 2023: 61.6, 2024: 59.8, 2025: 62.1 };
const planMissing = { 2015: 22.2, 2016: 22.3, 2017: 22.9, 2018: 24.8, 2019: 26.9, 2021: 28.8, 2022: 50.1, 2023: 38.4, 2024: 40.2, 2025: 37.9 };
for (const [y, v] of Object.entries(planRate)) check('National trend', `Attendance rate ${y}`, v, T(+y).attendance_rate);
for (const [y, v] of Object.entries(planLevel)) check('National trend', `Attendance level ${y}`, v, T(+y).attendance_level);
for (const [y, v] of Object.entries(planMissing)) check('National trend', `Missing out ${y}`, v, T(+y).missing_out);
check('National trend', '2020 marked as not published', 1, T(2020).published === false ? 1 : 0, 0, ['yes', T(2020).published === false ? 'yes' : 'no']);
check('National trend', 'Days missed 2025', 11.2, T(2025).days_missed);
for (const [y, n] of [[2019, 27], [2022, 50], [2025, 38]]) check('National trend', `ISOTYPE icons out of 100, ${y}`, n, Math.round(T(y).missing_out), 0);

// Year level
const YL = (y, n) => at(yearLevel, { year: y, year_level: n }).missing_out;
[32.4, 32.2, 31.5, 32.9, 33.6, 36.0, 35.5, 45.2, 48.6, 49.8].forEach((v, k) => check('Year level (2025, missing out)', `Year ${k + 1}`, v, YL(2025, k + 1)));
for (const [y, a, b] of [[2015, 20.0, 24.7], [2019, 24.6, 31.8], [2022, 47.3, 55.5]]) {
  check('Year level (2025, missing out)', `Year 7 in ${y}`, a, YL(y, 7));
  check('Year level (2025, missing out)', `Year 8 in ${y}`, b, YL(y, 8));
}
const ylValues = yearLevel.filter(r => r.missing_out !== null).map(r => r.missing_out);
check('Year level (2025, missing out)', 'Heatmap minimum (2016, Year 3)', 18.6, Math.min(...ylValues));
check('Year level (2025, missing out)', 'Heatmap maximum (2022, Year 10)', 58.4, Math.max(...ylValues));
const stage = at(factors, { factor: 'Stage of school' });
check('Year level (2025, missing out)', 'Attendance rate, Years 1-6', 90.4, stage.lower_attendance_rate);
check('Year level (2025, missing out)', 'Attendance rate, Years 7-10', 86.5, stage.higher_attendance_rate);

// States
const ST = (abbr, y) => at(states, { state_abbr: abbr, year: y }).missing_out;
const planStates = { NSW: [25.1, 35.8, 10.7], Vic: [25.6, 40.0, 14.4], Qld: [28.7, 38.6, 9.9], SA: [27.5, 36.3, 8.8], WA: [27.9, 36.7, 8.8], Tas: [28.6, 41.6, 13.0], NT: [50.0, 55.1, 5.1], ACT: [29.5, 37.0, 7.5], Aust: [26.9, 37.9, 11.0] };
for (const [abbr, [a, b, c]] of Object.entries(planStates)) {
  check('States (missing out)', `${abbr} 2019`, a, ST(abbr, 2019));
  check('States (missing out)', `${abbr} 2025`, b, ST(abbr, 2025));
  check('States (missing out)', `${abbr} change`, c, r1(ST(abbr, 2025) - ST(abbr, 2019)));
}
const changes = Object.keys(planStates).filter(s => s !== 'Aust').map(s => [s, r1(ST(s, 2025) - ST(s, 2019))]).sort((x, y) => y[1] - x[1]);
check('States (missing out)', 'Largest rises are Vic then Tas', 1, changes[0][0] === 'Vic' && changes[1][0] === 'Tas' ? 1 : 0, 0, ['Vic, Tas', `${changes[0][0]}, ${changes[1][0]}`]);

// Remoteness and regions
const nationalRA = ['Major cities', 'Inner regional', 'Outer regional', 'Remote', 'Very remote'];
const remoteFactor = at(factors, { factor: 'Where you live' });
check('Remoteness and regions', 'Major cities 2025', 35.2, remoteFactor.lower_missing_out);
check('Remoteness and regions', 'Very remote 2025', 74.7, remoteFactor.higher_missing_out);
const mo = (abbr, ra) => at(regions, { state_abbr: abbr, remoteness: ra });
check('Remoteness and regions', 'NT very remote (highest region)', 87.2, mo('NT', 'Very Remote').missing_out_2025);
check('Remoteness and regions', 'NT very remote attendance level', 12.8, mo('NT', 'Very Remote').attendance_level_2025);
const withValues = regions.filter(r => r.missing_out_2025 !== null);
const lowest = withValues.reduce((m, r) => (r.missing_out_2025 < m.missing_out_2025 ? r : m));
check('Remoteness and regions', 'Lowest region (NSW major cities)', 32.9, lowest.missing_out_2025, 0.0001, ['32.9 (NSW|Major Cities)', `${lowest.missing_out_2025} (${lowest.key})`]);
check('Remoteness and regions', 'Highest region value', 87.2, Math.max(...withValues.map(r => r.missing_out_2025)));
check('Remoteness and regions', 'Regions with a 2025 value', 32, withValues.length, 0);
const rose = regions.filter(r => r.missing_out_2019 !== null && r.missing_out_2025 !== null && r.missing_out_2025 > r.missing_out_2019).length;
check('Remoteness and regions', 'Regions where missing out rose 2019-2025', 32, rose, 0);
check('Remoteness and regions', 'Boundary polygons (remoteness object)', 33, topo.objects.remoteness.geometries.length, 0);
const actInner = mo('ACT', 'Inner Regional');
check('Remoteness and regions', 'ACT inner regional: no attendance value', 1, actInner.missing_out_2025 === null ? 1 : 0, 0, ['no value', actInner.missing_out_2025 === null ? 'no value' : String(actInner.missing_out_2025)]);
check('Remoteness and regions', 'ACT inner regional FTE students', 60, actInner.students_fte_2025, 0);

// ABS students and land area by remoteness
const byRA = label => regions.filter(r => r.remoteness === label);
const totalFte = sum(regions.map(r => r.students_fte_2025));
check('Students and land (ABS)', 'Total FTE students 2025', 4155025, totalFte, 1);
const raLabels = ['Major Cities', 'Inner Regional', 'Outer Regional', 'Remote', 'Very Remote'];
[73.6, 17.1, 7.5, 1.1, 0.7].forEach((v, k) => check('Students and land (ABS)', `Share of students: ${raLabels[k]}`, v, r1(pct(sum(byRA(raLabels[k]).map(r => r.students_fte_2025)), totalFte))));
[62, 62, 69, 76, 88].forEach((v, k) => {
  const rs = byRA(raLabels[k]);
  check('Students and land (ABS)', `Government share: ${raLabels[k]}`, v, Math.round(pct(sum(rs.map(r => r.students_fte_gov_2025)), sum(rs.map(r => r.students_fte_2025)))), 0);
});
const totalArea = sum(regions.map(r => r.area_km2));
const areaShare = labels => pct(sum(regions.filter(r => labels.includes(r.remoteness)).map(r => r.area_km2)), totalArea);
check('Students and land (ABS)', 'Land share: very remote (about)', 74, Math.round(areaShare(['Very Remote'])), 0);
check('Students and land (ABS)', 'Land share: remote (about)', 12, Math.round(areaShare(['Remote'])), 0);
check('Students and land (ABS)', 'Land share: remote + very remote (about)', 86, Math.round(areaShare(['Remote', 'Very Remote'])), 0);
check('Students and land (ABS)', 'Student share: remote + very remote', 1.7, r1(pct(sum([...byRA('Remote'), ...byRA('Very Remote')].map(r => r.students_fte_2025)), totalFte)));
check('Students and land (ABS)', 'Remote + very remote FTE students', 72597, sum([...byRA('Remote'), ...byRA('Very Remote')].map(r => r.students_fte_2025)), 1);
check('Students and land (ABS)', "NSW major cities students (about 970,000)", 970000, mo('NSW', 'Major Cities').students_fte_2025, 500);

// Aboriginal and Torres Strait Islander students
const ATSI = 'Aboriginal and Torres Strait Islander students', NONI = 'Non-Indigenous students';
const indFactor = at(factors, { factor: 'Aboriginal and Torres Strait Islander status' });
check('Aboriginal and Torres Strait Islander students', 'Missing out 2025', 63.2, indFactor.higher_missing_out);
check('Aboriginal and Torres Strait Islander students', 'Non-Indigenous missing out 2025', 36.0, indFactor.lower_missing_out);
check('Aboriginal and Torres Strait Islander students', 'Attendance rate 2025', 77.2, indFactor.higher_attendance_rate);
check('Aboriginal and Torres Strait Islander students', 'Non-Indigenous attendance rate 2025', 89.7, indFactor.lower_attendance_rate);
const gapRow = y => at(indTrend, { year: y, status: 'Gap (points)' });
check('Aboriginal and Torres Strait Islander students', 'Level gap 2025 (ACARA)', 27.2, gapRow(2025).attendance_level);
check('Aboriginal and Torres Strait Islander students', 'Rate gap 2025 (ACARA)', 12.4, gapRow(2025).attendance_rate);
const planInd = { 'Major Cities': [59.3, 34.2, 25.1], 'Inner Regional': [59.7, 41.8, 18.0], 'Outer Regional': [64.5, 40.7, 23.7], Remote: [75.9, 41.1, 34.8], 'Very Remote': [88.0, 48.3, 39.7] };
for (const [ra, [a, b, g]] of Object.entries(planInd)) {
  const ar = at(indRemote, { remoteness: ra, status: ATSI }), nr = at(indRemote, { remoteness: ra, status: NONI });
  check('Aboriginal and Torres Strait Islander students', `${ra}: Aboriginal and Torres Strait Islander`, a, ar.missing_out);
  check('Aboriginal and Torres Strait Islander students', `${ra}: non-Indigenous`, b, nr.missing_out);
  check('Aboriginal and Torres Strait Islander students', `${ra}: gap (ACARA level gap)`, g, ar.gap_attendance_level);
}
check('Aboriginal and Torres Strait Islander students', 'Rate gap, major cities', 9.8, at(indRemote, { remoteness: 'Major Cities', status: ATSI }).gap_attendance_rate);
check('Aboriginal and Torres Strait Islander students', 'Rate gap, very remote', 32.7, at(indRemote, { remoteness: 'Very Remote', status: ATSI }).gap_attendance_rate);
const IT = (y, s) => at(indTrend, { year: y, status: s });
check('Aboriginal and Torres Strait Islander students', 'Missing out 2015', 50.8, IT(2015, ATSI).missing_out);
check('Aboriginal and Torres Strait Islander students', 'Non-Indigenous missing out 2015', 20.7, IT(2015, NONI).missing_out);
check('Aboriginal and Torres Strait Islander students', 'Missing-out gap 2015', 30.1, r1(IT(2015, ATSI).missing_out - IT(2015, NONI).missing_out));
check('Aboriginal and Torres Strait Islander students', 'Missing-out gap 2025', 27.2, r1(IT(2025, ATSI).missing_out - IT(2025, NONI).missing_out));
check('Aboriginal and Torres Strait Islander students', 'Rate gap 2015 (ACARA)', 9.4, gapRow(2015).attendance_rate);
check('Aboriginal and Torres Strait Islander students', 'Rate gap widened 2015-2025', 3.0, r1(gapRow(2025).attendance_rate - gapRow(2015).attendance_rate));

// Advantage (ICSEA quarters) and sector
const planIcsea = {
  'All schools': [41.7, 33.4, 28.9, 37.9], 'Lowest quarter': [54.3, 57.8, 64.5, 54.6], 'Second quarter': [46.2, 38.0, 41.3, 45.1],
  'Third quarter': [39.6, 35.7, 34.0, 37.6], 'Highest quarter': [28.1, 28.5, 25.1, 27.2],
};
const sectorNames = ['Government', 'Catholic', 'Independent', 'All sectors'];
for (const [group, values] of Object.entries(planIcsea)) {
  values.forEach((v, k) => check('Advantage and sector (missing out)', `${group}: ${sectorNames[k]}`, v, at(icsea, { group, sector: sectorNames[k] }).missing_out));
}
[82.2, 76.7, 75.4].forEach((v, k) => check('Advantage and sector (missing out)', `Lowest quarter attendance rate: ${sectorNames[k]}`, v, at(icsea, { group: 'Lowest quarter', sector: sectorNames[k] }).attendance_rate));
const sex = at(factors, { factor: 'Sex' });
check('Advantage and sector (missing out)', 'Boys missing out', 38.4, sex.higher_missing_out);
check('Advantage and sector (missing out)', 'Girls missing out', 37.4, sex.lower_missing_out);
check('Advantage and sector (missing out)', 'Boys attendance rate', 88.7, sex.higher_attendance_rate);
check('Advantage and sector (missing out)', 'Girls attendance rate', 88.9, sex.lower_attendance_rate);

// Estimated students missing out (ABS x ACARA)
const E25 = estimates.filter(r => r.year === 2025);
const ft25 = sum(E25.map(r => r.ft_students_y1_10)), est25 = sum(E25.map(r => r.est_missing_out));
check('Estimated students missing out', 'Full-time Years 1-10 students 2025', 3280974, ft25, 0);
check('Estimated students missing out', 'Estimated missing out 2025', 1242453, est25, 0);
check('Estimated students missing out', 'About 1.24 million', 1.24, Math.round(est25 / 1e4) / 100, 0);
check('Estimated students missing out', 'Share of students', 37.9, r1(pct(est25, ft25)));
const byState = abbr => sum(E25.filter(r => r.state_abbr === abbr).map(r => r.est_missing_out));
for (const [abbr, k] of Object.entries({ NSW: 359, Vic: 333, Qld: 269, WA: 135, SA: 79, Tas: 26, ACT: 23, NT: 18 })) {
  check('Estimated students missing out', `${abbr} (thousands)`, k * 1000, byState(abbr), 500);
}
check('Estimated students missing out', 'NSW + Vic + Qld share (%)', 77, Math.round(pct(byState('NSW') + byState('Vic') + byState('Qld'), est25)), 0);
const bySector = s => sum(E25.filter(r => r.sector === s).map(r => r.est_missing_out));
check('Estimated students missing out', 'Government (thousands)', 866000, bySector('Government'), 500);
check('Estimated students missing out', 'Catholic (thousands)', 217000, bySector('Catholic'), 500);
check('Estimated students missing out', 'Independent (thousands)', 160000, bySector('Independent'), 500);
check('Estimated students missing out', 'Government share, 7 in 10 (%)', 70, Math.round(pct(bySector('Government'), est25)), 0);
check('Estimated students missing out', 'states_summary.csv agrees with state x sector file', est25, sum(summary.map(r => r.est_missing_out_2025)), 0);
const govStudents = sum(E25.filter(r => r.sector === 'Government').map(r => r.ft_students_y1_10));
check('Estimated students missing out', 'Government full-time Years 1-10 students', 2077841, govStudents, 0);
check('Estimated students missing out', "Government share of students (%)", 63, Math.round(pct(govStudents, ft25)), 0);
const E19 = estimates.filter(r => r.year === 2019);
const est19 = sum(E19.map(r => r.est_missing_out));
check('Estimated students missing out', 'Full-time Years 1-10 students 2019', 3140140, sum(E19.map(r => r.ft_students_y1_10)), 0);
check('Estimated students missing out', 'Estimated missing out 2019 (about 843,000)', 843000, est19, 500);
check('Estimated students missing out', 'Increase 2019 to 2025 (about 400,000)', 400000, est25 - est19, 500);
check('Estimated students missing out', 'Increase 2019 to 2025 (%)', 47, Math.round(pct(est25 - est19, est19)), 0);
for (const [abbr, k] of Object.entries({ NSW: 249, Vic: 200, Qld: 192, WA: 93, SA: 58, Tas: 19, ACT: 17, NT: 16 })) {
  check('Estimated students missing out', `${abbr} 2019 (thousands)`, k * 1000, at(summary, { state_abbr: abbr }).est_missing_out_2019, 500);
}

// NSW public schools
const with24 = nsw.filter(r => r.attendance_2024 !== null);
const with22 = nsw.filter(r => r.attendance_2022 !== null);
const both = nsw.filter(r => r.attendance_2022 !== null && r.attendance_2024 !== null);
const low = with24.filter(r => r.attendance_2024 < 80);
check('NSW public schools', 'Schools with 2024 attendance', 2123, with24.length, 0);
check('NSW public schools', 'Median attendance 2024', 88.8, r1(median(with24.map(r => r.attendance_2024))));
check('NSW public schools', 'Median attendance 2022', 86.0, r1(median(with22.map(r => r.attendance_2022))));
check('NSW public schools', 'Schools with both years', 2099, both.length, 0);
check('NSW public schools', 'Schools that improved 2022-2024', 1810, both.filter(r => r.attendance_2024 > r.attendance_2022).length, 0);
check('NSW public schools', 'Schools below 80% in 2024', 254, low.length, 0);
check('NSW public schools', 'Share below 80% (%)', 12.0, r1(pct(low.length, with24.length)));
[['Major Cities', 103], ['Inner Regional', 86], ['Outer Regional', 45], ['Remote', 11], ['Very Remote', 9]]
  .forEach(([ra, n]) => check('NSW public schools', `Below 80%: ${ra}`, n, low.filter(r => r.remoteness === ra).length, 0));
const withIcsea = with24.filter(r => r.icsea !== null);
check('NSW public schools', 'Median ICSEA, all schools', 976, median(withIcsea.map(r => r.icsea)), 0);
check('NSW public schools', 'Median ICSEA, schools below 80%', 902, median(low.filter(r => r.icsea !== null).map(r => r.icsea)), 0);
const bandLabels = ['Under 900', '900–949', '950–999', '1000–1049', '1050–1099', '1100 and over'];
const bandMedianPlan = [83.7, 87.0, 88.5, 89.8, 91.1, 92.7];
const bandCountPlan = [352, 430, 495, 330, 258, 256];
bandLabels.forEach((b, k) => {
  const v = withIcsea.filter(r => r.icsea_band === b).map(r => r.attendance_2024);
  check('NSW public schools', `Median attendance, ICSEA ${b}`, bandMedianPlan[k], r1(median(v)));
  check('NSW public schools', `Schools, ICSEA ${b}`, bandCountPlan[k], v.length, 0);
});
const under900 = withIcsea.filter(r => r.icsea_band === 'Under 900');
check('NSW public schools', 'ICSEA under 900: share below 80% (%)', 35, Math.round(pct(under900.filter(r => r.attendance_2024 < 80).length, under900.length)), 0);

// Box plot (C12): percentiles with linear interpolation, as Vega-Lite's quantile transform
const boxPlan = {
  'Under 900': [70.0, 76.8, 86.8, 89.0], '900–949': [78.0, 82.7, 89.1, 90.4], '950–999': [80.6, 85.4, 90.0, 91.1],
  '1000–1049': [84.6, 88.0, 90.9, 91.6], '1050–1099': [87.2, 89.4, 91.9, 92.6], '1100 and over': [90.4, 91.8, 93.3, 93.9],
};
for (const [band, ps] of Object.entries(boxPlan)) {
  const v = withIcsea.filter(r => r.icsea_band === band).map(r => r.attendance_2024);
  [0.1, 0.25, 0.75, 0.9].forEach((p, k) => check('NSW box plot (C12)', `ICSEA ${band}: ${p * 100}th percentile`, ps[k], r1(quantile(v, p))));
}
const spread = band => { const v = withIcsea.filter(r => r.icsea_band === band).map(r => r.attendance_2024); return r1(quantile(v, 0.75) - quantile(v, 0.25)); };
check('NSW box plot (C12)', 'Middle-half spread, ICSEA under 900 (points)', 10.0, spread('Under 900'));
check('NSW box plot (C12)', 'Middle-half spread, ICSEA 1100 and over (points)', 1.5, spread('1100 and over'));

// Bin map (C15): 0.5 degree squares, median days missed, coloured when a square has 3+ schools
const mapped = with24.filter(r => r.in_map_extent === true);
const squares = new Map();
for (const r of mapped) {
  const k = `${Math.floor(r.lon / 0.5) * 0.5},${Math.floor(r.lat / 0.5) * 0.5}`;
  if (!squares.has(k)) squares.set(k, []);
  squares.get(k).push(r.days_missed_2024);
}
const coloured = [...squares].map(([k, v]) => ({ lon: Number(k.split(',')[0]), n: v.length, med: median(v) })).filter(s => s.n >= 3);
check('NSW bin map (C15)', 'Squares containing schools', 201, squares.size, 0);
check('NSW bin map (C15)', 'Squares with 3+ schools (coloured)', 102, coloured.length, 0);
// Same five classes as the charts: threshold domain [10, 12, 15, 20]
const classOf = m => (m < 10 ? '<10' : m < 12 ? '10–12' : m < 15 ? '12–15' : m < 20 ? '15–20' : '≥20');
for (const [c, n] of [['≥20', 5], ['15–20', 9], ['12–15', 38], ['10–12', 40], ['<10', 10]]) {
  check('NSW bin map (C15)', `Coloured squares in class ${c}% days missed`, n, coloured.filter(s => classOf(s.med) === c).length, 0);
}
const west = coloured.filter(s => s.lon < 147), rest = coloured.filter(s => s.lon >= 147);
check('NSW bin map (C15)', 'Typical square west of 147°E (median of medians)', 11.0, r1(median(west.map(s => s.med))));
check('NSW bin map (C15)', 'Typical square elsewhere (median of medians)', 12.0, r1(median(rest.map(s => s.med))));

// Factor ladder
const planFactors = { 'Where you live': 39.5, "School community's advantage": 27.4, 'Aboriginal and Torres Strait Islander status': 27.2, 'School sector': 12.8, 'Stage of school': 11.6, 'Since COVID-19': 11.0, Sex: 1.0 };
for (const [f, v] of Object.entries(planFactors)) check('Factor ladder (difference, points)', f, v, at(factors, { factor: f }).difference);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const mismatches = results.filter(r => !r.ok);
console.log(`# Data check: plan values vs recomputed from data/\n`);
console.log(`${results.length} values checked, ${mismatches.length} mismatch(es).\n`);
let section = null;
const cell = s => String(s).replace(/\|/g, '\\|'); // keys like "NSW|Major Cities" must not split table cells
console.log('| Section | Item | Plan | File | Status |\n|---|---|---|---|---|');
for (const r of results) {
  const [p, f] = r.display || [fmt(r.reference), fmt(r.computed)];
  console.log(`| ${r.section === section ? '' : cell(r.section)} | ${cell(r.item)} | ${cell(p)} | ${cell(f)} | ${r.ok ? '✅' : '⚠️ mismatch'} |`);
  section = r.section;
}
process.exitCode = mismatches.length ? 1 : 0;
