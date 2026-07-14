"""
Phase 2 one-time cleanup of backfill-duplicated messageHistory entries.

Safe pair criteria (all must be true):
  1. Exactly 2 entries in the matching group (within 2s window)
  2. Same normalized role
  3. Exactly identical content
  4. Timestamp difference <= 2000ms
  5. Exactly one entry has an opMsgId, the other does not

For each safe pair:
  - Keep the entry with the earlier ts
  - If the kept entry lacks opMsgId, copy it from the removed entry
  - Remove the later duplicate

Safety: before writing, verify len(new_history) == original_count - safe_pairs_removed
If mismatch, skip session and log for manual review.

Ambiguous groups (3+ entries within window) are never touched.
"""

import mysql.connector, json
from collections import defaultdict

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

cur.execute("""
    SELECT id, leadPhone, messageHistory
    FROM conversation_sessions
    WHERE messageHistory IS NOT NULL AND messageHistory != '[]' AND messageHistory != ''
""")
sessions = cur.fetchall()

stats = {
    'sessions_modified': 0,
    'messages_removed': 0,
    'messages_enriched': 0,
    'ambiguous_skipped': 0,
    'sessions_skipped_validation': 0,
}
skipped_sessions = []

for s in sessions:
    raw = s['messageHistory']
    try:
        history = json.loads(raw)
    except Exception:
        continue
    if not isinstance(history, list) or len(history) < 2:
        continue

    original_count = len(history)

    # Find all safe pairs and ambiguous groups
    # Group by (role, content)
    groups = defaultdict(list)
    for i, entry in enumerate(history):
        key = (entry.get('role', ''), entry.get('content', ''))
        groups[key].append((i, entry))

    indices_to_remove = set()
    enrichments = {}  # index -> opMsgId to attach
    session_safe_pairs = 0
    has_ambiguous = False

    for (role, content), members in groups.items():
        if len(members) < 2:
            continue
        members_sorted = sorted(members, key=lambda x: x[1].get('ts') or 0)

        # Check all pairs within the window
        processed = set()
        for a_idx in range(len(members_sorted)):
            if a_idx in processed:
                continue
            for b_idx in range(a_idx + 1, len(members_sorted)):
                if b_idx in processed:
                    continue
                a_pos, a = members_sorted[a_idx]
                b_pos, b = members_sorted[b_idx]
                ts_a = a.get('ts') or 0
                ts_b = b.get('ts') or 0
                if abs(ts_a - ts_b) > WINDOW_MS:
                    continue

                # Count all members within window of ts_a
                window_members = [
                    m for m in members_sorted
                    if abs((m[1].get('ts') or 0) - ts_a) <= WINDOW_MS
                ]

                if len(window_members) > 2:
                    has_ambiguous = True
                    stats['ambiguous_skipped'] += 1
                    break  # don't process this group

                # Exactly 2 in window — check safe pair criteria
                a_has_id = bool(a.get('opMsgId'))
                b_has_id = bool(b.get('opMsgId'))
                if a_has_id == b_has_id:
                    # Both have ID or neither — not a safe pair
                    continue

                # Safe pair confirmed
                # Keep earlier ts, remove later ts
                if ts_a <= ts_b:
                    keep_pos, keep = a_pos, a
                    remove_pos, remove = b_pos, b
                else:
                    keep_pos, keep = b_pos, b
                    remove_pos, remove = a_pos, a

                # If kept entry lacks opMsgId, copy from removed
                if not keep.get('opMsgId') and remove.get('opMsgId'):
                    enrichments[keep_pos] = remove['opMsgId']
                    stats['messages_enriched'] += 1

                indices_to_remove.add(remove_pos)
                session_safe_pairs += 1
                processed.add(a_idx)
                processed.add(b_idx)

    if session_safe_pairs == 0:
        continue

    # Apply enrichments
    for idx, op_msg_id in enrichments.items():
        history[idx]['opMsgId'] = op_msg_id

    # Build new history excluding removed indices
    new_history = [entry for i, entry in enumerate(history) if i not in indices_to_remove]

    # Safety validation: length check
    expected_count = original_count - session_safe_pairs
    if len(new_history) != expected_count:
        skipped_sessions.append({
            'sessionId': s['id'],
            'phone': s['leadPhone'],
            'original': original_count,
            'expected': expected_count,
            'actual': len(new_history),
        })
        stats['sessions_skipped_validation'] += 1
        continue

    # Sort chronologically
    new_history.sort(key=lambda x: x.get('ts') or 0)

    # Write back
    cur.execute(
        "UPDATE conversation_sessions SET messageHistory = %s, updatedAt = NOW() WHERE id = %s",
        (json.dumps(new_history), s['id'])
    )
    conn.commit()

    stats['sessions_modified'] += 1
    stats['messages_removed'] += session_safe_pairs

conn.close()

print("=" * 60)
print("CLEANUP EXECUTION REPORT")
print("=" * 60)
print(f"Sessions modified:              {stats['sessions_modified']}")
print(f"Messages removed:               {stats['messages_removed']}")
print(f"Messages enriched with opMsgId: {stats['messages_enriched']}")
print(f"Ambiguous groups skipped:       {stats['ambiguous_skipped']}")
print(f"Sessions skipped (validation):  {stats['sessions_skipped_validation']}")

if skipped_sessions:
    print()
    print("--- SESSIONS SKIPPED (validation mismatch) ---")
    for ss in skipped_sessions:
        print(f"  Session {ss['sessionId']} ({ss['phone']}): original={ss['original']} expected={ss['expected']} actual={ss['actual']}")
