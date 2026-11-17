import re
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

import ml_quest

# 問題の設定の識別子の形 (置き場の外を指せないように)
ID_PATTERN = re.compile(r"^[0-9a-f]{12}$")


class Store:
    def __init__(self, home: Path):
        # 置き場を保存
        self.home = home
        self.lock = threading.Lock()

    @property
    def problems_dir(self) -> Path:
        """
        問題の設定を置くディレクトリを返す関数

        Parameters
        ----------
        None

        Returns
        ----------
        path: Path
            置き場の problems
        """
        # 1 つの問題の設定に 1 つのディレクトリ
        path = self.home / "problems"

        return path

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
        if not ID_PATTERN.match(problem_id):
            raise KeyError(problem_id)
        path = self.problems_dir / problem_id
        if not (path / "problem.yaml").is_file():
            raise KeyError(problem_id)

        return path

    def list(self) -> list[tuple[str, dict[str, Any]]]:
        """
        問題の設定を, 更新の新しい順に返す関数

        Parameters
        ----------
        None

        Returns
        ----------
        items: list[tuple[str, dict[str, Any]]]
            識別子と問題の設定の組 (読めないものは除く)
        """
        # 置き場が無ければ空
        items: list[tuple[str, dict[str, Any]]] = []
        if not self.problems_dir.is_dir():
            return items
        for child in self.problems_dir.iterdir():
            if not ID_PATTERN.match(child.name):
                continue
            try:
                items.append((child.name, ml_quest.load_problem(child)))
            except (OSError, ValueError):
                continue
        items.sort(key=lambda item: str(item[1].get("updated_at", "")),
                   reverse=True)

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

    def delete(self, problem_id: str) -> None:
        """
        問題の設定を消す関数

        Parameters
        ----------
        problem_id: str
            識別子

        Returns
        ----------
        None
        """
        # ディレクトリごと
        with self.lock:
            shutil.rmtree(self.place(problem_id))
