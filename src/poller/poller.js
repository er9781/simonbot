var github = require('../github/github');
var buildkite = require('../buildkite/buildkite');
var fixer = require('../prfixer/fixer');
var c = require('../common');
var git = require('../git/git');
var jank = require('../jank/jank');

const mainActions = async env => {
    // once per loop, let's get master status to inform decisions;
    // We return a closure over it to memoize the buildkite call. todo pull in memoize helper
    const getLatestMaster = (() => {
        let latestBuild;
        return async () => {
            if (!latestBuild) {
                latestBuild = await buildkite.getLatestMasterBuild();
            }
            return latestBuild;
        };
    })();

    // prune the origin once per loop. This sometimes causes issues
    git.raw(['remote', 'prune', 'origin']);

    // we get the open prs up front so that each call below won't need to do it.
    const openPrs = await github.getOpenPrs();

    let [{ other = [], failingGitDiff = [] }, prsThatUpdateJankIndex] = await Promise.all([
        github.getPrsToFixup(openPrs),
        github.getJankIndexUpdatingPrs(openPrs),
    ]);

    const prsThatNeedJankSetting = prsThatUpdateJankIndex.filter(github.getJankHasNotBeenSet);

    console.log(
        'main',
        'other fixup prs',
        other.map(pr => pr.title),
        'failing diff',
        failingGitDiff.map(pr => pr.title),
        'janking',
        prsThatNeedJankSetting.map(pr => pr.title)
    );

    await Promise.all(prsThatNeedJankSetting.map(jank.postJankIndexFromPr));

    if (env.buildkiteIsValid && failingGitDiff.length > 0) {
        // prs failing git diff will get the diff applied to them.
        await fixer.handleAllPrsToApplyGitDiff(env, failingGitDiff);
    } else {
        // if we don't have buildkite api, then let's default to just rebasing on
        // master for you. this is a no-op when failingGitDiff is undefined
        other = c.concat(other, failingGitDiff);
    }

    if (other.length > 0) {
        await fixer.handleAllPrsToRebase(env, other, getLatestMaster);
    }

    // needs github app upgrade.
    await github.mergePrs(openPrs);
};

// restart every 2 hours
const autoRestartDelay = 2 * 60 * 60 * 1000;

const minDelayIntervalSeconds = 30;

// Misc actions we want to take on shutdown.
const shutdown = async () => {
    try {
        // log our current rate limit to monitor.
        const rateLimit = await github.getRateLimitInfo();
        console.log('current rate limit: ', JSON.stringify(rateLimit.graphql));
        console.log(`reset happening at ${new Date(rateLimit.graphql.reset * 1000)} it is now ${new Date()}`);
    } catch (err) {
        console.log('shutdown actions failed', err);
    }
};

const fireloop = (env, startTime = Date.now()) => {
    // scratchpad.
    // buildkite.getLatestMasterBuild().then(console.log);
    // return;

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
            const delay = Math.max(2000, minDelayIntervalSeconds * 1000 - (Date.now() - startMs));

            // if we're still less than the auto restart delay, poll again. Otherwise exit and let systemd restart us.
            if (Date.now() - startTime <= autoRestartDelay) {
                setTimeout(() => fireloop(env, startTime), delay);
            } else {
                // clean up and exit.
                shutdown().then();
            }
        });
};

exports.fireloop = fireloop;
