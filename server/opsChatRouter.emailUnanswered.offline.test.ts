// Run with cached Node 22.13, --experimental-sqlite, empty environment and unshare -n.
// AST-extract the actual handler and additive metadata helpers; never load production services/startup.
import { test } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const orm = require('drizzle-orm');
const { drizzle } = require('drizzle-orm/mysql-proxy');
const { mysqlTable, varchar, text, bigint, int, timestamp } = require('drizzle-orm/mysql-core');
const root = resolve(__dirname, '..');
const source = process.env.EMAIL_INDICATOR_CONTROL_SOURCE
  ? readFileSync(process.env.EMAIL_INDICATOR_CONTROL_SOURCE, 'utf8')
  : readFileSync(resolve(root, 'server/opsChatRouter.ts'), 'utf8');
const ast = ts.createSourceFile('opsChatRouter.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let procedure: any;
function visit(node: any) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'listEmailInboxThreads') procedure = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(procedure);
assert.equal(procedure.initializer.expression.name.text, 'query');
const handler = procedure.initializer.arguments[0].getText(ast);
const compile = (code: string) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const handlerJS = compile(`const handler = ${handler};`);
const serviceSource = readFileSync(resolve(root, 'server/gmailService.ts'), 'utf8');
const metadataSource = serviceSource.slice(serviceSource.indexOf('/** Read-only inbox indicator inputs;'));
assert.ok(metadataSource.startsWith('/** Read-only inbox indicator inputs;'));
const serviceAst = ts.createSourceFile('gmailService.ts', serviceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const concurrencyDeclaration = serviceAst.statements.find((s: any) => ts.isVariableStatement(s) &&
  s.declarationList.declarations.some((d: any) => d.name.getText(serviceAst) === 'GMAIL_THREAD_FETCH_CONCURRENCY'));
assert.ok(concurrencyDeclaration, 'reuse existing concurrency declaration');
const concurrencyJS = compile(concurrencyDeclaration.getText(serviceAst));
const inboxModule: any = { exports: {} };
new Function('exports', compile(readFileSync(resolve(root, 'server/utils/emailInbox.ts'), 'utf8')))(inboxModule.exports);
const gmailThreadMeta = mysqlTable('gmail_thread_meta', {
  threadId: varchar('threadId', { length: 255 }), senderName: text('senderName'), senderEmail: text('senderEmail'),
  subject: text('subject'), snippet: text('snippet'), lastMessageAt: bigint('lastMessageAt', { mode: 'number' }),
  messageCount: int('messageCount'), isUnread: int('isUnread'), aiHistoryId: text('aiHistoryId'), aiResolvedAt: timestamp('aiResolvedAt'),
});
const baseDate = 1794881567000;
const message = (id: any, date: any, labels: any = ['INBOX']) => ({ id, internalDate: String(date), labelIds: labels });
const threadData = (id = 'thread', messages: any[] = [message('incoming', baseDate)], historyId: any = 'history-1') => ({ id, historyId, messages });
const revision = (options: any = {}) => ({ threadId: 'thread', lastMessageAt: baseDate, messageCount: 1,
  aiHistoryId: 'history-1', latestAcceptedMessageId: null, ...options });

function metadataPort() {
  const requests: any[] = [];
  const responses = new Map<string, any>();
  let clientCalls = 0;
  let active = 0;
  let maxActive = 0;
  let clientError: any;
  let beforeRead: ((request: any) => Promise<void>) | undefined;
  const gmail = { users: { threads: { get: async (request: any) => {
    requests.push(request); active++; maxActive = Math.max(active, maxActive);
    try {
      // Exact provider port: extra methods/headers/bodies would fail this equality.
      assert.deepEqual(request, { userId: 'me', id: request.id, format: 'metadata',
        fields: 'id,historyId,messages(id,internalDate,labelIds)' });
      if (beforeRead) await beforeRead(request);
      else await Promise.resolve();
      const response = responses.get(request.id);
      if (response instanceof Error) throw response;
      return { data: response };
    } finally { active--; }
  } } } };
  const exports: any = {};
  new Function('exports', 'getGmailClient', `${concurrencyJS}\n${compile(metadataSource)}`)(exports, async () => {
    clientCalls++; if (clientError) throw clientError; return gmail;
  });
  return { requests, responses, read: (rows: any[], mailbox: any = 'office@example.com') => exports.getEmailInboxUnansweredStatuses(rows, mailbox),
    counts: () => ({ clientCalls, maxActive }), failClient: () => { clientError = Error('auth unavailable'); },
    before: (fn: (request: any) => Promise<void>) => { beforeRead = fn; } };
}
function buildHandler(getDb: () => Promise<any>, getInbox: () => Promise<any>, statuses: any) {
  return new Function('getDb', 'getInboxEmailAddress', 'gmailThreadMeta', 'keepLatestEmailThreadPerSender',
    'sql', 'and', 'isNull', 'desc', 'require', `${handlerJS}\nreturn handler;`)(
    getDb, getInbox, gmailThreadMeta, inboxModule.exports.keepLatestEmailThreadPerSender,
    orm.sql, orm.and, orm.isNull, orm.desc, (path: string) => {
      assert.equal(path, './gmailService', 'only mocked metadata helper is imported');
      return { getEmailInboxUnansweredStatuses: statuses };
    });
}
function harness() {
  const local = new DatabaseSync(':memory:');
  local.exec(`CREATE TABLE gmail_thread_meta (
    threadId TEXT PRIMARY KEY, senderName TEXT, senderEmail TEXT, subject TEXT, snippet TEXT,
    lastMessageAt INTEGER, messageCount INTEGER, isUnread INTEGER, aiHistoryId TEXT, aiResolvedAt TEXT);
    CREATE TABLE madison_email_drafts (threadId TEXT, status TEXT);
    CREATE TABLE gmail_sent_log (id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT, messageId TEXT, agentName TEXT, sentAt TEXT);`);
  local.function('CHAR_LENGTH', (value: unknown) => typeof value === 'string' ? value.length : null);
  const calls: { query: string; params: any[]; method: string }[] = [];
  const db = drizzle(async (query: string, params: any[], method: string) => {
    calls.push({ query, params, method });
    assert.match(query, /^select\b/i, 'only database SELECT permitted'); assert.equal(method, 'all');
    return { rows: local.prepare(query).all(...params).map((row: any) => Object.values(row)) };
  });
  const port = metadataPort();
  const run = buildHandler(async () => db, async () => 'office@example.com', port.read);
  function thread(id = 'thread', options: any = {}) {
    const row = { senderName: 'Maya', senderEmail: `${id}@example.com`, subject: 'Hello', snippet: 'Incoming',
      lastMessageAt: baseDate, messageCount: 1, isUnread: 0, aiHistoryId: 'history-1', aiResolvedAt: null, ...options };
    local.prepare('INSERT INTO gmail_thread_meta VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, row.senderName, row.senderEmail, row.subject, row.snippet, row.lastMessageAt, row.messageCount,
      row.isUnread, row.aiHistoryId, row.aiResolvedAt);
    if (options.admitted !== false) local.prepare('INSERT INTO madison_email_drafts VALUES (?, ?)').run(id, options.draftStatus ?? 'DRAFT_READY');
    port.responses.set(id, threadData(id, [message(`${id}-incoming`, row.lastMessageAt)], row.aiHistoryId));
    return row;
  }
  function accepted(id = 'thread', messageId: any = 'accepted-outgoing', sentAt = baseDate + 24000, agent = 'Instinct') {
    local.prepare('INSERT INTO gmail_sent_log (threadId, messageId, agentName, sentAt) VALUES (?, ?, ?, ?)').run(
      id, messageId, agent, new Date(sentAt).toISOString());
  }
  return { local, calls, thread, accepted, port, run };
}
async function indicator(h: ReturnType<typeof harness>, id = 'thread') {
  return (await h.run()).threads.find((r: any) => r.threadId === id);
}

for (const agent of ['Instinct', 'Human Agent']) test(`exact latest SENT ${agent} remains answered after outgoing worker refresh (recorded blocker repaired)`, async () => {
  const h = harness(); h.thread('thread', { isUnread: 1 }); h.accepted('thread', 'accepted-outgoing', baseDate + 24000, agent);
  h.port.responses.set('thread', threadData('thread', [message('incoming', baseDate), message('accepted-outgoing', baseDate + 24000, ['SENT'])]));
  assert.equal((await indicator(h)).hasUnanswered, false);
  assert.equal(h.port.requests.length, 1);
  await indicator(h); assert.equal(h.port.requests.length, 2, 'mismatched pre-refresh revision is not cached');
  h.local.prepare('UPDATE gmail_thread_meta SET lastMessageAt = ?, messageCount = 2 WHERE threadId = ?').run(baseDate + 24000, 'thread');
  const row = await indicator(h); assert.equal(row.hasUnanswered, false); assert.equal(row.isUnread, true);
  await indicator(h); assert.equal(h.port.requests.length, 3, 'exact refreshed revision is cached');
});
for (const unread of [0, 1]) test(`incoming stays pending independent of unread=${unread}`, async () => {
  const h = harness(); h.thread('thread', { isUnread: unread });
  const row = await indicator(h); assert.equal(row.hasUnanswered, true); assert.equal(row.isUnread, unread === 1);
  await indicator(h); assert.equal(h.port.requests.length, 1, 'exact incoming revision also caches');
});
test('latest SENT acceptance in Gmail needs no app receipt or sender/address heuristic', async () => {
  const h = harness(); h.thread('thread', { senderEmail: 'customer@example.com' });
  h.port.responses.set('thread', threadData('thread', [message('external-accepted', baseDate, ['SENT'])]));
  assert.equal((await indicator(h)).hasUnanswered, false);
});
test('new incoming restores green, including same-second receipt and mailbox display sender counterexample', async () => {
  const h = harness(); h.thread('thread', { senderEmail: 'office@example.com', lastMessageAt: baseDate + 24800, messageCount: 2 });
  h.accepted('thread', 'accepted-outgoing', baseDate + 24000);
  h.port.responses.set('thread', threadData('thread', [message('incoming', baseDate), message('accepted-outgoing', baseDate + 24800, ['SENT'])]));
  assert.equal((await indicator(h)).hasUnanswered, false);
  h.local.prepare('UPDATE gmail_thread_meta SET lastMessageAt = ?, messageCount = 3 WHERE threadId = ?').run(baseDate + 24900, 'thread');
  h.port.responses.set('thread', threadData('thread', [message('incoming', baseDate), message('accepted-outgoing', baseDate + 24800, ['SENT']),
    message('noreply-inbound', baseDate + 24900, ['INBOX', 'UNREAD'])]));
  const row = await indicator(h); assert.equal(row.hasUnanswered, true); assert.equal(row.senderEmail, 'office@example.com');
  assert.equal(h.port.requests.length, 2);
});
test('latest is selected by exact internalDate, not array order or message count', async () => {
  const p = metadataPort();
  p.responses.set('thread', threadData('thread', [message('reply', baseDate + 10, ['SENT']), message('old', baseDate)]));
  assert.deepEqual(await p.read([revision({ lastMessageAt: baseDate + 10, messageCount: 2 })]), [false]);
});
test('historical ties do not obscure a uniquely latest SENT, but same-timestamp new incoming invalidates by count', async () => {
  const p = metadataPort();
  p.responses.set('thread', threadData('thread', [message('old1', baseDate), message('old2', baseDate), message('out', baseDate + 1, ['SENT'])]));
  assert.deepEqual(await p.read([revision({ lastMessageAt: baseDate + 1, messageCount: 3 })]), [false]);
  p.responses.set('thread', threadData('thread', [message('old1', baseDate), message('old2', baseDate),
    message('out', baseDate + 1, ['SENT']), message('new-incoming', baseDate + 1)]));
  assert.deepEqual(await p.read([revision({ lastMessageAt: baseDate + 1, messageCount: 4 })]), [true]);
  assert.equal(p.requests.length, 2);
});
for (const labels of [['DRAFT', 'SENT'], ['INBOX']]) test(`accepted ID on ${labels.join('/')} is not settled accepted-message evidence`, async () => {
  const p = metadataPort();
  p.responses.set('thread', threadData('thread', [message('accepted', baseDate, labels), message('other-out', baseDate + 1, ['SENT'])]));
  const row = revision({ latestAcceptedMessageId: 'accepted', lastMessageAt: baseDate + 1, messageCount: 2 });
  assert.deepEqual(await p.read([row]), [true]); assert.deepEqual(await p.read([row]), [true]);
  assert.equal(p.requests.length, 2);
});
for (const options of [{ lastMessageAt: baseDate + 1 }, { messageCount: 2 }]) test(`demonstrably older Gmail SENT metadata cannot suppress newer row ${JSON.stringify(options)}`, async () => {
  const p = metadataPort(); p.responses.set('thread', threadData('thread', [message('out', baseDate, ['SENT'])]));
  assert.deepEqual(await p.read([revision(options)]), [true]);
});
for (const [name, data] of [
  ['tied latest outgoing/incoming', threadData('thread', [message('out', baseDate, ['SENT']), message('in', baseDate)])],
  ['tied latest two outgoing', threadData('thread', [message('out1', baseDate, ['SENT']), message('out2', baseDate, ['SENT'])])],
  ['only DRAFT SENT', threadData('thread', [message('draft', baseDate, ['DRAFT', 'SENT'])])],
  ['no messages', threadData('thread', [])], ['missing messages', { id: 'thread', historyId: 'history-1' }],
  ['wrong thread ID', threadData('other', [message('out', baseDate, ['SENT'])])],
  ['blank thread ID', threadData('', [message('out', baseDate, ['SENT'])])],
  ['missing message ID', threadData('thread', [message(undefined, baseDate, ['SENT'])])],
  ['blank message ID', threadData('thread', [message(' ', baseDate, ['SENT'])])],
  ['padded message ID', threadData('thread', [message(' out ', baseDate, ['SENT'])])],
  ['duplicate message IDs', threadData('thread', [message('out', baseDate, ['SENT']), message('out', baseDate + 1, ['SENT'])])],
  ['nonfinite date', threadData('thread', [message('out', Infinity, ['SENT'])])],
  ['malformed date', threadData('thread', [message('out', '123junk', ['SENT'])])],
  ['zero date', threadData('thread', [message('out', 0, ['SENT'])])],
  ['missing labels', threadData('thread', [message('out', baseDate, undefined)].map(m => ({ ...m, labelIds: undefined })))],
  ['malformed labels', threadData('thread', [message('out', baseDate, 'SENT')])],
  ['null label', threadData('thread', [message('out', baseDate, ['SENT', null])])],
  ['null message', threadData('thread', [null])], ['null metadata', null], ['provider failure', Error('provider unavailable')],
] as const) test(`${name} stays pending and never caches`, async () => {
  const p = metadataPort(); p.responses.set('thread', data);
  assert.deepEqual(await p.read([revision()]), [true]); assert.deepEqual(await p.read([revision()]), [true]);
  assert.equal(p.requests.length, 2);
});
test('draft never changes last non-draft status, including a later SENT-labelled draft and draft tied with latest', async () => {
  const p = metadataPort();
  for (const date of [baseDate, baseDate + 100]) {
    p.responses.set('thread', threadData('thread', [message('incoming', baseDate), message('draft', date, ['DRAFT', 'SENT'])]));
    assert.deepEqual(await p.read([revision({ lastMessageAt: date, messageCount: 2 })]), [true]);
  }
  p.responses.set('thread', threadData('thread', [message('sent', baseDate, ['SENT']), message('draft', baseDate + 200, ['DRAFT'])]));
  assert.deepEqual(await p.read([revision({ lastMessageAt: baseDate + 200, messageCount: 2 })]), [false]);
});
for (const options of [ { lastMessageAt: baseDate + 1 }, { messageCount: 2 }, { aiHistoryId: 'old-history' },
  { lastMessageAt: null }, { messageCount: null }, { latestAcceptedMessageId: 'not-yet-present' } ]) {
  test(`cache rejects mismatched/missing revision or pending accepted ID ${JSON.stringify(options)}`, async () => {
    const p = metadataPort(); p.responses.set('thread', threadData('thread', [message('out', baseDate, ['SENT'])]));
    await p.read([revision(options)]); await p.read([revision(options)]); assert.equal(p.requests.length, 2);
  });
}
test('null AI history can cache objective matching timestamp/count; malformed source history cannot cache', async () => {
  const p = metadataPort(); p.responses.set('thread', threadData());
  await p.read([revision({ aiHistoryId: null })]); await p.read([revision({ aiHistoryId: null })]); assert.equal(p.requests.length, 1);
  p.responses.set('other', threadData('other', [message('in', baseDate)], null));
  await p.read([revision({ threadId: 'other', aiHistoryId: null })]); await p.read([revision({ threadId: 'other', aiHistoryId: null })]);
  assert.equal(p.requests.length, 3);
});
test('every immutable row revision component invalidates existing cache', async () => {
  const p = metadataPort(); p.responses.set('thread', threadData()); await p.read([revision()]);
  for (const options of [{ lastMessageAt: baseDate + 1 }, { messageCount: 2 }, { aiHistoryId: 'history-2' }]) {
    await p.read([revision(options)]);
  }
  p.responses.set('other', threadData('other')); await p.read([revision({ threadId: 'other' })]); assert.equal(p.requests.length, 5);
});
test('post-send accepted ID invalidates unchanged row immediately; missing accepted ID is pending and not cached', async () => {
  const h = harness(); h.thread(); assert.equal((await indicator(h)).hasUnanswered, true);
  await indicator(h); assert.equal(h.port.requests.length, 1);
  h.accepted(); assert.equal((await indicator(h)).hasUnanswered, true);
  await indicator(h); assert.equal(h.port.requests.length, 3, 'not-yet-present accepted receipt must be retried on later reads only');
  h.port.responses.set('thread', threadData('thread', [message('incoming', baseDate), message('accepted-outgoing', baseDate + 24000, ['SENT'])]));
  assert.equal((await indicator(h)).hasUnanswered, false);
  h.local.prepare('UPDATE gmail_thread_meta SET lastMessageAt = ?, messageCount = 2 WHERE threadId = ?').run(baseDate + 24000, 'thread');
  assert.equal((await indicator(h)).hasUnanswered, false);
  await indicator(h); assert.equal(h.port.requests.length, 5);
  h.accepted('thread', 'second-accepted', baseDate + 24000);
  assert.equal((await indicator(h)).hasUnanswered, true, 'same-second receipt uses newest exact log id, not timestamp tolerance');
  assert.equal(h.port.requests.length, 6);
});
test('receipt projection correlates exact thread, ignores blank receipts, and never infers status from receipt time', async () => {
  const h = harness(); h.thread(); h.accepted('other-thread'); h.accepted('thread', 'present', baseDate - 999999);
  h.accepted('thread', '   ', baseDate + 999999);
  h.port.responses.set('thread', threadData('thread', [message('present', baseDate, ['SENT'])]));
  assert.equal((await indicator(h)).hasUnanswered, false);
  assert.match(h.calls[0].query, /gsl\.threadId = gmail_thread_meta\.threadId/);
  assert.doesNotMatch(h.calls[0].query, /UNIX_TIMESTAMP|CASE WHEN/);
});
test('failed read after revision change cannot reuse previously answered cache or drop row', async () => {
  const h = harness(); h.thread(); h.port.responses.set('thread', threadData('thread', [message('out', baseDate, ['SENT'])]));
  assert.equal((await indicator(h)).hasUnanswered, false);
  h.local.prepare('UPDATE gmail_thread_meta SET messageCount = 2 WHERE threadId = ?').run('thread');
  h.port.responses.set('thread', Error('read failed'));
  assert.equal((await indicator(h)).hasUnanswered, true); assert.equal((await indicator(h)).hasUnanswered, true);
  assert.equal(h.port.requests.length, 3);
});
test('authentication failure retains all pending rows without provider requests', async () => {
  const p = metadataPort(); p.failClient(); assert.deepEqual(await p.read([revision(), revision({ threadId: 'other' })]), [true, true]);
  assert.equal(p.requests.length, 0);
});
test('authenticated mailbox is part of cache identity; missing mailbox never reuses answered evidence', async () => {
  const p = metadataPort(); p.responses.set('thread', threadData('thread', [message('out', baseDate, ['SENT'])]));
  assert.deepEqual(await p.read([revision()], 'office@example.com'), [false]);
  assert.deepEqual(await p.read([revision()], 'office@example.com'), [false]);
  assert.equal(p.requests.length, 1);
  for (const missing of [null, '', ' ']) assert.deepEqual(await p.read([revision()], missing), [true]);
  assert.equal(p.requests.length, 1);
  p.responses.set('thread', threadData('thread', [message('other-mailbox-incoming', baseDate)]));
  assert.deepEqual(await p.read([revision()], 'other@example.com'), [true]);
  assert.equal(p.requests.length, 2, 'reauthenticated different mailbox must fetch its own exact source');
});
test('empty or invalid exact thread identifiers never fetch Gmail', async () => {
  const p = metadataPort(); assert.deepEqual(await p.read([]), []);
  assert.deepEqual(await p.read([revision({ threadId: '' }), revision({ threadId: ' thread ' })]), [true, true]);
  assert.equal(p.counts().clientCalls, 0);
});
test('existing concurrency=5 bounds the real port, all rows returned, unchanged polling uses cache', async () => {
  const p = metadataPort(); const rows = Array.from({ length: 27 }, (_, i) => revision({ threadId: `thread-${i}` }));
  for (const row of rows) p.responses.set(row.threadId, threadData(row.threadId));
  assert.deepEqual(await p.read(rows), rows.map(() => true));
  assert.equal(p.requests.length, 27); assert.equal(p.counts().maxActive, 5);
  await p.read(rows); assert.equal(p.requests.length, 27); assert.equal(p.counts().clientCalls, 1);
});
for (const draftStatus of ['RECEIVED', 'CLASSIFIED', 'TOOLS_RUNNING', 'DRAFT_READY', 'SENDING', 'FAILED', 'SENT', 'DISMISSED']) {
  test(`draft workflow ${draftStatus} cannot count as reply without latest non-draft SENT`, async () => {
    const h = harness(); h.thread('thread', { draftStatus }); assert.equal((await indicator(h)).hasUnanswered, true);
  });
}
test('original unresolved admission, newest-first sender dedup, unlimited rows and display defaults preserved', async () => {
  const h = harness(); h.thread('older', { senderEmail: ' Maya@Example.com ', lastMessageAt: baseDate - 1000 });
  h.thread('latest', { senderEmail: 'maya@example.com', isUnread: 1 });
  h.thread('resolved', { aiResolvedAt: new Date(baseDate).toISOString() }); h.thread('draftless', { admitted: false });
  h.thread('null-contact', { senderName: null, senderEmail: null, subject: null, snippet: null, messageCount: null });
  for (let i = 0; i < 601; i++) h.thread(`batch-${i}`, { lastMessageAt: baseDate - 30000 - i });
  const result = await h.run(); assert.equal(result.threads.length, 603); assert.equal(result.threads[0].threadId, 'latest');
  assert.equal(result.threads[0].isUnread, true);
  for (const absent of ['older', 'resolved', 'draftless']) assert.ok(!result.threads.some((r: any) => r.threadId === absent));
  assert.deepEqual(result.threads.find((r: any) => r.threadId === 'null-contact'), {
    threadId: 'null-contact', senderName: null, senderEmail: null, subject: '(no subject)', snippet: '',
    lastMessageAt: baseDate, messageCount: 0, isUnread: false, hasUnanswered: true,
  });
  assert.equal(result.inboxEmail, 'office@example.com'); assert.equal(h.calls.length, 1);
  assert.equal(h.port.requests.length, 603); assert.equal(h.port.counts().maxActive, 5);
  await h.run(); assert.equal(h.port.requests.length, 604, 'unchanged polling reads only the uncachable null-count row, not the whole inbox');
  // The sole LIMIT is the scalar latest-receipt lookup, never a list row cap.
  assert.equal((h.calls[0].query.match(/\blimit\b/gi) ?? []).length, 1);
  assert.match(h.calls[0].query, /order by `gmail_thread_meta`\.`lastMessageAt` desc$/i);
});
test('missing DB, inbox failure, helper failure and malformed status preserve safe shape', async () => {
  let calls = 0;
  assert.deepEqual(await buildHandler(async () => null, async () => { calls++; throw Error('not expected'); }, () => [])(),
    { threads: [], inboxEmail: null }); assert.equal(calls, 0);
  const h = harness(); h.thread();
  const db = drizzle(async () => ({ rows: [['thread', null, null, null, null, baseDate, 1, 1, null, null]] }));
  for (const statuses of [async () => { throw Error('helper unavailable'); }, async () => [undefined], async () => ['false']]) {
    const result = await buildHandler(async () => db, async () => { throw Error('identity unavailable'); }, statuses)();
    assert.equal(result.inboxEmail, null); assert.equal(result.threads[0].hasUnanswered, true); assert.equal(result.threads[0].isUnread, true);
  }
});
test('owned handler/helper have no sending, writes, model, automation, SMS or operational-table dependencies', () => {
  for (const code of [handler, metadataSource]) {
    assert.doesNotMatch(code.replaceAll('emailInboxStatusCache.delete(', 'allowedLocalMapRemoval('), /\b(insert|update|delete|mutation|sendGmailReply|sendSms|invokeLLM|markThreadRead|broadcastOpsUpdate|alertInvalidGrant)\b(?=\s*\()/);
    for (const forbidden of ['cleaner' + 'Jobs', 'cleaner' + '_jobs', 'madison_sms_draft', 'gmail_message_html_cache']) assert.ok(!code.includes(forbidden));
  }
  assert.doesNotMatch(metadataSource, /setTimeout|setInterval|payload|snippet|metadataHeaders|\.send\(|\.modify\(/);
});
