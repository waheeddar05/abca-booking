#!/usr/bin/env python3
"""List ALL env var keys on playorbit project (no values)."""
import json, os, urllib.request

token_path = os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')
with open(token_path) as f:
    token = json.load(f).get('token', '')

team = 'team_CMm0HDZknn2YFYFiz6DNbunq'
url = f'https://api.vercel.com/v9/projects/playorbit/env?teamId={team}'
req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req) as r:
    envs = json.load(r).get('envs', [])

for e in sorted(envs, key=lambda x: x.get('key', '')):
    tgt = ','.join(e.get('target') or []) or f"custom={e.get('customEnvironmentIds')}"
    print(f"  [{tgt}] {e.get('key')}")
