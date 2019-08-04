var git = require('../git/git');
var config = require('../config');

const getBaseBranch = pr => pr.baseRef.name;
const getBranch = pr => pr.headRef.name;

const rebasePr = async (env, pr) => {
    const base = getBaseBranch(pr);
    const branch = getBranch(pr);

    await git.fetch(base);
    await git.fetch(branch);

    await git.checkout(branch);
    await git.clean();

    await git.rebase(`origin/${base}`);

    const remote = `https://${env.githubUsername}:${config.secrets.githubToken}@github.com/${
        config.secrets.repoowner
    }/${config.secrets.repo}`;
    // TODO consider retries on failed pushes?
    await git.push(['--force', remote, branch]);

    // ok, we did the rebase and push.

    return;
};

const handlePr = async (env, pr) => {
    if (pr.mergeable === 'CONFLICTING') {
        // TODO what to do if there are merge conflicts? email me?
    }
    const result = await git.raw([
        'rev-list',
        '--left-right',
        '--count',
        `origin/${getBaseBranch(pr)}...${getBranch(pr)}`,
    ]);
    const isBehindBase = parseInt(result.trim().split('\t')[0]) !== 0;

    console.log(pr.title, 'behind?', isBehindBase, env.githubUsername);

    // if not behind base, not much we can do. We could retry builds potentially, but we can also just
    // wait until there's a new commit on master. Seems better.
    if (isBehindBase) {
        // TODO PRE LAUNCH uncomment.
        return await rebasePr(env, pr);
    }
};

exports.handleAllPrs = async (env, prs) => {
    // cannot do them all in parallel since we're using only 1 cloned repo.
    for (let pr of prs) {
        try {
            await handlePr(env, pr);
        } catch (err) {
            // if any fails, continue on to the next one.
            // TODO log the error somewhere? Should I run sentry lmao?
        }
    }
};
