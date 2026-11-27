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
from fastapi import FastAPI
from fastapi.testclient import TestClient
from ml_eda import synthetic

from ml_pathfinder import api
from ml_pathfinder.app import cookie_name, create_api, create_app

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
    standalone = create_app(data_dir=tmp_path, token=TOKEN,
                            allowed_hosts=["testserver"])
    assert TestClient(standalone).get("/api/problems").status_code == 401


def test_standalone_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    単独の起動のアプリが確かめ, /api/auth, 画面の配信を持つことを
    確かめる関数

    Parameters
    ----------
    tmp_path: Path
        一時ディレクトリ
    monkeypatch: pytest.MonkeyPatch
        画面の置き場の差し替え

    Returns
    ----------
    None
    """
    # ビルド済みの画面の代わり
    static_dir = (tmp_path / "static").resolve()
    (static_dir / "assets").mkdir(parents=True)
    (static_dir / "index.html").write_text("画面", encoding="utf-8")
    (static_dir / "assets" / "a.js").write_text("1", encoding="utf-8")
    monkeypatch.setattr("ml_pathfinder.app.STATIC_DIR", static_dir)
    standalone = create_app(data_dir=tmp_path / "home", token=TOKEN,
                            allowed_hosts=["testserver"])
    client = TestClient(standalone)

    # 違うトークンは 401, 合うトークンは Cookie を置いて画面へ
    assert client.get("/api/auth?token=x").status_code == 401
    # GET でない /api/auth はトークンの確かめを通らない
    assert client.post("/api/auth?token=x").status_code == 401
    assert client.get("/api/problems").status_code == 401
    moved = client.get(f"/api/auth?token={TOKEN}", follow_redirects=False)
    assert moved.status_code == 303 and moved.headers["location"] == "/"
    assert cookie_name(TOKEN) in moved.cookies
    assert client.get("/api/problems").json() == []

    # 別の Origin の書き込みは 403, 同じ Origin は受け付ける
    foreign = client.post("/api/problems", json={"name": "試し"},
                          headers={"origin": "http://evil.example"})
    assert foreign.status_code == 403
    same = client.post("/api/problems", json={"name": "試し"},
                       headers={"origin": "http://testserver"})
    assert same.status_code == 201
    assert (tmp_path / "home" / "problems" / same.json()["id"]
            / "problem.yaml").is_file()

    # 別のホスト名は断る
    other = client.get("/api/problems", headers={"host": "evil.example"})
    assert other.status_code == 400

    # 画面の配信と, 無い API と仕様の画面の 404
    assert client.get("/").text == "画面"
    assert client.get(f"/problems/{same.json()['id']}").text == "画面"
    assert client.get("/assets/a.js").text == "1"
    for path in ["/api", "/api/nothing", "/api/openapi.json", "/api/docs"]:
        assert client.get(path).status_code == 404, path


def test_create_api_mounted(tmp_path: Path) -> None:
    """
    API だけのアプリを別の頭の下に mount して動き, 確かめを持たない
    ことを確かめる関数

    Parameters
    ----------
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # 殻の代わりのアプリ (確かめは殻が持つので, ここでは付けない)
    problems_dir = tmp_path / "shared" / "problems"
    shell = FastAPI()
    shell.mount("/api/problem",
                create_api(tmp_path / "unused", problems_dir=problems_dir))
    client = TestClient(shell)

    # トークン無しで, 別の Origin からも作れる (確かめは殻の役目)
    assert client.get("/api/problem/problems").json() == []
    created = client.post("/api/problem/problems", json={"name": "試し"},
                          headers={"origin": "http://other.example"})
    assert created.status_code == 201, created.text
    problem_id = created.json()["id"]
    assert (problems_dir / problem_id / "problem.yaml").is_file()
    assert not (tmp_path / "unused").exists()

    # 答え, 読み, 一覧に出る
    url = f"/api/problem/problems/{problem_id}"
    answered = client.put(f"{url}/answers",
                          json={"id": "issue.pain", "value": "廃棄が多い"})
    assert answered.json()["progress"]["answered"] == 1
    assert client.get(url).json()["name"] == "試し"
    items = client.get("/api/problem/problems").json()
    assert [item["id"] for item in items] == [problem_id]
    assert client.get(f"{url}/download").status_code == 200

    # /auth も仕様の画面も持たない
    for path in ["/auth", "/openapi.json", "/docs", "/redoc"]:
        assert client.get(f"/api/problem{path}").status_code == 404, path

    # problems_dir を渡さなければ data_dir の下の problems
    default = TestClient(create_api(tmp_path / "home"))
    created = default.post("/problems", json={"name": "試し"})
    assert (tmp_path / "home" / "problems" / created.json()["id"]
            / "problem.yaml").is_file()


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
    # 見本の名前と受け渡しの分割の名前 (分けないも) は info から
    info = client.get("/api/info").json()
    examples = info["examples"]
    assert [item["value"] for item in info["splits"]] == [
        item["value"] for item in ml_quest.SPLITS
    ]
    # グループを使う分割の目印も ML-Quest のまま
    assert {item["value"] for item in info["splits"]
            if item["grouped"]} == {"group", "group_time",
                                    "stratified_group"}
    assert [item["grouped"] for item in info["splits"]] == [
        item["grouped"] for item in ml_quest.SPLITS
    ]
    assert "none" in [item["value"] for item in info["splits"]]
    view = client.post("/api/problems",
                       json={"example": examples[0]}).json()
    assert view["ready"] is True
    assert view["handoff"]["training"]["monitor"] == "valid/mae"
    # 列の予測には合う雛形が無い
    assert view["handoff"]["model"]["example"] is None
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
    stored = [
        yaml.safe_load(path.read_text())
        for path in tmp_path.rglob(f"{imported.json()['id']}/problem.yaml")
    ]
    assert len(stored) == 1 and "origin" not in stored[0]
    again_target = tmp_path / "again"
    client.post(f"/api/problems/{imported.json()['id']}/project",
                json={"path": str(again_target)})
    copy = yaml.safe_load((again_target / "problem.yaml").read_text())
    assert copy["origin"].endswith(
        f"{imported.json()['id']}/problem.yaml"
    )

    # 機械学習を使わない見本は出口 (受け渡せない)
    exit_view = client.post("/api/problems",
                            json={"example": examples[-1]}).json()
    assert exit_view["finished"] is True and exit_view["handoff"] is None
    refused = client.post(f"/api/problems/{exit_view['id']}/project",
                          json={"path": str(tmp_path / "x")})
    assert refused.status_code == 400
    assert client.post("/api/problems",
                       json={"example": "無い"}).status_code == 400


