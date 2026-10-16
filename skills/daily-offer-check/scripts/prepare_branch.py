#!/usr/bin/env python3
"""Check out today's sweep branch; resume an earlier attempt only by fast-forward."""
import argparse
import subprocess
import sys

from list_active import REPO, date


class Refused(Exception):
    pass


def git(repo, *args):
    result = subprocess.run(['git', *args], cwd=str(repo), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'git ' + args[0] + ' failed')
    return result.stdout


def resolve(repo, ref):
    result = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', ref],
                            cwd=str(repo), capture_output=True, text=True)
    return result.stdout.strip() or None


def is_ancestor(repo, a, b):
    result = subprocess.run(['git', 'merge-base', '--is-ancestor', a, b],
                            cwd=str(repo), capture_output=True, text=True)
    if result.returncode == 0:
        return True
    if result.returncode == 1:
        return False
    raise RuntimeError(result.stderr.strip() or 'git merge-base failed')


def prepare(repo, today):
    sweep = f'chore/daily-offer-check-{today}'
    if git(repo, 'status', '--porcelain'):
        raise Refused('working tree is not clean; commit or stash local changes first')
    git(repo, 'fetch', '-q', 'origin')
    main = resolve(repo, 'refs/remotes/origin/main')
    if not main:
        raise Refused('origin/main not found after git fetch origin')
    remote = git(repo, 'ls-remote', '--heads', 'origin', f'refs/heads/{sweep}')
    pushed = any(line.split()[-1:] == [f'refs/heads/{sweep}'] for line in remote.splitlines())
    if pushed:
        git(repo, 'fetch', '-q', 'origin', f'+refs/heads/{sweep}:refs/remotes/origin/{sweep}')
        start, start_name = resolve(repo, f'refs/remotes/origin/{sweep}'), f'origin/{sweep}'
    else:
        start, start_name = main, 'origin/main'
    local = resolve(repo, f'refs/heads/{sweep}')
    if local is None:
        target, how = start, f'created from {start_name}'
    elif local == start:
        target, how = local, f'already at {start_name}'
    elif is_ancestor(repo, local, start):
        target, how = start, f'fast-forwarded to {start_name}'
    elif is_ancestor(repo, start, local):
        ahead = git(repo, 'rev-list', '--count', f'{start}..{local}').strip()
        target, how = local, f'resumed {ahead} local commit(s) ahead of {start_name}'
    else:
        raise Refused(f'{sweep} has diverged from {start_name}; '
                      f'inspect git log --oneline --graph {sweep} {start_name}')
    if not is_ancestor(repo, main, target):
        raise Refused(f'{sweep} at {target[:7]} does not contain origin/main ({main[:7]}); '
                      'it was cut from an older main, so its tree lacks the current skill. '
                      "Merge or close today's sweep PR, then rerun")
    if local is None:
        if pushed:
            git(repo, 'checkout', '-q', '-b', sweep, '--track', f'origin/{sweep}')
        else:
            git(repo, 'checkout', '-q', '-b', sweep, '--no-track', 'refs/remotes/origin/main')
    else:
        git(repo, 'checkout', '-q', sweep)
        if target != local:
            git(repo, 'merge', '-q', '--ff-only', target)
    if resolve(repo, 'HEAD') != target or git(repo, 'status', '--porcelain'):
        raise RuntimeError('post-checkout verification failed')
    print(f'OK branch {sweep} at {target[:7]} ({how})')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--today', required=True)
    parser.add_argument('--repo', default=str(REPO))
    args = parser.parse_args()
    try:
        date(args.today)
    except ValueError:
        parser.error('--today must be YYYY-MM-DD')
    try:
        return prepare(args.repo, args.today)
    except Refused as exc:
        print(f'Branch refused: {exc}', file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(exc.args[0] if exc.args and exc.args[0] else 'git failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
