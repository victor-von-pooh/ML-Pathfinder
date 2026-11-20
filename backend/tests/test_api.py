import sys
import types
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Any

import ml_eda
import ml_quest
import pandas as pd
import pytest
import yaml
from fastapi.testclient import TestClient
from ml_eda import synthetic

from ml_pathfinder import api
from ml_pathfinder.app import create_app

# テストのトークン
TOKEN = "test-token"


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """
    一時ディレクトリを置き場にしたアプリの利用者を作る関数

    Parameters
    ----------
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    client: TestClient
        トークン付きの利用者
    """
    # トークンをヘッダーで渡す
    app = create_app(data_dir=tmp_path / "home", token=TOKEN,
                     allowed_hosts=["testserver"])
    client = TestClient(app, headers={"x-pathfinder-token": TOKEN})

    return client


def test_token_required(tmp_path: Path) -> None:
    """
    トークンの無い API の呼び出しを断ることを確かめる関数

    Parameters
    ----------
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # ヘッダーも Cookie も無い
    app = create_app(data_dir=tmp_path, token=TOKEN,
                     allowed_hosts=["testserver"])
    assert TestClient(app).get("/api/problems").status_code == 401


def test_create_answer_and_list(client: TestClient) -> None:
    """
    空の問題の設定を作り, 答え, 一覧に出ることを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者

    Returns
    ----------
    None
    """
    # 名前の無い空は誤り
    assert client.post("/api/problems", json={}).status_code == 400
    view = client.post("/api/problems", json={"name": "試し"}).json()
    assert view["progress"]["answered"] == 0
    assert any(f["id"] == "issue.pain" for f in view["findings"])

    # 答えると進み, 形の誤りは 400 で中身は変わらない
    url = f"/api/problems/{view['id']}/answers"
    view = client.put(url, json={"id": "issue.pain",
                                 "value": "廃棄が多い"}).json()
    assert view["progress"]["answered"] == 1
    bad = client.put(url, json={"id": "issue.kpi.current", "value": "多い"})
    assert bad.status_code == 400 and "数で" in bad.json()["detail"]
    assert client.put(url, json={"id": "x", "value": 1}).status_code == 400
    items = client.get("/api/problems").json()
    assert [item["name"] for item in items] == ["試し"]
    assert items[0]["ready"] is False

    # 名前の変更と消去
    renamed = client.put(f"/api/problems/{view['id']}/name",
                         json={"name": "総菜"}).json()
    assert renamed["name"] == "総菜"
    assert client.delete(f"/api/problems/{view['id']}").status_code == 204
    assert client.get(f"/api/problems/{view['id']}").status_code == 404
    assert client.get("/api/problems/../x").status_code == 404


def test_version(client: TestClient, tmp_path: Path) -> None:
    """
    他のアプリが問題の設定のファイルを書き換えると, 中身の印が変わる
    ことを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # 画面の全てと印だけの応答は同じ印. 自分で答えても変わる
    view = client.post("/api/problems", json={"name": "試し"}).json()
    url = f"/api/problems/{view['id']}"
    first = client.get(f"{url}/version").json()["version"]
    assert client.get(url).json()["version"] == first
    answered = client.put(f"{url}/answers", json={
        "id": "issue.pain", "value": "廃棄が多い"
    }).json()
    second = client.get(f"{url}/version").json()["version"]
    assert answered["version"] == second != first

    # 他のアプリ (同じ秒の書き戻しも) で書き換えると変わる
    path = tmp_path / "home" / "problems" / view["id"] / "problem.yaml"
    problem = ml_quest.answer(ml_quest.load_problem(path), "issue.pain",
                              "欠品が多い")
    ml_quest.save_problem(problem, path)
    assert client.get(f"{url}/version").json()["version"] != second

    # 無い問題の設定は 404
    assert client.get("/api/problems/0123456789ab/version").status_code == (
        404
    )


