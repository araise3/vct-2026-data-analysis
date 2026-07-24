#!/usr/bin/env python3
"""
export_to_csv.py — dump every table in a .db file to CSV files in
./csv_export/<db_name>/ (a subfolder per database, so exporting both the
VCT and EWC databases doesn't overwrite each other's same-named tables).

Usage: python3 export_to_csv.py [db_path]
"""
import csv
import sqlite3
import sys
from pathlib import Path

db_path = sys.argv[1] if len(sys.argv) > 1 else "vlr_vct_2026.db"
db_name = Path(db_path).stem  # e.g. "vlr_vct_2026" or "vlr_ewc_2026"
out_dir = Path("csv_export") / db_name
out_dir.mkdir(parents=True, exist_ok=True)

conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]

for table in tables:
    cur.execute(f"SELECT * FROM {table}")
    rows = cur.fetchall()
    col_names = [d[0] for d in cur.description]
    out_path = out_dir / f"{table}.csv"
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(col_names)
        writer.writerows(rows)
    print(f"{table}: {len(rows)} rows -> {out_path}")

conn.close()
print(f"\nDone. CSVs are in ./{out_dir}/")
