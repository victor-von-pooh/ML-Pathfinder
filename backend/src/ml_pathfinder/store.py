import hashlib
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import ml_quest
import yaml

# 問題の設定の識別子の形 (置き場の外を指せないように)
ID_PATTERN = re.compile(r"[0-9a-f]{12}")

# 読めない問題の設定のファイルの誤り
READ_ERRORS = (OSError, ValueError, yaml.YAMLError)


class Store:
    def __init__(self, problems_dir: Path):
        # 問題の設定の置き場を保存
        self.problems_dir = problems_dir
        self.lock = threading.Lock()

    def place(self, problem_id: str) -> Path:
        """
        問題の設定のディレクトリを返す関数

        Parameters
        ----------
        problem_id: str
            識別子

        Returns
        ----------
        path: Path
            ディレクトリ

        Raises
        ----------
        KeyError
            形の違う識別子か, 無い問題の設定の場合
        """
        # 識別子の形と, ファイルの有無
        if not ID_PATTERN.fullmatch(problem_id):
            raise KeyError(problem_id)
        path = self.problems_dir / problem_id
        if not (path / "problem.yaml").is_file():
            raise KeyError(problem_id)

        return path

    def list_all(self) -> list[tuple[str, Any]]:
        """
        問題の設定を, 更新の新しい順に返す関数

        Parameters
        ----------
        None

        Returns
        ----------
        items: list[tuple[str, Any]]
            識別子と問題の設定の組 (読めないファイルは問題の設定の代わりに
            読めない理由の例外)
        """
        # 置き場が無ければ空
        items: list[tuple[str, Any]] = []
        if not self.problems_dir.is_dir():
            return items
        for child in self.problems_dir.iterdir():
            if not ID_PATTERN.fullmatch(child.name) or not (
                child / "problem.yaml"
            ).is_file():
                continue
            try:
                items.append((child.name, ml_quest.load_problem(child)))
            except READ_ERRORS as error:
                items.append((child.name, error))
        items.sort(key=updated_of, reverse=True)

        return items

    def load(self, problem_id: str) -> dict[str, Any]:
        """
        問題の設定を読む関数

        Parameters
        ----------
        problem_id: str
            識別子

        Returns
        ----------
        problem: dict[str, Any]
            問題の設定
        """
        # 場所の確かめと読み込み
        problem: dict[str, Any] = ml_quest.load_problem(
            self.place(problem_id)
        )

        return problem

    def load_versioned(
        self, problem_id: str
    ) -> tuple[dict[str, Any], str, Optional[int]]:
        """
        問題の設定と, 同じ中身の印と, ファイルに書いてある版を読む関数

        他のアプリが読む間に書き換えても, 中身と印がずれないように, 読む
        前と後の印が同じになるまで読み直す (保存は置き換えなので, 書きかけ
        は読まない)

        Parameters
        ----------
        problem_id: str
            識別子

        Returns
        ----------
        loaded: tuple[dict[str, Any], str, Optional[int]]
            問題の設定 (版 1 は ML-Quest が版 2 に移したもの), 中身の
            sha256 の 16 進, ファイルに書いてある版
        """
        # 前後の印が同じ読み込み (書き換えが続けば最後の読み込み)
        before = self.version(problem_id)
        for _ in range(3):
            problem = self.load(problem_id)
            written = self.file_version(problem_id)
            after = self.version(problem_id)
            if after == before:
                break
            before = after
        loaded = (problem, before, written)

        return loaded

    def file_version(self, problem_id: str) -> Optional[int]:
        """
        問題の設定のファイルに書いてある版を返す関数

        ML-Quest は版 1 を読むと版 2 に移すので, ファイルがまだ版 1 かを
        画面に出すため

        Parameters
        ----------
        problem_id: str
            識別子

        Returns
        ----------
        written: Optional[int]
            format_version の値 (数でなければ None)
        """
        # 移す前の YAML の版の欄
        path = self.place(problem_id) / "problem.yaml"
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        value = raw.get("format_version") if isinstance(raw, dict) else None
        written = value if isinstance(value, int) and not isinstance(
            value, bool
        ) else None

        return written

    def version(self, problem_id: str) -> str:
        """
        問題の設定のファイルの中身の印を返す関数

        他のアプリ (ML-Fathom の書き戻しなど) が書き換えたことに画面が
        気付くため. 更新の時刻は秒の単位なので中身で

        Parameters
        ----------
        problem_id: str
            識別子

        Returns
        ----------
        version: str
            中身の sha256 の 16 進
        """
        # ファイルの中身の要約
        path = self.place(problem_id) / "problem.yaml"
        version = hashlib.sha256(path.read_bytes()).hexdigest()

        return version

    def create(self, problem: dict[str, Any]) -> str:
        """
        新しい問題の設定を置く関数

        Parameters
        ----------
        problem: dict[str, Any]
            問題の設定

        Returns
        ----------
        problem_id: str
            識別子
        """
        # 重ならない識別子のディレクトリ
        with self.lock:
            problem_id = uuid.uuid4().hex[:12]
            place = self.problems_dir / problem_id
            place.mkdir(parents=True)
            ml_quest.save_problem(problem, place / "problem.yaml")

        return problem_id

    def save(self, problem_id: str, problem: dict[str, Any]) -> dict[str, Any]:
        """
        問題の設定を書き直す関数

        Parameters
        ----------
        problem_id: str
            識別子
        problem: dict[str, Any]
            問題の設定

        Returns
        ----------
        saved: dict[str, Any]
            更新の時刻を入れた問題の設定
        """
        # 書き換えは 1 つずつ
        with self.lock:
            place = self.place(problem_id)
            saved: dict[str, Any] = ml_quest.save_problem(
                problem, place / "problem.yaml"
            )

        return saved

    def delete(self, problem_id: str) -> Path:
        """
        問題の設定を消す関数

        大きな写しを消す間も他の保存を止めないように, ここでは識別子の形に
        合わない名前に変えるだけ. 返した場所は呼び出し側が鍵の外で消す

        Parameters
        ----------
        problem_id: str
            識別子

        Returns
        ----------
        removing: Path
            名前を変えたディレクトリ (一覧には出ない)
        """
        # ディレクトリごとの名前の変更
        with self.lock:
            removing = self.problems_dir / f".removing-{uuid.uuid4().hex}"
            self.place(problem_id).rename(removing)

        return removing


def updated_of(item: tuple[str, Any]) -> datetime:
    """
    一覧の並びに使う, 問題の設定の更新の時刻を返す関数

    Parameters
    ----------
    item: tuple[str, Any]
        識別子と, 問題の設定か読めない理由

    Returns
    ----------
    stamp: datetime
        時差付きの時刻 (読めないものは最も古い時刻)
    """
    # 時差の違う時刻も比べられるように, 時差付きにそろえる
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    value = item[1].get("updated_at") if isinstance(item[1], dict) else None
    try:
        stamp = value if isinstance(value, datetime) else (
            datetime.fromisoformat(str(value))
        )
    except ValueError:
        return oldest
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)

    return stamp