def test_example_handoff_and_project(
    client: TestClient, tmp_path: Path
) -> None:
    """
    見本から作った問題の設定が受け渡せ, 骨組みを書き出せることを確かめる
    関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # 見本の名前は info から
    examples = client.get("/api/info").json()["examples"]
    view = client.post("/api/problems",
                       json={"example": examples[0]}).json()
    assert view["ready"] is True
    assert view["handoff"]["training"]["monitor"] == "valid/mae"
    assert view["progress"]["answered"] == view["progress"]["required"]
    assert view["summary"]

    # 骨組みの書き出しと, 上書きしない既にあるファイル
    url = f"/api/problems/{view['id']}/project"
    target = tmp_path / "project"
    result = client.post(url, json={"path": str(target)}).json()
    assert "train.py" in result["files"]
    assert (target / "configs" / "default" / "train.yaml").is_file()

    # 書き出した場所の記録は問題の設定に残り, 受け渡しと画面の値に出る
    place = target.resolve()
    record = {"path": str(place),
              "dataset": str(place / "outputs" / "dataset"),
              "model_spec": str(place / "models" / "model.yaml")}
    assert result["project"] == record
    saved = client.get(f"/api/problems/{view['id']}").json()
    assert saved["project"] == record
    assert saved["handoff"]["project"] == {"path": str(place)}
    assert saved["handoff"]["data"]["project_dataset"] == record["dataset"]
    assert view["project"] is None
    again = client.post(url, json={"path": str(target)})
    assert again.status_code == 400 and "既に" in again.json()["detail"]
    assert client.post(url, json={"path": str(target),
                                  "overwrite": True}).status_code == 200

    # 写しは置き場の元の問題の設定を指す. 写しを取り込むと元の場所を外す
    copy = yaml.safe_load((target / "problem.yaml").read_text())
    assert copy["origin"].endswith(f"{view['id']}/problem.yaml")
    assert Path(copy["origin"]).is_file()
    imported = client.post("/api/problems/import",
                           json={"path": str(target / "problem.yaml")})
    assert imported.status_code in (200, 201), imported.text
    again_target = tmp_path / "again"
    client.post(f"/api/problems/{imported.json()['id']}/project",
                json={"path": str(again_target)})
    copy = yaml.safe_load((again_target / "problem.yaml").read_text())
    assert copy["origin"].endswith(
        f"{imported.json()['id']}/problem.yaml"
    )

    # 機械学習を使わない見本は出口 (受け渡せない)
    exit_view = client.post("/api/problems",
                            json={"example": examples[2]}).json()
    assert exit_view["finished"] is True and exit_view["handoff"] is None
    refused = client.post(f"/api/problems/{exit_view['id']}/project",
                          json={"path": str(tmp_path / "x")})
    assert refused.status_code == 400
    assert client.post("/api/problems",
                       json={"example": "無い"}).status_code == 400


def test_columns_import_and_download(
    client: TestClient, tmp_path: Path
) -> None:
    """
    データの列の読み込み, 問題の設定の取り込みと持ち出しを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # Shift_JIS の csv から列の名前
    pd.DataFrame({"日付": ["2026-01-01"], "売上": [1]}).to_csv(
        tmp_path / "d.csv", index=False, encoding="cp932"
    )
    view = client.post("/api/problems", json={"name": "列"}).json()
    url = f"/api/problems/{view['id']}/columns"
    view = client.post(url, json={"path": str(tmp_path / "d.csv")}).json()
    columns = next(q for q in view["questions"]
                   if q["id"] == "information.columns")
    assert columns["value"] == ["日付", "売上"]
    missing = client.post(url, json={"path": str(tmp_path / "no.csv")})
    assert missing.status_code == 400

    # 持ち出したファイルを取り込むと同じ答え
    text = client.get(f"/api/problems/{view['id']}/download").text
    (tmp_path / "problem.yaml").write_text(text, encoding="utf-8")
    imported = client.post("/api/problems/import",
                           json={"path": str(tmp_path)}).json()
    assert imported["id"] != view["id"]
    assert yaml.safe_load(text)["information"]["columns"] == ["日付", "売上"]
    bad = tmp_path / "bad.yaml"
    bad.write_text("a: 1\n", encoding="utf-8")
    assert client.post("/api/problems/import",
                       json={"path": str(bad)}).status_code == 400


