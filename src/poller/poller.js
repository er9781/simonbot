var github = require('../github/github');
var fixer = require('../prfixer/fixer');
var c = require('../common');

const delaySeconds = 5;

const mainActions = async env => {
    // we get the open prs up front so that each call below won't need to do it.
    const openPrs = await github.getOpenPrs();

    let { other = [], failingGitDiff = [] } = await github.getPrsToFixup(openPrs);

    console.log(
        'main',
        'other fixup prs',
        other.map(pr => pr.title),
        'failing diff',
        failingGitDiff.map(pr => pr.title)
    );

    if (env.buildkiteIsValid && failingGitDiff.length > 0) {
        // prs failing git diff will get the diff applied to them.
        await fixer.handleAllPrsToApplyGitDiff(env, failingGitDiff);
    } else {
        // if we don't have buildkite api, then let's default to just rebasing on
        // master for you. this is a no-op when failingGitDiff is undefined
        other = c.concat(other, failingGitDiff);
    }

    if (other.length > 0) {
        await fixer.handleAllPrsToRebase(env, other);
    }

    // TODO make this next thing work.
    // needs github app upgrade.
    // await github.mergePrs(openPrs);
};

const fireloop = env => {
    console.assert(env);
    const startMs = Date.now();

    // do main thing
    mainActions(env)
        .catch(err => {
            console.log(err);
            // TODO actual tracking?
        })
        .finally(() => {
            // trigger next loop. wait at least some delay from last loop to let github get up to date.
            const delay = Math.max(2000, delaySeconds * 1000 - (Date.now() - startMs));
            setTimeout(() => fireloop(env), delay);
        });
};

exports.fireloop = fireloop;
