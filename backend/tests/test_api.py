from pathlib import Path

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