def test_version_one_file(client: TestClient, tmp_path: Path) -> None:
    """
    版 1 のファイルを開くと版 2 の問いで描け, 答えを保存すると版 2 で
    書くことを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # 他のアプリが置き場に書いた版 1 のファイル
    part = ml_quest.PART
    assert client.get("/api/info").json()["format_version"] == 2
    view = client.post("/api/problems", json={"name": "古い"}).json()
    url = f"/api/problems/{view['id']}"
    assert view["file_version"] == 2
    path = tmp_path / "home" / "problems" / view["id"] / "problem.yaml"
    path.write_text(
        "format_version: 1\nname: 古い\n"
        "ml: {use: true, task: regression, target: sales}\n"
        "evaluation: {metric: mae}\n", encoding="utf-8"
    )

    # 開くと版 2 の識別子で, ファイルはまだ版 1
    opened = client.get(url).json()
    assert opened["file_version"] == 1
    values = {q["id"]: q["value"] for q in opened["questions"]}
    assert values[f"{part}.role"] == "predict"
    assert values[f"{part}.target.column"] == "sales"
    assert values[f"{part}.evaluation.metric"] == "mae"
    assert "ml.target" not in values

    # 答えを保存すると版 2 で書く
    saved = client.put(f"{url}/answers", json={
        "id": "issue.pain", "value": "外れが多い"
    }).json()
    assert saved["file_version"] == 2
    written = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert written["format_version"] == 2
    assert written["ml"]["parts"][0]["target"]["column"] == "sales"

    # 知っている版より新しいファイルは開かない (黙って読み違えない)
    path.write_text("format_version: 3\nname: 新しい\n", encoding="utf-8")
    newer = client.get(url)
    detail = newer.json()["detail"]
    assert newer.status_code == 422 and "新しい版" in detail
    assert "壊れています" not in detail and "消さずに" in detail
    imported = client.post("/api/problems/import", json={"path": str(path)})
    assert imported.status_code == 400


def cloud_answers() -> dict[str, Any]:
    """
    予測するで点群 (正解は今の処理の出力) の問題の設定の答えを返す関数

    Parameters
    ----------
    None

    Returns
    ----------
    answers: dict[str, Any]
        問いの場所から答え (受け渡せるまで)
    """
    # 受け持ちの場所
    part = ml_quest.PART
    answers = {
        "issue.owner": "設計の係", "issue.pain": "計算に時間がかかる",
        "issue.current": "毎回計算する", "issue.kpi.name": "待ち時間",
        "issue.kpi.unit": "分", "issue.kpi.better": "lower",
        "action.who": "設計の係", "action.when": "計算の前",
        "action.what": "計算を省くか",
        "decomposition": [{"cause": "毎回計算する", "lever": "近似で省く",
                           "ml": True}],
        "ml.reason": "計算の結果を早く近似したい",
        f"{part}.role": "predict", f"{part}.unit": "bundle",
        f"{part}.output": "shape", f"{part}.target.source": "process",
        f"{part}.target.process.name": "今の計算",
        f"{part}.target.process.settings": "既定の設定",
        f"{part}.method": "scratch", f"{part}.target.kind": "point_cloud",
        f"{part}.what": "形の点群", f"{part}.item": "1 回の撮影",
        f"{part}.baseline": "今の計算",
        f"{part}.evaluation.metric": "chamfer",
        f"{part}.evaluation.link": "近いほど計算を省ける",
        "verification.method": "backtest",
        "verification.backtest": "過去の結果と比べる",
        "verification.success": "待ち時間が半分",
        "operation.review": "月に 1 回", "operation.approver": "係の長",
        "operation.stop": "外れが増えたら",
    }

    return answers


def test_other_roles_and_metric(client: TestClient, tmp_path: Path) -> None:
    """
    列の予測でない受け持ちと, 最良を選ぶ指標のその他を受け渡せ, 点群の
    骨組みは書き出せ, 作るとその他の指標は書き出せないことを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # 新しい問題の設定は, 受け持ちと正解の種類に答えるまで列の問いが出ない
    part = ml_quest.PART
    view = client.post("/api/problems", json={"name": "形"}).json()
    url = f"/api/problems/{view['id']}"
    view = client.put(f"{url}/answers",
                      json={"id": "ml.use", "value": True}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert applies[f"{part}.role"] and not applies[f"{part}.task"]

    # 予測するで点群, 正解は今の処理の出力
    answers = cloud_answers()
    for key, value in answers.items():
        response = client.put(f"{url}/answers",
                              json={"id": key, "value": value})
        assert response.status_code == 200, (key, response.json())
    view = client.get(url).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [] and view["ready"] is True, errors
    handoff = view["handoff"]
    assert handoff["part"]["target_process"] == {
        "name": "今の計算", "settings": "既定の設定"
    }
    assert handoff["data"]["target"] is None
    assert handoff["training"]["monitor"] == "valid/chamfer"
    # データ無しでも点群の骨組みは書き出せる (README で書き出しを案内)
    assert view["exportable"] is True and view["export_error"] is None
    written = client.post(f"{url}/project",
                          json={"path": str(tmp_path / "p")})
    assert written.status_code == 200, written.json()
    assert "train.py" in written.json()["files"]
    config = yaml.safe_load((tmp_path / "p" / "configs" / "default"
                             / "train.yaml").read_text(encoding="utf-8"))
    assert config["data"]["dataset"] == "outputs/dataset"

    # 作るの受け持ちは書き出せない (誤りの文は project_error のまま)
    view = client.put(f"{url}/answers", json={"id": f"{part}.role",
                                             "value": "generate"}).json()
    assert view["ready"] is True, view["handoff_error"]
    assert view["exportable"] is False
    assert view["export_error"] == ml_quest.project_error(
        ml_quest.load_problem(tmp_path / "home" / "problems" / view["id"]
                              / "problem.yaml")
    )
    assert "まだ扱えません" in view["export_error"]
    refused = client.post(f"{url}/project",
                          json={"path": str(tmp_path / "g")})
    assert refused.status_code == 400
    assert refused.json()["detail"] == view["export_error"]

    # その他の指標は名前と向きで監視する. 骨組みは書き出せない
    examples = client.get("/api/info").json()["examples"]
    view = client.post("/api/problems",
                       json={"example": examples[0]}).json()
    assert view["exportable"] is True and view["export_error"] is None
    url = f"/api/problems/{view['id']}"
    for key, value in {f"{part}.evaluation.metric": "other",
                       f"{part}.evaluation.name": "wape",
                       f"{part}.evaluation.better": "lower"}.items():
        view = client.put(f"{url}/answers",
                          json={"id": key, "value": value}).json()
    assert view["handoff"]["training"] == {
        "metric": "wape", "monitor": "valid/wape", "mode": "min",
        "role": "predict", "target_kind": "column",
    }
    assert view["exportable"] is False and "その他" in view["export_error"]


def test_items_dataset(client: TestClient, tmp_path: Path) -> None:
    """
    ML-EDA の版 2 のデータセットのディレクトリを入れ, 知らせと骨組みの
    書き出しを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # 合成の撮影と点群, 画像と領域から版 2 のデータセット (テスト用なし.
    # ML-EDA と Pillow は ml-quest[data] の依存なので飛ばさない)
    split = {"method": "random", "valid": 0.25, "seed": 0}
    synthetic.write_shape_captures(tmp_path / "raw_c", count=6, views=3,
                                   size=(16, 16), points=64)
    ml_eda.export_capture_clouds(
        tmp_path / "raw_c" / "captures", tmp_path / "raw_c" / "clouds",
        tmp_path / "clouds", split=split
    )
    synthetic.write_image_masks(tmp_path / "raw_m", count=6, size=(16, 16))
    ml_eda.export_image_masks(
        tmp_path / "raw_m" / "images", tmp_path / "raw_m" / "masks",
        tmp_path / "masks", split={"method": "random", "valid": 0.0,
                                   "seed": 0},
        classes={0: "background", 1: "circle", 2: "square"}
    )

    # 点群の問題に点群のデータセット: 読み方は items, 概要は空で件数
    view = client.post("/api/problems", json={"name": "形"}).json()
    url = f"/api/problems/{view['id']}"
    client.put(f"{url}/answers", json={"id": "ml.use", "value": True})
    for key, value in cloud_answers().items():
        response = client.put(f"{url}/answers",
                              json={"id": key, "value": value})
        assert response.status_code == 200, (key, response.json())
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "clouds")}).json()
    saved = ml_quest.load_problem(tmp_path / "home" / "problems"
                                  / view["id"] / "problem.yaml")
    assert saved["data"]["loader"] == "items"
    assert Path(saved["data"]["source"], "dataset.yaml").is_file()
    found = client.get(f"{url}/insight").json()
    assert found["overview"] is None and found["suggestions"] == []
    assert [f["level"] for f in found["findings"]] == ["info"]
    assert "point_cloud" in found["findings"][0]["message"]

    # 書き出すとデータセットを data/ に写して読む
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "project"
    result = client.post(f"{url}/project", json={"path": str(target)})
    assert result.status_code == 200, result.json()
    assert {"train.py", "README.md", "configs/default/train.yaml"} <= set(
        result.json()["files"]
    )
    assert (target / "data" / "clouds" / "dataset.yaml").is_file()
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["data"]["dataset"] == "data/clouds"

    # 種類の違うデータセット (検証用の分割も無い) は誤りと警告
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "masks")}).json()
    assert view["exportable"] is False
    assert "入れたデータセット" in view["export_error"]
    levels = [f["level"] for f in client.get(f"{url}/insight").json()[
        "findings"
    ]]
    assert levels == ["info", "error", "warning"]
    refused = client.post(f"{url}/project",
                          json={"path": str(tmp_path / "never")})
    assert refused.status_code == 400
    assert refused.json()["detail"] == view["export_error"]


def fake_describe(
    names: list[str], check: bool = True
) -> list[dict[str, Any]]:
    """
    ML-Found の describe_requirements の代わりの関数

    Parameters
    ----------
    names: list[str]
        機能の名前
    check: bool = True
        入っているかを確かめるか (画面からは False のはず)

    Returns
    ----------
    entries: list[dict[str, Any]]
        機能ごとの説明 (rl は pip, それ以外は公式の手順)
    """
    # 確かめないで呼ばれること. 知らない名前は登録簿と同じく誤り
    assert check is False
    entries: list[dict[str, Any]] = []
    for name in names:
        if name == "ros2":
            raise ValueError("機能 ros2 は登録されていません")
        pip = name == "rl"
        entries.append({
            "name": name, "description": f"{name} の説明",
            "checks": [], "match": "all", "available": None,
            "install": {
                "kind": "pip" if pip else "guide",
                "command": 'pip install "gymnasium>=1.0"' if pip else None,
                "extra_command": None,
                "url": f"https://example.org/{name}",
            },
            "note": None if pip else "公式の手順で入れる",
        })

    return entries


def test_requires_and_policy(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    要る機能を答えの途中から返し, ML-Found があれば入れ方を添え, 方策の
    守りを受け渡すことを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    monkeypatch: pytest.MonkeyPatch
        ML-Found の有無を差し替える道具

    Returns
    ----------
    None
    """
    # ML-Found が無い場合 (この環境の既定)
    monkeypatch.setattr(api, "FOUND", {})
    monkeypatch.setitem(sys.modules, "ml_found", None)
    part = ml_quest.PART
    examples = client.get("/api/info").json()["examples"]
    view = client.post("/api/problems",
                       json={"example": examples[0]}).json()
    assert view["requires"] == []
    url = f"/api/problems/{view['id']}"

    # 効果を見積もるでシミュレータと答えた途中 (まだ渡せない) から出る
    for key, value in [("role", "effect"), ("collect", "simulator"),
                       ("simulator", "mujoco")]:
        view = client.put(f"{url}/answers",
                          json={"id": f"{part}.{key}", "value": value}).json()
    assert view["ready"] is False
    assert [item["name"] for item in view["requires"]] == ["rl", "mujoco"]
    first = view["requires"][0]
    assert first["source"] == "ml_quest" and first["install"] is None
    assert "Gymnasium" in first["label"] and "ML-Found" in first["note"]

    # 残りに答えると, 受け渡しに要る機能と守りが乗る
    answers: list[tuple[str, Any]] = [("unit", "row"), ("output", "effect"),
               ("target.source", "intervention"), ("method", "scratch"),
               ("what", "試しの出力"), ("item", "1 件"),
               ("baseline", "今のやり方"), ("evaluation.metric", "qini"),
               ("evaluation.link", "良くなると損が減る"),
               ("autonomous", True),
               ("policy.action_limits", "各関節の速さは毎秒 0.5 rad まで"),
               ("policy.stop", "腕の先が台の上 0 から 0.3 m を出たら"),
               ("policy.fallback", "handover"),
               ("policy.approver", "設備の責任者")]
    for key, value in answers:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())
    view = response.json()
    assert view["ready"] is True, view["handoff_error"]
    assert view["handoff"]["requires"] == ["rl", "mujoco"]
    assert view["handoff"]["policy"] == {
        "action_limits": "各関節の速さは毎秒 0.5 rad まで",
        "stop": "腕の先が台の上 0 から 0.3 m を出たら",
        "fallback": "handover", "fallback_action": None,
        "safety_key": "cost", "approver": "設備の責任者",
    }

    # ML-Found があれば入れ方を添える (登録簿に無い名前は補足のまま)
    module = types.ModuleType("ml_found")
    module.describe_requirements = fake_describe  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "ml_found", module)
    monkeypatch.setattr(api, "FOUND", {})
    view = client.put(f"{url}/answers",
                      json={"id": f"{part}.ros2", "value": True}).json()
    items = {item["name"]: item for item in view["requires"]}
    assert list(items) == ["rl", "mujoco", "ros2"]
    assert items["rl"]["source"] == "ml_found"
    assert items["rl"]["install"]["command"] == 'pip install "gymnasium>=1.0"'
    assert items["mujoco"]["install"]["kind"] == "guide"
    assert items["mujoco"]["note"] == "公式の手順で入れる"
    assert items["ros2"]["source"] == "ml_quest"

    # 方策でなくすると守りは渡さない
    view = client.put(f"{url}/answers",
                      json={"id": f"{part}.autonomous",
                            "value": False}).json()
    assert view["handoff"]["policy"] is None
    assert [item["name"] for item in view["requires"]] == ["rl", "mujoco"]


