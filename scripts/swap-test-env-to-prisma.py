#!/usr/bin/env python3
"""Swap the `test` custom env (id=env_b52Z1eHk8WnWSTrFCmMAhk8NdIvz) on the
playorbit project from Neon → new Prisma Postgres DB.

Safety:
- Only touches env vars whose customEnvironmentIds includes the test env id.
- Refuses if any matched row also targets production/preview/development.
- Captures pre-change state to /tmp/playorbit-test-env-pre-swap.json for restore.
"""
import json, os, sys, urllib.request

TEAM = 'team_CMm0HDZknn2YFYFiz6DNbunq'
PROJECT = 'playorbit'
TEST_ENV_ID = 'env_b52Z1eHk8WnWSTrFCmMAhk8NdIvz'
KEYS_TO_REPLACE = ['DATABASE_URL', 'POSTGRES_URL', 'PRISMA_DATABASE_URL']

token = json.load(open(os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')))['token']

def api(method, path, body=None):
    url = f'https://api.vercel.com{path}{"&" if "?" in path else "?"}teamId={TEAM}'
    headers = {'Authorization': f'Bearer {token}'}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req) as r:
        return json.load(r) if r.read else None

# Load new DB env vars from clipboard-saved file
new_vals = {}
with open('/tmp/playorbit-test-db-env.txt') as f:
    for line in f:
        line = line.strip()
        if not line or '=' not in line:
            continue
        k, v = line.split('=', 1)
        new_vals[k.strip()] = v.strip().strip('"')

for key in KEYS_TO_REPLACE:
    if key not in new_vals:
        print(f'ABORT: missing new value for {key}')
        sys.exit(1)
print(f'Loaded {len(new_vals)} new values from clipboard file')

# Fetch current envs
envs = api('GET', f'/v9/projects/{PROJECT}/env').get('envs', [])

# Find rows scoped strictly to the test custom env
to_replace = []
for e in envs:
    if e.get('key') not in KEYS_TO_REPLACE:
        continue
    cust = e.get('customEnvironmentIds') or []
    tgt = e.get('target') or []
    if TEST_ENV_ID not in cust:
        continue
    if tgt:  # Has standard targets — refuse to touch
        print(f"ABORT: row for {e.get('key')} also targets {tgt}. Won't touch.")
        sys.exit(1)
    to_replace.append(e)

if len(to_replace) != 3:
    print(f'ABORT: expected 3 test-custom-env DB rows, found {len(to_replace)}')
    sys.exit(1)

# Snapshot pre-state with decrypted values
snapshot = []
for e in to_replace:
    val = api('GET', f'/v9/projects/{PROJECT}/env/{e["id"]}?decrypt=true').get('value', '')
    snapshot.append({**e, 'value': val})

snap_path = '/tmp/playorbit-test-env-pre-swap.json'
with open(snap_path, 'w') as f:
    json.dump(snapshot, f, indent=2)
os.chmod(snap_path, 0o600)
print(f'Snapshotted pre-state to {snap_path}')

# Apply PATCH to each
print()
for s in snapshot:
    key = s['key']
    new_val = new_vals[key]
    print(f'  PATCH {key} (id={s["id"]})')
    print(f'    old: {len(s["value"])} bytes, host={s["value"].split("@", 1)[1].split("/", 1)[0] if "@" in s["value"] else "?"}')
    print(f'    new: {len(new_val)} bytes, host={new_val.split("@", 1)[1].split("/", 1)[0] if "@" in new_val else "?"}')
    api('PATCH', f'/v9/projects/{PROJECT}/env/{s["id"]}', {'value': new_val})

# Verify
print('\nVerifying post-state...')
for s in snapshot:
    cur = api('GET', f'/v9/projects/{PROJECT}/env/{s["id"]}?decrypt=true').get('value', '')
    ok = cur == new_vals[s['key']]
    print(f'  {"✓" if ok else "✗"} {s["key"]} now matches new value: {ok}')
