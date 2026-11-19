#!/usr/bin/env bash
# 画面の通しのテスト (Playwright) 用に, 作業用の置き場でアプリを起動する.
# 画面は pnpm build で作っておく
set -euo pipefail

cd "$(dirname "$0")"
WORK="$PWD/.work"
PORT="${E2E_PORT:-8795}"

# 前回の結果を消し, 置き場を作業用のディレクトリにして決まったトークンで起動
rm -rf "$WORK"
mkdir -p "$WORK"
cd ../../backend

# 点群の問題に入れる, ML-EDA の合成の撮影と点群から書き出した小さな版 2 のデータセット
uv run python - "$WORK" <<'PY'
import sys
from pathlib import Path

import ml_eda
from ml_eda import synthetic

work = Path(sys.argv[1])
synthetic.write_shape_captures(work / "raw_c", count=6, views=3,
                               size=(16, 16), points=64)
ml_eda.export_capture_clouds(
    work / "raw_c" / "captures", work / "raw_c" / "clouds",
    work / "clouds", split={"method": "random", "valid": 0.25, "seed": 0}
)
PY

ML_PATHFINDER_HOME="$WORK/home" ML_PATHFINDER_TOKEN=e2e-token \
  exec uv run ml-pathfinder --port "$PORT"
