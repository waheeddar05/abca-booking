#!/usr/bin/env python3
"""Find the latest `test` custom env deployment on the playorbit project."""
import json, os, urllib.request, datetime

token_path = os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')
with open(token_path) as f:
    token = json.load(f).get('token', '')

team = 'team_CMm0HDZknn2YFYFiz6DNbunq'
project_id = 'prj_xkBio8oKbWj6zYTeIpre1u4DP1tv'  # playorbit (prod project)

url = f'https://api.vercel.com/v6/deployments?teamId={team}&projectId={project_id}&limit=15'
req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req) as r:
    data = json.load(r)

print(f'{"created":<20}  {"branch":<30}  {"state":<10}  {"target":<12}  {"customEnv":<8}  url')
for dep in data.get('deployments', []):
    meta = dep.get('meta', {}) or {}
    branch = meta.get('githubCommitRef') or meta.get('branch') or ''
    state = dep.get('state') or dep.get('readyState') or ''
    ts = datetime.datetime.fromtimestamp(dep.get('created', 0)/1000).strftime('%Y-%m-%d %H:%M:%S')
    target = dep.get('target') or ''
    ce = dep.get('customEnvironment') or {}
    ce_slug = ce.get('slug') if isinstance(ce, dict) else ''
    dep_url = dep.get('url', '')
    print(f'{ts:<20}  {branch:<30}  {state:<10}  {target:<12}  {ce_slug or "-":<8}  https://{dep_url}')