def test_project_with_open_errors(
    client: TestClient, tmp_path: Path
) -> None:
    """
    直すところが残っても骨組みを組めれば書き出せ, 確かめの指定が無ければ
    409 で一覧を返すことを確かめる関数

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
    # 見本の課題の答えを消すと受け渡せないが, 骨組みは組める
    examples = client.get("/api/info").json()["examples"]
    view = client.post("/api/problems",
                       json={"example": examples[0]}).json()
    assert view["open_errors"] == []
    url = f"/api/problems/{view['id']}"
    view = client.put(f"{url}/answers",
                      json={"id": "issue.owner", "value": None}).json()
    assert view["ready"] is False and view["handoff"] is None
    assert view["exportable"] is True and view["export_error"] is None
    # 骨組みの型は, 直すところが残っても ML-Quest の skeleton_type の名前
    assert view["skeleton_type"] == ml_quest.skeleton_type(
        ml_quest.example_problem(examples[0])
    )
    assert view["skeleton_type"] in ml_quest.SKELETON_TYPES
    assert [item["id"] for item in view["open_errors"]] == ["issue.owner"]
    assert view["open_errors"][0]["level"] == "error"
    listed = client.get("/api/problems").json()
    assert all("open_errors" not in item for item in listed)

    # 指定が無ければ 409 で一覧 (ライブラリを使うコード向けの文は出さない)
    target = tmp_path / "project"
    refused = client.post(f"{url}/project", json={"path": str(target)})
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["open_errors"] == view["open_errors"]
    assert "1 件" in detail["message"]
    assert "accept_errors" not in detail["message"]
    assert not target.exists()

    # 確かめて指定すると書き出し, README に一覧が残る
    written = client.post(f"{url}/project",
                          json={"path": str(target), "accept_errors": True})
    assert written.status_code == 200, written.json()
    readme = (target / "README.md").read_text(encoding="utf-8")
    assert "書き出した時点で残っていた直すところ" in readme
    assert "issue.owner" in readme

    # 組めない問題の設定は指定しても 400 (組めない理由の文)
    view = client.put(f"{url}/answers",
                      json={"id": "ml.use", "value": None}).json()
    assert view["exportable"] is False and view["open_errors"] == []
    refused = client.post(f"{url}/project",
                          json={"path": str(tmp_path / "never"),
                                "accept_errors": True})
    assert refused.status_code == 400
    assert refused.json()["detail"] == view["export_error"]


class CountedInspect:
    def __init__(self, inspect: Callable[[dict[str, Any]], Any]):
        # 元の分析と, 呼んだ数を保存
        self.inspect = inspect
        self.calls = 0

    def __call__(self, problem: dict[str, Any]) -> Any:
        """
        呼んだ数を数えて元の分析を呼ぶ関数

        Parameters
        ----------
        problem: dict[str, Any]
            問題の設定

        Returns
        ----------
        found: Any
            元の分析の結果
        """
        # 数えてから元の分析
        self.calls += 1
        found = self.inspect(problem)

        return found


def test_project_with_data_errors(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    入れたデータの確かめの error が直すところの一覧に入り, 覚えた分析を
    書き出しまで使い回し, 確かめて書き出しても既にあるファイルと相対
    パスは 400 にすることを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ
    monkeypatch: pytest.MonkeyPatch
        分析の呼び出しの数え (覚えた結果を使い回すかの確かめ)

    Returns
    ----------
    None
    """
    # 連絡する会員を選ぶ課題に, 目的の列が 3 種類のデータ (2 クラスでない)
    rows = 120
    pd.DataFrame({
        "member_id": range(rows), "plan": ["a", "b"] * (rows // 2),
        "months": [i % 30 for i in range(rows)],
        "inquiries": [i % 5 for i in range(rows)],
        "monthly_fee": [2000] * rows,
        "churned": ["yes", "no", "maybe"] * (rows // 3),
    }).to_csv(tmp_path / "churn.csv", index=False)
    view = client.post("/api/problems",
                       json={"example": "解約の引き止め"}).json()
    url = f"/api/problems/{view['id']}"
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "churn.csv")}).json()
    assert view["exportable"] is True and view["ready"] is True
    found = client.get(f"{url}/insight").json()
    data_errors = [item for item in found["findings"]
                   if item["level"] == "error"]
    assert data_errors
    assert all(item in view["open_errors"] for item in data_errors)

    # 覚えた分析を, 詳しい画面, 候補, 書き出し (記録の後も) で使い回す
    counted = CountedInspect(ml_quest.inspect_data)
    monkeypatch.setattr(ml_quest, "inspect_data", counted)
    monkeypatch.setattr(ml_quest.skeleton, "inspect_data", counted)
    assert client.get(url).json()["open_errors"] == view["open_errors"]
    assert client.get(f"{url}/insight").json() == found
    target = tmp_path / "project"
    written = client.post(f"{url}/project",
                          json={"path": str(target), "accept_errors": True})
    assert written.status_code == 200, written.json()
    assert client.get(url).json()["open_errors"] == view["open_errors"]
    assert counted.calls == 0

    # 確かめても, 上書きしない既にあるファイルと相対パスは 400
    again = client.post(f"{url}/project",
                        json={"path": str(target), "accept_errors": True})
    assert again.status_code == 400
    relative = client.post(f"{url}/project",
                           json={"path": "project", "accept_errors": True})
    assert relative.status_code == 400


