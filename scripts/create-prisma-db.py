#!/usr/bin/env python3
"""Discover the right API endpoint for creating a new Prisma Postgres DB
under the user's existing Vercel integration. READ-ONLY exploration first."""
import json, os, urllib.request

token_path = os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')
with open(token_path) as f:
    token = json.load(f).get('token', '')

team = 'team_CMm0HDZknn2YFYFiz6DNbunq'

def get(path):
    full = f'https://api.vercel.com{path}'
    sep = '&' if '?' in path else '?'
    full += f'{sep}teamId={team}'
    req = urllib.request.Request(full, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

# Try common storage list endpoints
candidates = [
    '/v1/storage/stores',
    '/v9/storage/stores',
    '/v1/integrations/installations',
]
for path in candidates:
    try:
        d = get(path)
        if isinstance(d, dict):
            keys = list(d.keys())
            print(f'OK {path}: keys={keys}')
            if 'stores' in d:
                for s in d.get('stores', []):
                    print(f"   store: id={s.get('id')} type={s.get('type')} name={s.get('name')} integrationId={s.get('integrationId')} installationId={s.get('integrationConfigurationId')}")
            if 'installations' in d:
                for i in d.get('installations', []):
                    print(f"   install: id={i.get('id')} slug={i.get('slug')}")
        else:
            print(f'OK {path}: list of {len(d)} items')
    except Exception as e:
        print(f'FAIL {path}: {e}')
