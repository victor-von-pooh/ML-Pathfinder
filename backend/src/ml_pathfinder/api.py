import threading
from pathlib import Path
from typing import Any, Optional

import ml_quest
import yaml
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ml_pathfinder.store import Store

router = APIRouter(prefix="/api")

# 読んで答えて書く間を 1 つずつにする鍵 (答えが消えないように)
EDIT_LOCK = threading.Lock()

# 名前に使える長さ
MAX_NAME = 80

# 画面に返す誤りとする例外
USER_ERRORS = (ValueError, FileNotFoundError, yaml.YAMLError)


class ProblemCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=MAX_NAME)
    example: Optional[str] = None


class AnswerRequest(BaseModel):
    id: str
    value: Any = None


class PathRequest(BaseModel):
    path: str = Field(min_length=1)


class ProjectRequest(BaseModel):
    path: str = Field(min_length=1)
    name: Optional[str] = None
    overwrite: bool = False


def get_store(request: Request) -> Store:
    """
    アプリの置き場を返す関数

    Parameters
    ----------
    request: Request
        リクエスト

    Returns
    ----------
    store: Store
        置き場
    """
    store: Store = request.app.state.store

    return store


def user_error(error: Exception) -> HTTPException:
    """
    問題の設定の誤りを, 画面に出す 400 の例外にする関数

    Parameters
    ----------
    error: Exception
        起きた例外

    Returns
    ----------
    exception: HTTPException
        400 の例外 (文は元の誤りの文)
    """
    # 誤りの文をそのまま
    message = str(error) or type(error).__name__
    exception = HTTPException(400, message)

    return exception


def load_or_404(store: Store, problem_id: str) -> dict[str, Any]:
    """
    問題の設定を読み, 無ければ 404 にする関数

    Parameters
    ----------
    store: Store
        置き場
    problem_id: str
        識別子

    Returns
    ----------
    problem: dict[str, Any]
        問題の設定

    Raises
    ----------
    HTTPException
        無い場合は 404
    """
    # 形の違う識別子も無いものと同じ
    try:
        problem = store.load(problem_id)
    except KeyError as error:
        raise HTTPException(404, "問題の設定が見つかりません") from error

    return problem


def progress_of(items: list[dict[str, Any]]) -> dict[str, Any]:
    """
    要る問いのうち答えた数を, 節ごとと全体で数える関数

    Parameters
    ----------
    items: list[dict[str, Any]]
        問いの並び (ml_quest.questions の結果)

    Returns
    ----------
    progress: dict[str, Any]
        answered, required (全体) と, sections (節ごとの同じ数)
    """
    # 今要る問いの, 要るものだけを数える
    sections: dict[int, dict[str, int]] = {
        number: {"answered": 0, "required": 0}
        for number in ml_quest.SECTIONS
    }
    for item in items:
        if not item["applies"] or not item["required"]:
            continue
        counts = sections[item["section"]]
        counts["required"] += 1
        counts["answered"] += int(item["answered"])
    progress = {
        "answered": sum(c["answered"] for c in sections.values()),
        "required": sum(c["required"] for c in sections.values()),
        "sections": [
            {"number": number, "title": ml_quest.SECTIONS[number], **counts}
            for number, counts in sections.items()
        ],
    }

    return progress


def problem_view(problem_id: str, problem: dict[str, Any]) -> dict[str, Any]:
    """
    問題の設定と, 問い, 確かめ, 要約, 受け渡しをまとめる関数

    Parameters
    ----------
    problem_id: str
        識別子
    problem: dict[str, Any]
        問題の設定

    Returns
    ----------
    view: dict[str, Any]
        画面に出す全て (受け渡せない場合は handoff が None で, 理由を
        handoff_error に)
    """
    # 機械学習を使わない出口と, 直すところの残る問題の設定は受け渡せない
    items = ml_quest.questions(problem)
    findings = ml_quest.check(problem)
    try:
        handoff: Optional[dict[str, Any]] = ml_quest.handoff(problem)
        reason = None
    except ValueError as error:
        handoff, reason = None, str(error)
    uses = ml_quest.get_value(problem, "ml.use")
    view = {
        "id": problem_id,
        "name": problem.get("name", ""),
        "created_at": problem.get("created_at"),
        "updated_at": problem.get("updated_at"),
        "uses_ml": uses,
        "questions": items,
        "progress": progress_of(items),
        "findings": findings,
        "summary": ml_quest.describe(problem),
        "handoff": handoff,
        "handoff_error": reason,
        "ready": handoff is not None,
        "finished": uses is False and not any(
            item["level"] == "error" for item in findings
        ),
    }

    return view


