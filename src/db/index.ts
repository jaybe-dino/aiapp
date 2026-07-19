import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/** 스키마를 적용한다(idempotent). */
export function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(sql);
  migrate();
}

/** 기존 DB에 누락된 컬럼을 idempotent하게 추가(CREATE TABLE IF NOT EXISTS로는 컬럼 증분이 안 됨). */
function migrate() {
  const cols = (db.prepare("PRAGMA table_info(answers)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("need_level")) db.exec("ALTER TABLE answers ADD COLUMN need_level TEXT");
  if (!cols.includes("reward_nudge")) db.exec("ALTER TABLE answers ADD COLUMN reward_nudge TEXT");
  const ucols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!ucols.includes("region")) db.exec("ALTER TABLE users ADD COLUMN region TEXT");
}

/**
 * 직렬화 수준의 쓰기 트랜잭션. better-sqlite3는 동기 실행이라
 * BEGIN IMMEDIATE 로 쓰기 잠금을 선점해 원장 정합성을 보장한다.
 */
export function tx<T>(fn: () => T): T {
  const run = db.transaction(fn);
  return run.immediate();
}

applySchema();
