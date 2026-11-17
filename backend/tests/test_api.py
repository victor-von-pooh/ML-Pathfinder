from pathlib import Path

import ml_quest
import pandas as pd
import pytest
import yaml
from fastapi.testclient import TestClient

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
    again = client.post(url, json={"path": str(target)})
    assert again.status_code == 400 and "既に" in again.json()["detail"]
    assert client.post(url, json={"path": str(target),
                                  "overwrite": True}).status_code == 200

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


def test_browse(client: TestClient, tmp_path: Path) -> None:
    """
    ディレクトリの中身を, プロジェクトの印付きで返すことを確かめる関数

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
    listing = client.get("/api/browse", params={"path": str(tmp_path)})
    entries = {e["name"]: e for e in listing.json()["entries"]}
    assert entries["p"]["project"] is True
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
    assert {"ml.target", "ml.time_column"} <= ids

    # 目的の列を答えると漏れの疑いが確かめに出る. 同じ答えなら覚えたもの
    client.put(f"{url}/answers", json={"id": "ml.target", "value": "sales"})
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
