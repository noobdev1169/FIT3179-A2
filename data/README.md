# Data for "The Missing Days"

This folder holds the chart-ready data loaded by the web page. Every file here is **derived** from official public datasets by `scripts/prepare_data.js`. The raw downloads are not published.

## Keeping the published data small

The page loads **415 KB** of data in total. That is well under the assignment's limit of "a few megabytes", and each chart loads only its own file. Five rules keep it small:

1. **Only derived files are published.** The raw sources (about 61 MB of spreadsheets, CSVs and shapefiles) live in `data/raw/`, which is git-ignored. `scripts/download_raw.sh` re-creates that folder.
2. **One tidy file per chart family, with only the columns a chart uses.** Long ("tidy") tables suit Vega-Lite's encodings.
3. **Rounding follows the publishers:**
   - percentages to 1 decimal, as ACARA publishes them
   - ABS FTE student numbers to 1 decimal, so regional values add up exactly to the published total
   - student counts and estimates as whole numbers
   - school coordinates to 4 decimals (about 10 m)
4. **Simplified boundaries:**
   - filtered to the 8 states and territories
   - clipped to the mainland, Tasmania and the Torres Strait (which removes Lord Howe Island and the external territories)
   - simplified (Visvalingam weighted, keeping small islands) and quantised as TopoJSON
   - state outlines are dissolved from the remoteness regions, so both layers share arcs and their borders match exactly
5. **No school names.** The NSW file keeps the public school code but drops names, so the charts show patterns and not a league table.

| File | Rows | Size | Used by |
|---|---|---|---|
| `australia_2021.topojson` | 8 + 33 shapes | 115.8 KB | choropleth, proportional symbol map, Dorling cartogram outline |
| `nsw_2021.topojson` | 1 + 5 shapes | 99.2 KB | NSW dot map and bin map |
| `nsw_schools.csv` | 2,130 | 182.6 KB | NSW dot map, bin map, box plot |
| `attendance_regions.csv` | 33 | 3.9 KB | choropleth, proportional symbol map |
| `attendance_states.csv` | 90 | 3.4 KB | Dorling cartogram tooltips (official state rates and levels) |
| `attendance_yearlevel.csv` | 110 | 2.8 KB | heatmap |
| `missing_out_state_sector.csv` | 48 | 2.5 KB | treemap |
| `attendance_indigenous_trend.csv` | 33 | 1.5 KB | source for the dumbbell chart's trend annotation |
| `attendance_icsea_sector.csv` | 20 | 0.9 KB | advantage vs sector dot plot |
| `attendance_indigenous_remoteness.csv` | 10 | 0.8 KB | dumbbell chart |
| `factors_2025.csv` | 7 | 0.7 KB | factor ladder |
| `states_summary.csv` | 8 | 0.7 KB | Dorling cartogram |
| `attendance_trend.csv` | 12 | 0.4 KB | trend line, headline numbers |
| `manifest.json` | n/a | n/a | build record: sizes, row counts, raw-file checksums |

## Sources

All raw files were retrieved on **15 October 2026**. Their SHA-256 checksums are recorded in `manifest.json`.

| Publisher | Dataset | Licence | Link |
|---|---|---|---|
| ACARA | National Report on Schooling in Australia data portal: *Student attendance dataset* (December 2025 release; 2014–2025) | CC BY 4.0 | <https://www.acara.edu.au/reporting/national-report-on-schooling-in-australia/student-attendance> |
| Australian Bureau of Statistics | *Schools, 2025* (released 5 March 2026): Table 42b *Number of full-time and part-time students, 2006–2025*; Table 46a *FTE students by ASGS remoteness areas, 2025* | CC BY 4.0 | <https://www.abs.gov.au/statistics/people/education/schools/2025> |
| NSW Department of Education | *Student attendance rate by individual government school (2011–2024)* | CC BY | <https://data.nsw.gov.au/data/dataset/b558a070-09f5-4941-a140-e60a744327bf> |
| NSW Department of Education | *Master dataset: NSW government school locations and student enrolment numbers* (ICSEA values sourced from ACARA) | CC BY | <https://data.nsw.gov.au/data/dataset/78c10ea3-8d04-4c9c-b255-bbf8547e37e7> |
| Australian Bureau of Statistics | ASGS Edition 3: Remoteness Areas 2021 (GDA2020) | CC BY 4.0 | <https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/digital-boundary-files> |

