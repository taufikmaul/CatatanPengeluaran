#!/usr/bin/env bash
#
# push-branch.sh - Terapkan 5 commit hasil kerja di VPS, verifikasi, lalu push.
#
# Dijalankan di MESIN LOKAL (yang punya akses push ke GitHub).
#
# Pemakaian:
#   ./push-branch.sh /path/ke/CatatanPengeluaran
#   ./push-branch.sh /path/ke/CatatanPengeluaran /path/ke/catpen-transfer
#   ./push-branch.sh /path/ke/CatatanPengeluaran --dry-run
#
# Argumen:
#   $1  path repo lokal (wajib)
#   $2  path folder transfer, default: folder tempat script ini berada
#   --dry-run  kerjakan semua langkah TANPA push, supaya bisa diperiksa dulu
#
# Script ini tidak menyentuh working tree Anda: semua langkah dilakukan pada
# branch baru, dan bila ada perubahan yang belum di-commit script berhenti.

set -Eeuo pipefail

BRANCH="feat/impor-historis-dan-perbaikan"
BASE_BRANCH="main"
# Nilai harapan TIDAK ditulis mati di sini. Semuanya dibaca dari manifest.env
# yang dibuat bersama bundle. Kalau angka seperti jumlah commit atau tree hash
# di-hardcode, skrip ini diam-diam jadi basi setiap kali pekerjaan bertambah:
# ia akan menolak push yang sebenarnya benar.
EXPECTED_TREE=""
EXPECTED_BASE=""
EXPECTED_COMMITS=""

DRY_RUN="no"
REPO_PATH=""
TRANSFER_DIR=""

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN="yes" ;;
        -h|--help)
            sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            if [ -z "$REPO_PATH" ]; then
                REPO_PATH="$arg"
            elif [ -z "$TRANSFER_DIR" ]; then
                TRANSFER_DIR="$arg"
            else
                echo "ERROR: argumen tidak dikenal: $arg" >&2
                exit 2
            fi
            ;;
    esac
done

if [ -z "$REPO_PATH" ]; then
    echo "ERROR: path repo belum diberikan." >&2
    echo "Contoh: $0 ~/projects/CatatanPengeluaran" >&2
    exit 2
fi
if [ -z "$TRANSFER_DIR" ]; then
    TRANSFER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

BUNDLE="$TRANSFER_DIR/feat-impor-historis.bundle"
PATCH_DIR="$TRANSFER_DIR/patches"
MANIFEST="$TRANSFER_DIR/manifest.env"

if [ -f "$MANIFEST" ]; then
    # shellcheck disable=SC1090
    . "$MANIFEST"
fi

step() { printf '\n== %s ==\n' "$*"; }
fail() { printf '\nGAGAL: %s\n' "$*" >&2; exit 1; }

step "Memeriksa repo: $REPO_PATH"
[ -d "$REPO_PATH/.git" ] || fail "'$REPO_PATH' bukan repo git."
cd "$REPO_PATH"

if [ -n "$(git status --porcelain)" ]; then
    fail "Ada perubahan yang belum di-commit. Commit atau 'git stash' dulu supaya tidak tercampur."
fi

ORIGINAL_REF="$(git symbolic-ref --short -q HEAD || git rev-parse HEAD)"
echo "Branch aktif : $ORIGINAL_REF"

step "Mengambil state terbaru dari origin"
git fetch origin --prune
BASE_SHA="$(git rev-parse "origin/$BASE_BRANCH")"
echo "origin/$BASE_BRANCH = ${BASE_SHA:0:7}"

if [ -n "$EXPECTED_BASE" ] && [ "$BASE_SHA" != "$EXPECTED_BASE" ]; then
    echo
    echo "PERHATIAN: origin/$BASE_BRANCH sudah bergerak dari ${EXPECTED_BASE:0:7} ke ${BASE_SHA:0:7}."
    echo "Bundle dibuat terhadap ${EXPECTED_BASE:0:7}. Bila ada commit baru di main,"
    echo "branch ini sebaiknya di-rebase setelah diterapkan."
    printf "Lanjutkan? [y/N] "
    read -r answer
    [ "$answer" = "y" ] || [ "$answer" = "Y" ] || fail "Dibatalkan oleh user."
