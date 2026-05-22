#!/usr/bin/env python3
"""Read-only inspection of playorbit (prod) project env vars.
Prints KEY + targets + gitBranch only — NEVER values."""
import json, sys, os, urllib.request

token_path = os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')
with open(token_path) as f:
    token = json.load(f).get('token', '')

team = 'team_CMm0HDZknn2YFYFiz6DNbunq'
url = f'https://api.vercel.com/v9/projects/playorbit/env?teamId={team}'
req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req) as r:
    data = json.load(r)

envs = data.get('envs', [])
focus = ('DATABASE', 'POSTGRES', 'PRISMA', 'NEXTAUTH_URL', 'NEON', 'ACCELERATE')
print('=== DB/infra env vars in playorbit (prod) project ===')
for e in envs:
    key = e.get('key', '')
    if any(s in key.upper() for s in focus):
        targets = e.get('target', [])
        branch = e.get('gitBranch') or ''
        comment = e.get('comment', '') or ''
        cust_ids = e.get('customEnvironmentIds', []) or []
        suffix = f' (branch={branch})' if branch else ''
        suffix += f' [{comment}]' if comment else ''
        suffix += f' customEnvIds={cust_ids}' if cust_ids else ''
        print(f'  {key}: {targets}{suffix}')

# List custom environments on this project
print('\n=== Custom environments on playorbit project ===')
url2 = f'https://api.vercel.com/v9/projects/playorbit/custom-environments?teamId={team}'
req2 = urllib.request.Request(url2, headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req2) as r:
    ce_data = json.load(r)
for ce in ce_data.get('environments', []):
    print(f"  id={ce.get('id')}  slug={ce.get('slug')}  type={ce.get('type')}  branch_matcher={ce.get('branchMatcher')}")

print(f'\nTotal env vars in playorbit project: {len(envs)}')

# Now pull DECRYPTED values for the 'test' custom env DB-related vars,
# but print ONLY masked hostnames so secrets aren't leaked into console.
print('\n=== Decoded values for ALL DB env vars (masked) ===')
custom_env_id = 'env_b52Z1eHk8WnWSTrFCmMAhk8NdIvz'
from urllib.parse import urlparse
for e in envs:
    if e.get('key') not in ('DATABASE_URL', 'POSTGRES_URL', 'PRISMA_DATABASE_URL', 'NEXTAUTH_URL'):
        continue
    env_id = e.get('id')
    url_decrypt = f'https://api.vercel.com/v9/projects/playorbit/env/{env_id}?teamId={team}&decrypt=true'
    req = urllib.request.Request(url_decrypt, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as r:
        val_data = json.load(r)
    val = val_data.get('value', '')
    key = e.get('key')
    target = e.get('target') or []
    cust = e.get('customEnvironmentIds') or []
    scope_label = ','.join(target) if target else f'custom={cust}'
    if key == 'NEXTAUTH_URL':
        print(f'  [{scope_label}] {key} = {val}')
    else:
        # mask credentials, show host + path + query keys only
        try:
            p = urlparse(val)
            host = p.hostname
            qs = p.query
            scheme = p.scheme
            qkeys = ','.join(sorted({kv.split('=')[0] for kv in qs.split('&') if kv})) if qs else ''
            print(f'  [{scope_label}] {key} = {scheme}://***:***@{host}{p.path}?<{qkeys}>')
        except Exception as ex:
            print(f'  [{scope_label}] {key} = <parse error: {ex}>  raw_start={val[:30]!r}')
