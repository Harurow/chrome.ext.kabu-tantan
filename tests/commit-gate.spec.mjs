/**
 * コミットゲートのフック（.claude/hooks/commit-gate.mjs）が、コミットされる中身まで承認した中身と比べること
 * （docs/WORKFLOW.md「コミットされる中身を確かめる」）。
 *
 * ブラウザを起動しない。一時の git リポジトリで承認を記録し（全件のチェックは差し替えた関数で演じる）、
 * フックに Bash の呼び出しを渡して、通すか止めるかを見る。
 * 承認の記録（npm run approve）の条件は tests/check-record.spec.mjs が見る。
 * フックと本テストは chrome.ext.silent-tab の 89912be と同じ形にしてある（2つのフックを別々の形に分けない）。
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { computeChangeHash } from '../scripts/lib/change-hash.mjs'
import { runRecordedCheckAsync, approveAsync } from '../scripts/lib/check-record.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(repoRoot, '.claude', 'hooks', 'commit-gate.mjs')

let root

const gitAsync = (...args) => execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root })
/** 衝突で止まる git の操作。止まるのは想定どおりなので、失敗を無視する（テストの中の git はフックを通らない） */
const gitMayFailAsync = (...args) => gitAsync(...args).catch(() => {})
const write = (file, content) => writeFile(path.join(root, file), content)

/** 全件のチェックが通ったことにして承認を記録する */
const approve = async () => {
  const result = await approveAsync({
    root,
    runCheckAsync: async () => (await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: {} })).code,
    runDocsCheckAsync: async () => 0
  })
  expect(result.ok).toBe(true)
}

/**
 * a.txt を書き換えるコミットを、もとのブランチ（m1）と other（o1。続けて b.txt の o2、c.txt の o3）に作り、もとのブランチに戻る。
 * beforeEach の作業ツリーの変更は戻す
 * @returns {Promise<string>} もとのブランチの名前
 */
const divergeAsync = async () => {
  const main = (await gitAsync('rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  await gitAsync('checkout', '-q', '--', 'a.txt')
  await gitAsync('checkout', '-q', '-b', 'other')
  await write('a.txt', 'other\n')
  await gitAsync('commit', '-qam', 'o1')
  await write('b.txt', 'o2\n')
  await gitAsync('add', 'b.txt')
  await gitAsync('commit', '-qm', 'o2')
  await write('c.txt', 'o3\n')
  await gitAsync('add', 'c.txt')
  await gitAsync('commit', '-qm', 'o3')
  await gitAsync('checkout', '-q', main)
  await write('a.txt', 'main\n')
  await gitAsync('commit', '-qam', 'm1')
  return main
}

/**
 * 端末が無く、エディタの設定（GIT_EDITOR / EDITOR / VISUAL と、利用者・システムの git の設定の core.editor など）も無い状態で、
 * bash にコマンドを流す。エディタを待って止まったら、プロセスグループごと止めて失敗にする
 * （利用者の設定に core.editor = true があると、エディタを開く形でも通ってしまい、検出できない）
 */
const runWithoutTerminalAsync = (command) => new Promise((resolve, reject) => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  // 環境変数で渡す git の設定（GIT_CONFIG_COUNT / GIT_CONFIG_PARAMETERS）でも core.editor を差し込めるので消す
  for (const name of ['GIT_EDITOR', 'EDITOR', 'VISUAL', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[name]
  const child = spawn('bash', ['-c', command], { cwd: root, env, stdio: 'ignore', detached: true })
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // ちょうど終わっていた
    }
    reject(new Error(`端末の無い状態で 10 秒たっても終わらない（エディタを待っている）: ${command}`))
  }, 10_000)
  child.on('error', reject)
  child.on('close', (code) => { clearTimeout(timer); resolve(code) })
})

/** フックに Bash の呼び出しを渡し、止めたかどうかと理由を返す */
const gate = (command) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_PROJECT_DIR: root } })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.on('error', reject)
  child.on('close', (code) => {
    if (code !== 0) return reject(new Error(`フックが異常終了した (${code})`))
    const decision = out ? JSON.parse(out).hookSpecificOutput : null
    resolve({ denied: decision?.permissionDecision === 'deny', reason: decision?.permissionDecisionReason ?? '' })
  })
  child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }))
})