def test_browse(client: TestClient, tmp_path: Path) -> None:
    """
    ディレクトリの中身を, プロジェクトとデータセットの印付きで返すことを
    確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # ML-Found のプロジェクトの形のディレクトリ
    (tmp_path / "p" / "configs" / "default").mkdir(parents=True)
    (tmp_path / "p" / "configs" / "default" / "train.yaml").write_text(
        "{}", encoding="utf-8"
    )
    # dataset.yaml を持つディレクトリ (ML-EDA のデータセット)
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "dataset.yaml").write_text("{}", encoding="utf-8")
    listing = client.get("/api/browse", params={"path": str(tmp_path)})
    entries = {e["name"]: e for e in listing.json()["entries"]}
    assert entries["p"]["project"] is True
    assert entries["p"]["dataset"] is False
    assert entries["d"]["dataset"] is True and entries["d"]["project"] is False
    assert client.get("/api/browse", params={
        "path": str(tmp_path / "none")
    }).status_code == 404


def test_broken_files(client: TestClient, tmp_path: Path) -> None:
    """
    置き場の壊れた問題の設定が, 一覧を止めずに印付きで出て, 消せることを
    確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # YAML として壊れたものと, 形の崩れたもの
    good = client.post("/api/problems", json={"name": "良い"}).json()
    home = tmp_path / "home" / "problems"
    (home / "aaaaaaaaaaaa").mkdir(parents=True)
    (home / "aaaaaaaaaaaa" / "problem.yaml").write_text(
        "a: [", encoding="utf-8"
    )
    (home / "bbbbbbbbbbbb").mkdir()
    (home / "bbbbbbbbbbbb" / "problem.yaml").write_text(
        "format_version: 1\nname: x\nml: {use: true, task: [1]}\n",
        encoding="utf-8",
    )
    items = {item["id"]: item for item in client.get("/api/problems").json()}
    assert items[good["id"]]["broken"] is None
    assert "YAML" in items["aaaaaaaaaaaa"]["broken"]
    assert items["bbbbbbbbbbbb"]["errors"] >= 1

    # 壊れたものは開けないが 422 で理由が出て, 消せる
    opened = client.get("/api/problems/aaaaaaaaaaaa")
    assert opened.status_code == 422 and "壊れて" in opened.json()["detail"]
    assert client.delete("/api/problems/aaaaaaaaaaaa").status_code == 204

    # 相対パスと, 無い識別子での列の読み込みは誤り
    relative = client.post(f"/api/problems/{good['id']}/columns",
                           json={"path": "data.csv"})
    assert relative.status_code == 400 and "絶対パス" in relative.json()[
        "detail"
    ]
    assert client.post("/api/problems/cccccccccccc/columns",
                       json={"path": str(tmp_path / "x.csv")}
                       ).status_code == 404
    missing = client.post(f"/api/problems/{good['id']}/columns",
                          json={"path": str(tmp_path / "none.csv")})
    assert missing.json()["detail"] == "none.csv が見つかりません"

    # 取り込めない形と, 文字列でない名前
    broken = tmp_path / "broken.yaml"
    broken.write_text("format_version: 1\nml: {task: [1]}\n", "utf-8")
    assert client.post("/api/problems/import",
                       json={"path": str(broken)}).status_code == 201
    odd = tmp_path / "odd.yaml"
    odd.write_text("format_version: 1\nname: {a: 1}\n", "utf-8")
    imported = client.post("/api/problems/import",
                           json={"path": str(odd)}).json()
    assert imported["name"] == "odd"

    # ダウンロードの応答のヘッダー
    download = client.get(f"/api/problems/{good['id']}/download")
    assert download.headers["x-content-type-options"] == "nosniff"


