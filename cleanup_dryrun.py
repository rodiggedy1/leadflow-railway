"""
Dry-run cleanup report for backfill-duplicated messageHistory entries.

Rules for a "safe pair":
  - Exactly 2 entries in the matching group
  - Same normalized role
  - Exactly identical content
  - Timestamp difference <= 2000ms
  - Exactly one entry has an opMsgId, the other does not

For each safe pair: would keep the entry with the EARLIER ts, attach the opMsgId to it,
and remove the later duplicate.

Ambiguous groups (3+ entries matching) are reported separately for manual review.
"""

import mysql.connector, json

conn = mysql.connector.connect(
    host='gateway04.us-east-1.prod.aws.tidbcloud.com',
    port=4000,
    user='QXWpcJKwPBoGqNG.f679bd03aa5d',
    password='lavuI337Gv3r6hjOW1wI',
    database='CAeRhAUjAZoEuxNGm5QbPr',
    ssl_disabled=False
)
cur = conn.cursor(dictionary=True)

WINDOW_MS = 2000

# Fetch all sessions that have messageHistory
cur.execute("SELECT id, leadPhone, messageHistory FROM conversation_sessions WHERE messageHistory IS NOT NULL AND messageHistory != '[]' AND messageHistory != ''")
sessions = cur.fetchall()
conn.close()

total_sessions_checked = 0
affected_sessions = 0
total_safe_pairs = 0
total_ambiguous_groups = 0
ambiguous_details = []
safe_pair_examples = []

for s in sessions:
    raw = s['messageHistory']
    try:
        history = json.loads(raw)
    except Exception:
        continue
    if not isinstance(history, list) or len(history) < 2:
        continue

    total_sessions_checked += 1
    session_safe = 0
    session_ambiguous = 0

    # Group entries by (role, content)
    from collections import defaultdict
    groups = defaultdict(list)
    for i, entry in enumerate(history):
        key = (entry.get('role',''), entry.get('content',''))
        groups[key].append((i, entry))

    for (role, content), members in groups.items():
        if len(members) < 2:
            continue
        # Check all pairs within the window
        # Sort by ts
        members_sorted = sorted(members, key=lambda x: x[1].get('ts') or 0)
        # Find pairs within 2s window
        for a_idx in range(len(members_sorted)):
            for b_idx in range(a_idx + 1, len(members_sorted)):
                a_pos, a = members_sorted[a_idx]
                b_pos, b = members_sorted[b_idx]
                ts_a = a.get('ts') or 0
                ts_b = b.get('ts') or 0
                if abs(ts_a - ts_b) > WINDOW_MS:
                    continue
                # Within window — check safe pair criteria
                a_has_id = bool(a.get('opMsgId'))
                b_has_id = bool(b.get('opMsgId'))
                exactly_one_has_id = (a_has_id != b_has_id)  # XOR

                # Count how many entries in this group are within window of each other
                # (to detect ambiguous groups of 3+)
                window_members = [
                    m for m in members_sorted
                    if abs((m[1].get('ts') or 0) - ts_a) <= WINDOW_MS
                ]
                if len(window_members) > 2:
                    session_ambiguous += 1
                    if len(ambiguous_details) < 10:
                        ambiguous_details.append({
                            'sessionId': s['id'],
                            'phone': s['leadPhone'],
                            'role': role,
                            'content': content[:60],
                            'group_size': len(window_members),
                            'ts_values': [m[1].get('ts') for m in window_members],
                        })
                    break  # don't double-count

                if exactly_one_has_id and len(window_members) == 2:
                    session_safe += 1
                    if len(safe_pair_examples) < 10:
                        keep = a if ts_a <= ts_b else b
                        remove = b if ts_a <= ts_b else a
                        safe_pair_examples.append({
                            'sessionId': s['id'],
                            'phone': s['leadPhone'],
                            'role': role,
                            'content': content[:60],
                            'ts_diff_ms': abs(ts_a - ts_b),
                            'keep_ts': min(ts_a, ts_b),
                            'keep_has_id': bool(keep.get('opMsgId')),
                            'remove_ts': max(ts_a, ts_b),
                            'remove_has_id': bool(remove.get('opMsgId')),
                            'opMsgId': a.get('opMsgId') or b.get('opMsgId'),
                        })

    if session_safe > 0 or session_ambiguous > 0:
        affected_sessions += 1
        total_safe_pairs += session_safe
        total_ambiguous_groups += session_ambiguous

print("=" * 60)
print("DRY-RUN CLEANUP REPORT")
print("=" * 60)
print(f"Sessions checked:          {total_sessions_checked}")
print(f"Affected sessions:         {affected_sessions}")
print(f"Safe pairs to clean:       {total_safe_pairs}")
print(f"Ambiguous groups (skip):   {total_ambiguous_groups}")
print()

if safe_pair_examples:
    print("--- SAFE PAIR EXAMPLES (first 10) ---")
    for ex in safe_pair_examples:
        print(f"  Session {ex['sessionId']} ({ex['phone']})")
        print(f"    role={ex['role']} content='{ex['content']}'")
        print(f"    ts_diff={ex['ts_diff_ms']}ms | opMsgId={ex['opMsgId']}")
        print(f"    KEEP ts={ex['keep_ts']} (has_id={ex['keep_has_id']})")
        print(f"    REMOVE ts={ex['remove_ts']} (has_id={ex['remove_has_id']})")
        print()

if ambiguous_details:
    print("--- AMBIGUOUS GROUPS (manual review needed) ---")
    for ag in ambiguous_details:
        print(f"  Session {ag['sessionId']} ({ag['phone']})")
        print(f"    role={ag['role']} content='{ag['content']}'")
        print(f"    group_size={ag['group_size']} ts_values={ag['ts_values']}")
        print()
