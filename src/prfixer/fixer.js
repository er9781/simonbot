var git = require('../git/git');
var setup = require('../setup/setup');
var pullrequest = require('../pullrequest/pullrequest');
var buildkite = require('../buildkite/buildkite');
var fs = require('fs');
var github = require('../github/github');

const fetchBranches = async (env, pr) => {
    const remote = setup.getGitRemote(env);
    const base = pullrequest.getBaseBranch(pr);
    const branch = pullrequest.getBranch(pr);
    await git.fetch(remote, base, ['--force']);
    await git.fetch(remote, branch, ['--force']);
};

// just wraps common actions on a git branch (fetch, checkout, push, etc)
const gitBranchAction = async (env, pr, mainAction, forcePush = true) => {
    const remote = setup.getGitRemote(env);
    const branch = pullrequest.getBranch(pr);

    console.log(pr.title, 'diff checks');

    // force fetch to be sure. Maybe I just messed up my refs in my cloud install :shrug:
    await fetchBranches(env, pr);
    console.log('fetched');

    await git.checkout(branch);
    console.log('checked out');
    await git.clean();
    await git.reset('hard');

    await mainAction();

    // TODO consider retries on failed pushes?
    await git.push([...(forcePush ? ['--force'] : []), ...[remote, branch]]);
};

const rebasePr = async (env, pr) => {
    const base = pullrequest.getBaseBranch(pr);
    await gitBranchAction(env, pr, async () => await git.rebase(`origin/${base}`));
    // mark rebase as performed
    return await github.logRebase(pr);
};

const handleRebasePr = async (env, pr) => {
    if (pr.mergeable === 'CONFLICTING') {
        // TODO what to do if there are merge conflicts? email me?
        return;
    }

    // check retry count.
    const state = await github.getBotState(pr);
    if (state.numRebases >= 10) {
        console.log(`max rebases hit on ${pr.title}`);
        return;
    }

    // fetch the branch first.
    await fetchBranches(env, pr);

    const result = await git.raw([
        'rev-list',
        '--left-right',
        '--count',
        `origin/${pullrequest.getBaseBranch(pr)}...${pullrequest.getBranch(pr)}`,
    ]);
    const isBehindBase = parseInt(result.trim().split('\t')[0]) !== 0;

    // if not behind base, not much we can do. We could retry builds potentially, but we can also just
    // wait until there's a new commit on master. Seems better.
    if (isBehindBase) {
        return await rebasePr(env, pr);
    }
};

const handleRepoAction = async (env, pr, action) => {
    // cannot do them all in parallel since we're using only 1 cloned repo.
    // TODO maybe acquire lock for this stuff.
    try {
        return await action(env, pr);
    } catch (err) {
        // if any fails, continue on to the next one.
        // TODO log the error somewhere? Should I run sentry lmao?
    }
};

exports.handleAllPrsToRebase = async (env, prs) => {
    return prs.mapAsync(pr => handleRepoAction(env, pr, handleRebasePr));
};

const handleApplyGitDiff = async (env, pr) => {
    const patch = await buildkite.getDiffPatch(pr);

    if (patch) {
        await gitBranchAction(
            env,
            pr,
            async () => {
                // apply the patch.
                const path = '/tmp/diff.patch';
                fs.writeFileSync(path, patch);
                await git.raw(['apply', '--index', path]);

                // TODO figure out some intelligent way to create commit messages
                // based on the status? To start let's take the first directory to look ok.
                // TODO maybe split out adding files by top level dir? :)
                const firstModified = (await git.status()).modified.first();
                const dir = firstModified.split('/').first();
                await git.commit(`${dir}: commit generate code`);
            },
            false
        );
    }
};

exports.handleAllPrsToApplyGitDiff = async (env, prs) => {
    return prs.mapAsync(pr => handleRepoAction(env, pr, handleApplyGitDiff));
};
