#!/usr/bin/env python3
"""Update PRISMA_DATABASE_URL for the 'test' custom env on playorbit project.
Scoped strictly to customEnvironmentIds=[env_b52Z1eHk8WnWSTrFCmMAhk8NdIvz].
Will REFUSE to update if the row's target list is non-empty OR if it targets prod.
"""
import json, os, urllib.request

token_path = os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')
with open(token_path) as f:
    token = json.load(f).get('token', '')

team = 'team_CMm0HDZknn2YFYFiz6DNbunq'
project = 'playorbit'
test_env_id = 'env_b52Z1eHk8WnWSTrFCmMAhk8NdIvz'

NEW_VALUE = ('postgresql://neondb_owner:npg_hjleaR8goE2u@'
             'ep-bitter-fire-a1bdvv1o-pooler.ap-southeast-1.aws.neon.tech/neondb'
             '?sslmode=require&pgbouncer=true&connect_timeout=10'
             '&options=-c%20TimeZone%3DAsia%2FKolkata')

# Fetch all env vars
url = f'https://api.vercel.com/v9/projects/{project}/env?teamId={team}'
req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req) as r:
    envs = json.load(r).get('envs', [])

# Find PRISMA_DATABASE_URL scoped to the test custom env ONLY
target = None
for e in envs:
    if e.get('key') != 'PRISMA_DATABASE_URL':
        continue
    cust = e.get('customEnvironmentIds') or []
    tgt = e.get('target') or []
    if test_env_id in cust and not tgt:
        if target is not None:
            raise SystemExit('ERROR: multiple matching rows found, aborting')
        target = e

if target is None:
    raise SystemExit('ERROR: no matching PRISMA_DATABASE_URL row for test custom env')

# Safety: must NOT touch anything tied to standard production target
if 'production' in (target.get('target') or []):
    raise SystemExit('ABORT: row also targets production. Refusing to update.')

env_id = target['id']
print(f'Found env var id={env_id} scoped to customEnvIds={target.get("customEnvironmentIds")} target={target.get("target")}')

# PATCH the value
patch_url = f'https://api.vercel.com/v9/projects/{project}/env/{env_id}?teamId={team}'
body = json.dumps({'value': NEW_VALUE}).encode()
req = urllib.request.Request(
    patch_url,
    data=body,
    method='PATCH',
    headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    },
)
with urllib.request.urlopen(req) as r:
    resp = json.load(r)

print('PATCH response status: updated')
print(f'  key={resp.get("key")}  target={resp.get("target")}  customEnvIds={resp.get("customEnvironmentIds")}')
print(f'  updatedAt={resp.get("updatedAt")}')