def test_view_unreadable_data(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    データの場所が文字列でないか, 調べる権限が無い問題の設定でも, 詳しい
    画面を開け, 誤りが確かめに出ることを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者
    tmp_path: Path
        一時ディレクトリ
    monkeypatch: pytest.MonkeyPatch
        調べる権限が無いときの置き換え

    Returns
    ----------
    None
    """
    # 場所が数の問題の設定を取り込む
    problem = ml_quest.example_problem("総菜の作る量")
    problem["data"] = {"source": 123, "loader": "csv"}
    path = tmp_path / "broken.yaml"
    path.write_text(yaml.safe_dump(problem, allow_unicode=True),
                    encoding="utf-8")
    imported = client.post("/api/problems/import", json={"path": str(path)})
    assert imported.status_code in (200, 201), imported.text
    url = f"/api/problems/{imported.json()['id']}"
    view = client.get(url)
    assert view.status_code == 200, view.text
    # ML-Quest の確かめが形の誤りにし (骨組みを組めない), データの分析も
    # 同じ誤りを返す. 書き出しは組めない誤りで断る
    # 期待の確かめは ML-Quest の check から (文は ML-Quest が決める)
    expected = [item for item in ml_quest.check(problem)
                if item["id"] == "data.source"]
    assert [item["level"] for item in expected] == ["error"]
    finding = expected[0]
    message = finding["message"]
    shown = view.json()
    assert finding in shown["findings"]
    assert shown["exportable"] is False and message in shown["export_error"]
    found = client.get(f"{url}/insight")
    assert found.status_code == 200
    assert found.json()["findings"] == [finding]
    written = client.post(f"{url}/project",
                          json={"path": str(tmp_path / "never"),
                                "accept_errors": True})
    assert written.status_code == 400
    assert message in written.json()["detail"]
    assert not (tmp_path / "never").exists()

    # 入れたデータのディレクトリの中を調べる権限が無い (分析の印を作る所
    # が例外になる. 中のディレクトリの権限は OS ごとに違うので置き換えで)
    folder = tmp_path / "images"
    folder.mkdir()
    problem = ml_quest.example_problem("総菜の作る量")
    problem["data"] = {"source": str(folder), "loader": "csv"}
    path.write_text(yaml.safe_dump(problem, allow_unicode=True),
                    encoding="utf-8")
    imported = client.post("/api/problems/import", json={"path": str(path)})
    url = f"/api/problems/{imported.json()['id']}"
    monkeypatch.setattr(ml_quest.data, "data_stat", denied)
    view = client.get(url)
    assert view.status_code == 200, view.text
    finding = {"level": "error", "id": "data.source",
               "message": "データを読めません: images を読み書きする権限が"
                          "ありません"}
    assert finding in view.json()["open_errors"]
    assert client.get(f"{url}/insight").json()["findings"] == [finding]


def denied(*args: Any, **kwargs: Any) -> Any:
    """
    調べる権限が無いときの例外を投げる関数

    Parameters
    ----------
    *args: Any
        使わない
    **kwargs: Any
        使わない

    Returns
    ----------
    None
    """
    # 権限の誤り (場所はデータのディレクトリ)
    raise PermissionError(13, "Permission denied", str(args[0]))


def test_insight_key_directory(tmp_path: Path) -> None:
    """
    覚えた分析の鍵が, ディレクトリのデータの中のファイルの変化で変わり,
    プロジェクトの記録では変わらないことを確かめる関数

    Parameters
    ----------
    tmp_path: Path
        一時ディレクトリ

    Returns
    ----------
    None
    """
    # 中のファイルを足すと変わり, 記録と元の場所では変わらない
    folder = tmp_path / "images" / "circle"
    folder.mkdir(parents=True)
    (folder / "a.png").write_bytes(b"a")
    problem = ml_quest.example_problem("総菜の作る量")
    problem["data"] = {"source": str(tmp_path / "images"),
                       "loader": "image_folder"}
    before = api.insight_key("p", problem)
    recorded = dict(problem, project={"path": str(tmp_path / "x")})
    assert api.insight_key("p", recorded) == before
    assert api.insight_key("q", problem) != before
    (folder / "b.png").write_bytes(b"bb")
    assert api.insight_key("p", problem) != before


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
    assert handoff["training"]["mode"] == "min"
    # 一から学習する点群の予測は, 受け持ちに合う雛形の名前を渡す
    assert handoff["model"]["example"] == "point_cloud_predictor"
    assert handoff["model"]["example"] in ml_quest.MODEL_EXAMPLES.values()
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


def test_table_generate(client: TestClient, tmp_path: Path) -> None:
    """
    作るで正解の種類を表にし, 表を入れると, 列ごとの分布の近さを選べ,
    確かめに食い違いが無く, 表の生成の骨組みを書き出せることを確かめる関数

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
    # 見本の課題から受け持ちを作るで表に答え直す
    part = ml_quest.PART
    view = client.post("/api/problems",
                       json={"example": "総菜の作る量"}).json()
    url = f"/api/problems/{view['id']}"
    for key, value in [("role", "generate"), ("unit", "row"),
                       ("output", "table"), ("target.source", "self"),
                       ("target.kind", "table"), ("method", "scratch"),
                       ("what", "顧客の表に似た行"), ("item", "顧客の 1 行"),
                       ("baseline", "手で作る"),
                       ("evaluation.metric", "column_distance"),
                       ("evaluation.link", "近いほど元の表の代わりに使える")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())

    # 指標の選択肢に列ごとの分布の近さが, 言葉と向きの付いた名前で出る
    view = client.get(url).json()
    metric = next(q for q in view["questions"]
                  if q["id"] == f"{part}.evaluation.metric")
    labels = {c["value"]: c["label"] for c in metric["choices"]}
    assert "column_distance" in labels and "fid" not in labels
    assert "列ごとの分布の近さ" in labels["column_distance"]
    assert "小さいほど良い" in labels["column_distance"]

    # 数と種類の列の表を入れても, 確かめに直すところが無い
    frame = pd.DataFrame({"age": [float(20 + i % 30) for i in range(60)],
                          "city": ["a", "b", "c"] * 20})
    frame.to_csv(tmp_path / "customers.csv", index=False)
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "customers.csv")}).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [] and view["open_errors"] == [], errors
    assert view["ready"] is True, view["handoff_error"]

    # 受け渡しは雛形 diffusion_denoiser と, 分布の近さを小さく見る監視
    handoff = view["handoff"]
    assert handoff["model"]["example"] == "diffusion_denoiser"
    assert handoff["model"]["example"] in ml_quest.MODEL_EXAMPLES.values()
    assert handoff["training"]["monitor"] == "valid/column_distance"
    assert handoff["training"]["mode"] == "min"
    assert handoff["data"]["split"] == "random"
    assert handoff["data"]["target"] is None

    # 表の生成の骨組みを書き出し, 入れた表を data/ に写す
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "table"
    written = client.post(f"{url}/project", json={"path": str(target)})
    assert written.status_code == 200, written.json()
    assert {"train.py", "README.md", "configs/default/train.yaml",
            "data/customers.csv"} <= set(written.json()["files"])
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["trainer"]["monitor"] == "valid/column_distance"
    assert config["trainer"]["mode"] == "min"
    readme = (target / "README.md").read_text(encoding="utf-8")
    assert "元の表に似た行を作る" in readme

    # 表でないデータ (文の行) を入れると書き出せない (文は project_error)
    (tmp_path / "lines.txt").write_text("一\n二\n", encoding="utf-8")
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "lines.txt")}).json()
    assert view["exportable"] is False
    assert "表のデータで学びます" in view["export_error"]