## Measures

| Measure | Definition | Source |
|---|---|---|
| `attendance_rate` | Full-time-equivalent days attended by full-time students in Years 1–10 in Semester 1, as a % of possible days | ACARA |
| `attendance_level` | % of full-time students in Years 1–10 who attended **at least 90%** of Semester 1 | ACARA |
| `missing_out` | **100 − attendance_level**: % of students who missed more than 1 day in 10 (about a day a fortnight) | derived |
| `days_missed` | **100 − attendance_rate**: % of school days missed | derived |
| `est_missing_out` | ABS full-time Years 1–10 students × (100 − ACARA attendance level) ÷ 100, computed for each state and sector, then summed | derived (estimate) |
| `students_fte` | Full-time-equivalent students, all year levels, ABS August census | ABS |
| `icsea` | Index of Community Socio-Educational Advantage: based on parents' occupation and education, the school's remoteness and its share of Aboriginal and Torres Strait Islander students; median school 1000 | ACARA via NSW |

ACARA marks suppressed cells with "-". They appear as empty values here.

## Processing (what `prepare_data.js` does)

1. **ACARA attendance.** The script reads the single `Data` sheet (225,014 rows) and stops if any combination of year, state, sector, group and year level appears twice. It keeps Years 1–10 for every table except the heatmap, which uses Years 1 to 10 separately. It then:
   - derives `missing_out` and `days_missed`
   - adds 2020 as a "not published" row in the trend and heatmap tables, so charts can show the gap honestly
2. **ABS Table 42b.** Sums **full-time** students in the year levels ACARA counts as Years 1–10, including ungraded students as ACARA does, by state × sector, for 2019 and 2025. Multiplying by ACARA's attendance level for the same state and sector gives `est_missing_out`.
3. **ABS Table 46a.** Sums 2025 FTE students by state × remoteness, for all students and for government schools.
4. **Remoteness boundaries (mapshaper):**
   - filter to the 8 states and territories
   - clip to bounding box `112, −44.5, 154.5, −9`
   - build the join key `"<state>|<remoteness>"` (for example `NSW|Major Cities`), which matches `attendance_regions.csv`
   - compute a point inside each region (symbol position) and each state (Dorling start position)
   - dissolve to states
   - simplify to 0.5% (national) or 2% (NSW, clipped to `140.9, −37.6, 154, −28.1`)
   - write TopoJSON (quantisation 1e5)
5. **NSW schools.** Joins attendance by school to the master dataset on `school_code`:
   - 81 attendance rows have no match in the current master dataset (closed or merged schools)
   - 17 matched schools have no 2022 or 2024 value
   - both groups are dropped
   - Lord Howe Island Central School stays in the file (so statistics include it) but is flagged `in_map_extent = false`
   - ICSEA is grouped into six bands: under 900, 900–949, 950–999, 1000–1049, 1050–1099, 1100 and over

## Files and columns

- **`attendance_trend.csv`:** Australia, all sectors, Years 1–10, 2014–2025.
  - Columns: `year`, `published`, `attendance_rate`, `attendance_level` (from 2015), `missing_out`, `days_missed`.
- **`attendance_yearlevel.csv`:** Australia, all sectors, 2015–2025.
  - Columns: `year`, `published`, `year_level` (1–10), `attendance_rate`, `attendance_level`, `missing_out`.
