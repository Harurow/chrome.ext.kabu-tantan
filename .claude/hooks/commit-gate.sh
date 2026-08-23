#!/bin/bash
# コミットを作るコマンドを、レビュー承認済みのときだけ通す PreToolUse フック。
#
# 高速パス（純 bash・プロセス起動なし）で無関係なコマンドを弾き、
# 可能性のあるものだけ commit-gate.mjs に渡して厳密に解析する。
#
# fail-closed: 判定できない場合は通さない。

INPUT=$(cat)

# コミットを作りうる語が生の JSON に一切現れなければ即座に通す。
# 取りこぼしを避けるため git を含むものは一律 mjs に渡して厳密に判定させる
# （mjs 側で git log などは正しく通す）。
case "$INPUT" in
  *git*|*commit*|*revert*|*merge*|*cherry-pick*|*rebase*|*version*|*xargs*|*-exec*) ;;
  *) exit 0 ;;
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GATE="$PROJECT_DIR/.claude/hooks/commit-gate.mjs"

if [ ! -f "$GATE" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"コミットゲート本体 (.claude/hooks/commit-gate.mjs) が見つかりません。"}}'
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"コミットゲートを実行できません: node が見つかりません。"}}'
  exit 0
fi

ERRFILE=$(mktemp -t kabu-commit-gate)
OUT=$(printf '%s' "$INPUT" | node "$GATE" 2>"$ERRFILE")
STATUS=$?

if [ $STATUS -ne 0 ]; then
  ERR=$(head -c 500 "$ERRFILE" | tr '\n' ' ' | sed 's/"/\\"/g')
  rm -f "$ERRFILE"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"コミットゲートが異常終了しました（安全側に倒してブロックします）: %s"}}' "$ERR"
  exit 0
fi
rm -f "$ERRFILE"

printf '%s' "$OUT"
exit 0
