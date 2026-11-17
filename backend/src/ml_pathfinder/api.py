import json
import shutil
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional

import ml_quest
import yaml
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ml_pathfinder.store import READ_ERRORS, Store

router = APIRouter(prefix="/api")

# 読んで答えて書く間を 1 つずつにする鍵 (答えが消えないように)
EDIT_LOCK = threading.Lock()

# 名前に使える長さ
MAX_NAME = 80

# データからの候補を覚えておく数と鍵
INSIGHT_CACHE_SIZE = 16
INSIGHTS: OrderedDict[str, dict[str, Any]] = OrderedDict()
INSIGHT_LOCK = threading.Lock()

# 画面に返す誤りとする例外 (手元のファイルの誤りを含む)
USER_ERRORS = (ValueError, OSError, ImportError, yaml.YAMLError)


class ProblemCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=MAX_NAME)
    example: Optional[str] = None


class NameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME)


class AnswerRequest(BaseModel):
    id: str
    value: Any = None


class PathRequest(BaseModel):
    path: str = Field(min_length=1)


class ProjectRequest(BaseModel):
    path: str = Field(min_length=1)
    name: Optional[str] = Field(default=None, max_length=MAX_NAME)
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
    # 手元のファイルの誤りは日本語に, 他は誤りの文をそのまま
    name = Path(str(getattr(error, "filename", "") or "")).name or "ファイル"
    if isinstance(error, FileNotFoundError):
        message = f"{name} が見つかりません"
    elif isinstance(error, PermissionError):
        message = f"{name} を読み書きする権限がありません"
    elif isinstance(error, IsADirectoryError):
        message = f"{name} はディレクトリです"
    elif isinstance(error, UnicodeDecodeError):
        message = "文字コードを読めません (UTF-8 で保存してください)"
    elif isinstance(error, ImportError):
        message = ("このデータを読むには追加の部品が要ります "
                   f"({getattr(error, 'name', None) or error})")
    elif isinstance(error, yaml.YAMLError):
        message = "YAML として読めません"
    elif isinstance(error, OSError):
        message = f"{name} を読み書きできません"
    else:
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
        無い場合は 404, ファイルが壊れている場合は 422
    """
    # 形の違う識別子も無いものと同じ. 壊れたファイルは消せるように 422
    try:
        problem = store.load(problem_id)
    except KeyError as error:
        raise HTTPException(404, "問題の設定が見つかりません") from error
    except READ_ERRORS as error:
        raise HTTPException(
            422, "問題の設定のファイルが壊れています "
            f"({user_error(error).detail}). 消すか, ファイルを直してください"
        ) from error

    return problem


def exists_or_404(store: Store, problem_id: str) -> None:
    """
    問題の設定のファイルがあるかだけを確かめる関数 (中身は読まない)

    Parameters
    ----------
    store: Store
        置き場
    problem_id: str
        識別子

    Returns
    ----------
    None

    Raises
    ----------
    HTTPException
        無い場合は 404
    """
    # 壊れたファイルも消せるように, 場所だけ
    try:
        store.place(problem_id)
    except KeyError as error:
        raise HTTPException(404, "問題の設定が見つかりません") from error


def local_path(text: str) -> Path:
    """
    画面から受け取った場所を, 絶対パスにして返す関数

    Parameters
    ----------
    text: str
        場所 (~ から書ける)

    Returns
    ----------
    path: Path
        絶対パス

    Raises
    ----------
    HTTPException
        相対パスの場合は 400 (起動した場所で意味が変わるため)
    """
    # ~ を展開した後に絶対パスであること
    path = Path(text.strip()).expanduser()
    if not path.is_absolute():
        raise HTTPException(400, f"{text} は絶対パスで書いてください")

    return path


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
    # 今要る問いのうち, 要るものだけの数え上げ
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
    # 機械学習を使わない出口と, 直すところの残る問題の設定は受け渡し不可
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
    item["broken"] = None

    return item


def broken_item(problem_id: str, error: Exception) -> dict[str, Any]:
    """
    読めない問題の設定の一覧の 1 行を作る関数

    Parameters
    ----------
    problem_id: str
        識別子
    error: Exception
        読めない理由

    Returns
    ----------
    item: dict[str, Any]
        broken に理由を入れた 1 行 (消せるように識別子は残す)
    """
    # 名前は分からないので識別子
    item = {
        "id": problem_id, "name": f"(読めない問題の設定 {problem_id})",
        "updated_at": None, "uses_ml": None,
        "progress": {"answered": 0, "required": 0, "sections": []},
        "ready": False, "finished": False, "errors": 0,
        "broken": user_error(error).detail,
    }

    return item


@router.get("/info")
def get_info() -> dict[str, Any]:
    """
    問いの節, 見本の名前, 問題の設定の形の版を返す関数

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
    ファイルとディレクトリを選ぶための, ディレクトリの中身を返す関数

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
    # 隠しファイルを除いて, ディレクトリを先に名前の順 (読めない子は除く)
    target = Path(path).expanduser().resolve()
    if not target.is_dir():
        raise HTTPException(404, f"{target} はディレクトリではありません")
    try:
        children = [entry_of(c) for c in target.iterdir()
                    if not c.name.startswith(".")]
    except PermissionError as error:
        raise HTTPException(403, "読む権限がありません") from error
    visible = sorted((e for e in children if e is not None),
                     key=entry_order)
    entries = visible[:1000]
    listing = {
        "path": str(target),
        "parent": str(target.parent) if target.parent != target else None,
        "home": str(Path.home()),
        "entries": entries,
        "truncated": len(visible) > 1000,
    }

    return listing


