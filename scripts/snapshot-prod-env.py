#!/usr/bin/env python3
"""Snapshot the prod DB env vars on playorbit project to disk.
Stores them in /tmp/playorbit-prod-env-snapshot.json with mode 0600.
This is the restore source if Vercel's integration overwrites them.
NEVER prints values to stdout."""
import json, os, urllib.request, stat

token_path = os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')
with open(token_path) as f:
    token = json.load(f).get('token', '')

team = 'team_CMm0HDZknn2YFYFiz6DNbunq'
url = f'https://api.vercel.com/v9/projects/playorbit/env?teamId={team}'
req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req) as r:
    envs = json.load(r).get('envs', [])

# Find prod-target DB env vars
prod_keys = ('DATABASE_URL', 'POSTGRES_URL', 'PRISMA_DATABASE_URL')
snapshot = []
for e in envs:
    if e.get('key') not in prod_keys:
        continue
    tgt = e.get('target') or []
    # only standard targets (NOT custom env)
    if not tgt:
        continue
    env_id = e.get('id')
    # fetch decrypted value
    url_decrypt = f'https://api.vercel.com/v9/projects/playorbit/env/{env_id}?teamId={team}&decrypt=true'
    req = urllib.request.Request(url_decrypt, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as r:
        val_data = json.load(r)
    snapshot.append({
        'id': env_id,
        'key': e.get('key'),
        'target': tgt,
        'value': val_data.get('value', ''),
        'gitBranch': e.get('gitBranch'),
        'type': e.get('type'),
    })

out_path = '/tmp/playorbit-prod-env-snapshot.json'
with open(out_path, 'w') as f:
    json.dump(snapshot, f, indent=2)
os.chmod(out_path, 0o600)

# Print only meta, not values
print(f'Snapshotted {len(snapshot)} prod env vars to {out_path}:')
for s in snapshot:
    v = s['value']
    # Show only hostname for sanity-check; mask credentials
    if v.startswith('prisma+postgres://'):
        host = 'accelerate.prisma-data.net'
    elif '@' in v:
        host = v.split('@', 1)[1].split('/', 1)[0]
    else:
        host = '<unparsed>'
    print(f"  {s['key']:<22} target={s['target']}  host={host}  bytes={len(v)}  id={s['id']}")
