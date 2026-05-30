#!/usr/bin/env python3
"""Look at Vercel integrations/storage for playorbit project to see if the
Development Prisma Postgres DB has Vercel-auto-managed env vars somewhere.
Read-only."""
import json, os, urllib.request

token_path = os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')
with open(token_path) as f:
    token = json.load(f).get('token', '')

team = 'team_CMm0HDZknn2YFYFiz6DNbunq'
project_id = 'prj_xkBio8oKbWj6zYTeIpre1u4DP1tv'  # playorbit

def get(path):
    url = f'https://api.vercel.com{path}{"&" if "?" in path else "?"}teamId={team}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

# Try storage stores attached to project
try:
    data = get(f'/v1/storage/stores?projectId={project_id}')
    print('=== Storage stores attached to playorbit project ===')
    for s in data.get('stores', []):
        print(f"  type={s.get('type')}  name={s.get('name')}  id={s.get('id')}  status={s.get('status')}")
except Exception as e:
    print(f'storage err: {e}')

# Try integrations
try:
    data = get(f'/v1/integrations/configurations?teamId={team}')
    print('\n=== Team integrations (filtered for prisma) ===')
    for c in data:
        if 'prisma' in (c.get('slug', '') + c.get('name', '')).lower():
            print(f"  slug={c.get('slug')}  name={c.get('name')}  id={c.get('id')}  projects={c.get('projects')}")
except Exception as e:
    print(f'integrations err: {e}')
