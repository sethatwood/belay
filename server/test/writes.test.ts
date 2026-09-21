// The Bash write-pattern table. Commands that reach the filesystem are denied
// on a step the person is meant to do themselves; everything else passes.

import assert from "node:assert/strict";
import test from "node:test";
import { writePattern } from "../src/lib/writes.js";

const ALLOW = [
  "npx vitest run",
  "npx vitest run --reporter=verbose",
  "tsc --noEmit",
  "npx tsc --noEmit 2>&1 | head -20",
  "npm test",
  "npm run build",
  "node --test",
  "git status",
  "git diff",
  "git diff --stat HEAD",
  "git log --oneline -5",
  "git show HEAD --stat",
  "git rev-parse --short HEAD",
  "ls -la src",
  "cat src/webhooks/verify.ts",
  "grep -rn constantTime src",
  "find . -name '*.ts' -not -path './node_modules/*'",
  "npx vitest run 2>&1",
  "echo x > /dev/null",
  "npm test &> /dev/null",
  'echo "a > b"',
  "grep -q signature src/x.ts <<< \"$body\"",
  "pnpm test",
  "cd server && npm test",
  "node script.js",
  "node --test test/",
  "python3 tools/report.py",
  "git stash list",
  "git stash show -p",
  "tar tzf release.tgz",
  "find . -name '*.log' -mtime +7",
  "timeout 60 npx vitest run",
  "env CI=1 npm test",
  "sh -c 'npm test'",
  "bash -c \"git diff --stat\"",
  'eval "npm test"',
  "git reset --soft HEAD~1",
  "pip list",
  "pip3 show requests",
  "uv run pytest",
  "uv pip list",
  "poetry run pytest",
  "python -m pytest",
  "python3 -m pip list",
];

const DENY: [string, string][] = [
  ["git diff > out.txt", "redirect"],
  ["echo hi >> notes.md", "redirect"],
  ["cat <<EOF > src/webhooks/verify.ts", "redirect"],
  ["cat <<'EOF'", "heredoc"],
  ["npm test | tee results.txt", "tee"],
  ["sed -i '' s/a/b/ src/x.ts", "sed -i"],
  ["sed -i.bak s/a/b/ src/x.ts", "sed -i"],
  ["perl -pi -e 's/a/b/' src/x.ts", "perl -i"],
  ["cp src/a.ts src/b.ts", "cp"],
  ["mv src/a.ts src/b.ts", "mv"],
  ["rm -rf dist", "rm"],
  ["mkdir -p src/webhooks", "mkdir"],
  ["touch src/webhooks/verify.ts", "touch"],
  ["ln -s ../a src/b", "ln"],
  ["git apply fix.patch", "git apply"],
  ["git checkout -- src/x.ts", "git checkout"],
  ["git checkout src/x.ts", "git checkout"],
  ["git checkout main", "git checkout"],
  ["git switch main", "git switch"],
  ["git clean -fd", "git clean"],
  ["git rm src/x.ts", "git rm"],
  ["git mv a.ts b.ts", "git mv"],
  ["git pull", "git pull"],
  ["git merge feature", "git merge"],
  ["git rebase main", "git rebase"],
  ["git stash", "git stash"],
  ["git stash push -m wip", "git stash"],
  ["git reset --merge", "git reset --hard"],
  ["bash -c \"echo x > src/f.ts\"", "redirect"],
  ["sh -c 'rm -rf dist'", "rm"],
  ["zsh -c 'sed -i s/a/b/ f'", "sed -i"],
  ['eval "cp a b"', "cp"],
  ["node -e \"require('fs').writeFileSync('f','x')\"", "node inline"],
  ["node --eval \"1\"", "node inline"],
  ["python3 -c \"open('f','w').write('x')\"", "python3 inline"],
  ["python -c 'print(1)'", "python inline"],
  ["ruby -e 'File.write(\"f\",\"x\")'", "ruby inline"],
  ["env FOO=1 rm f", "rm"],
  ["sudo -u me rm f", "rm"],
  ["xargs -0 rm", "rm"],
  ["timeout 5 cp a b", "cp"],
  ["find . -name '*.log' -delete", "find -exec"],
  ["find . -name '*.ts' -exec rm {} \\;", "find -exec"],
  ["tar xzf a.tgz", "tar x"],
  ["tar -xvf a.tar", "tar x"],
  ["tar --extract -f a.tar", "tar x"],
  ["rsync -a a/ b/", "rsync"],
  ["unzip a.zip", "unzip"],
  ["dd if=/dev/zero of=f bs=1 count=1", "dd"],
  ["git restore src/x.ts", "git restore"],
  ["git stash pop", "git stash"],
  ["git reset --hard HEAD", "git reset --hard"],
  ["patch -p1 < fix.diff", "patch"],
  ["npx create-vite my-app", "npx create-"],
  ["npm init -y", "npm init"],
  ["npm install zod", "npm install"],
  ["pnpm add zod", "npm install"],
  ["npm test && echo ok > done.txt", "redirect"],
  ["sudo rm -rf /tmp/x", "rm"],
  ["npm test > /dev/null && cp a b", "cp"],
  ["pip install requests", "package install"],
  ["pip3 install -r requirements.txt", "package install"],
  ["python -m pip install requests", "package install"],
  ["python3 -m pip install -U pip", "package install"],
  ["uv add httpx", "package install"],
  ["uv pip install requests", "package install"],
  ["uv sync", "package install"],
  ["poetry add httpx", "package install"],
  ["poetry install", "package install"],
  ["pipx install ruff", "package install"],
];

for (const command of ALLOW) {
  test(`allows ${command}`, () => {
    assert.equal(writePattern(command), null, `${command} should be allowed`);
  });
}

for (const [command, pattern] of DENY) {
  test(`denies ${command} as ${pattern}`, () => {
    assert.equal(writePattern(command), pattern);
  });
}

test("the JavaScript installers keep their own pattern name", () => {
  assert.equal(writePattern("npm install zod"), "npm install");
  assert.equal(writePattern("pnpm add zod"), "npm install");
  assert.equal(writePattern("yarn"), "npm install");
  assert.equal(writePattern("bun install"), "npm install");
});

test("a redirect inside a quoted string is text, not a write", () => {
  assert.equal(writePattern("git commit -m \"added a > b check\""), null);
});

test("an fd duplication is not a write", () => {
  assert.equal(writePattern("npm run build 2>&1"), null);
  assert.equal(writePattern("npm run build >&2"), null);
});