def list_item(problem_id: str, problem: dict[str, Any]) -> dict[str, Any]:
    """
    一覧の 1 行 (名前, 進み具合, 渡せるか) を作る関数

    Parameters
    ----------
    problem_id: str
        識別子
    problem: dict[str, Any]
        問題の設定

    Returns
    ----------
    item: dict[str, Any]
        一覧の 1 行
    """
    # 画面の一覧に要るものだけ
    view = problem_view(problem_id, problem)
    item = {key: view[key] for key in (
        "id", "name", "updated_at", "uses_ml", "progress", "ready",
        "finished"
    )}
    item["errors"] = sum(1 for f in view["findings"] if f["level"] == "error")

    return item


@router.get("/info")
def get_info() -> dict[str, Any]:
    """
    問いの節, タスク, 指標, 見本の名前を返す関数

    Parameters
    ----------
    None

    Returns
    ----------
    info: dict[str, Any]
        sections, examples, format_version
    """
    # 画面が固定で持たずに済むもの
    info = {
        "format_version": ml_quest.FORMAT_VERSION,
        "sections": [{"number": number, "title": title}
                     for number, title in ml_quest.SECTIONS.items()],
        "examples": list(ml_quest.EXAMPLES),
    }

    return info


@router.get("/browse")
def browse(path: str = "~") -> dict[str, Any]:
    """
    ディレクトリの中身を返す関数 (ファイルとディレクトリを選ぶため)

    Parameters
    ----------
    path: str = "~"
        ディレクトリ (~ から書ける)

    Returns
    ----------
    listing: dict[str, Any]
        path, parent, home, entries (名前, 場所, ディレクトリか, 大きさ),
        truncated

    Raises
    ----------
    HTTPException
        ディレクトリでない場合は 404
    """
    # 隠しファイルを除いて, ディレクトリを先に名前の順で並べる
    target = Path(path).expanduser().resolve()
    if not target.is_dir():
        raise HTTPException(404, f"{target} はディレクトリではありません")
    try:
        children = sorted(
            target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())
        )
    except PermissionError as error:
        raise HTTPException(403, "読む権限がありません") from error
    visible = [c for c in children if not c.name.startswith(".")]
    entries = []
    for child in visible[:1000]:
        try:
            size = child.stat().st_size if child.is_file() else None
        except OSError:
            continue
        entries.append({
            "name": child.name, "path": str(child),
            "is_dir": child.is_dir(), "size": size,
            "project": child.is_dir() and (
                child / "configs" / "default" / "train.yaml"
            ).is_file(),
        })
    listing = {
        "path": str(target),
        "parent": str(target.parent) if target.parent != target else None,
        "home": str(Path.home()),
        "entries": entries,
        "truncated": len(visible) > 1000,
    }

    return listing


@router.get("/problems")
def list_problems(request: Request) -> list[dict[str, Any]]:
    """
    問題の設定の一覧を返す関数

    Parameters
    ----------
    request: Request
        リクエスト

    Returns
    ----------
    items: list[dict[str, Any]]
        更新の新しい順の一覧
    """
    # 置き場の全て
    items = [list_item(problem_id, problem)
             for problem_id, problem in get_store(request).list()]

    return items


@router.post("/problems", status_code=201)
def create_problem(
    request: Request, body: ProblemCreate
) -> dict[str, Any]:
    """
    空か見本の問題の設定を作る関数

    Parameters
    ----------
    request: Request
        リクエスト
    body: ProblemCreate
        名前か見本の名前

    Returns
    ----------
    view: dict[str, Any]
        作った問題の設定

    Raises
    ----------
    HTTPException
        名前も見本も無い場合と, 無い見本の場合は 400
    """
    # 見本は答えを順に入れたもの
    try:
        if body.example:
            problem = ml_quest.example_problem(body.example)
            if body.name and body.name.strip():
                problem["name"] = body.name.strip()
        else:
            problem = ml_quest.new_problem(body.name or "")
    except ValueError as error:
        raise user_error(error) from error
    store = get_store(request)
    problem_id = store.create(problem)
    view = problem_view(problem_id, store.load(problem_id))

    return view


@router.post("/problems/import", status_code=201)
def import_problem(request: Request, body: PathRequest) -> dict[str, Any]:
    """
    手元の problem.yaml (か, それを持つディレクトリ) を写して取り込む関数

    Parameters
    ----------
    request: Request
        リクエスト
    body: PathRequest
        場所

    Returns
    ----------
    view: dict[str, Any]
        取り込んだ問題の設定
    """
    # 元のファイルは変えない (置き場に写す)
    try:
        problem = ml_quest.load_problem(Path(body.path).expanduser())
    except (*USER_ERRORS, OSError) as error:
        raise user_error(error) from error
    if not str(problem.get("name") or "").strip():
        problem["name"] = Path(body.path).stem
    store = get_store(request)
    problem_id = store.create(problem)
    view = problem_view(problem_id, store.load(problem_id))

    return view


