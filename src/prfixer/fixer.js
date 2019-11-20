var git = require('../git/git');
var setup = require('../setup/setup');
var pullrequest = require('../pullrequest/pullrequest');
var buildkite = require('../buildkite/buildkite');
var fs = require('fs');
var github = require('../github/github');
var constants = require('../constants');

const fetchBranches = async (env, pr) => {
    // the stuff below is an attempt at an optimization where we'd
    // only fetch the branches we need, but that seems silly and was
    // not working properly. Just fetch the world.
    await git.raw(['fetch', 'origin', '--force']);
    // const remote = setup.getGitRemote(env);
    // const base = pullrequest.getBaseBranch(pr);
    // const branch = pullrequest.getBranch(pr);
    // await git.fetchForce(remote, base);
    // await git.fetchForce(remote, branch);
};

// just wraps common actions on a git branch (fetch, checkout, push, etc)
const gitBranchAction = async (env, pr, mainAction, forcePush = true) => {
    const remote = setup.getGitRemote(env);
    const branch = pullrequest.getBranch(pr);

    // force fetch to be sure. Maybe I just messed up my refs in my cloud install :shrug:
    await fetchBranches(env, pr);

    // await git.checkout(branch);
    await git.raw(['checkout', branch, '--force']);
    await git.clean();
    // reset hard to the remote ref no matter what.
    await git.raw(['reset', '--hard', `origin/${branch}`]);

    await mainAction();

    // recheck trigger prior to pushing in case they've removed it.
    

    // force with lease will fail if other updates have been pushed
    // since our last fetch. This is muuuuuch better than --force in case
    // any body has pushed to their branch while we're operating on it.
    try {
        // this doesn't work. Dropping to regular git push operation which requires an ssh key
        // unfortunately. TODO fix this.
        await git.raw(['push', remote, branch, ...(forcePush ? ['--force-with-lease'] : [])]);
    } catch (err) {
        console.log(err.message);

        const args = ['push', 'origin', branch, ...(forcePush ? ['--force-with-lease'] : [])];
        console.log(`attempting push with args ${args.join(' ')}`);
        await git.raw(args);
    }
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
    const numRebases = github.getNumberOfRebases(pr);
    if (numRebases >= constants.MAX_REBASE_ATTEMPTS) {
        console.log(`max rebases hit on ${pr.title}`);
        return;
    }

    let isBehindBase = true;
    try {
        // fetch the branch first.
        await fetchBranches(env, pr);

        // this fails if our local branch is on this branch and failed to push previously.
        // we probably want to check origin's status
        const result = await git.raw([
            'rev-list',
            '--left-right',
            '--count',
            `origin/${pullrequest.getBaseBranch(pr)}...origin/${pullrequest.getBranch(pr)}`,
        ]);
        isBehindBase = parseInt(result.trim().split('\t')[0]) !== 0;
    } catch (err) {
        console.log(err);
    }

    // if not behind base, not much we can do. We could retry builds potentially, but we can also just
    // wait until there's a new commit on master. Seems better.
    if (isBehindBase) {
        return await rebasePr(env, pr);
    } else {
        console.log('Already up to date with base');
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
                await git.commit(`${dir}: commit generated code`);
            },
            // don't force push in case the user has pushed to their branch
            false
        );
    }
};

exports.handleAllPrsToApplyGitDiff = async (env, prs) => {
    return prs.mapAsync(pr => handleRepoAction(env, pr, handleApplyGitDiff));
};
