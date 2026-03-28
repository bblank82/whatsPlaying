"""Tests for pure utility functions in main.py."""
import pytest
from main import _clean_title, _rt_score_from_page, _rt_direct_url


# ---------------------------------------------------------------------------
# _clean_title
# ---------------------------------------------------------------------------

class TestCleanTitle:
    def test_strips_trailing_parenthesised_year(self):
        assert _clean_title("Inception (2010)") == "Inception"

    def test_strips_trailing_bracketed_year(self):
        assert _clean_title("Show [2024]") == "Show"

    def test_leaves_title_without_year_unchanged(self):
        assert _clean_title("The Bear") == "The Bear"

    def test_strips_surrounding_whitespace(self):
        assert _clean_title("  Alien (1979)  ") == "Alien"

    def test_year_mid_title_is_not_stripped(self):
        # A year that is not at the end should not be removed
        assert _clean_title("2001: A Space Odyssey") == "2001: A Space Odyssey"

    def test_empty_string(self):
        assert _clean_title("") == ""

    def test_only_year_annotation(self):
        assert _clean_title("(2020)") == ""

    def test_four_digit_only_matches(self):
        # Three digits should not be stripped
        assert _clean_title("Title (999)") == "Title (999)"


# ---------------------------------------------------------------------------
# _rt_score_from_page
# ---------------------------------------------------------------------------

class TestRtScoreFromPage:
    def test_extracts_score_from_json_ld(self):
        html = '<script type="application/ld+json">{"ratingValue": "94"}</script>'
        assert _rt_score_from_page(html) == 94

    def test_returns_none_when_field_absent(self):
        assert _rt_score_from_page("<html>No scores here</html>") is None

    def test_returns_none_for_empty_string(self):
        assert _rt_score_from_page("") is None

    def test_handles_whitespace_around_colon(self):
        html = '"ratingValue" : "72"'
        assert _rt_score_from_page(html) == 72

    def test_takes_first_match_when_multiple_present(self):
        html = '"ratingValue": "88", "ratingValue": "55"'
        assert _rt_score_from_page(html) == 88

    def test_zero_score(self):
        assert _rt_score_from_page('"ratingValue": "0"') == 0


# ---------------------------------------------------------------------------
# _rt_direct_url
# ---------------------------------------------------------------------------

MOVIE_ANCHOR = (
    'href="https://www.rottentomatoes.com/m/the_bear"'
    ' data-qa="info-name">The Bear</a>'
)
TV_ANCHOR = (
    'href="https://www.rottentomatoes.com/tv/the_bear"'
    ' data-qa="info-name">The Bear</a>'
)


class TestRtDirectUrl:
    def test_returns_none_for_empty_html(self):
        assert _rt_direct_url("", "The Bear", "movie") is None

    def test_returns_none_when_no_anchors_match_the_prefix(self):
        # Only /tv/ anchors present, but we're searching for a movie — no candidates
        html = '<a href="https://www.rottentomatoes.com/tv/something" data-qa="info-name">Other</a>'
        assert _rt_direct_url(html, "Not Present", "movie") is None

    def test_finds_movie_url(self):
        html = f'<html>{MOVIE_ANCHOR}</html>'
        url = _rt_direct_url(html, "The Bear", "movie")
        assert url == "https://www.rottentomatoes.com/m/the_bear"

    def test_finds_tv_url(self):
        html = f'<html>{TV_ANCHOR}</html>'
        url = _rt_direct_url(html, "The Bear", "show")
        assert url == "https://www.rottentomatoes.com/tv/the_bear"

    def test_movie_search_ignores_tv_prefix(self):
        # When media_type="movie", /tv/ links should be skipped
        html = f'<html>{TV_ANCHOR}</html>'
        assert _rt_direct_url(html, "The Bear", "movie") is None

    def test_tv_search_ignores_movie_prefix(self):
        html = f'<html>{MOVIE_ANCHOR}</html>'
        assert _rt_direct_url(html, "The Bear", "show") is None

    def test_exact_title_match_preferred_over_first_result(self):
        html = (
            'href="https://www.rottentomatoes.com/m/the_bear_2022"'
            ' data-qa="info-name">The Bear 2022</a>'
            ' href="https://www.rottentomatoes.com/m/the_bear"'
            ' data-qa="info-name">The Bear</a>'
        )
        url = _rt_direct_url(html, "The Bear", "movie")
        assert url == "https://www.rottentomatoes.com/m/the_bear"

    def test_returns_none_when_no_close_match(self):
        # "The Bear Film" neither equals nor contains "The Bear" as substring check
        # (actually it does contain it — use a clearly unrelated name)
        html = (
            '<a href="https://www.rottentomatoes.com/m/zenon_girl_of_the_21st_century"'
            ' data-qa="info-name">Zenon Girl of the 21st Century</a>'
        )
        assert _rt_direct_url(html, "21", "movie") is None

    def test_partial_match_title_contained_in_candidate(self):
        html = (
            '<a href="https://www.rottentomatoes.com/m/21_2008"'
            ' data-qa="info-name">21 (2008)</a>'
        )
        url = _rt_direct_url(html, "21", "movie")
        assert url == "https://www.rottentomatoes.com/m/21_2008"

    def test_title_match_is_case_insensitive(self):
        html = (
            '<a href="https://www.rottentomatoes.com/m/inception"'
            ' data-qa="info-name">INCEPTION</a>'
        )
        url = _rt_direct_url(html, "Inception", "movie")
        assert url == "https://www.rottentomatoes.com/m/inception"
