import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const defaultDb = fileURLToPath(new URL('../data/island.sqlite', import.meta.url));
export function listReports(db, { includeDemo = false } = {}) {
  const hasReviews = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='report_reviews'").get();
  const rows = db.prepare(`SELECT r.id,r.reason,r.created_at AS createdAt,${hasReviews ? 'v.action AS reviewAction,v.reviewed_at AS reviewedAt' : 'NULL AS reviewAction,NULL AS reviewedAt'}
    FROM reports r JOIN users reporter ON reporter.id=r.reporter
    LEFT JOIN matches m ON m.id=r.match_id LEFT JOIN users a ON a.id=m.a LEFT JOIN users b ON b.id=m.b
    ${hasReviews ? 'LEFT JOIN report_reviews v ON v.report_id=r.id' : ''}
    WHERE ?=1 OR (COALESCE(json_extract(reporter.data,'$.demo'),0)=0 AND COALESCE(json_extract(a.data,'$.demo'),0)=0 AND COALESCE(json_extract(b.data,'$.demo'),0)=0)
    ORDER BY r.created_at DESC,r.id`).all(includeDemo ? 1 : 0);
  return rows.map(row => ({ ...row }));
}

export function reviewReport(db, reportId, { action, note = '', includeDemo = false, now = new Date().toISOString() } = {}) {
  if (!['dismiss', 'reviewed'].includes(action)) throw new Error('action只允许dismiss或reviewed；这里只记录人工处理，不执行拉黑或发消息');
  if (typeof note !== 'string' || [...note].length > 500) throw new Error('处理备注最多500字');
  if (typeof reportId !== 'string' || !listReports(db, { includeDemo }).some(report => report.id === reportId)) throw new Error('举报不存在或不在当前样本范围；演示数据需 --include-demo');
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('处理时间无效');
  const reviewedAt = timestamp.toISOString();
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS report_reviews (
    report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('dismiss','reviewed')),
    note TEXT NOT NULL,
    reviewed_at TEXT NOT NULL
  );`);
  db.prepare('INSERT INTO report_reviews(report_id,action,note,reviewed_at) VALUES (?,?,?,?) ON CONFLICT(report_id) DO UPDATE SET action=excluded.action,note=excluded.note,reviewed_at=excluded.reviewed_at').run(reportId, action, note.trim(), reviewedAt);
  return { id: reportId, action, reviewedAt, effect: '仅记录本地人工处理结果；未发送消息，未更改用户账号或匹配。' };
}

export function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { db: { type: 'string' }, action: { type: 'string' }, note: { type: 'string' }, 'include-demo': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log('用法：node scripts/reports.mjs list [--db path] [--include-demo]\n      node scripts/reports.mjs review <reportId> --action dismiss|reviewed [--note 文本] [--db path] [--include-demo]\nlist只读列出必要举报内容；review仅保存本地人工记录，不发送消息。默认排除演示用户。'); return; }
  const [command, reportId] = positionals;
  if (!['list', 'review'].includes(command) || positionals.length !== (command === 'list' ? 1 : 2)) throw new Error('请使用list或review <reportId>；查看 --help 获取用法');
  if (command === 'list' && (values.action !== undefined || values.note !== undefined)) throw new Error('list不接受--action或--note');
  const dbPath = values.db || defaultDb;
  if (!existsSync(dbPath)) throw new Error('数据库不存在，请先启动服务或通过 --db 指定现有数据库');
  const db = new DatabaseSync(dbPath, { readOnly: command === 'list' });
  try {
    const result = command === 'list' ? { includeDemo: values['include-demo'], reports: listReports(db, { includeDemo: values['include-demo'] }) }
      : reviewReport(db, reportId, { action: values.action, note: values.note ?? '', includeDemo: values['include-demo'] });
    console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
