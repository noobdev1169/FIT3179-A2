#!/usr/bin/env bash
# Downloads the raw public datasets used by scripts/prepare_data.js.
# Usage: bash scripts/download_raw.sh [target-dir]   (default: data/raw, which is git-ignored)
set -euo pipefail

RAW="${1:-data/raw}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
ABS_SCHOOLS="https://www.abs.gov.au/statistics/people/education/schools/2025"
ASGS="https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/access-and-downloads/digital-boundary-files"

fetch() {  # fetch <url> <output-file>
  mkdir -p "$(dirname "$2")"
  curl -sSfL -A "$UA" -o "$2" "$1"
  echo "  $(wc -c < "$2") bytes  $2"
}

echo "ACARA: Student attendance dataset (Dec 2025)"
fetch "https://dataandreporting.blob.core.windows.net/anrdataportal/ANR-ExcelDownloads/202512/Student%20attendance%20dataset.xlsx" \
      "$RAW/acara/Student_attendance_dataset.xlsx"

echo "ABS: Schools, 2025 (Tables 42b and 46a)"
fetch "$ABS_SCHOOLS/Table%2042b%20Number%20of%20full-time%20and%20part-time%20students%2C%202006-2025.xlsx" \
      "$RAW/abs_schools/t42b.xlsx"
fetch "$ABS_SCHOOLS/Table%2046a%20Full-time%20equivalent%20%28FTE%29%20students%20by%20ASGS%20remoteness%20areas%2C%202025.xlsx" \
      "$RAW/abs_schools/t46a.xlsx"

echo "NSW Department of Education: attendance by school and the public schools master dataset"
fetch "https://data.nsw.gov.au/data/dataset/b558a070-09f5-4941-a140-e60a744327bf/resource/df5e3989-0595-4c61-94ab-0f63ab6b1528/download/2011-2024-attendance-rates-by-government-schools.csv" \
      "$RAW/nsw/attendance_2011_2024.csv"
fetch "https://data.nsw.gov.au/data/dataset/78c10ea3-8d04-4c9c-b255-bbf8547e37e7/resource/3e6d5f6a-055c-440d-a690-fc0537c31095/download/master_dataset.csv" \
      "$RAW/nsw/master_dataset.csv"

echo "ABS: ASGS Edition 3 Remoteness Areas 2021 (state outlines are dissolved from these)"
fetch "$ASGS/RA_2021_AUST_GDA2020.zip" "$RAW/asgs/RA_2021_AUST_GDA2020.zip"
unzip -o -q "$RAW/asgs/RA_2021_AUST_GDA2020.zip" -d "$RAW/asgs"

echo "Done. Next: node scripts/prepare_data.js --raw $RAW --out data"
