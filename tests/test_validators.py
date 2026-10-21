"""Test untuk app/utils/validators.py."""

import pytest

from app.config import settings
from app.utils.validators import (
    audit_calculations,
    is_valid_category,
    validate_category,
)


class TestAuditCalculations:
    def test_recalculates_total_from_components(self):
        data = {
            "items": [
                {
                    "barang": "Tepung",
                    "qty": 2,
                    "harga_satuan": 15000,
                    "diskon": 5000,
                    "tax": 1000,
                    "total_harga": 999999,  # nilai salah dari AI
                }
            ]
        }
        result = audit_calculations(data)
        # (2 * 15000) - 5000 + 1000 = 26000
        assert result["items"][0]["total_harga"] == 26000

    def test_handles_missing_fields_with_defaults(self):
        data = {"items": [{"barang": "Gula"}]}
        result = audit_calculations(data)
        item = result["items"][0]
        assert item["qty"] == 1
        assert item["harga_satuan"] == 0
        assert item["total_harga"] == 0

    def test_handles_string_numbers(self):
        data = {"items": [{"qty": "3", "harga_satuan": "2500"}]}
        result = audit_calculations(data)
        assert result["items"][0]["total_harga"] == 7500

    def test_preserves_error_payload(self):
        data = {"error": True, "message": "AI gagal"}
        assert audit_calculations(data) == data

    def test_preserves_empty_items(self):
        data = {"items": []}
        assert audit_calculations(data) == data

    def test_handles_none(self):
        assert audit_calculations(None) is None

    def test_multiple_items_are_each_recalculated(self):
        data = {
            "items": [
                {"qty": 1, "harga_satuan": 1000, "total_harga": 0},
                {"qty": 5, "harga_satuan": 2000, "total_harga": 0},
            ]
        }
        result = audit_calculations(data)
        assert [i["total_harga"] for i in result["items"]] == [1000, 10000]


class TestValidateCategory:
    @pytest.mark.parametrize("category", settings.valid_categories)
    def test_accepts_exact_valid_category(self, category):
        assert validate_category(category) == category

    def test_normalizes_case(self):
        assert validate_category("bahan kue") == "Bahan Kue"
        assert validate_category("KEMASAN") == "Kemasan"

    def test_falls_back_to_operasional(self):
        assert validate_category("Kategori Ngawur") == "Operasional"

    def test_none_falls_back_to_operasional(self):
        assert validate_category(None) == "Operasional"


class TestIsValidCategory:
    def test_true_for_valid_category(self):
        assert is_valid_category("Bahan Kue") is True

    def test_case_insensitive(self):
        assert is_valid_category("bahan minuman") is True

    def test_false_for_invalid_category(self):
        assert is_valid_category("Makan Siang") is False

    def test_false_for_empty_string(self):
        assert is_valid_category("") is False

    def test_category_list_is_not_empty(self):
        assert len(settings.valid_categories) == 11