def test_rank(client: TestClient, tmp_path: Path) -> None:
    """
    並べるで反応の表の列と並べる件数の問いが出て, 反応の表を入れると
    受け渡しに並べ方が渡り, 並べるの骨組みを書き出せることを確かめる関数

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
    # 見本の課題から受け持ちを並べるで答え直す
    part = ml_quest.PART
    view = client.post("/api/problems",
                       json={"example": "総菜の作る量"}).json()
    url = f"/api/problems/{view['id']}"
    for key, value in [("role", "rank"), ("unit", "query"),
                       ("output", "ranking"), ("target.source", "feedback"),
                       ("method", "scratch"), ("what", "会員ごとに勧める品"),
                       ("item", "会員ごとの品の並び"), ("baseline", "人気順"),
                       ("evaluation.metric", "ndcg"),
                       ("evaluation.link", "上位に買う品が来るほど売上が増える")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())

    # 5 の節に列の問い 4 つと数の問いが ML-Quest の並びのまま出て, 列の
    # 予測の問いは出ない. 答えるまでは書き出せない
    view = client.get(url).json()
    shown = [q for q in view["questions"] if q["applies"]]
    ranks = [q for q in shown if q["id"].startswith(f"{part}.rank.")]
    assert [(q["id"], q["kind"], q["required"], q["section"])
            for q in ranks] == [
        (f"{part}.rank.user", "column", True, 5),
        (f"{part}.rank.item", "column", True, 5),
        (f"{part}.rank.time", "column", True, 5),
        (f"{part}.rank.reaction", "column", False, 5),
        (f"{part}.rank.k", "number", True, 5),
    ]
    ids = [q["id"] for q in shown]
    assert ids.index("information.columns") < ids.index(f"{part}.rank.user")
    assert f"{part}.target.column" not in ids and f"{part}.task" not in ids
    assert view["exportable"] is False and view["handoff"] is None

    # 反応の表を入れると列が読め, 列と件数 (画面は文で送る) に答えられる
    rows = [{"member": f"m{i % 7}", "item_id": f"i{i % 11}", "ts": i,
             "qty": i % 3} for i in range(200)]
    pd.DataFrame(rows).to_csv(tmp_path / "reactions.csv", index=False)
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "reactions.csv")}).json()
    columns = next(q for q in view["questions"]
                   if q["id"] == "information.columns")
    assert columns["value"] == ["member", "item_id", "ts", "qty"]
    for key, value in [("user", "member"), ("item", "member"), ("time", "ts"),
                       ("reaction", "qty"), ("k", "10")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.rank.{key}",
                                    "value": value})
        assert response.status_code == 200, (key, response.json())

    # 同じ列を 2 つに答えると確かめに出る (文は ML-Quest のまま)
    view = client.get(url).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert [f["id"] for f in errors] == [f"{part}.rank.item"], errors
    view = client.put(f"{url}/answers", json={"id": f"{part}.rank.item",
                                             "value": "item_id"}).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [] and view["ready"] is True, errors

    # 受け渡しに並べ方 (件数は数), 時刻の順の分割, 2 塔の雛形, NDCG の監視
    handoff = view["handoff"]
    assert handoff["rank"] == {"user": "member", "item": "item_id",
                               "time": "ts", "reaction": "qty", "k": 10}
    assert handoff["data"]["split"] == "time"
    assert handoff["data"]["time_column"] == "ts"
    assert handoff["data"]["target"] is None
    assert handoff["model"]["example"] == "two_tower_retrieval"
    assert handoff["model"]["example"] in ml_quest.MODEL_EXAMPLES.values()
    assert handoff["training"]["monitor"] == "valid/ndcg"
    assert handoff["training"]["mode"] == "max"
    assert any("上位 10 件" in line for line in view["summary"])

    # 並べるの骨組みを書き出し, 入れた表を data/ に写して読む
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "rank"
    written = client.post(f"{url}/project", json={"path": str(target)})
    assert written.status_code == 200, written.json()
    assert {"train.py", "README.md", "configs/default/train.yaml",
            "data/reactions.csv"} <= set(written.json()["files"])
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["rank"]["k"] == 10
    assert config["data"]["dataset"] == "data/reactions.csv"
    assert config["experiment"]["name"] == "item_id_rank"

    # 書き出せるかは ML-Quest の project_error のまま (表でないデータを
    # 入れると, 答えた列が使えるデータの列から外れる)
    (tmp_path / "lines.txt").write_text("一\n二\n", encoding="utf-8")
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "lines.txt")}).json()
    problem = ml_quest.load_problem(tmp_path / "home" / "problems"
                                    / view["id"] / "problem.yaml")
    assert view["exportable"] is False
    assert view["export_error"] == ml_quest.project_error(problem)
    assert "使えるデータの列にありません" in view["export_error"]

    # 既製のモデルをそのまま使うと列と件数の問いは要らなくなり, 渡さない
    view = client.put(f"{url}/answers", json={"id": f"{part}.method",
                                             "value": "pretrained"}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert not any(applies[f"{part}.rank.{key}"]
                   for key in ("user", "item", "time", "reaction", "k"))
    assert view["handoff"] is None or view["handoff"]["rank"] is None


def test_group(client: TestClient, tmp_path: Path) -> None:
    """
    まとめるで群を作る列, 群の数, 安定性の数え方の問いが出て, 守る指標は
    問わず, 表を入れると受け渡しに群が渡り, まとめるの骨組みを書き出せる
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
    # 見本の課題に守る指標を書くと, 予測するでは守る指標の問いが出る
    part = ml_quest.PART
    view = client.post("/api/problems",
                       json={"example": "総菜の作る量"}).json()
    url = f"/api/problems/{view['id']}"
    view = client.put(f"{url}/answers", json={"id": "issue.guard.name",
                                             "value": "品切れの割合"}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert applies["issue.guard.name"] and applies["issue.guard.line"]

    # 受け持ちをまとめるで答え直す
    for key, value in [("role", "group"), ("unit", "row"),
                       ("output", "cluster"), ("target.source", "none"),
                       ("method", "scratch"), ("what", "顧客の群"),
                       ("item", "顧客ごとの 1 行"),
                       ("baseline", "使う額で 3 段に分ける"),
                       ("evaluation.metric", "silhouette"),
                       ("evaluation.link", "群ごとに案内を変えると売上が増える")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())

    # 5 の節に群の問い 4 つが ML-Quest の並びのまま出て, 列の予測の問い
    # と守る指標の問い (2 の節と, 7 の数える量) は出ない
    view = client.get(url).json()
    shown = [q for q in view["questions"] if q["applies"]]
    groups = [q for q in shown if q["id"].startswith(f"{part}.group.")]
    assert [(q["id"], q["kind"], q["required"], q["section"])
            for q in groups] == [
        (f"{part}.group.columns", "columns", True, 5),
        (f"{part}.group.id", "column", False, 5),
        (f"{part}.group.k", "number", True, 5),
        (f"{part}.group.stability", "choice", True, 5),
    ]
    stability = groups[3]
    assert [c["value"] for c in stability["choices"]] == ["seed", "sample"]
    ids = [q["id"] for q in shown]
    assert ids.index("information.columns") < ids.index(
        f"{part}.group.columns")
    assert f"{part}.target.column" not in ids and f"{part}.task" not in ids
    assert not [name for name in ids if name.startswith("issue.guard.")]
    metric = next(q for q in shown
                  if q["id"] == f"{part}.evaluation.metric")
    assert "silhouette" in [c["value"] for c in metric["choices"]]
    assert view["exportable"] is False

    # 顧客の表を入れると列が読め, 列, 群の数 (画面は文で送る), 数え方に
    # 答えられる
    rows = [{"customer": f"c{i}", "spend": (i % 3) * 100 + i % 7,
             "visits": (i % 3) * 5 + i % 2,
             "region": ["east", "west", "north"][i % 3]}
            for i in range(240)]
    pd.DataFrame(rows).to_csv(tmp_path / "customers.csv", index=False)
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "customers.csv")}).json()
    columns = next(q for q in view["questions"]
                   if q["id"] == "information.columns")
    assert columns["value"] == ["customer", "spend", "visits", "region"]
    for key, value in [("columns", ["spend", "visits", "region", "customer"]),
                       ("id", "customer"), ("k", "3"),
                       ("stability", "sample")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.group.{key}",
                                    "value": value})
        assert response.status_code == 200, (key, response.json())

    # 行を見分ける列を群を作る列にも入れると確かめに出る (文は ML-Quest
    # のまま)
    view = client.get(url).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert [f["id"] for f in errors] == [f"{part}.group.id"], errors
    view = client.put(f"{url}/answers",
                      json={"id": f"{part}.group.columns",
                            "value": ["spend", "visits", "region"]}).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [] and view["ready"] is True, errors

    # 受け渡しに群 (群の数は数), 無作為の分割, 対照学習の雛形, シルエット
    # 係数の監視. 守る指標と意思決定は渡さない
    handoff = view["handoff"]
    assert handoff["group"] == {"columns": ["spend", "visits", "region"],
                                "id": "customer", "k": 3,
                                "stability": "sample"}
    assert handoff["rank"] is None
    assert handoff["data"]["split"] == "random"
    assert handoff["data"]["target"] is None
    assert handoff["model"]["example"] == "contrastive_encoder"
    assert handoff["model"]["example"] in ml_quest.MODEL_EXAMPLES.values()
    assert handoff["training"]["monitor"] == "valid/silhouette"
    assert handoff["training"]["mode"] == "max"
    assert handoff["inference"]["guard"] is None
    assert handoff["inference"]["decision"] is None
    assert any("3 つの群" in line for line in view["summary"])

    # まとめるの骨組みを書き出し, 入れた表を data/ に写して読む
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "group"
    written = client.post(f"{url}/project", json={"path": str(target)})
    assert written.status_code == 200, written.json()
    assert {"train.py", "README.md", "configs/default/train.yaml",
            "data/customers.csv"} <= set(written.json()["files"])
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["group"]["k"] == 3
    assert config["group"]["stability"] == "sample"
    assert config["data"]["dataset"] == "data/customers.csv"
    assert config["experiment"]["name"] == "group_3"
    readme = (target / "README.md").read_text(encoding="utf-8")
    assert "group_stability.json" in readme
    assert "group_summary.json" in readme

    # 群の数が 2 より小さいと確かめに出る
    view = client.put(f"{url}/answers", json={"id": f"{part}.group.k",
                                             "value": "1"}).json()
    assert f"{part}.group.k" in [f["id"] for f in view["findings"]
                                 if f["level"] == "error"]

    # 既製のモデルをそのまま使う場合の, 要らなくなる群を作る列と行を
    # 見分ける列 (群の数と安定性の数え方は残る) と, 渡らない受け渡しの群
    view = client.put(f"{url}/answers", json={"id": f"{part}.method",
                                             "value": "pretrained"}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert not any(applies[f"{part}.group.{key}"]
                   for key in ("columns", "id"))
    assert all(applies[f"{part}.group.{key}"] for key in ("k", "stability"))
    assert view["handoff"] is None or view["handoff"]["group"] is None


def test_anomaly(client: TestClient, tmp_path: Path) -> None:
    """
    予測するで正解の種類が異常のときに, 異常の検知の列と度合いの決め方と
    件数の上限の問いが出て, 表を入れると受け渡しに異常の検知の値と件数の
    上限の振り分けが渡り, 異常の検知の骨組みを書き出せることを確かめる関数

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
    # 見本の課題の受け持ちの, 異常の検知での答え直し (正解は少し)
    part = ml_quest.PART
    view = client.post("/api/problems",
                       json={"example": "解約の引き止め"}).json()
    url = f"/api/problems/{view['id']}"
    for key, value in [("role", "predict"), ("unit", "row"),
                       ("output", "value"), ("target.source", "few"),
                       ("method", "scratch"), ("target.kind", "anomaly"),
                       ("what", "機械の異常の度合い"), ("item", "1 回の計測"),
                       ("baseline", "決まった値を超えたら")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())

    # ML-Quest の並びのままの 5 の節の異常の検知の問い 4 つと 7 の節の
    # 件数の上限. 出ない列の予測の問いと損得の問い
    view = client.get(url).json()
    shown = [q for q in view["questions"] if q["applies"]]
    anomaly = [(q["id"], q["kind"], q["required"], q["section"])
               for q in shown if q["id"].startswith(f"{part}.anomaly.")]
    assert anomaly == [
        (f"{part}.anomaly.label", "column", True, 5),
        (f"{part}.anomaly.id", "column", False, 5),
        (f"{part}.anomaly.columns", "columns", True, 5),
        (f"{part}.anomaly.score", "choice", True, 5),
        (f"{part}.anomaly.capacity", "number", True, 7),
    ]
    ids = [q["id"] for q in shown]
    assert f"{part}.target.column" not in ids and f"{part}.task" not in ids
    assert "action.decision" not in ids

    # センサの表の取り込みと, 列, 度合いの決め方, 件数の上限 (画面は文で
    # 送る) と指標の答え
    rows = [{"reading_id": f"r{i}", "temp": 20 + i % 5,
             "vibration": 0.1 * (i % 7), "memo": "x",
             "is_anomaly": 1 if i % 40 == 0 else None}
            for i in range(200)]
    pd.DataFrame(rows).to_csv(tmp_path / "sensors.csv", index=False)
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "sensors.csv")}).json()
    for key, value in [("anomaly.label", "is_anomaly"),
                       ("anomaly.id", "reading_id"),
                       ("anomaly.columns", ["temp", "vibration"]),
                       ("anomaly.score", "autoencoder"),
                       ("anomaly.capacity", "5"),
                       ("evaluation.metric", "average_precision"),
                       ("evaluation.link", "上位に異常が多いほど見逃しが減る")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())
    view = client.get(url).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [], errors
    metric = next(q for q in view["questions"]
                  if q["id"] == f"{part}.evaluation.metric")
    assert {"average_precision", "precision_at_k", "loss"} <= {
        c["value"] for c in metric["choices"]}

    # 受け渡しの異常の検知の値と, 件数の上限だけの振り分け
    handoff = view["handoff"]
    assert handoff["anomaly"] == {
        "score": "autoencoder", "label": "is_anomaly", "id": "reading_id",
        "columns": ["temp", "vibration"], "capacity": 5, "k": 5,
    }
    assert handoff["data"]["task"] == "anomaly"
    assert handoff["data"]["drop"] == ["memo"]
    assert handoff["inference"]["decision"] == {"type": "triage",
                                                "capacity": 5}
    assert handoff["inference"]["guard"] is None
    assert handoff["model"]["example"] == "tabular_autoencoder"
    assert handoff["training"]["monitor"] == "valid/average_precision"

    # 異常の検知の骨組みの書き出しと, data/ への入れた表の写し
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "anomaly"
    written = client.post(f"{url}/project", json={"path": str(target)})
    assert written.status_code == 200, written.json()
    assert {"train.py", "README.md", "configs/default/train.yaml",
            "data/sensors.csv"} <= set(written.json()["files"])
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["anomaly"]["capacity"] == 5
    assert config["anomaly"]["score"] == "autoencoder"
    assert config["experiment"]["name"] == "anomaly_autoencoder"
    readme = (target / "README.md").read_text(encoding="utf-8")
    assert "anomaly_scores.csv" in readme

    # 正解が無く距離の場合の, 問わない正解の列と指標と, 渡らない学習の値
    for key, value in [("target.source", "none"),
                       ("anomaly.score", "distance")]:
        view = client.put(f"{url}/answers",
                          json={"id": f"{part}.{key}", "value": value}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert not applies[f"{part}.anomaly.label"]
    assert not applies[f"{part}.evaluation.metric"]
    handoff = view["handoff"]
    assert handoff is not None, view["handoff_error"]
    assert handoff["anomaly"]["label"] is None
    assert handoff["training"]["monitor"] is None
    assert handoff["model"]["example"] is None
    assert view["exportable"] is True, view["export_error"]


def test_uplift(client: TestClient, tmp_path: Path) -> None:
    """
    効果を見積もるで方策でなく今ある記録から集めるときに, 処置と結果の列,
    上位の割合と配る判断の問いが出て, 表を入れると受け渡しに効果の見積もり
    の値と配る数の上限の判断が渡り, 効果の見積もりの骨組みを書き出せること
    を確かめる関数

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
    # 見本の課題の受け持ちの, 今ある記録からの効果の見積もりでの答え直し
    part = ml_quest.PART
    view = client.post("/api/problems",
                       json={"example": "解約の引き止め"}).json()
    url = f"/api/problems/{view['id']}"
    for key, value in [("role", "effect"), ("unit", "row"),
                       ("output", "effect"),
                       ("target.source", "intervention"),
                       ("method", "scratch"), ("autonomous", False),
                       ("collect", "log"),
                       ("what", "クーポンで買う確率がどれだけ上がるか"),
                       ("item", "顧客ごとの 1 行"),
                       ("baseline", "全員に配る")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())

    # ML-Quest の並びのままの 5 の節の効果の見積もりの問い 5 つと 8 の節の
    # 上位の割合. 出ない列の予測の問いと, 配る判断だけの意思決定の型
    view = client.get(url).json()
    shown = [q for q in view["questions"] if q["applies"]]
    uplift = [(q["id"], q["kind"], q["required"], q["section"])
              for q in shown if q["id"].startswith(f"{part}.uplift.")]
    assert uplift == [
        (f"{part}.uplift.treatment", "column", True, 5),
        (f"{part}.uplift.outcome", "column", True, 5),
        (f"{part}.uplift.outcome_kind", "choice", True, 5),
        (f"{part}.uplift.id", "column", False, 5),
        (f"{part}.uplift.columns", "columns", True, 5),
        (f"{part}.uplift.k", "number", True, 8),
    ]
    ids = [q["id"] for q in shown]
    assert f"{part}.target.column" not in ids and f"{part}.task" not in ids
    assert "action.current" not in ids
    decision = next(q for q in shown if q["id"] == "action.decision")
    assert [c["value"] for c in decision["choices"]] == ["treat"]
    assert [f["key"] for f in decision["choices"][0]["fields"]] == ["budget"]
    metric = next(q for q in shown if q["id"] == f"{part}.evaluation.metric")
    assert "qini" in [c["value"] for c in metric["choices"]]
    assert "reward" not in [c["value"] for c in metric["choices"]]

    # 無作為に配った記録の表の取り込みと, 列, 上位の割合 (画面は文で送る),
    # 配る判断と指標の答え
    rows = [{"customer_id": f"c{i}", "age": 20 + i % 40,
             "visits": i % 9, "coupon": i % 2,
             "purchased": int((i * 7) % 10 < 3 + (i % 2) * (i % 9) // 3),
             "used": i % 2 * (i % 3 == 0)}
            for i in range(240)]
    pd.DataFrame(rows).to_csv(tmp_path / "coupons.csv", index=False)
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "coupons.csv")}).json()
    for key, value in [("uplift.treatment", "coupon"),
                       ("uplift.outcome", "purchased"),
                       ("uplift.outcome_kind", "binary"),
                       ("uplift.id", "customer_id"),
                       ("uplift.columns", ["age", "visits"]),
                       ("uplift.k", "0.3"),
                       ("evaluation.metric", "qini"),
                       ("evaluation.link", "効果の順が当たるほど費用が実る")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())
    response = client.put(f"{url}/answers",
                          json={"id": "action.decision",
                                "value": {"type": "treat", "budget": "50"}})
    assert response.status_code == 200, response.json()
    view = client.get(url).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [], errors

    # 受け渡しの効果の見積もりの値と, 配る数の上限だけの判断
    handoff = view["handoff"]
    assert handoff["uplift"] == {
        "treatment": "coupon", "outcome": "purchased",
        "outcome_kind": "binary", "id": "customer_id",
        "columns": ["age", "visits"], "k": 0.3,
    }
    assert handoff["anomaly"] is None
    assert handoff["data"]["task"] == "uplift"
    assert handoff["data"]["split"] == "stratified"
    assert handoff["data"]["drop"] == ["used"]
    assert handoff["inference"]["decision"] == {"type": "treat",
                                                "budget": 50}
    assert handoff["inference"]["guard"] is None
    assert handoff["model"]["example"] == "tabular_uplift"
    assert handoff["model"]["outputs"] == 1
    assert handoff["training"]["monitor"] == "valid/qini"

    # 効果の見積もりの骨組みの書き出しと, data/ への入れた表の写し
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "uplift"
    written = client.post(f"{url}/project", json={"path": str(target)})
    assert written.status_code == 200, written.json()
    assert {"train.py", "README.md", "configs/default/train.yaml",
            "data/coupons.csv"} <= set(written.json()["files"])
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["uplift"]["k"] == 0.3
    assert config["uplift"]["budget"] == 50
    assert config["experiment"]["name"] == "purchased_uplift"
    readme = (target / "README.md").read_text(encoding="utf-8")
    assert "uplift_estimator.json" in readme

    # 配る数の上限が 1 より小さいと確かめに出て, 受け渡せないが書き出せる
    view = client.put(f"{url}/answers",
                      json={"id": "action.decision",
                            "value": {"type": "treat", "budget": "0"}}).json()
    assert any(f["id"].startswith("action.decision")
               for f in view["open_errors"]), view["open_errors"]
    assert view["exportable"] is True, view["export_error"]

    # 方策と答えると効果の見積もりの問いは要らなくなる
    view = client.put(f"{url}/answers", json={"id": f"{part}.autonomous",
                                             "value": True}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert not any(applies[f"{part}.uplift.{key}"]
                   for key in ("treatment", "outcome", "columns", "k"))


def test_price(client: TestClient, tmp_path: Path) -> None:
    """
    効果を見積もるで今ある記録の値段を変えたと答えるときに, 値段, 売れた数,
    原価, 商品の id, 行の id の列と値段の判断の問いが出て, 表を入れると受け
    渡しに値段を変える判断の値と値段の判断が渡り, 値段を変える判断の骨組み
    を書き出せることを確かめる関数

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
    # 見本の課題の受け持ちの, 今ある記録の値段を変える判断での答え直し
    part = ml_quest.PART
    view = client.post("/api/problems",
                       json={"example": "解約の引き止め"}).json()
    url = f"/api/problems/{view['id']}"
    for key, value in [("role", "effect"), ("unit", "row"),
                       ("output", "effect"),
                       ("target.source", "intervention"),
                       ("method", "scratch"), ("autonomous", False),
                       ("collect", "log"), ("varied", "price"),
                       ("what", "値段ごとの売れた数"),
                       ("item", "商品と日ごとの 1 行"),
                       ("baseline", "今の値段のまま")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())

    # ML-Quest の並びのままの 5 の節の値段を変える判断の問い 6 つ. 出ない
    # 効果の見積もりと列の予測の問いと, 値段の判断だけの意思決定の型
    view = client.get(url).json()
    shown = [q for q in view["questions"] if q["applies"]]
    price = [(q["id"], q["kind"], q["required"], q["section"])
             for q in shown if q["id"].startswith(f"{part}.price.")]
    assert price == [
        (f"{part}.price.price", "column", True, 5),
        (f"{part}.price.units", "column", True, 5),
        (f"{part}.price.cost", "column", False, 5),
        (f"{part}.price.product", "column", False, 5),
        (f"{part}.price.id", "column", False, 5),
        (f"{part}.price.columns", "columns", True, 5),
    ]
    ids = [q["id"] for q in shown]
    assert not any(name.startswith(f"{part}.uplift.") for name in ids)
    assert f"{part}.target.column" not in ids and "action.current" not in ids
    decision = next(q for q in shown if q["id"] == "action.decision")
    assert [c["value"] for c in decision["choices"]] == ["price"]
    fields = decision["choices"][0]["fields"]
    assert [(f["key"], f.get("list", False)) for f in fields] == [
        ("candidates", True), ("max_change", False)]
    metric = next(q for q in shown if q["id"] == f"{part}.evaluation.metric")
    values = [c["value"] for c in metric["choices"]]
    assert "mae" in values and "loss" in values
    assert "qini" not in values and "reward" not in values

    # 試しに値段を変えた売れ行きの表の取り込みと, 列, 値段の判断 (画面は
    # 候補をカンマで区切った文で送る) と指標の答え
    rows = [{"record_id": f"r{i}", "product_id": f"p{i % 12}",
             "category": i % 3, "weekday": i % 7,
             "price": 100 * (1 + (i % 5 - 2) * 0.05),
             "units": 20 - (i % 5) * (1 + i % 3), "unit_cost": 60,
             "left": i % 4}
            for i in range(240)]
    pd.DataFrame(rows).to_csv(tmp_path / "sales.csv", index=False)
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "sales.csv")}).json()
    for key, value in [("price.price", "price"), ("price.units", "units"),
                       ("price.cost", "unit_cost"),
                       ("price.product", "product_id"),
                       ("price.id", "record_id"),
                       ("price.columns", ["category", "weekday"]),
                       ("evaluation.metric", "mae"),
                       ("evaluation.link", "売れた数が当たるほど利益が増える")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())
    response = client.put(f"{url}/answers", json={
        "id": "action.decision",
        "value": {"type": "price", "candidates": "-0.1, -0.05, 0, 0.05, 0.1",
                  "max_change": "0.1"}})
    assert response.status_code == 200, response.json()
    view = client.get(url).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [], errors

    # 受け渡しの値段を変える判断の値と, 候補と上限だけの値段の判断
    handoff = view["handoff"]
    assert handoff["price"] == {
        "price": "price", "units": "units", "cost": "unit_cost",
        "product": "product_id", "id": "record_id",
        "columns": ["category", "weekday"],
    }
    assert handoff["uplift"] is None
    assert handoff["data"]["task"] == "price"
    assert handoff["data"]["split"] == "stratified"
    assert handoff["data"]["known"] == ["category", "weekday", "price"]
    assert handoff["data"]["drop"] == ["left"]
    assert handoff["inference"]["decision"] == {
        "type": "price", "candidates": [-0.1, -0.05, 0, 0.05, 0.1],
        "max_change": 0.1}
    assert handoff["inference"]["guard"] is None
    assert handoff["model"]["example"] == "tabular_price"
    assert handoff["model"]["outputs"] == 1
    assert handoff["training"]["monitor"] == "valid/mae"

    # 値段を変える判断の骨組みの書き出しと, data/ への入れた表の写し
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "price"
    written = client.post(f"{url}/project", json={"path": str(target)})
    assert written.status_code == 200, written.json()
    assert {"train.py", "README.md", "configs/default/train.yaml",
            "data/sales.csv"} <= set(written.json()["files"])
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["price"]["candidates"] == [-0.1, -0.05, 0, 0.05, 0.1]
    assert config["price"]["max_change"] == 0.1
    assert config["experiment"]["name"] == "units_price"
    readme = (target / "README.md").read_text(encoding="utf-8")
    assert "price_estimator.json" in readme

    # 候補に今の値段 (0) が無いと確かめに出て, 受け渡せないが書き出せる
    view = client.put(f"{url}/answers", json={
        "id": "action.decision",
        "value": {"type": "price", "candidates": "-0.1, 0.1",
                  "max_change": "0.1"}}).json()
    assert any(f["id"].startswith("action.decision")
               for f in view["open_errors"]), view["open_errors"]
    assert view["exportable"] is True, view["export_error"]

    # 配ったかと答え直すと値段を変える判断の問いは要らなくなる
    view = client.put(f"{url}/answers", json={"id": f"{part}.varied",
                                             "value": "treat"}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert not any(applies[f"{part}.price.{key}"]
                   for key in ("price", "units", "columns"))
    assert applies[f"{part}.uplift.treatment"]


def test_demand(client: TestClient, tmp_path: Path) -> None:
    """
    予測するで正解の種類が先の期間の需要と答えるときに, 商品の id, 日付,
    売れた数, 在庫の数の列と学ぶ水準 (数の並び) と発注の判断の問いが出て,
    表を入れると受け渡しに時間をまたぐ量の判断の値と発注の判断が渡り, 時間
    をまたぐ量の判断の骨組みを書き出せることを確かめる関数

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
    # 見本の課題の受け持ちの, 先の期間の需要の予測での答え直し
    part = ml_quest.PART
    view = client.post("/api/problems",
                       json={"example": "解約の引き止め"}).json()
    url = f"/api/problems/{view['id']}"
    for key, value in [("role", "predict"), ("unit", "row"),
                       ("output", "distribution"), ("target.kind", "demand"),
                       ("target.source", "column"), ("method", "scratch"),
                       ("what", "先の 7 日の売れる数"),
                       ("item", "商品と発注を決める日ごとの 1 行"),
                       ("baseline", "前の 7 日と同じ数を発注する")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())

    # ML-Quest の並びのままの 5 の節の時間をまたぐ量の判断の問い 8 つ (学ぶ
    # 水準は数の並び). 出ない列の予測の問いと, 発注の判断だけの意思決定の型
    view = client.get(url).json()
    shown = [q for q in view["questions"] if q["applies"]]
    demand = [(q["id"], q["kind"], q["required"], q["section"])
              for q in shown if q["id"].startswith(f"{part}.demand.")]
    assert demand == [
        (f"{part}.demand.product", "column", True, 5),
        (f"{part}.demand.date", "column", True, 5),
        (f"{part}.demand.units", "column", True, 5),
        (f"{part}.demand.stock", "column", False, 5),
        (f"{part}.demand.id", "column", False, 5),
        (f"{part}.demand.columns", "columns", False, 5),
        (f"{part}.demand.horizon", "number", False, 5),
        (f"{part}.demand.levels", "numbers", False, 5),
    ]
    ids = [q["id"] for q in shown]
    assert f"{part}.target.column" not in ids and "action.current" not in ids
    decision = next(q for q in shown if q["id"] == "action.decision")
    assert [c["value"] for c in decision["choices"]] == ["order"]
    fields = decision["choices"][0]["fields"]
    assert [f["key"] for f in fields] == [
        "shortage_cost", "holding_cost", "max_order"]

    # 商品ごとの日ごとの売れた数の記録の取り込みと, 列, 期間と発注の判断と
    # 指標の答え
    rows = [{"record_id": f"r{i}", "product_id": f"p{i % 4}",
             "date": f"2026-01-{1 + i // 4:02d}", "category": i % 4 % 2,
             "units": 3 + i % 5, "stock": 2, "waste": i % 3}
            for i in range(4 * 28)]
    pd.DataFrame(rows).to_csv(tmp_path / "daily.csv", index=False)
    view = client.post(f"{url}/data",
                       json={"path": str(tmp_path / "daily.csv")}).json()
    for key, value in [("demand.product", "product_id"),
                       ("demand.date", "date"), ("demand.units", "units"),
                       ("demand.stock", "stock"),
                       ("demand.id", "record_id"),
                       ("demand.columns", ["category"]),
                       ("demand.horizon", "7"),
                       ("evaluation.metric", "loss"),
                       ("evaluation.link", "分位点の損失が小さいほど発注の"
                        "損の見込みが当たる")]:
        response = client.put(f"{url}/answers",
                              json={"id": f"{part}.{key}", "value": value})
        assert response.status_code == 200, (key, response.json())
    response = client.put(f"{url}/answers", json={
        "id": "action.decision",
        "value": {"type": "order", "shortage_cost": "3",
                  "holding_cost": "1", "max_order": "60"}})
    assert response.status_code == 200, response.json()

    # 学ぶ水準は画面がカンマで区切った文で送り, 数の並びで保存する. 末尾の
    # カンマ, 続いたカンマ, 読点は誤りで, 答えは変えない. 空白だけなら消す
    levels = f"{part}.demand.levels"
    response = client.put(f"{url}/answers",
                          json={"id": levels, "value": "0.1, 0.9"})
    assert response.status_code == 200, response.json()
    for text, message in [("0.1, 0.9, ", "空の要素"), ("0.1, , 0.9", "空の要素"),
                          ("0.1、0.9", "数で")]:
        response = client.put(f"{url}/answers",
                              json={"id": levels, "value": text})
        assert response.status_code == 400, (text, response.json())
        assert message in response.json()["detail"], response.json()
    view = client.get(url).json()
    saved = next(q for q in view["questions"] if q["id"] == levels)
    assert saved["value"] == [0.1, 0.9]
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [], errors

    # 受け渡しの時間をまたぐ量の判断の値 (水準に 0.5 と τ = 3 / (3 + 1) を
    # 足す) と, 損と上限だけの発注の判断
    handoff = view["handoff"]
    assert handoff["demand"] == {
        "product": "product_id", "date": "date", "units": "units",
        "stock": "stock", "id": "record_id", "columns": ["category"],
        "horizon": 7, "levels": [0.1, 0.5, 0.75, 0.9],
    }
    assert handoff["price"] is None and handoff["uplift"] is None
    assert handoff["data"]["task"] == "demand"
    assert handoff["data"]["split"] == "time"
    assert handoff["data"]["known"] == ["category"]
    assert handoff["data"]["drop"] == ["waste"]
    assert handoff["inference"]["decision"] == {
        "type": "order", "shortage_cost": 3, "holding_cost": 1,
        "max_order": 60}
    assert handoff["inference"]["guard"] is None
    assert handoff["model"]["example"] == "tabular_demand"
    assert handoff["model"]["outputs"] == 4
    assert handoff["training"]["monitor"] == "valid/loss"

    # 時間をまたぐ量の判断の骨組みの書き出しと, data/ への入れた表の写し
    assert view["exportable"] is True and view["export_error"] is None
    target = tmp_path / "demand"
    written = client.post(f"{url}/project", json={"path": str(target)})
    assert written.status_code == 200, written.json()
    assert {"train.py", "README.md", "configs/default/train.yaml",
            "data/daily.csv"} <= set(written.json()["files"])
    config = yaml.safe_load((target / "configs" / "default" / "train.yaml")
                            .read_text(encoding="utf-8"))
    assert config["order"] == {"shortage_cost": 3, "holding_cost": 1,
                               "max_order": 60}
    assert config["demand"]["levels"] == [0.1, 0.5, 0.75, 0.9]
    assert config["experiment"]["name"] == "units_demand"
    readme = (target / "README.md").read_text(encoding="utf-8")
    assert "demand_estimator.json" in readme

    # 水準の答えを消すと (画面は空白だけの欄を null で送る), 既定の水準に戻る
    view = client.put(f"{url}/answers",
                      json={"id": levels, "value": None}).json()
    assert view["handoff"]["demand"]["levels"] == [0.1, 0.25, 0.5, 0.75,
                                                   0.9]

    # 損が 0 だと確かめに出て, 受け渡せないが書き出せる
    view = client.put(f"{url}/answers", json={
        "id": "action.decision",
        "value": {"type": "order", "shortage_cost": "3",
                  "holding_cost": "0", "max_order": "60"}}).json()
    assert any(f["id"].startswith("action.decision")
               for f in view["open_errors"]), view["open_errors"]
    assert view["exportable"] is True, view["export_error"]

    # 表の列と答え直すと時間をまたぐ量の判断の問いは要らなくなる
    view = client.put(f"{url}/answers", json={"id": f"{part}.target.kind",
                                             "value": "column"}).json()
    applies = {q["id"]: q["applies"] for q in view["questions"]}
    assert not any(applies[f"{part}.demand.{key}"]
                   for key in ("product", "date", "units", "levels"))
    assert applies[f"{part}.target.column"]


def test_guard_counted(client: TestClient) -> None:
    """
    守る指標の数える量の問いが 7 の節に意思決定の型で絞った選択肢で出て,
    受け渡しの守る指標に counted として渡ることを確かめる関数

    Parameters
    ----------
    client: TestClient
        利用者

    Returns
    ----------
    None
    """
    # 選ぶ意思決定の見本は, 7 の節の ML-Quest の並びのまま問いが出る
    view = client.post("/api/problems",
                       json={"example": "解約の引き止め"}).json()
    url = f"/api/problems/{view['id']}"
    shown = [q for q in view["questions"] if q["applies"]]
    seven = [q["id"] for q in shown if q["section"] == 7]
    order = [q["id"] for q in ml_quest.questions(ml_quest.example_problem(
        "解約の引き止め")) if q["applies"] and q["section"] == 7]
    assert seven == order and "issue.guard.counted" in seven
    counted = next(q for q in shown if q["id"] == "issue.guard.counted")
    values = [choice["value"] for choice in counted["choices"]]
    assert values == [*ml_quest.GUARD_COUNTS["select"], "none"]

    # 量を選ぶと受け渡しに名前で渡り, 指さないと None
    assert view["handoff"]["inference"]["guard"]["counted"] is None
    view = client.put(f"{url}/answers",
                      json={"id": "issue.guard.counted",
                            "value": "selected"}).json()
    errors = [f for f in view["findings"] if f["level"] == "error"]
    assert errors == [], errors
    guard = view["handoff"]["inference"]["guard"]
    assert guard["counted"] == "selected"

    # 割合の量では, 守る線 (2 の節の 5 件) を 0 から 1 で書くよう出る
    view = client.put(f"{url}/answers",
                      json={"id": "issue.guard.counted",
                            "value": "selected_hit_rate"}).json()
    assert "issue.guard.line" in [f["id"] for f in view["findings"]
                                  if f["level"] == "error"]

    # 型に無い量は確かめに出る (文は ML-Quest のまま)
    view = client.put(f"{url}/answers", json={"id": "issue.guard.counted",
                                             "value": "shortage"}).json()
    assert "issue.guard.counted" in [f["id"] for f in view["findings"]
                                     if f["level"] == "error"]


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
        "safety_key": "cost", "approver": "設備の責任者", "env_id": None,
    }

    # 環境の登録名を答えると受け渡しの方策とファイルに入り (骨組みはそこ
    # から読む), 形が違えば直すところになる. 空に戻すと None
    env_id = f"{part}.env_id"
    question = {item["id"]: item for item in view["questions"]}[env_id]
    assert question["applies"] and not question["required"]
    view = client.put(f"{url}/answers",
                      json={"id": env_id, "value": " Hopper-v5 "}).json()
    assert view["handoff"]["policy"]["env_id"] == "Hopper-v5"
    assert "Hopper-v5" in client.get(f"{url}/download").text
    view = client.put(f"{url}/answers",
                      json={"id": env_id, "value": "Hopper v5"}).json()
    assert view["ready"] is False
    assert any(item["id"] == env_id and item["level"] == "error"
               for item in view["findings"])
    view = client.put(f"{url}/answers",
                      json={"id": env_id, "value": None}).json()
    assert view["handoff"]["policy"]["env_id"] is None

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


