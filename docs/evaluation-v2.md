> Исторический документ. Текущие проверки и ограничения кандидата 0.3.0 перечислены в [checkpoint-status](checkpoint-status.md); прежние числа не заменяют итоговую проверку.

# Фактическая оценка v2

Запуск 2026-10-30T08-58-21-626Z, v22.21.0, AMD Ryzen 5 4500U with Radeon Graphics         . Реальный E5 ONNX int8: ready; initialize 2313.0 мс (существующий приватный cache); генератор выключен.

## Реальные validation: 1000

Оба direct arm получили одинаковый sanitizeInput и предыдущую историю того же автора (161 записей с историей и временем); admin/outcome/labels исключены. Полей category в исходнике: 0; priority: 0. Независимый gold не предоставлен. Исторический lang — эвристические metadata.

| Arm | Передано человеку | Точные цитаты | Ошибки схемы | Ошибки grounding |
|---|---:|---:|---:|---:|
| baseline | 997/1000 | 941/941 | 0 | 0 |
| v2 | 1000/1000 | 921/921 | 0 | 0 |

Изменения: {"count":1000,"changed":{"category":29,"priority":19,"lang":0,"needs_human":3,"is_spam_or_duplicate":0},"auto_to_human":3,"human_to_auto":0}. V2 режимы: {"counts":{"semantic-hybrid":1000},"fallback_reasons":{}}.

Предсказанные распределения (не accuracy):

```json
{
  "baseline": {
    "category": {
      "complaint.cheat": 36,
      "complaint.invalid": 58,
      "complaint.other": 311,
      "complaint.insult": 202,
      "complaint.dm": 89,
      "complaint.admin": 96,
      "complaint.scam": 23,
      "complaint.rmt_ads": 2,
      "report.offtopic": 127,
      "report.help": 22,
      "report.complaint": 29,
      "report.question": 5
    },
    "priority": {
      "p1": 141,
      "p2": 350,
      "p3": 505,
      "p0": 4
    },
    "lang": {
      "ru": 844,
      "uz": 132,
      "es": 2,
      "kk": 16,
      "pt": 2,
      "en": 4
    }
  },
  "v2": {
    "category": {
      "complaint.cheat": 34,
      "complaint.invalid": 57,
      "complaint.other": 303,
      "complaint.insult": 202,
      "complaint.dm": 89,
      "complaint.admin": 106,
      "complaint.scam": 24,
      "complaint.rmt_ads": 2,
      "report.offtopic": 125,
      "report.help": 20,
      "report.complaint": 33,
      "report.question": 5
    },
    "priority": {
      "p1": 150,
      "p2": 357,
      "p3": 489,
      "p0": 4
    },
    "lang": {
      "ru": 844,
      "uz": 132,
      "es": 2,
      "kk": 16,
      "pt": 2,
      "en": 4
    }
  },
  "kk_uz_metadata": {
    "kk": {
      "provenance": "source_heuristic_language_metadata_not_gold",
      "count": 31,
      "baseline_human": 31,
      "v2_human": 31
    },
    "uz": {
      "provenance": "source_heuristic_language_metadata_not_gold",
      "count": 119,
      "baseline_human": 119,
      "v2_human": 119
    }
  }
}
```

| Метрика на real valid | baseline | v2 |
|---|---:|---:|
| category_accuracy | null (0/0) | null (0/0) |
| priority_macro_f1 | null (0/0) | null (0/0) |
| risk_recall | null (0/0) | null (0/0) |
| auto_precision | null (0/0) | null (0/0) |
| auto_coverage | null (0/0) | null (0/0) |
| citation_relevance_precision | null (0/0) | null (0/0) |

Нет нужных меток: нулевой знаменатель означает null. Все метрики содержат numerator/denominator/provenance; macro-F1 знаменатель — объединение ожидаемых/предсказанных классов, numerator — сумма F1 классов.

## Настоящий HTTP

POST /triage на отдельном ephemeral localhost, seed=false, приватный отдельный runtime, concurrency=1. Все 1000 validation-запросов один раз; JSON serialization/transport/read/parse включены. Store пуст: этот HTTP замер без истории между запросами. First request 61.3 мс и 20 warmup отдельно. Измеренные p50=18.2 мс, p95=45.2 мс, max=306.4 мс; p95<=5000: true. Ошибок HTTP 0; режимы/fallback: {"counts":{"semantic-hybrid":1000},"fallback_reasons":{}}. Initialization не спрятана в latency.

Память по OS working sets parent+worker: sampled max parent 114778112 B, worker 629395456 B, combined 686612480 B; samples 23; min sampled free 798945280 B. Это дискретные снимки каждые 100 записей, не непрерывный пик.

## Авторский regression

35 сценариев из существующего control.json; provenance=authored_synthetic_regression; не unseen и не экспертный gold. All expectations baseline 35/35, v2 32/35.