def entry_of(child: Path) -> Optional[dict[str, Any]]:
    """
    ディレクトリの中の 1 つを, 一覧の 1 件にする関数

    Parameters
    ----------
    child: Path
        ファイルかディレクトリ

    Returns
    ----------
    entry: Optional[dict[str, Any]]
        名前, 場所, ディレクトリか, 大きさ, ML-Found のプロジェクトか
        (読めなければ None)
    """
    # 権限の無い子は除く (macOS の守られたディレクトリなど)
    try:
        is_dir = child.is_dir()
        entry: Optional[dict[str, Any]] = {
            "name": child.name, "path": str(child), "is_dir": is_dir,
            "size": None if is_dir else child.stat().st_size,
            "project": is_dir and (
                child / "configs" / "default" / "train.yaml"
            ).is_file(),
        }
    except OSError:
        entry = None

    return entry


def entry_order(entry: dict[str, Any]) -> tuple[bool, str]:
    """
    一覧の並びの鍵を返す関数

    Parameters
    ----------
    entry: dict[str, Any]
        一覧の 1 件

    Returns
    ----------
    key: tuple[bool, str]
        ディレクトリが先, 名前の順
    """
    # 大文字と小文字を区別しない名前の順
    key = (not entry["is_dir"], entry["name"].lower())

    return key


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
    # 置き場の全て (読めないファイルと, 形の崩れで確かめが落ちるものも
    # 消せるように行に残す)
    items = []
    for problem_id, problem in get_store(request).list_all():
        try:
            if isinstance(problem, Exception):
                raise problem
            items.append(list_item(problem_id, problem))
        except (*READ_ERRORS, TypeError, KeyError, AttributeError) as error:
            items.append(broken_item(problem_id, error))

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
    # 元のファイルは変えず, 置き場への写し. 確かめが落ちる形は取り込まない
    path = local_path(body.path)
    try:
        problem = ml_quest.load_problem(path)
        if not isinstance(problem.get("name"), str) or not problem[
            "name"
        ].strip():
            problem["name"] = path.stem if path.is_file() else path.name
        problem_view("0" * 12, problem)
    except USER_ERRORS as error:
        raise user_error(error) from error
    except (TypeError, KeyError, AttributeError) as error:
        raise HTTPException(
            400, f"問題の設定の形が崩れていて取り込めません ({error})"
        ) from error
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
    # 読み込みだけ
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
    # 読み込み, 答え, 書き込み (形の誤りは 400). データの場所は読めるかを
    # 確かめる「データを入れる」だけで
    if body.id == "data.source":
        raise HTTPException(400, "手元のデータは「データを入れる」で入れて"
                                 "ください")
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
    request: Request, problem_id: str, body: NameRequest
) -> dict[str, Any]:
    """
    問題の名前を変える関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子
    body: NameRequest
        新しい名前

    Returns
    ----------
    view: dict[str, Any]
        名前を変えた後の全て
    """
    # 空の名前は誤り
    name = body.name.strip()
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
    # 問題の設定があってから, 先頭の行だけの読み込み
    store = get_store(request)
    exists_or_404(store, problem_id)
    try:
        columns = ml_quest.read_columns(local_path(body.path))
    except USER_ERRORS as error:
        raise user_error(error) from error
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