def test_sensitivity(client: TestClient, tmp_path: Path) -> None:
    """
    損得の値の幅から結論の変わり方を返し, 誤りを 400 にすることを
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
    # 型ごとの幅を渡せる項目は info に
    fields = client.get("/api/info").json()["sensitivity_fields"]
    assert fields == {kind: list(names) for kind, names
                      in ml_quest.SENSITIVITY_FIELDS.items()}

    # 量を決める見本に, データと今のやり方 (前の週の同じ曜日) を入れる
    view = client.post("/api/problems",
                       json={"example": "総菜の作る量"}).json()
    url = f"/api/problems/{view['id']}"
    days = pd.date_range("2025-01-01", periods=60).strftime("%Y-%m-%d")
    pd.DataFrame({
        "date": days, "store": "a", "item": "x",
        "sales": [float(50 + i % 7 * 10 + i % 3) for i in range(60)],
        "temperature_forecast": 20.0, "promo": 0, "customers": 100,
    }).to_csv(tmp_path / "sozai.csv", index=False)
    client.post(f"{url}/data", json={"path": str(tmp_path / "sozai.csv")})
    client.put(f"{url}/answers", json={
        "id": "action.current", "value": {"type": "lag", "periods": 7}
    })
    found = client.post(f"{url}/sensitivity", json={
        "ranges": {"under_cost": [100, 300], "over_cost": [100, 200]},
        "points": 3,
    })
    assert found.status_code == 200
    result = found.json()
    assert result["type"] == "quantity"
    assert result["data"]["rows"] > 0
    under = result["fields"][0]
    assert under["field"] == "under_cost"
    assert [point["value"] for point in under["points"]] == [100, 200, 300]
    assert under["points"][0]["rule"] == pytest.approx(100 / 250)
    assert "current" in under["points"][0]["loss"]
    assert under["swing"]["loss"] > 0 and under["sentence"]
    assert any("予測" in note for note in result["notes"])

    # 幅を渡せない項目, 幅の誤り, 点の数の誤りは画面の誤り (ML-Quest の文)
    wrong = client.post(f"{url}/sensitivity",
                        json={"ranges": {"budget": [1, 2]}})
    assert wrong.status_code == 400
    assert "件数の上限 (budget) には幅を渡せません" in wrong.json()["detail"]
    flipped = client.post(f"{url}/sensitivity",
                          json={"ranges": {"under_cost": [300, 100]}})
    assert flipped.json()["detail"] == (
        "足りないときの損 (under_cost) の幅は, 下を上以下にしてください"
    )
    for points in (1, 22):
        few = client.post(f"{url}/sensitivity", json={
            "ranges": {"under_cost": [100, 300]}, "points": points
        })
        assert few.status_code == 400
        assert "2 から 21" in few.json()["detail"]
    assert client.post(f"{url}/sensitivity",
                       json={"ranges": {}}).status_code == 400

    # 対象を選ぶ型は件数の上限と選ばなくなる値. 意思決定しなければ誤り
    view = client.post("/api/problems",
                       json={"example": "解約の引き止め"}).json()
    url = f"/api/problems/{view['id']}"
    result = client.post(f"{url}/sensitivity", json={
        "ranges": {"cost": [1000, 6000], "budget": [100, 500]}, "points": 3
    }).json()
    cost, budget = result["fields"]
    assert [point["acts"] for point in cost["points"]] == [True, True, False]
    assert [point["limit"] for point in budget["points"]] == [100, 300, 500]
    assert result["data"] is None
    client.put(f"{url}/answers", json={"id": "action.decision",
                                       "value": {"type": "none"}})
    none = client.post(f"{url}/sensitivity",
                       json={"ranges": {"cost": [1000, 6000]}})
    assert none.status_code == 400
    assert client.post("/api/problems/nothing/sensitivity", json={
        "ranges": {"cost": [1, 2]}
    }).status_code == 404