@router.get("/problems/{problem_id}")
def get_problem(request: Request, problem_id: str) -> dict[str, Any]:
    """
    問題の設定と, 問い, 確かめ, 要約, 受け渡しを返す関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子

    Returns
    ----------
    view: dict[str, Any]
        画面に出す全て
    """
    # 読むだけ
    problem = load_or_404(get_store(request), problem_id)
    view = problem_view(problem_id, problem)

    return view


@router.put("/problems/{problem_id}/answers")
def put_answer(
    request: Request, problem_id: str, body: AnswerRequest
) -> dict[str, Any]:
    """
    問いに答えて保存する関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子
    body: AnswerRequest
        問いの識別子と答え (null で消す)

    Returns
    ----------
    view: dict[str, Any]
        答えた後の全て
    """
    # 読んで答えて書く (形の誤りは 400)
    store = get_store(request)
    with EDIT_LOCK:
        problem = load_or_404(store, problem_id)
        try:
            updated = ml_quest.answer(problem, body.id, body.value)
        except ValueError as error:
            raise user_error(error) from error
        saved = store.save(problem_id, updated)
    view = problem_view(problem_id, saved)

    return view


@router.put("/problems/{problem_id}/name")
def rename_problem(
    request: Request, problem_id: str, body: ProblemCreate
) -> dict[str, Any]:
    """
    問題の名前を変える関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子
    body: ProblemCreate
        新しい名前

    Returns
    ----------
    view: dict[str, Any]
        名前を変えた後の全て
    """
    # 空の名前は誤り
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "問題の名前を書いてください")
    store = get_store(request)
    with EDIT_LOCK:
        problem = load_or_404(store, problem_id)
        problem["name"] = name
        saved = store.save(problem_id, problem)
    view = problem_view(problem_id, saved)

    return view


@router.post("/problems/{problem_id}/columns")
def read_columns(
    request: Request, problem_id: str, body: PathRequest
) -> dict[str, Any]:
    """
    データのファイルから列の名前を読み, 使えるデータの列に答える関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子
    body: PathRequest
        データのファイルの場所

    Returns
    ----------
    view: dict[str, Any]
        答えた後の全て
    """
    # 先頭の行だけを読む
    try:
        columns = ml_quest.read_columns(Path(body.path).expanduser())
    except (*USER_ERRORS, OSError) as error:
        raise user_error(error) from error
    store = get_store(request)
    with EDIT_LOCK:
        problem = load_or_404(store, problem_id)
        try:
            updated = ml_quest.answer(problem, "information.columns",
                                      columns)
        except ValueError as error:
            raise user_error(error) from error
        saved = store.save(problem_id, updated)
    view = problem_view(problem_id, saved)

    return view


@router.post("/problems/{problem_id}/project")
def write_project(
    request: Request, problem_id: str, body: ProjectRequest
) -> dict[str, Any]:
    """
    ML-Found のプロジェクトの骨組みを書き出す関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子
    body: ProjectRequest
        書き出す場所, 実験の名前, 上書きするか

    Returns
    ----------
    result: dict[str, Any]
        path (書き出したディレクトリ) と files (書いたファイル)
    """
    # 渡せない問題の設定と, 上書きしない既にあるファイルは 400
    problem = load_or_404(get_store(request), problem_id)
    target = Path(body.path).expanduser().resolve()
    try:
        files = ml_quest.make_project(problem, target, name=body.name,
                                      overwrite=body.overwrite)
    except (*USER_ERRORS, OSError) as error:
        raise user_error(error) from error
    result = {"path": str(target), "files": files}

    return result


@router.get("/problems/{problem_id}/download")
def download_problem(request: Request, problem_id: str) -> Response:
    """
    問題の設定のファイルを返す関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子

    Returns
    ----------
    response: Response
        problem.yaml (添付として)
    """
    # 置き場のファイルをそのまま
    store = get_store(request)
    load_or_404(store, problem_id)
    text = (store.place(problem_id) / "problem.yaml").read_text("utf-8")
    response = Response(
        text, media_type="application/x-yaml",
        headers={"Content-Disposition": 'attachment; filename="problem.yaml"'}
    )

    return response


@router.delete("/problems/{problem_id}", status_code=204)
def delete_problem(request: Request, problem_id: str) -> Response:
    """
    問題の設定を消す関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子

    Returns
    ----------
    response: Response
        204
    """
    # 無ければ 404
    store = get_store(request)
    with EDIT_LOCK:
        load_or_404(store, problem_id)
        store.delete(problem_id)
    response = Response(status_code=204)

    return response
