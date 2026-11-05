#!/usr/bin/env bash
# Выкладка студии на сервер демок Pragmatica: https://vk-light.demo.pragmatica.design
#
# Сервер (pgcode, pragmatica-design/pgcode) сам забирает ветку pgcode-ship из репы
# pragmatica-design/demo-vk-light — приватной копии этой. Скрипт:
#   1. отправляет main из GitHub в копию;
#   2. во временной папке клонирует копию и pgcode;
#   3. берёт пароль прошлой выкладки из ветки pgcode-ship — в эту репу он не попадает;
#   4. запускает выкладку pgcode: сборка, проверки, ветка pgcode-ship, ожидание сервера.
# В конце — одна строка JSON: адрес, логин demo и пароль.
#
# Сменить пароль: tools/ship-demo.sh --password <новый>; дальше он держится сам.
# Сервер снимает демку, если её не обновляли 90 дней: выкладывать хотя бы раз в три месяца.
set -euo pipefail

new_password=""
if [ "${1:-}" = "--password" ]; then
  new_password=${2:?после --password нужен пароль}
fi

ROOT=$(git rev-parse --show-toplevel)
COPY=https://github.com/pragmatica-design/demo-vk-light.git
PGCODE=https://github.com/pragmatica-design/pgcode.git

TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT

git -C "$ROOT" fetch -q origin main
git -C "$ROOT" push -q "$COPY" FETCH_HEAD:refs/heads/main
git clone -q "$COPY" "$TMP/demo"
git clone -q --depth 1 "$PGCODE" "$TMP/pgcode"
ln -s "$ROOT/node_modules" "$TMP/demo/node_modules"

password=${new_password:-$(git -C "$TMP/demo" show origin/pgcode-ship:.pgcode-ship.json 2>/dev/null |
  python3 -c 'import json, sys; print(json.load(sys.stdin).get("password", ""))' 2>/dev/null || true)}

python3 - "$TMP/demo/pgcode.json" "$password" <<'PY'
import json, sys
path, password = sys.argv[1], sys.argv[2]
config = {"version": 1, "kind": "client", "stack": "react", "client": "vk", "project": "light",
          "repo": "demo-vk-light", "devices": "desktop", "access": "password", "indexable": False}
if password:
    config["password"] = password
open(path, "w", encoding="utf-8").write(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
PY

python3 "$TMP/pgcode/skills/ship/scripts/ship.py" --dir "$TMP/demo" --wait-seconds 240