- **`attendance_states.csv`:** 8 states/territories + Australia, 2015–2025 (no 2020).
  - Columns: `state`, `state_abbr`, `year`, `attendance_rate`, `attendance_level`, `missing_out`.
- **`attendance_regions.csv`:** the 33 state × remoteness regions.
  - Columns: `key`, `state`, `state_abbr`, `remoteness`, `ra_order` (1 = major cities … 5 = very remote).
  - Attendance for 2019 and 2025: `attendance_rate_2019`, `attendance_level_2019`, `missing_out_2019`, and the same three for 2025.
  - Students and geography: `students_fte_2025`, `students_fte_gov_2025`, `area_km2` (ABS), `lon`/`lat` (symbol position).
  - ACT inner regional has no ACARA value.
- **`attendance_indigenous_remoteness.csv`:** Australia 2025, remoteness × Indigenous status.
  - Columns: rate, level and `missing_out`, plus ACARA's own gap values (`gap_attendance_level`, `gap_attendance_rate`).
- **`attendance_indigenous_trend.csv`:** Australia, 2014–2025, by Indigenous status.
  - The `Gap (points)` rows are ACARA's published gaps.
- **`attendance_icsea_sector.csv`:** Australia 2025.
  - Rows: `All schools` and the four ICSEA quarters (`group`, `group_order`), × `sector` (Government, Catholic, Independent, All sectors).
- **`factors_2025.csv`:** seven comparisons of `missing_out` (and attendance rate) between the higher and lower group, with `difference` in percentage points, sorted largest first.
- **`missing_out_state_sector.csv`:** 2019 and 2025 × state × sector.
  - Columns: `ft_students_y1_10`, `attendance_level`, `est_missing_out`.
- **`states_summary.csv`:** one row per state.
  - Columns: `lon`/`lat`, plus students, estimated students missing out and `missing_out` for 2019 and 2025.
- **`nsw_schools.csv`:** NSW public schools.
  - Columns: `school_code`, `lat`, `lon`, `in_map_extent`, `level_of_schooling`, `remoteness` (ASGS 2016, as supplied), `ra_order`, `icsea`, `icsea_band`, `icsea_band_order`, `fte` (latest enrolment), `attendance_2022`, `attendance_2024`, `days_missed_2024`.
- **`australia_2021.topojson`:**
  - object `states` (`state_abbr`, `state`)
  - object `remoteness` (`key`, `state_abbr`, `remoteness`, `ra_order`)
- **`nsw_2021.topojson`:**
  - object `outline`
  - object `remoteness` (`remoteness`, `ra_order`)

## Caveats

- ACARA did not publish 2020 attendance (COVID-19). The attendance level starts in 2015.
- NSW changed its attendance calculation for government schools in 2018 and 2021. NSW school-level figures for 2022 and 2024 are comparable with each other but not with earlier years.
- Remoteness: 2019 attendance values were classified with ASGS 2016 boundaries; the maps use ASGS 2021 boundaries.
- `est_missing_out` combines an August student count (ABS) with a Semester 1 attendance share (ACARA), so treat it as an estimate. The ABS also randomly adjusts small cells for confidentiality.
- ICSEA already includes remoteness and the share of Aboriginal and Torres Strait Islander students, so these factors overlap.
- School-level attendance is NSW government schools only, and 2024 is the latest year published at that level.

## Reproduce

```bash
npm install                      # xlsx and mapshaper (dev dependencies only)
bash scripts/download_raw.sh     # about 50 MB of downloads (61 MB once unzipped) into data/raw/ (git-ignored)
node scripts/prepare_data.js     # writes the files above and manifest.json
node scripts/check_data.js       # recomputes the headline numbers and compares them with the text
```

Attribution (also shown on the page): Source: ACARA, National Report on Schooling in Australia data portal (CC BY 4.0); Australian Bureau of Statistics, Schools, 2025 and ASGS Edition 3 (CC BY 4.0); NSW Department of Education (CC BY).