| Метрика | baseline | v2 |
|---|---:|---:|
| category_accuracy | 100.00% (31/31) | 100.00% (31/31) |
| priority_macro_f1 | 100.00% (4/4) | 100.00% (4/4) |
| language_accuracy | 100.00% (30/30) | 100.00% (30/30) |
| risk_recall | 100.00% (28/28) | 100.00% (28/28) |
| auto_precision | null (0/0) | null (0/0) |
| auto_coverage | null (0/0) | null (0/0) |

Расхождения авторских ожиданий: {"baseline":[],"v2":[{"id":"ru-question","errors":[{"field":"needs_human","expected":false,"observed":true}]},{"id":"en-faq","errors":[{"field":"needs_human","expected":false,"observed":true}]},{"id":"ru-evidence-question","errors":[{"field":"needs_human","expected":false,"observed":true}]}]}.

## Отдельный retrieval holdout

24 запросов; provenance=authored_synthetic_independent_control; human_reviewed=false; SHA256=a9bc7407ea869e891105182df4fc26207f842031db7785090269d54b1e9453eb; заморожен 2026-10-30T08:58:21.625Z до evaluated inference. Global lexical и hybrid используют те же 290 источников. Exact canonical IDs с namespace; generic KB не подменяет expected rule. Никакой настройки по результату.

| Метрика | Global lexical | Hybrid E5 |
|---|---:|---:|
| hit_at_1 | 4.17% (1/24) | 33.33% (8/24) |
| hit_at_3 | 8.33% (2/24) | 62.50% (15/24) |
| hit_at_8 | 12.50% (3/24) | 79.17% (19/24) |
| mrr_at_8 | 6.85% (1.6428571428571428/24) | 49.31% (11.834523809523809/24) |
| expected_recall_at_8 | 12.50% (3/24) | 79.17% (19/24) |

Miss IDs lexical: ["control-ru-01","control-ru-03","control-ru-04","control-en-01","control-en-02","control-en-03","control-en-04","control-kk-01","control-kk-02","control-kk-04","control-uz-01","control-uz-02","control-uz-03","control-es-01","control-es-02","control-es-03","control-es-04","control-pt-01","control-pt-02","control-pt-03","control-pt-04"]; hybrid: ["control-ru-01","control-en-01","control-kk-03","control-uz-02","control-uz-03"].

По языкам (авторские метки; не оценка носителями):

| Язык | n | Lexical hit@8 | Hybrid hit@8 |
|---|---:|---:|---:|
| ru | 4 | 25.00% (1/4) | 75.00% (3/4) |
| en | 4 | 0.00% (0/4) | 75.00% (3/4) |
| kk | 4 | 25.00% (1/4) | 75.00% (3/4) |
| uz | 4 | 25.00% (1/4) | 50.00% (2/4) |
| es | 4 | 0.00% (0/4) | 100.00% (4/4) |
| pt | 4 | 0.00% (0/4) | 100.00% (4/4) |

## Воспроизведение и ограничения

Команда: `node scripts/evaluate-v2.mjs` (или `--input <private.jsonl>`). Модель заранее локально установлена; автоматической загрузки нет. Приватные результаты/checkpoints: `artifacts/private/v2-evaluation/<run-id>/`; изолированный пустой HTTP runtime: `runtime/evaluation-v2/<run-id>/http/`. `runtime/evaluation-v2/latest.json` указывает на actual report. Скрипт не меняет основной state.json и не использует train. Полные prediction/failure rows остаются приватными.

- No expert quality, real-validation accuracy, risk recall, auto precision/coverage or manual citation relevance can be claimed without corresponding labels.
- Author regression is development regression; retrieval holdout is authored and not native-speaker/expert reviewed. Misses remain reported.
- Citation integrity verifies exact canonical source existence/text/namespace, not relevance.
- Sequential local HTTP is not concurrency/load or external-network SLA. Memory maxima are sampled, not continuous.
- Original validation language values are metadata; kk/uz gold evaluation exists only in authored fixtures.

Safety failures: 0. External API calls: 0, API cost $0; локальная стоимость не оценивалась. Benchmark не запускает генератор или GPU training. Checkpoint recovery проверяется отдельным main-owned script; здесь сохраняется прогресс выполнения, resume этого benchmark не заявляется.

## Отдельная проверка восстановления

`node scripts/check-recovery-v2.mjs`: PASS; provenance=automated_authored_synthetic_recovery_probe; только авторская синтетика, без real data/model. Процесс импортера фактически прерван SIGKILL после durable cursor 5/300; сохранённый job=running. Повтор той же команды возобновил импорт за 9845 мс: 300 imported + 1 seed = 301 unique; повторно добавлено 0. Operator edit/escalated status/feedback/annotation сохранены; admin/outcome исключены. Отдельный первый probe с частым открытием файла наблюдал Windows EPERM rename; гипотеза конкурирующего чтения подтверждается успешным stat-only probe. Ошибка и данные сохранены приватно; это не скрытый PASS первого запуска. Основной runtime не изменён.
