> Исторический документ. Текущие проверки и ограничения кандидата 0.3.0 перечислены в [checkpoint-status](checkpoint-status.md); прежние числа не заменяют итоговую проверку.

# Submission: Support Copilot

Проверяемая поставка: HTTP/JSONL триаж, черновик ответа, источники и передача человеку. Новая версия 0.3 ещё проходит проверку; ниже результаты 0.2 явно отделены от ожидаемых результатов 0.3. Обучение совместного 100-step эксперимента завершилось, однако его веса утрачены с временной Colab-сессией до локальной загрузки; отдельно восстановлена и сохранена исходная 20-step модель с проверкой полной контрольной суммы и структуры. Это не подтверждение качества генератора. Приватные правила, обращения, предсказания и веса передаются отдельно и в публичный репозиторий не входят.

## Четыре deliverables

| Deliverable | Где проверить |
|---|---|
| `POST /triage` | JSON `kind: complaint\|report`, `messages: [{role:"player",text:"…"}]`; ответ содержит `lang`, `category`, `priority`, `is_spam_or_duplicate`, `extracted`, `draft_reply`, `needs_human`, `confidence`, `reasons`. `category` — из переданной taxonomy, priority — p0–p3. Дополнительные `citations`/`analysis` показывают происхождение. [Контракт и публичный авторский запрос](../README.md#http-и-пакетная-обработка). |
| `make predict IN=tickets.jsonl OUT=pred.jsonl` | Существующий [Makefile](../Makefile): одна строка JSON на вход/выход, порядок сохраняется. Default `MODE=v2` и `--initialize`; `MODE=baseline` — явное сравнение. Admin/outcome/исторические labels исключаются из inference. |
| Отчёт: метрики, примеры черновиков, доля `needs_human` | [Агрегированный отчёт 0.2](evaluation-v2.md); [авторские примеры черновиков ru/kk/uz в историческом baseline-отчёте](evaluation.md). Это опубликованные синтетические примеры, не частные сообщения игроков. [Отдельное evidence обучения](training.md) не заменяет оценку реальных ответов. |
| Стоимость запроса и latency | Таблица ниже: быстрый HTTP triage и явный native-режим учитываются отдельно; полный локальный cost/request пока `N/A`. По умолчанию `/triage` и v2 batch используют проверенный черновик из кода без LLM; `TRIAGE_DRAFT_MODE=native` требует отдельной проверенной активации. |

`confidence` — эвристический score. Утверждение игрока не устанавливает нарушение; наличие вложения не означает просмотр. Одобрение черновика не применяет санкцию и не отправляет сообщение игроку.

## Воспроизводимый запуск

Из корня приложения, PowerShell; Node 22+, GNU Make для команды `make`. `DATA_DIR` содержит отдельно полученные `rules.json` и `taxonomy.json`. Переменные действуют в текущем процессе, `.env` автоматически не читается.

```powershell
npm ci
$env:DATA_DIR = 'D:\private\grand-handout'
$env:RUNTIME_DIR = 'D:\private\submission-runtime'
npm start
```

API: `http://127.0.0.1:3000/triage`, `Content-Type: application/json`. Фактический режим и fallback проверяются через `GET /api/health`. Семантический поиск требует подготовленной локальной E5-модели и инициализации; веса не скачиваются неявно. [Установка и ограничения](models.md).

```powershell
# Требуемый интерфейс; вход и результат остаются приватными.
make predict IN=tickets.jsonl OUT=pred.jsonl
# Те же аргументы с явными частными путями и общим DATA_DIR:
make predict IN='D:/private/tickets.jsonl' OUT='D:/private/pred.jsonl'
# Без Make — точный эквивалент default v2:
node src/cli/predict.mjs --in D:/private/tickets.jsonl --out D:/private/pred.jsonl --mode v2 --initialize
```

Docker: приватный handout монтируется read-only, HTTP публикуется только на loopback. Эти команды — инструкция воспроизведения, не заявление о новом выполненном Docker-тесте 0.3.

```powershell
docker build -t support-copilot:submission .
docker volume create support-copilot-submission-state
docker run --rm --name support-copilot-submission -p 127.0.0.1:3001:3000 --mount "type=bind,source=$env:DATA_DIR,target=/data,readonly" --mount "type=volume,source=support-copilot-submission-state,target=/app/runtime" support-copilot:submission
```

Docker API: `http://127.0.0.1:3001/triage`. Для E5 добавьте read-only mount подготовленного каталога модели в `/models/e5`; без него показан явный fallback. Отдельная пакетная обработка не использует volume очереди:

```powershell
$env:OUTPUT_DIR = 'D:\private\submission-output'
New-Item -ItemType Directory -Path $env:OUTPUT_DIR -Force | Out-Null
docker run --rm -e DATA_DIR=/data --mount "type=bind,source=$env:DATA_DIR,target=/data,readonly" --mount "type=bind,source=$env:OUTPUT_DIR,target=/output" support-copilot:submission make predict IN=/data/tickets.jsonl OUT=/output/pred.jsonl
```

## Пять критериев и границы evidence

| Критерий | Вес | Подтверждено / ещё требуется |
|---|---:|---|
| Качество черновика | 30 | Авторские примеры и безопасный условный черновик — по ссылкам выше. Новое end-to-end качество генератора 0.3 **pending**; успешное обучение или валидный JSON не доказывают полезность ответа. |
| Классификация | 25 | На предоставленных 1000 validation нет независимых gold category/priority: real accuracy **N/A**. Новый GPU-run на малом авторском holdout: focus **14/42 → 30/42**, macro-F1 **0.2781 → 0.7046**. Это не экспертный gold и не реальная accuracy. |
| Нет выдуманных правил | 20 | История 0.2: **921/921** цитат совпали с каноническими источниками, ошибок целостности 0. Это проверка точного источника, не доказательство релевантности всех ссылок. Произвольные ссылки/обещания санкций, refund/unban не допускаются; новая 0.3 проверяется отдельно. |
| kk + uz | 15 | История 0.2, авторский retrieval hit@8: kk **3/4**, uz **2/4**. Это не экспертная оценка языка черновиков и не real accuracy. Новая 0.3/оценка носителями pending. |
| Cost + latency | 10 | История 0.2: **1000 HTTP запросов**, p95 **45.20 ms**, concurrency=1, генератор выключен; cold initialize **2313 ms** отдельно. Новые generation latency, общий cost/request и итоговый замер 0.3 pending. |

В том же историческом прогоне 0.2 `needs_human` = **1000/1000 (100%)**; это измеренная доля эскалаций, не доказательство точности и не снижение нагрузки оператора. Протокол замера включает JSON/HTTP/read/parse, исключает 20 warmup; [полный метод и ограничения](evaluation-v2.md).

Внешних LLM API-вызовов в этом прогоне 0: соответствующий API billing — $0. **Полная стоимость локального запроса не измерена**: электричество, оборудование, инициализация/скачивание и амортизация обучения не становятся бесплатными от отсутствия API-ключа. Для повторного расчёта: `cost/request = API billing/N + (энергия × тариф + распределённая стоимость оборудования и setup)/N`, с явно выбранным периодом и отдельно указанной амортизацией обучения.

Статус 0.3: первый исторический 20-step LoRA-run сохранён; совместная FP16-попытка прервана без адаптера. Отдельный BF16-emulated run **завершил 100 actual updates / 100 attempts / 0 skips**, веса изменились и сохранены, finite-проверки прошли; training+generation после загрузки заняли **571.77 s** в пределах 600 s. На авторском plan-holdout: valid **0/12 → 12/12**, exact **11/12**, request precision **23/23**, recall **23/24**. Эта plan-оценка условна на правильной заданной теме, не end-to-end. Веса этого 100-step прогона утрачены с временной VM. Отдельный официальный pretrained Qwen3-1.7B Q4 полностью сохранён и проверен локально; это другой кандидат без проектного дообучения. Его рабочий профиль, независимое качество и финальная latency/cost 0.3 ещё проверяются. [Фактические stages, hashes и ограничения](training.md). Публичный submission не содержит частных player texts, rule payload или реальных предсказаний.
