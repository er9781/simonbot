var git = require('../git/git');

const getBaseBranch = pr => pr.baseRef.name;
const getBranch = pr => pr.headRef.name;

const rebasePr = async pr => {
    const base = getBaseBranch(pr);
    const branch = getBranch(pr);

    await git.fetch(base);
    await git.fetch(branch);

    await git.checkout(branch);
    await git.clean();

    await git.rebase(`origin/${base}`);

    try {
        await git.push('--force');
    } catch (err) {
        // TODO what to do? retry?
    }

    // ok, we did the rebase and push.

    return;
};

const handlePr = async pr => {
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

    console.log(pr.title, 'behind?', isBehindBase);

    // if not behind base, not much we can do. We could retry builds potentially, but we can also just
    // wait until there's a new commit on master. Seems better.
    if (isBehindBase) {
        // TODO PRE LAUNCH uncomment.
        // return await rebasePr(pr);
    }
};

exports.handlePr = handlePr;
