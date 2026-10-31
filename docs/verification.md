> Исторический документ. Текущие проверки и ограничения кандидата 0.3.0 перечислены в [checkpoint-status](checkpoint-status.md); прежние числа не заменяют итоговую проверку.

# Проверка Support Copilot v0.2.0

Контрольная точка 30.10.2026, Windows/Node22. Это локальная проверка MVP, не экспертная оценка ответов жюри. История v1 отдельно в [verification-v1.md](verification-v1.md).

| Область | Фактическое evidence | Результат |
|---|---|---|
| T001 рабочее пространство/E5 |82 regression, реальные E5/index/search и browser flow|PASS82/82,0skip на контрольной точке|
| T002 генератор/подготовка обучения |Последовательный suite с native lifecycle|PASS108/108,0skip до последующих review fixes|
| Training candidate после обновления |stdlib dry-run, notebook SHA/AST/первые2ячейки, metadata/API/direct-wheel checks|PASS7/7; GPU install/train/merge not-run|
| T003 оценка |1000paired+1000actualHTTP, exact source check|PASS: schema/grounding/hard-gate/HTTPerrors0; p9545.20мс|
| Retrieval holdout |24 frozen author queries/6langs|Lexical3/24→hybrid19/24 hit@8;5misses раскрыты|
| Метки качества |realvalid безgold; отдельная author regression|Real quality metrics null; author35/35→32/35 из-за3extra humanFAQ|
| Power recovery |actualSIGKILL после5/300, тот же CLI resume/repeat|300imports+seed301unique; edits/feedback/annotation preserved; repeat0|
| UI |CUA/IAB desktop1440×1000/mobile390×844|Все6экранов; approve/revoke/import/label/compare; overflow0, consoleerrors0|
| Ручной ответ |browser generate unavailable→reanalyze→explicit apply|Правка не стирается, fallback явно помечен|
| Main upgrade |Сравнение с private v1 backup|15tickets,3feedback и edited_reply/status сохранены|

Независимые T004 reviews первоначально вернули FAIL и нашли: второй владелец runtime может перезаписать изменения; перефразированные remedies проходят свободный LLM validator; Docker не включает intents; tests игнорируют внешний DATA_DIR. Замечания исправлены: exclusive owner с hostname/process identity, отказ CLI до изменения данных, восстановление stale owner после SIGKILL, закрытый enum формулировок, Docker intents и env-first DATA_DIR в tests. Независимая повторная ownership проверка PASS:8/8 и дополнительный двухпроцессный probe без изменения state/workspace. Closed reviewed-enum validator независимо перепроверен: 291 текстовая атака, неизвестные refs и human-flag inversions отклонены; итог security PASS WITH WARNINGS. Это проверка фильтра, не quality-оценка настоящих ответов модели.

Режим свободного Qwen ранее реально выполнил8 проб:0accepted/8quality-failed,6.7–15.9с. После review его ограничили выбором проверенных формулировок. Новая попытка benchmark была остановлена preflight RAM:0executed. Default off остаётся. Нельзя выдавать старый замер свободного prompt за измерение обновлённого constrained prompt.

## Известное dependency warning

`npm audit --omit=dev --registry=https://registry.npmjs.org` сообщил2high alerts: Transformers через Sharp0.34.5. Уязвимости относятся к декодированию недоверенных изображений: [libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). В текущем фиксированном string→feature-extraction pipeline декодирование изображений не вызывается; HTTP принимает только счётчики вложений. Подтверждённый reachable High/RCE не установлен. Это известное ограничение зависимостей, а не утверждение об отсутствии любых уязвимостей. Перед добавлением image processing нужен совместимый проверенный patched stack.

## Итоговая поставка

Итоговый suite:125 tests,124PASS,0FAIL,1SKIP (свободной RAM недостаточно для opt-in native timeout/close). Исторический реальный lifecycle18/18 до изменения output policy сохранён; процессный запуск/таймаут/закрытие не изменялись, новый ограниченный prompt не выдаётся за реально испытанный. Реальные E5 tests в финальном suite выполнены. Из извлечённого source пакета с внешним DATA_DIR:125 tests,121PASS,0FAIL,4SKIP (веса не входят в архив); обычный npm ci установил собственные зависимости, HTTP startup/triage дали280rules и p0/human для взлома. Это не запуск за счёт зависимостей родительского проекта.

Финальный tar содержит70 обычных файлов, без symlink/private paths; каждый payload сравнивается побайтно с проверенными исходниками. Предыдущий архив0.1.0 сохранён. Отдельный receipt хранится локально вне пакета. Docker0.2.0 build PASS:Node22 Debian/glibc,uid1000,HTTP/UI/fallback,graceful restart и реальный SIGKILL/PID1 restart с сохранением feedback; второй контейнер с тем же volume отказал; make predict обработал1000/1000 в явно baseline fallback без модели. Собственные test container/volume удалены. Первый probe выявил смену ephemeral published port после restart; второй — ошибку экранирования в probe. Оба исправлены в проверяющем скрипте, третий полный запуск PASS; это не скрытые падения приложения.

Финальный browser:main3000 с реально готовым E5,290/290источников,semantic re-analysis и сохранённой правкой; consoleerrors0. Viewport1440×1000:scrollWidth1425;390×844:375. Overrides сброшены. Screenshot artifacts/ui-v2-final.png — только синтетика. Открытие/закрытие новой формы не создало обращения.

Проверяется только локальное приложение. Промышленная авторизация, отправка сообщений в игру, облачное GPU обучение и оценка kk/uz носителями не выполнялись. Исходные данные, модели, runtime и private predictions не публикуются. Репозиторий получает только allowlisted code и агрегаты по прямому поручению пользователя; hourly sync зависит от доступности ноутбука/Codex.