@router.post("/problems/{problem_id}/data")
def attach_data(
    request: Request, problem_id: str, body: PathRequest
) -> dict[str, Any]:
    """
    手元のデータを読み, 場所と読み方と列の名前を問題の設定に入れる関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子
    body: PathRequest
        データの場所 (ファイルか, 画像などのディレクトリ)

    Returns
    ----------
    view: dict[str, Any]
        入れた後の全て
    """
    # ML-EDA で読めるかを確かめてから, 問題の設定の置き場に写して保存.
    # 大きなデータの読み込みの間も他の答えを止めないように, 読むのは鍵の
    # 外で, 書くときに今の問題の設定へ重ねる
    store = get_store(request)
    path = local_path(body.path)
    snapshot = load_or_404(store, problem_id)
    try:
        attached = ml_quest.attach_data(
            snapshot, path, copy_to=store.place(problem_id) / "data"
        )
    except USER_ERRORS as error:
        raise user_error(error) from error
    with EDIT_LOCK:
        problem = load_or_404(store, problem_id)
        missing = ml_quest.get_value(problem, "data.missing")
        problem["data"] = dict(attached["data"])
        if missing:
            problem["data"]["missing"] = missing
        try:
            updated = ml_quest.answer(
                problem, "information.columns",
                ml_quest.get_value(attached, "information.columns")
            )
        except ValueError as error:
            raise user_error(error) from error
        saved = store.save(problem_id, updated)
    view = problem_view(problem_id, saved)

    return view


def insight_key(problem_id: str, problem: dict[str, Any]) -> str:
    """
    データからの候補を覚えておく鍵を作る関数

    Parameters
    ----------
    problem_id: str
        識別子
    problem: dict[str, Any]
        問題の設定

    Returns
    ----------
    key: str
        データの場所, 更新の時刻と大きさ, 候補に効く答えをつないだ文字列
    """
    # データか, 候補に効く答えが変わったときの作り直し (手で書いた文字列
    # でない場所は読まない)
    source = ml_quest.get_value(problem, "data.source")
    if not isinstance(source, str):
        source, stamp = repr(source), "invalid"
    else:
        try:
            stat = Path(source).stat()
            stamp = f"{stat.st_mtime_ns}:{stat.st_size}"
        except OSError:
            stamp = "missing"
    # 候補に効く答えの漏れを防ぐため, 時刻を除く問題の設定の全てを鍵に
    answers = json.dumps(
        {k: v for k, v in problem.items()
         if k not in ("created_at", "updated_at")},
        ensure_ascii=False, sort_keys=True, default=str
    )
    key = f"{problem_id}|{source}|{stamp}|{answers}"

    return key


@router.delete("/problems/{problem_id}/data")
def detach_data(request: Request, problem_id: str) -> dict[str, Any]:
    """
    入れた手元のデータを問題の設定から外す関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子

    Returns
    ----------
    view: dict[str, Any]
        外した後の全て (要るのに無いデータと, 使えるデータの列は残す)
    """
    # 場所と読み方と, 置き場に写したデータの消去 (元のデータは変えない)
    store = get_store(request)
    with EDIT_LOCK:
        problem = load_or_404(store, problem_id)
        shutil.rmtree(store.place(problem_id) / "data", ignore_errors=True)
        missing = ml_quest.get_value(problem, "data.missing")
        problem.pop("data", None)
        if missing:
            problem["data"] = {"missing": missing}
        saved = store.save(problem_id, problem)
    view = problem_view(problem_id, saved)

    return view


@router.get("/problems/{problem_id}/insight")
def get_insight(request: Request, problem_id: str) -> dict[str, Any]:
    """
    入れたデータからの概要, 答えの候補, 確かめを返す関数

    Parameters
    ----------
    request: Request
        リクエスト
    problem_id: str
        識別子

    Returns
    ----------
    insight: dict[str, Any]
        overview, suggestions, findings (データを入れていなければ空)
    """
    # 分析は重いので, データと答えが同じ間は覚えた結果の返却
    problem = load_or_404(get_store(request), problem_id)
    key = insight_key(problem_id, problem)
    with INSIGHT_LOCK:
        cached = INSIGHTS.get(key)
        if cached is not None:
            INSIGHTS.move_to_end(key)
            return cached
    # 読めない場合も inspect_data が確かめの error にして返す
    found = ml_quest.inspect_data(problem)
    insight: dict[str, Any] = found or {
        "overview": None, "suggestions": [], "findings": []
    }
    with INSIGHT_LOCK:
        INSIGHTS[key] = insight
        while len(INSIGHTS) > INSIGHT_CACHE_SIZE:
            INSIGHTS.popitem(last=False)

    return insight


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
    target = local_path(body.path).resolve()
    try:
        files = ml_quest.make_project(problem, target, name=body.name,
                                      overwrite=body.overwrite)
    except USER_ERRORS as error:
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
    # 置き場のファイルをそのまま (中身で表示を変えないように添付で)
    store = get_store(request)
    with EDIT_LOCK:
        exists_or_404(store, problem_id)
        data = (store.place(problem_id) / "problem.yaml").read_bytes()
    response = Response(
        data, media_type="application/x-yaml; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="problem.yaml"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        }
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
    # 無ければ 404 (壊れたファイルも消せるように中身は読まない)
    store = get_store(request)
    with EDIT_LOCK:
        exists_or_404(store, problem_id)
        store.delete(problem_id)
    response = Response(status_code=204)

    return response
