"""Unit tests for the matching logic (no models needed): python3 -m pytest resources/aligner/test_align.py -q"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("align", os.path.join(HERE, "align.py"))
align = importlib.util.module_from_spec(spec)
sys.modules["align"] = align
spec.loader.exec_module(align)  # type: ignore


def lw(line, idx, text):
    return align.LyricWord(line, idx, f"{line}-{idx}", text, align.normalise(text))


def test_normalise_unifies_arabic_and_persian_forms():
    assert align.normalise("كتاب") == align.normalise("کتاب")
    assert align.normalise("می‌خوام") == align.normalise("میخوام")
    assert align.normalise("دلِ") == align.normalise("دل")
    assert align.normalise("تو،") == "تو"


def test_alignment_transfers_timestamps_and_interpolates_gaps():
    lyric_text = "دل من تنگه برای تو عزیزم"
    words = [lw(0, i, w) for i, w in enumerate(lyric_text.split())]
    # Recogniser missed "تنگه", mis-heard "عزیزم" slightly and hallucinated an extra token.
    tokens = [
        align.Token("دل", 1.0, 1.3),
        align.Token("من", 1.3, 1.6),
        align.Token("برای", 2.2, 2.6),
        align.Token("تو", 2.6, 2.8),
        align.Token("لالا", 2.9, 3.1),
        align.Token("عزیزام", 3.2, 3.8),
    ]
    mapping = align.needleman_wunsch(words, tokens)
    assert mapping[0] == 0 and mapping[1] == 1
    assert mapping[2] is None  # the missing word
    assert mapping[3] == 2 and mapping[4] == 3
    assert mapping[5] == 5  # fuzzy match to the mis-heard token
    for w, t in zip(words, mapping):
        if t is not None:
            w.start, w.end, w.matched = tokens[t].start, tokens[t].end, True
    align.interpolate(words, 10.0)
    # interpolated word sits between its neighbours and times stay monotonic
    assert 1.6 <= words[2].start < words[2].end <= 2.2
    starts = [w.start for w in words]
    assert starts == sorted(starts)
    assert all(w.end > w.start for w in words)


def test_no_matches_spreads_words_over_duration():
    words = [lw(0, i, w) for i, w in enumerate("یک دو سه".split())]
    align.interpolate(words, 6.0)
    assert words[0].start == 0.0
    assert abs(words[-1].end - 6.0) < 1e-6
