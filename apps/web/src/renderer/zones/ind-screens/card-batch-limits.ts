// apps/web は apps/api を直import できない構成(lint-deps.mjs)のため、
// BIO_CARD_BATCH_MAX(apps/api/src/observation-constants.ts)と同じ値をここに複製する。
// 値の突合は tests/biocard-batch-max-parity.test.ts が両定数を直接importして固定する
// (このコメントは2026-08-08 G-04-1是正。出典=kits/lane-audit/R0807-1df660-REPORT-2026-08-07-w1-gate.md)。
export const BIO_CARD_BATCH_MAX_WEB = 200;