fi

step "Menyiapkan branch $BRANCH"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "Branch sudah ada, memakai ulang dan me-reset ke origin/$BASE_BRANCH."
    git checkout -q "$BRANCH"
    git reset -q --hard "origin/$BASE_BRANCH"
else
    git checkout -q -b "$BRANCH" "origin/$BASE_BRANCH"
fi

TMP_REF="refs/heads/_catpen_transfer"

if [ -f "$BUNDLE" ]; then
    step "Menerapkan commit dari bundle (hash commit asli dipertahankan)"
    git bundle verify "$BUNDLE" >/dev/null 2>&1 \
        || fail "Bundle tidak valid. Ulangi unduhan dari VPS."
    git fetch -q "$BUNDLE" "$BRANCH:$TMP_REF"
    git merge --ff-only -q "$TMP_REF" \
        || fail "Fast-forward gagal: branch tidak sejalur dengan bundle."
    git update-ref -d "$TMP_REF"
elif [ -d "$PATCH_DIR" ]; then
    step "Bundle tidak ada, menerapkan patch (hash commit akan berbeda)"
    shopt -s nullglob
    patches=("$PATCH_DIR"/*.patch)
    shopt -u nullglob
    [ "${#patches[@]}" -gt 0 ] || fail "Tidak ada file .patch di $PATCH_DIR."
    if ! git am "${patches[@]}"; then
        git am --abort || true
        fail "git am gagal. Branch dikembalikan ke origin/$BASE_BRANCH."
    fi
else
    fail "Tidak menemukan bundle maupun folder patches di '$TRANSFER_DIR'."
fi

step "Memverifikasi isi branch"
ACTUAL_TREE="$(git rev-parse HEAD^{tree})"
COMMIT_COUNT="$(git rev-list --count "origin/$BASE_BRANCH..HEAD")"
echo "Jumlah commit : $COMMIT_COUNT"
echo "Tree sekarang : ${ACTUAL_TREE:0:7}"
echo "Tree diharapkan: ${EXPECTED_TREE:0:7}"

if [ -z "$EXPECTED_TREE" ]; then
    echo
    echo "PERINGATAN: manifest.env tidak ditemukan - verifikasi tree dilewati."
    echo "Paket tanpa manifest tidak bisa membuktikan isinya utuh."
else
    if [ -n "$EXPECTED_COMMITS" ] && [ "$COMMIT_COUNT" != "$EXPECTED_COMMITS" ]; then
        fail "Jumlah commit $COMMIT_COUNT, seharusnya $EXPECTED_COMMITS."
    fi
    if [ "$ACTUAL_TREE" != "$EXPECTED_TREE" ]; then
        fail "Tree hash tidak cocok. Isi file berbeda dari paket - jangan di-push."
    fi
    echo "OK: isi branch identik dengan paket hasil kerja."
fi

git --no-pager log --oneline "origin/$BASE_BRANCH..HEAD"

REMOTE_URL="$(git remote get-url origin)"
echo
echo "Remote tujuan : $REMOTE_URL"

if [ "$DRY_RUN" = "yes" ]; then
    step "Dry-run: tidak ada yang di-push"
    echo "Branch $BRANCH siap. Jalankan ulang tanpa --dry-run untuk push."
    exit 0
fi

step "Push ke origin"
printf "Push branch '%s' sekarang? [y/N] " "$BRANCH"
read -r answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || fail "Push dibatalkan. Branch tetap ada secara lokal."

git push -u origin "$BRANCH"

step "Selesai"
case "$REMOTE_URL" in
    *github.com*)
        REPO_SLUG="${REMOTE_URL#*github.com}"
        REPO_SLUG="${REPO_SLUG#:}"
        REPO_SLUG="${REPO_SLUG#/}"
        REPO_SLUG="${REPO_SLUG%.git}"
        echo "Buka PR:"
        echo "  https://github.com/$REPO_SLUG/compare/$BASE_BRANCH...$BRANCH?expand=1"
        ;;
    *)
        echo "Remote bukan GitHub, buka MR/PR manual di: $REMOTE_URL"
        ;;
esac
