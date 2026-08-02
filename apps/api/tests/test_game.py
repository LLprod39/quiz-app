from types import SimpleNamespace

from app.game import check_answer, normalize_text


def q(type_, correct, accepted=None, tolerance=None):
    return SimpleNamespace(type=type_, correct_answer=correct, accepted_answers=accepted or [], numeric_tolerance=tolerance)


def test_text_normalization_and_synonyms():
    question = q("text", "\u0421\u0430\u043d\u043a\u0442-\u041f\u0435\u0442\u0435\u0440\u0431\u0443\u0440\u0433", ["\u041f\u0438\u0442\u0435\u0440", "\u0421\u041f\u0431"])
    assert check_answer(question, "  \u0421\u0410\u041d\u041a\u0422   \u041f\u0415\u0422\u0415\u0420\u0411\u0423\u0420\u0413! ")
    assert check_answer(question, "\u043f\u0438\u0442\u0435\u0440")
    assert normalize_text("\u0412\u0441\u0451, \u0445\u043e\u0440\u043e\u0448\u043e!") == "\u0432\u0441\u0435 \u0445\u043e\u0440\u043e\u0448\u043e"


def test_multiple_requires_exact_set():
    question = q("multiple", ["a", "c"])
    assert check_answer(question, ["c", "a"])
    assert not check_answer(question, ["a"])
    assert not check_answer(question, ["a", "b", "c"])


def test_numeric_tolerance():
    question = q("number", 1998, tolerance=1)
    assert check_answer(question, 1997)
    assert check_answer(question, "1999")
    assert not check_answer(question, 2000)