test.beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ktt-commit-gate-'))
  await gitAsync('init', '-q')
  await gitAsync('config', 'user.email', 'test@example.invalid')
  await gitAsync('config', 'user.name', 'test')
  // テストの中で bash から git を直接動かすときも、利用者の署名やフックの設定を使わない
  await gitAsync('config', 'commit.gpgsign', 'false')
  await gitAsync('config', 'core.hooksPath', '/dev/null')
  // 本物と同じ .gitignore（記録と承認のファイルは無視される）
  await write('.gitignore', await readFile(path.join(repoRoot, '.gitignore')))
  await write('a.txt', 'base\n')
  await gitAsync('add', '.gitignore', 'a.txt')
  await gitAsync('commit', '-q', '-m', 'init')
  await write('a.txt', 'changed\n')
})

test.afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test.describe('コミットゲート: コミットされる中身を確かめる', () => {
  test('承認した作業ツリーを git add -A && git commit で入れるなら通す', async () => {
    await write('b.txt', 'new\n')
    await approve()

    expect((await gate('git add -A && git commit -m x')).denied).toBe(false)
  })

  test('承認のあとで git add -A を別に実行していれば、git commit だけでも通す', async () => {
    await approve()
    await gitAsync('add', '-A')

    expect((await gate('git commit -m x')).denied).toBe(false)
  })

  test('承認がなければ止める', async () => {
    const result = await gate('git add -A && git commit -m x')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('レビュー未承認')
  })

  test('承認のあとで作業ツリーを変えたら止める', async () => {
    await approve()
    await write('a.txt', 'changed after approval\n')

    const result = await gate('git add -A && git commit -m x')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('承認後にファイルが変更されています')
  })

  test('git add していない git commit は止める', async () => {
    await approve()

    const result = await gate('git commit -m x')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('コミットされる中身')
  })

  test('ステージしてから作業ツリーだけ戻した中身は、git commit では止め、git add -A && git commit なら通す', async () => {
    // index にはテストしていない中身、作業ツリーにはテストする中身がある
    await write('a.txt', 'staged but not tested\n')
    await gitAsync('add', 'a.txt')
    await write('a.txt', 'changed\n')
    await approve()

    expect((await gate('git commit -m x')).denied).toBe(true)
    expect((await gate('git add -A && git commit -m x')).denied).toBe(false)
  })

  test('一部だけステージした状態の git commit は止める', async () => {
    await write('b.txt', 'new\n')
    await gitAsync('add', 'a.txt')
    await approve()

    expect((await gate('git commit -m x')).denied).toBe(true)
  })

  test('承認の hash は、ステージの状態によらず作業ツリーの中身で決まる', async () => {
    await write('b.txt', 'new\n')
    const unstaged = await computeChangeHash(root)
    await gitAsync('add', '-A')
    const staged = await computeChangeHash(root)

    expect(staged.hash).toBe(unstaged.hash)
  })

  test('パスを指定したコミットと、一部だけのコミット（-o / -i / -p）は止める', async () => {
    await approve()

    for (const command of [
      'git add -A && git commit -m x a.txt',
      'git add -A && git commit -m x -- a.txt',
      'git add -A && git commit -o a.txt -m x',
      'git add -A && git commit -i -m x',
      'git add -A && git commit -p -m x',
      'git add -A && git commit --pat -m x',
      'git add -A && git commit --pathspec-from-file=list.txt -m x'
    ]) {
      const result = await gate(command)
      expect(result.denied, command).toBe(true)
      expect(result.reason, command).toContain('一部だけのコミット')
    }
  })

  test('git commit -am "msg" の msg をパスと取り違えず、追跡しているファイルだけの変更なら通す', async () => {
    await approve()

    expect((await gate('git commit -am "a.txt"')).denied).toBe(false)
    expect((await gate('git commit -a -m a.txt')).denied).toBe(false)
  })

  test('git commit -a は未追跡のファイルを入れないので、未追跡のファイルがあれば止める', async () => {
    await write('b.txt', 'new\n')
    await approve()

    expect((await gate('git commit -am x')).denied).toBe(true)
  })

  test('git commit の前に作業ツリーを変えうるコマンドがあれば止め、読むだけのコマンドなら通す', async () => {
    await approve()

    const changer = await gate('echo x > b.txt && git add -A && git commit -m x')
    expect(changer.denied).toBe(true)
    expect(changer.reason).toContain('作業ツリーや環境を変えうるコマンド')

    // git add -A でも、書き出し先のファイル（b.txt）はコミットの前にできて、テストしていない中身が入る
    const addWrites = await gate('git add -A > b.txt && git commit -m x')
    expect(addWrites.denied).toBe(true)
    expect(addWrites.reason).toContain('作業ツリーや環境を変えうるコマンド')

    expect((await gate('git status && git add -A && git commit -m x >/dev/null')).denied).toBe(false)
  })

  test('引用符の中の < や > はリダイレクトとみなさない（-m の値の後ろのパスを見逃さない・echo の引数は書き出しではない）', async () => {
    await approve()

    expect((await gate('git add -A && git commit -m "<b>" a.txt')).denied).toBe(true)
    expect((await gate('echo "a>b" && git add -A && git commit -m x')).denied).toBe(false)
  })

  test('2>&1 の & を区切りと取り違えない', async () => {
    await approve()

    expect((await gate('git status 2>&1 && git add -A && git commit -m x 2>&1')).denied).toBe(false)
  })

  test('シェルを介した git commit と、git の場所を変えた git commit は止める', async () => {
    await approve()

    for (const command of [
      "bash -c 'git add -A && git commit -m x'",
      'git add -A && git -C . commit -m x',
      'git add -A && GIT_INDEX_FILE=/tmp/other-index git commit -m x',
      'git add -A && git -c core.worktree=/tmp commit -a -m x'
    ]) {
      expect((await gate(command)).denied, command).toBe(true)
    }
  })

  test('承認した中身をコミットした後は、revert / merge / cherry-pick / 2回目の commit を止める（承認は1回のコミットで使い切る）', async () => {
    await approve()
    await gitAsync('add', '-A')
    await gitAsync('commit', '-q', '-m', 'approved')

    for (const command of [
      'git revert --no-edit HEAD',
      'git merge other',
      'git cherry-pick other',
      'git commit --allow-empty -m y'
    ]) {
      expect((await gate(command)).denied, command).toBe(true)
    }
  })

  test('ヒアドキュメントに見えるものが、承認の無い git commit を隠さない', async () => {
    for (const command of [
      'echo "a <<b"\ngit commit -m x',
      'echo "<<EOF"\ngit commit -m x\nEOF',
      // 引用符の中の << を読むと、区切りの直後が空白なのでヒアドキュメントとみなし、後ろの EOF の行まで取り除く
      'echo "a <<EOF b"\ngit commit -m x\nEOF',
      // <<< はヒアストリング。後ろの << を読むと、EOF の行まで取り除く
      'cat <<< EOF >/dev/null\ngit commit -m x\nEOF',
      'cat <<END-X >/dev/null\nhi\nEND-X\ngit commit -m x',
      // 区切りを END までしか読まないと、後ろの END の行まで取り除いて本物の git commit を隠す
      'cat <<END-X >/dev/null\nhi\nEND-X\ngit commit -m x\nEND',
      // 一部だけ引用した区切り（bash の区切りは EOF）を E と読むと、後ろの E の行まで取り除く
      'cat <<E"O"F >/dev/null\nx\nEOF\ngit commit -m x\nE',
      "cat <<'E'OF >/dev/null\nx\nEOF\ngit commit -m x\nE",
      'echo $((a<<b))\ngit commit -m x'
    ]) {
      // 隠さずに git commit を見つけていれば、止める理由に出る
      const result = await gate(command)
      expect(result.denied, command).toBe(true)
      expect(result.reason, command).toContain('検出: git commit')
    }
  })

  test('xargs を介した git commit は止める（xargs が足すパスが見えない）', async () => {
    await write('b.txt', 'new\n')
    await approve()
    await gitAsync('add', '-A')

    const result = await gate('echo a.txt | xargs git commit -m x')
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('シェルやラッパーを介した git commit')
  })

  test('1回の呼び出しで git commit を2回行うものは止める', async () => {
    await approve()

    const result = await gate('git add -A && git commit -m x && git commit --allow-empty -m y')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('2回以上')
  })

  test('コミットメッセージのヒアドキュメントに git commit と書いても、コマンドと取り違えない', async () => {
    await approve()

    const command = "git add -A && git commit -F - <<'EOF'\n変更はすべて git add -A && git commit で入れる\ngit commit -m は使わない\nEOF\ngit log --oneline -1"

    expect((await gate(command)).denied).toBe(false)
    expect((await gate("git add -A && git commit -m \"$(cat <<'EOF'\ngit commit で入れる\nEOF\n)\" && git log --oneline -1")).denied).toBe(false)
  })

  test('git commit 以外でコミットを作るコマンドは、承認があっても止める（--skip・引数を添えた --continue・commit と同じ呼び出しのものも）', async () => {
    await approve()

    for (const command of [
      'git merge --no-edit --no-ff other',
      'git cherry-pick other',
      'git revert --no-edit HEAD',
      'git rebase other',
      'git am x.patch',
      // --skip は、残りの手順を続けてコミットを作る
      'git rebase --skip',
      'git cherry-pick --skip',
      'git merge --continue --no-verify',
      'npm version patch',
      'git add -A && git commit -m x && git merge other'
    ]) {
      const result = await gate(command)
      expect(result.denied, command).toBe(true)
      expect(result.reason, command).toContain('承認があっても止めます')
    }
  })

  test('merge の --continue は、コミットされる中身（index）が承認した中身と同じなら通し、違えば止める', async () => {
    await divergeAsync()
    await gitMayFailAsync('merge', '-q', 'other') // a.txt が衝突する
    await write('a.txt', 'resolved\n')
    await approve()

    // index には解決していない a.txt がある
    expect((await gate('git merge --continue')).denied).toBe(true)
    expect((await gate('git add -A && GIT_EDITOR=true git merge --continue')).denied).toBe(false)

    // index にはテストしていない中身、作業ツリーにはテストした中身がある
    await write('a.txt', 'staged but not tested\n')
    await gitAsync('add', '-A')
    await write('a.txt', 'resolved\n')
    expect((await gate('GIT_EDITOR=true git merge --continue')).denied).toBe(true)

    await gitAsync('add', '-A')
    expect((await gate('GIT_EDITOR=true git merge --continue')).denied).toBe(false)
  })

  test('止めたときに案内する --continue の形は、ゲートを通り、端末もエディタの設定も無い状態でエディタを待たずにコミットまで終わる', async () => {
    const recommended = 'git add -A && GIT_EDITOR=true git merge --continue'
    const main = await divergeAsync()

    // merge と rebase の --continue は、エディタを開く（cherry-pick・revert・am は開かない。git 2.54）
    const cases = [
      // 件名は、既定のブランチ名が master / main 以外だと後ろに " into <名前>" が付く
      { command: recommended, start: () => gitMayFailAsync('merge', '-q', 'other'), subject: /^Merge branch 'other'/ },
      {
        command: recommended.replace('merge', 'rebase'),
        start: async () => {
          await gitAsync('reset', '-q', '--hard', 'HEAD~1') // merge を取り消す
          await gitAsync('checkout', '-q', 'other')
          await gitAsync('reset', '-q', '--hard', 'HEAD~2') // 手順を o1 だけにする
          await gitMayFailAsync('rebase', main)
        },
        subject: /^o1$/
      }
    ]
    for (const { command, start, subject } of cases) {
      await start()
      await write('a.txt', 'resolved\n')
      await approve()

      expect((await gate('git merge other')).reason, command).toContain(recommended)
      expect((await gate(command)).denied, command).toBe(false)
      expect(await runWithoutTerminalAsync(command), command).toBe(0)
      expect((await gitAsync('status', '--porcelain')).stdout, command).toBe('')
      expect((await gitAsync('log', '-1', '--format=%s')).stdout.trim(), command).toMatch(subject)
    }
  })

  test('cherry-pick の --continue は、続きの手順が残っていれば止め、残っていなければ通す', async () => {
    await divergeAsync()
    await gitMayFailAsync('cherry-pick', 'other~2', 'other~1') // o1 が衝突し、o2 が残る
    await write('a.txt', 'resolved\n')
    await approve()

    const left = await gate('git add -A && git cherry-pick --continue')
    expect(left.denied).toBe(true)
    expect(left.reason).toContain('1 個残っています')

    await gitAsync('cherry-pick', '--abort')
    await gitMayFailAsync('cherry-pick', 'other~2') // o1 だけ
    await write('a.txt', 'resolved\n')
    await approve()

    expect((await gate('git add -A && git cherry-pick --continue')).denied).toBe(false)
  })

  test('revert の --continue は、続きの手順が残っていれば止め、残っていなければ通す', async () => {
    await gitAsync('commit', '-qam', 'r1')
    await write('a.txt', 'r2\n')
    await gitAsync('commit', '-qam', 'r2')
    await gitMayFailAsync('revert', '--no-edit', 'HEAD~1', 'HEAD') // r1 の取り消しが衝突し、r2 の取り消しが残る
    await write('a.txt', 'resolved\n')
    await approve()

    const left = await gate('git add -A && git revert --continue')
    expect(left.denied).toBe(true)
    expect(left.reason).toContain('1 個残っています')

    await gitAsync('revert', '--abort')
    await gitMayFailAsync('revert', '--no-edit', 'HEAD~1') // r1 の取り消しだけ
    await write('a.txt', 'resolved\n')
    await approve()

    expect((await gate('git add -A && git revert --continue')).denied).toBe(false)
  })

  test('rebase の --continue は、続きの手順が残っていれば止め（merge と apply の両方の作り）、残っていなければ通す', async () => {
    const main = await divergeAsync()
    await gitAsync('checkout', '-q', 'other')

    for (const backend of ['--merge', '--apply']) {
      await gitMayFailAsync('rebase', backend, main) // o1 が衝突し、o2・o3 が残る
      await write('a.txt', 'resolved\n')
      await approve()

      const left = await gate('git add -A && git rebase --continue')
      expect(left.denied, backend).toBe(true)
      expect(left.reason, backend).toContain('2 個残っています')
      await gitAsync('rebase', '--abort')
    }

    await gitAsync('reset', '-q', '--hard', 'HEAD~2') // o1 だけにする
    await gitMayFailAsync('rebase', main)
    await write('a.txt', 'resolved\n')
    await approve()

    expect((await gate('git add -A && git rebase --continue')).denied).toBe(false)
  })

  test('am の --continue は、続きのパッチが残っていれば止め、残っていなければ通す', async () => {
    const main = await divergeAsync()
    // パッチは .git の中に置く（作業ツリーの中身に入れない）
    const patches = (await gitAsync('format-patch', '-o', '.git/patches', `${main}..other`)).stdout.trim().split('\n')
    await gitMayFailAsync('am', ...patches) // o1 が当たらず、o2・o3 が残る
    await write('a.txt', 'resolved\n')
    await approve()

    const left = await gate('git add -A && git am --continue')
    expect(left.denied).toBe(true)
    expect(left.reason).toContain('2 個残っています')

    await gitAsync('am', '--abort')
    await gitMayFailAsync('am', patches[0]) // o1 だけ
    await write('a.txt', 'resolved\n')
    await approve()

    expect((await gate('git add -A && git am --continue')).denied).toBe(false)
  })

  test('git commit の前に set や GIT_ で始まる変数への代入があれば止める（別の index や場所でコミットさせうる）', async () => {
    await approve()

    for (const command of [
      'set -a; GIT_INDEX_FILE=/tmp/other-index; git add -A && git commit -m x',
      'GIT_INDEX_FILE=/tmp/other-index; git add -A && git commit -m x',
      'set -a && git add -A && git commit -m x'
    ]) {
      const result = await gate(command)
      expect(result.denied, command).toBe(true)
      expect(result.reason, command).toContain('作業ツリーや環境を変えうるコマンド')
    }
  })

  test('git pull はマージやリベースのコミットを作りうるので止め、--ff-only（後に書いた方が勝つ）と --dry-run は通す', async () => {
    for (const command of [
      'git pull --ff-only',
      'git pull --ff-only origin master',
      'git -c pull.rebase=true pull --ff-only',
      'git pull --no-ff --ff-only',
      'git pull --dry-run'
    ]) {
      expect((await gate(command)).denied, command).toBe(false)
    }

    await approve()
    for (const command of [
      'git pull',
      'git pull --no-edit origin master',
      'git pull --rebase',
      'git pull --ff-only --no-ff',
      'git pull --ff-only -r',
      'git pull --ff-only --rebase=merges',
      // 値を取るオプション（-o）の値に置いた --ff-only / --dry-run は効かない
      'git pull --no-rebase --no-edit -o --ff-only',
      'git pull -o --dry-run',
      "bash -c 'git pull'"
    ]) {
      const result = await gate(command)
      expect(result.denied, command).toBe(true)
      expect(result.reason, command).toContain('--ff-only')
    }
  })
})
