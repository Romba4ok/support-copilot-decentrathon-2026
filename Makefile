NODE ?= node
MODE ?= v2

.PHONY: run test predict evaluate
run:
	$(NODE) src/server.mjs
test:
	$(NODE) --test --test-concurrency=1 tests/*.test.mjs
predict:
	$(NODE) src/cli/predict.mjs --in "$(IN)" --out "$(OUT)" --mode "$(MODE)" --initialize
evaluate:
	$(NODE) scripts/evaluate.mjs