def test_data_and_insight(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    手元のデータを入れると列が入り, 答えの候補と確かめが出ることを
    確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ
    monkeypatch: pytest.MonkeyPatch
        分析の呼び出しの置き換え (覚えた結果を返すかの確かめ)

    Returns
    ----------
    None
    """
    # 店ごとの売上と, 売上から作った客数
    days = pd.date_range("2025-01-01", periods=60).strftime("%Y-%m-%d")
    sales = [float(50 + i % 7 * 10) for i in range(120)]
    pd.DataFrame({
        "date": list(days) * 2, "shop": ["a"] * 60 + ["b"] * 60,
        "sales": sales, "customers": [v * 3 + 1 for v in sales],
    }).to_csv(tmp_path / "shop.csv", index=False)
    view = client.post("/api/problems", json={"name": "店"}).json()
    url = f"/api/problems/{view['id']}"
    client.put(f"{url}/answers", json={"id": "ml.use", "value": True})
    part = ml_quest.PART
    client.put(f"{url}/answers", json={"id": f"{part}.role",
                                       "value": "predict"})
    client.put(f"{url}/answers", json={"id": f"{part}.target.kind",
                                       "value": "column"})

    # 入れる前は空, 入れると列と読み方
    assert client.get(f"{url}/insight").json()["suggestions"] == []
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "shop.csv")}).json()
    columns = next(q for q in view["questions"]
                   if q["id"] == "information.columns")
    assert columns["value"] == ["date", "shop", "sales", "customers"]
    copies = tmp_path / "home" / "problems" / view["id"] / "data"
    source = next(q for q in view["questions"] if q["id"] == "data.source")
    copied = Path(source["value"])
    assert copied.name == "shop.csv" and copied.is_file()
    assert copied.parent.parent == copies.resolve()
    found = client.get(f"{url}/insight").json()
    assert found["overview"]["rows"] == 120
    ids = {item["id"] for item in found["suggestions"]}
    assert {f"{part}.target.column", f"{part}.time_column"} <= ids

    # 目的の列を答えると漏れの疑いが確かめに出る. 同じ答えなら覚えたもの
    client.put(f"{url}/answers", json={"id": f"{part}.target.column",
                                       "value": "sales"})
    found = client.get(f"{url}/insight").json()
    unknown = next(item for item in found["findings"]
                   if item["id"] == "information.unknown")
    assert "customers" in unknown["message"]
    calls = []
    monkeypatch.setattr(ml_quest, "inspect_data",
                        lambda problem: calls.append(1) or {})
    assert client.get(f"{url}/insight").json() == found
    assert calls == []

    # 場所は答えの PUT では変えられない. 外すと読み方も消える
    direct = client.put(f"{url}/answers",
                        json={"id": "data.source", "value": "/x.csv"})
    assert direct.status_code == 400
    removed = client.delete(f"{url}/data").json()
    source = next(q for q in removed["questions"] if q["id"] == "data.source")
    assert source["value"] is None and not copied.exists()
    assert (tmp_path / "shop.csv").is_file()
    assert [p.name for p in copies.parent.iterdir()] == ["problem.yaml"]

    # 相対パスと読めないファイルは誤り
    assert client.post(f"{url}/data",
                       json={"path": "shop.csv"}).status_code == 400
    assert client.post(f"{url}/data", json={
        "path": str(tmp_path / "none.csv")
    }).status_code == 400


def test_attach_again(client: TestClient, tmp_path: Path) -> None:
    """
    入れ直しで, 問題の設定と今の写しを壊さず, 古い写しを残さないことを
    確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # .. で終わる場所でも問題の設定は残る
    (tmp_path / "d1").mkdir()
    (tmp_path / "d2").mkdir()
    pd.DataFrame({"x": [1, 2, 3], "y": [4, 5, 6]}).to_csv(
        tmp_path / "d1" / "x.csv", index=False
    )
    pd.DataFrame({"z": [1, 2, 3]}).to_csv(tmp_path / "d2" / "y.csv",
                                         index=False)
    view = client.post("/api/problems", json={"name": "入れ直し"}).json()
    url = f"/api/problems/{view['id']}"
    client.post(f"{url}/data", json={"path": str(tmp_path / "d1" / "..")})
    assert client.get(url).status_code == 200

    # 読めない同じ名前のファイルを入れ直しても, 今の写しは読める
    first = client.post(f"{url}/data",
                        json={"path": str(tmp_path / "d1" / "x.csv")})
    source = next(q for q in first.json()["questions"]
                  if q["id"] == "data.source")["value"]
    (tmp_path / "d3").mkdir()
    (tmp_path / "d3" / "x.csv").write_bytes(b"\x00\x01")
    assert client.post(f"{url}/data", json={
        "path": str(tmp_path / "d3" / "x.csv")
    }).status_code == 400
    assert Path(source).is_file()

    # 別のファイルに入れ直すと, 古い写しは消える
    second = client.post(f"{url}/data",
                         json={"path": str(tmp_path / "d2" / "y.csv")})
    copies = Path(source).parent.parent
    assert [p.name for p in copies.rglob("*.csv")] == ["y.csv"]
    assert second.status_code == 200


def test_attach_races(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    写している間に問題の設定が消されても残り物が無く, 写している途中の
    写しは他の保存で消されないことを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ
    monkeypatch: pytest.MonkeyPatch
        写している間の割り込み

    Returns
    ----------
    None
    """
    # 写している間に消す (写しが消えたディレクトリを作り直す)
    pd.DataFrame({"x": [1, 2, 3]}).to_csv(tmp_path / "x.csv", index=False)
    problems = tmp_path / "home" / "problems"
    view = client.post("/api/problems", json={"name": "消す"}).json()
    url = f"/api/problems/{view['id']}"
    original = ml_quest.attach_data
    monkeypatch.setattr(ml_quest, "attach_data", partial(
        deleting_attach, client, url, original
    ))
    response = client.post(f"{url}/data",
                           json={"path": str(tmp_path / "x.csv")})
    assert response.status_code == 404
    assert list(problems.iterdir()) == []

    # 写している途中に別のデータを入れても, 途中の写しは残って保存できる
    view = client.post("/api/problems", json={"name": "重ね"}).json()
    url = f"/api/problems/{view['id']}"
    pd.DataFrame({"y": [1, 2, 3]}).to_csv(tmp_path / "y.csv", index=False)
    monkeypatch.setattr(ml_quest, "attach_data", partial(
        nested_attach, client, url, tmp_path / "y.csv", original, []
    ))
    outer = client.post(f"{url}/data", json={"path": str(tmp_path / "x.csv")})
    assert outer.status_code == 200
    copies = problems / view["id"] / "data"
    assert [p.name for p in copies.rglob("*.csv")] == ["x.csv"]
    assert not list((problems / view["id"]).glob(".removing-*"))


def deleting_attach(
    client: TestClient, url: str, original: Callable[..., dict],
    problem: dict, path: Path, copy_to: Path
) -> dict:
    """
    写す前に問題の設定を消してから写す関数 (割り込みの再現)

    Parameters
    ----------
    client: TestClient
        利用者
    url: str
        問題の設定の URL
    original: Callable[..., dict]
        元の attach_data
    problem: dict
        問題の設定
    path: Path
        データの場所
    copy_to: Path
        写し先

    Returns
    ----------
    attached: dict
        写した後の問題の設定
    """
    # 消してから写す
    client.delete(url)
    attached = original(problem, path, copy_to=copy_to)

    return attached


def nested_attach(
    client: TestClient, url: str, other: Path,
    original: Callable[..., dict], calls: list[int],
    problem: dict, path: Path, copy_to: Path
) -> dict:
    """
    1 回目だけ, 写す前に別のデータを入れてから写す関数 (割り込みの再現)

    Parameters
    ----------
    client: TestClient
        利用者
    url: str
        問題の設定の URL
    other: Path
        割り込んで入れるデータ
    original: Callable[..., dict]
        元の attach_data
    calls: list[int]
        呼ばれた回数の記録
    problem: dict
        問題の設定
    path: Path
        データの場所
    copy_to: Path
        写し先

    Returns
    ----------
    attached: dict
        写した後の問題の設定
    """
    # 1 回目だけの割り込み
    if not calls:
        calls.append(1)
        inner = client.post(f"{url}/data", json={"path": str(other)})
        assert inner.status_code == 200
    attached = original(problem, path, copy_to=copy_to)

    return attached
