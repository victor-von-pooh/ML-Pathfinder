#!/usr/bin/env bash
# README の画面の例と操作の動画を撮るために, 作り物のホームでアプリを起動する (CI では使わない).
# 置き場は既定の ~/.ml-pathfinder にし, 見本のデータ (作り物の売上の表と, ML-EDA の合成の
# 撮影と点群から書き出した小さなデータセット) をホームに置く. 画面は pnpm build で作っておく
set -euo pipefail

cd "$(dirname "$0")"
WORK="$PWD/.screens"
PORT="${SCREENS_PORT:-8796}"

rm -rf "$WORK"
mkdir -p "$WORK/home"
cd ../../backend

.venv/bin/python - "$WORK/home" <<'PY'
import sys
from datetime import date, timedelta
from pathlib import Path

import ml_eda
from ml_eda import synthetic

home = Path(sys.argv[1])
# 総菜の見本と同じ列の, 2 品の 120 日の売れた数
rows = ["date,item,weekday,weather,temperature,price,sold"]
for item, base in (("唐揚げ", 60), ("煮物", 30)):
    for day in range(120):
        when = date(2026, 1, 1) + timedelta(days=day)
        weather = ("晴れ", "曇り", "雨")[day % 3]
        sold = base + (when.weekday() >= 5) * 15 - (weather == "雨") * 8
        rows.append(
            f"{when},{item},{when.weekday()},{weather},{5 + day % 10},"
            f"{398 if base == 60 else 298},{sold}"
        )
(home / "sales.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")

synthetic.write_shape_captures(home / "raw_c", count=6, views=3,
                               size=(16, 16), points=64)
ml_eda.export_capture_clouds(
    home / "raw_c" / "captures", home / "raw_c" / "clouds",
    home / "clouds", split={"method": "random", "valid": 0.25, "seed": 0}
)
PY

unset ML_PATHFINDER_HOME
HOME="$WORK/home" ML_PATHFINDER_TOKEN=screens-token \
  exec .venv/bin/ml-pathfinder --port "$PORT"
